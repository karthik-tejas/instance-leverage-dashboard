"""Parse a Leverage Report .xlsx into normalized rows for the DB layer.

The workbook comes in TWO real-world layouts (discovered against the actual
Apurva.ai exports), so the parser auto-detects per instance sheet:

(A) NEW format (e.g. May/June 2026) -- matches the build prompt:
    * Summary sheet named like "Summary May 2026".
    * Each instance sheet has a TWO-row header: a top row naming each block
      ("Top Documents Sourced" | "Top Questions Asked and Frequency" |
       "Feedback Data" | "Total Questions Asked") and a second row of real
      column names. Blocks are side-by-side with independent row counts.
      The "Total Questions Asked" block is the full Q&A log.

(B) OLD format (e.g. April 2026) -- different export:
    * Summary sheet named "Monthly Summary April 2026".
    * Each instance sheet has a SINGLE header row of concrete column names and
      is ONE wide table (not independent blocks): a row is primarily a document,
      and may ALSO carry a top-question and/or feedback on the same row. There is
      NO separate Q&A-log block (question_text/answer_text hold the Q&A pairs, if
      any). Columns: Date of upload, Document URL, Document Name, Frequency,
      Questions asked, Frequency, question_text, answer_text, feedback,
      reaction_count, total_likes, total_dislikes, [Document URL, Frequency]*.

Detection is by HEADER TEXT, not exact positions, and tolerates a missing block.
"""

from __future__ import annotations

import re
from pathlib import Path

import pandas as pd

# Canonical block titles we look for in the NEW-format top header row.
NEW_BLOCK_TITLES = {
    "documents": "top documents sourced",
    "questions": "top questions asked",
    "feedback": "feedback data",
    "qa": "total questions asked",
}

# Canonical field per block, mapped from sub-header text (case-insensitive contains).
FIELD_MATCHERS = {
    "documents": [
        ("date_uploaded", ("date", "uploaded")),
        ("doc_url", ("url",)),
        ("doc_name", ("name", "document")),
        ("frequency", ("frequen",)),
    ],
    "questions": [
        ("question", ("question",)),
        ("count", ("count",)),
    ],
    "feedback": [
        ("question", ("question",)),
        ("answer", ("answer",)),
        ("feedback", ("feedback",)),
        ("count", ("count",)),
        ("likes", ("like",)),
        ("dislikes", ("dislike",)),
    ],
    "qa": [
        ("date", ("date", "time", "timestamp")),
        ("question", ("question", "asked")),
        ("answer", ("answer",)),
        ("source", ("source",)),
    ],
}


def _norm(s) -> str:
    if s is None:
        return ""
    # Collapse any non-alphanumeric run (spaces, hyphens, underscores) to a
    # single space so "IMPACT-FAILURE" == "IMPACT_FAILURE" == "impact failure".
    return re.sub(r"[^a-z0-9]+", " ", str(s).lower()).strip()


def _is_empty(v) -> bool:
    if v is None:
        return True
    if isinstance(v, float):
        return pd.isna(v)
    return str(v).strip() == ""


def _cell(raw: pd.DataFrame, r: int, c: int):
    if r < 0 or c < 0 or r >= raw.shape[0] or c >= raw.shape[1]:
        return None
    return raw.iat[r, c]


# --------------------------------------------------------------------------- #
# Workbook entry point
# --------------------------------------------------------------------------- #

def _resolve_instance_name(name: str, keys: list[str]) -> str:
    """Reconcile a Summary-sheet display name to an actual instance sheet name.

    The Summary sheet uses human names ("MILLET", "Pcw", "Irena") that differ in
    casing/prefix from the instance sheet tabs ("SELCO_MILLET", "PCW", "IRENA").
    We match case-insensitively, preferring an exact match, else the shortest
    sheet whose name contains (or is contained by) the summary name -- so
    "IMPACT" maps to "IMPACT" not "IMPACT_FAILURE". Unmatched names are kept
    as-is (a dormant instance with no sheet data).
    """
    n = _norm(name)
    for k in keys:
        if _norm(k) == n:
            return k
    cands = [k for k in keys if n in _norm(k) or _norm(k) in n]
    if cands:
        return min(cands, key=len)
    return name


def parse_workbook(path: str | Path) -> dict:
    path = str(path)
    xls = pd.ExcelFile(path, engine="openpyxl")

    summary_sheet = _find_summary_sheet(xls.sheet_names)
    month_label = Path(path).stem

    # Parse instance sheets first so Summary names can be reconciled to them.
    instances: dict[str, dict] = {}
    for sn in xls.sheet_names:
        if summary_sheet and sn == summary_sheet:
            continue
        if _norm(sn) in ("readme", "notes", "instructions"):
            continue
        inst = _parse_instance_sheet(xls, sn)
        if inst:
            instances[sn.strip()] = inst

    summary = []
    if summary_sheet:
        month_label = _month_label_from_summary(summary_sheet, month_label)
        summary = _parse_summary(pd.read_excel(xls, sheet_name=summary_sheet, header=0))
        keys = list(instances.keys())
        for s in summary:
            s["instance"] = _resolve_instance_name(s["instance"], keys)

    return {"month_label": month_label, "summary": summary, "instances": instances}


def _find_summary_sheet(sheet_names: list[str]) -> str | None:
    for sn in sheet_names:
        if "summary" in _norm(sn):
            return sn
    return None


def _month_label_from_summary(sheet_name: str, fallback: str) -> str:
    n = _norm(sheet_name)
    for prefix in ("monthly summary", "summary"):
        if n.startswith(prefix):
            label = sheet_name[len(prefix):].strip()
            if label:
                return label
    return fallback


# --------------------------------------------------------------------------- #
# Summary sheet
# --------------------------------------------------------------------------- #

def _pick(cols_norm: dict[str, str], needles: tuple[str, ...]) -> str | None:
    for needle in needles:
        for cn, orig in cols_norm.items():
            if needle in cn:
                return orig
    return None


def _parse_summary(sdf: pd.DataFrame) -> list[dict]:
    cols = {_norm(c): c for c in sdf.columns}
    name_col = _pick(cols, ("instance", "name"))
    q_col = _pick(cols, ("question", "asked"))
    u_col = _pick(cols, ("active user", "user"))
    if not name_col:
        return []
    out = []
    for _, row in sdf.iterrows():
        name = row[name_col]
        if _is_empty(name):
            continue
        out.append({
            "instance": str(name).strip(),
            "questions_asked": row[q_col] if q_col else None,
            "active_users": row[u_col] if u_col else None,
        })
    return out


# --------------------------------------------------------------------------- #
# Instance sheet dispatch
# --------------------------------------------------------------------------- #

def _parse_instance_sheet(xls: pd.ExcelFile, sheet_name: str) -> dict | None:
    raw = pd.read_excel(xls, sheet_name=sheet_name, header=None)
    raw = raw.dropna(how="all", axis=1)
    raw = raw.dropna(how="all").reset_index(drop=True)
    if raw.shape[0] == 0:
        return None
    # Detect format by the first non-empty row.
    header_row = raw.iloc[0]
    is_new = any(NEW_BLOCK_TITLES["documents"] in _norm(v) for v in header_row.values)
    if is_new:
        return _parse_instance_new(raw)
    return _parse_instance_old(raw)


# --------------------------------------------------------------------------- #
# NEW format: two-row block headers
# --------------------------------------------------------------------------- #

def _find_top_header_row(raw: pd.DataFrame) -> int | None:
    found = set()
    for i, row in raw.iterrows():
        for val in row.values:
            nv = _norm(val)
            for key, title in NEW_BLOCK_TITLES.items():
                if title in nv and key not in found:
                    found.add(key)
        if len(found) >= 2:
            return int(i)
    return None


def _block_spans(raw: pd.DataFrame, top_row: int) -> dict[str, tuple[int, int]]:
    starts = {}
    for c in range(raw.shape[1]):
        nv = _norm(raw.iat[top_row, c])
        for key, title in NEW_BLOCK_TITLES.items():
            if title in nv:
                starts[key] = c
                break
    if not starts:
        return {}
    ordered = sorted(starts.items(), key=lambda kv: kv[1])
    spans = {}
    ncols = raw.shape[1]
    for idx, (key, start) in enumerate(ordered):
        end = (ordered[idx + 1][1] - 1) if idx + 1 < len(ordered) else (ncols - 1)
        spans[key] = (start, end)
    return spans


def _map_columns(sub_headers: list[str], block: str) -> dict[int, str]:
    mapping: dict[int, str] = {}
    for ci, raw_name in enumerate(sub_headers):
        nv = _norm(raw_name)
        if not nv:
            continue
        for field, needles in FIELD_MATCHERS[block]:
            if any(needle in nv for needle in needles):
                if field not in mapping.values():
                    mapping[ci] = field
                break
    return mapping


def _extract_block(raw: pd.DataFrame, top_row: int, span: tuple[int, int], block: str) -> list[dict]:
    start, end = span
    sub_row = top_row + 1
    data_start = top_row + 2
    sub_headers = [
        _norm(raw.iat[sub_row, c]) if c < raw.shape[1] else ""
        for c in range(start, end + 1)
    ]
    col_map = _map_columns(sub_headers, block)
    if not col_map:
        return []
    records = []
    for r in range(data_start, raw.shape[0]):
        rec = {}
        for c, field in col_map.items():
            rec[field] = _cell(raw, r, start + c)
        if all(_is_empty(v) for v in rec.values()):
            continue
        records.append(rec)
    return records


def _parse_instance_new(raw: pd.DataFrame) -> dict | None:
    top_row = _find_top_header_row(raw)
    if top_row is None:
        return None
    spans = _block_spans(raw, top_row)
    if not spans:
        return None
    result: dict[str, list[dict]] = {"documents": [], "questions": [], "feedback": [], "qa": []}
    for block, span in spans.items():
        result[block] = _extract_block(raw, top_row, span, block)
    return result


# --------------------------------------------------------------------------- #
# OLD format: single header row, one wide table, row-filtered blocks
# --------------------------------------------------------------------------- #

def _first_col(raw: pd.DataFrame, header_row_idx: int, *names: str) -> int | None:
    for c in range(raw.shape[1]):
        nv = _norm(_cell(raw, header_row_idx, c))
        if nv in names:
            return c
    return None


def _parse_instance_old(raw: pd.DataFrame) -> dict | None:
    hr = 0
    # Anchor columns by their concrete header text.
    di = _first_col(raw, hr, "date of upload")            # documents: date
    ui = _first_col(raw, hr, "document url")              # documents: url (primary)
    ni = _first_col(raw, hr, "document name")             # documents: name
    qi = _first_col(raw, hr, "questions asked")           # questions: question
    fbi = _first_col(raw, hr, "question_text")            # feedback: question
    if di is None or ui is None or ni is None:
        # Not the expected old layout; bail so it isn't silently mis-parsed.
        return None

    documents: list[dict] = []
    questions: list[dict] = []
    feedback: list[dict] = []
    qa: list[dict] = []

    # Secondary "Document URL / Frequency" columns (trailing duplicate docs).
    sec_doc_cols = [
        c for c in range(raw.shape[1])
        if _norm(_cell(raw, hr, c)) == "document url" and c != ui
    ]

    seen_doc_keys = set()
    for r in range(1, raw.shape[0]):
        # Documents (primary block)
        if not _is_empty(_cell(raw, r, ui)):
            rec = {
                "date_uploaded": _cell(raw, r, di),
                "doc_url": _cell(raw, r, ui),
                "doc_name": _cell(raw, r, ni),
                "frequency": _cell(raw, r, di + 3) if di + 3 < raw.shape[1] else None,
            }
            key = (str(rec["doc_url"]), str(rec["doc_name"]))
            if key not in seen_doc_keys:
                seen_doc_keys.add(key)
                documents.append(rec)
        # Top questions
        if qi is not None and not _is_empty(_cell(raw, r, qi)):
            questions.append({
                "question": _cell(raw, r, qi),
                "count": _cell(raw, r, qi + 1) if qi + 1 < raw.shape[1] else None,
            })
        # Feedback / Q&A pairs
        if fbi is not None and not _is_empty(_cell(raw, r, fbi)):
            feedback.append({
                "question": _cell(raw, r, fbi),
                "answer": _cell(raw, r, fbi + 1) if fbi + 1 < raw.shape[1] else None,
                "feedback": _cell(raw, r, fbi + 2) if fbi + 2 < raw.shape[1] else None,
                "count": _cell(raw, r, fbi + 3) if fbi + 3 < raw.shape[1] else None,
                "likes": _cell(raw, r, fbi + 4) if fbi + 4 < raw.shape[1] else None,
                "dislikes": _cell(raw, r, fbi + 5) if fbi + 5 < raw.shape[1] else None,
            })
            # These Q&A pairs ARE the (only) log for the old format.
            qa.append({
                "date": None,
                "question": _cell(raw, r, fbi),
                "answer": _cell(raw, r, fbi + 1) if fbi + 1 < raw.shape[1] else None,
                "source": None,
            })
        # Secondary documents (merge, de-dupe)
        for c in sec_doc_cols:
            if not _is_empty(_cell(raw, r, c)):
                rec = {
                    "date_uploaded": None,
                    "doc_url": _cell(raw, r, c),
                    "doc_name": None,
                    "frequency": _cell(raw, r, c + 1) if c + 1 < raw.shape[1] else None,
                }
                key = (str(rec["doc_url"]), "")
                if key not in seen_doc_keys:
                    seen_doc_keys.add(key)
                    documents.append(rec)

    return {"documents": documents, "questions": questions, "feedback": feedback, "qa": qa}


# Allow running as a quick CLI smoke check (no server needed).
if __name__ == "__main__":
    import sys, json
    if len(sys.argv) < 2:
        print("usage: python parser.py <file.xlsx>")
        sys.exit(1)
    parsed = parse_workbook(sys.argv[1])
    summary = {k: (len(v) if isinstance(v, list) else v) for k, v in parsed.items()}
    summary["instances"] = {
        k: {b: len(r) for b, r in v.items()} for k, v in parsed["instances"].items()
    }
    print(json.dumps(summary, indent=2, default=str))
