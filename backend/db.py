"""Storage layer for the Leverage Report dashboard.

Two interchangeable backends behind one API, selected at import time:
  * Local SQLite file  (default; used for local dev + the test suite)
  * Turso / libSQL      (used in production on Vercel, set via TURSO_DATABASE_URL)

Both speak the same SQL dialect (libSQL is a SQLite fork), so almost every
query below is backend-agnostic. The only real differences are handled by
the small `_connect` / `_dictify` shims:
  * sqlite3 gets a local file path; libsql gets an HTTP(S) URL + auth token.
  * Row access is normalized to plain dicts via cursor.description instead of
    relying on sqlite3.Row, since the two drivers don't expose the same row
    object type.
  * FTS5 (full-text search) is created opportunistically. If the connected
    engine doesn't support the fts5 module, search transparently falls back
    to a LIKE-based query (data volumes here are small, so this is fine).

Schema (normalized, one row per fact -- never a JSON blob per month):
    months        (month_id PK, month_label, uploaded_at, source_filename)
    instances     (instance_id PK, name)              -- upserted dynamically
    summary_stats (month_id FK, instance_id FK, questions_asked, active_users)
    top_documents (month_id FK, instance_id FK, date_uploaded, doc_url, doc_name, frequency)
    top_questions (month_id FK, instance_id FK, question, count)
    feedback      (month_id FK, instance_id FK, question, answer, feedback, count, likes, dislikes)
    qa_log        (id PK, month_id FK, instance_id FK, date, question, answer, source)

Design rules (from the build prompt):
  * Idempotent uploads: re-uploading a month_label replaces (delete-then-insert)
    every row for that month_id across all tables.
  * Dynamic instance list: upsert, never hardcode.
  * Index on (month_id, instance_id) for the common drill-down query.
"""

from __future__ import annotations

import os
import re
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

# Defaults resolve relative to the project root (parent of backend/), not the
# process cwd, so `uvicorn main:app` works the same whether it's launched from
# the repo root or from inside backend/.
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
DB_PATH = Path(os.environ.get("LEVERAGE_DB", _PROJECT_ROOT / "data" / "leverage.db")).resolve()
UPLOAD_DIR = Path(os.environ.get("LEVERAGE_UPLOADS", _PROJECT_ROOT / "data" / "uploads")).resolve()

TURSO_URL = os.environ.get("TURSO_DATABASE_URL", "").strip()
TURSO_TOKEN = os.environ.get("TURSO_AUTH_TOKEN", "").strip()
USING_TURSO = bool(TURSO_URL)

# Whether raw uploaded workbooks can be retained on local disk. Serverless
# hosts (Vercel) have an ephemeral filesystem, so this is only meaningful --
# and only attempted -- when we're NOT pointed at Turso.
PERSIST_RAW_UPLOADS = not USING_TURSO

_SCHEMA_STATEMENTS = [
    """CREATE TABLE IF NOT EXISTS months (
        month_id       INTEGER PRIMARY KEY AUTOINCREMENT,
        month_label    TEXT NOT NULL UNIQUE,
        sort_key       TEXT,
        uploaded_at    TEXT NOT NULL,
        source_filename TEXT NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS instances (
        instance_id INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT NOT NULL UNIQUE
    )""",
    """CREATE TABLE IF NOT EXISTS summary_stats (
        month_id      INTEGER NOT NULL REFERENCES months(month_id) ON DELETE CASCADE,
        instance_id   INTEGER NOT NULL REFERENCES instances(instance_id) ON DELETE CASCADE,
        questions_asked INTEGER NOT NULL DEFAULT 0,
        active_users    INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (month_id, instance_id)
    )""",
    """CREATE TABLE IF NOT EXISTS top_documents (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        month_id     INTEGER NOT NULL REFERENCES months(month_id) ON DELETE CASCADE,
        instance_id  INTEGER NOT NULL REFERENCES instances(instance_id) ON DELETE CASCADE,
        date_uploaded TEXT,
        doc_url      TEXT,
        doc_name     TEXT,
        frequency    INTEGER
    )""",
    """CREATE TABLE IF NOT EXISTS top_questions (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        month_id     INTEGER NOT NULL REFERENCES months(month_id) ON DELETE CASCADE,
        instance_id  INTEGER NOT NULL REFERENCES instances(instance_id) ON DELETE CASCADE,
        question     TEXT,
        count        INTEGER
    )""",
    """CREATE TABLE IF NOT EXISTS feedback (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        month_id     INTEGER NOT NULL REFERENCES months(month_id) ON DELETE CASCADE,
        instance_id  INTEGER NOT NULL REFERENCES instances(instance_id) ON DELETE CASCADE,
        question     TEXT,
        answer       TEXT,
        feedback     TEXT,
        count        INTEGER,
        likes        INTEGER,
        dislikes     INTEGER
    )""",
    """CREATE TABLE IF NOT EXISTS qa_log (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        month_id     INTEGER NOT NULL REFERENCES months(month_id) ON DELETE CASCADE,
        instance_id  INTEGER NOT NULL REFERENCES instances(instance_id) ON DELETE CASCADE,
        date         TEXT,
        question     TEXT,
        answer       TEXT,
        source       TEXT
    )""",
    "CREATE INDEX IF NOT EXISTS idx_qa_month_instance ON qa_log(month_id, instance_id)",
]

# Full-text search is created best-effort (see _init_fts below); not every
# SQLite-compatible engine ships the fts5 module.
_FTS_STATEMENTS = [
    """CREATE VIRTUAL TABLE IF NOT EXISTS qa_fts USING fts5(
        question, answer,
        content='qa_log', content_rowid='id'
    )""",
    """CREATE TRIGGER IF NOT EXISTS qa_fts_ai AFTER INSERT ON qa_log BEGIN
        INSERT INTO qa_fts(rowid, question, answer) VALUES (new.id, new.question, new.answer);
    END""",
    """CREATE TRIGGER IF NOT EXISTS qa_fts_ad AFTER DELETE ON qa_log BEGIN
        INSERT INTO qa_fts(qa_fts, rowid, question, answer) VALUES ('delete', old.id, old.question, old.answer);
    END""",
    """CREATE TRIGGER IF NOT EXISTS qa_fts_au AFTER UPDATE ON qa_log BEGIN
        INSERT INTO qa_fts(qa_fts, rowid, question, answer) VALUES ('delete', old.id, old.question, old.answer);
        INSERT INTO qa_fts(rowid, question, answer) VALUES (new.id, new.question, new.answer);
    END""",
]

_fts_checked = False
_fts_ok = False


def init_db(db_path: Path | None = None) -> Path:
    """Create the DB file/tables. Returns the resolved local DB path (unused
    when talking to Turso, but kept for the local/dev/test code path)."""
    path = db_path or DB_PATH
    if not USING_TURSO:
        path.parent.mkdir(parents=True, exist_ok=True)
        UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    with _connect(db_path) as conn:
        for stmt in _SCHEMA_STATEMENTS:
            conn.execute(stmt)
        _migrate_sort_key(conn)
    _init_fts(db_path)
    return path


_MONTH_NAMES = {
    name.lower(): i
    for i, name in enumerate(
        ["January", "February", "March", "April", "May", "June",
         "July", "August", "September", "October", "November", "December"],
        start=1,
    )
}


def month_sort_key(label: str) -> str:
    """Derive a chronologically-sortable "YYYY-MM" key from a month_label like
    "April 2026" or "2026-04". Falls back to the raw label if unparseable, so
    ordering degrades gracefully rather than crashing on odd labels."""
    label = (label or "").strip()
    m = re.match(r"^(\d{4})-(\d{2})$", label)
    if m:
        return f"{m.group(1)}-{m.group(2)}"
    m = re.match(r"^([A-Za-z]+)\.?\s+(\d{4})$", label)
    if m:
        month_num = _MONTH_NAMES.get(m.group(1).lower())
        if month_num:
            return f"{m.group(2)}-{month_num:02d}"
    m = re.match(r"^(\d{4})\s+([A-Za-z]+)$", label)
    if m:
        month_num = _MONTH_NAMES.get(m.group(2).lower())
        if month_num:
            return f"{m.group(1)}-{month_num:02d}"
    return f"zz-{label}"  # keeps unparseable labels sorting after real dates


def _migrate_sort_key(conn) -> None:
    """Add + backfill months.sort_key for DBs created before it existed."""
    cols = {r["name"] for r in _query(conn, "PRAGMA table_info(months)")}
    if "sort_key" not in cols:
        conn.execute("ALTER TABLE months ADD COLUMN sort_key TEXT")
    rows = _query(conn, "SELECT month_id, month_label FROM months WHERE sort_key IS NULL")
    for r in rows:
        conn.execute(
            "UPDATE months SET sort_key = ? WHERE month_id = ?",
            (month_sort_key(r["month_label"]), r["month_id"]),
        )


def _init_fts(db_path: Path | None) -> None:
    """Best-effort FTS5 setup; search falls back to LIKE if unsupported."""
    global _fts_checked, _fts_ok
    try:
        with _connect(db_path) as conn:
            for stmt in _FTS_STATEMENTS:
                conn.execute(stmt)
        _fts_ok = True
    except Exception:
        _fts_ok = False
    _fts_checked = True


def _raw_connection(db_path: Path | None):
    if USING_TURSO:
        import libsql  # local import: only required when actually deployed

        return libsql.connect(database=TURSO_URL, auth_token=TURSO_TOKEN)
    return sqlite3.connect(db_path or DB_PATH)


@contextmanager
def _connect(db_path: Path | None = None):
    conn = _raw_connection(db_path)
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def _dictify(cur) -> list[dict]:
    if cur.description is None:
        return []
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


def _query(conn, sql: str, params: Iterable = ()) -> list[dict]:
    cur = conn.execute(sql, tuple(params))
    return _dictify(cur)


def _query_one(conn, sql: str, params: Iterable = ()) -> dict | None:
    rows = _query(conn, sql, params)
    return rows[0] if rows else None


# --------------------------------------------------------------------------- #
# Ingest
# --------------------------------------------------------------------------- #

def upsert_instance(conn, name: str) -> int:
    """Insert instance if new, else return existing id. Name is the key."""
    name = (name or "").strip()
    row = _query_one(conn, "SELECT instance_id FROM instances WHERE name = ?", (name,))
    if row:
        return int(row["instance_id"])
    cur = conn.execute("INSERT INTO instances(name) VALUES (?)", (name,))
    return int(cur.lastrowid)


def _month_id(conn, month_label: str) -> int | None:
    row = _query_one(conn, "SELECT month_id FROM months WHERE month_label = ?", (month_label,))
    return int(row["month_id"]) if row else None


def _delete_month_cascade(conn, month_id: int) -> None:
    """Remove every CHILD row tied to a month_id (idempotent re-upload safety).

    The `months` row itself is kept so its month_id stays stable across
    re-uploads -- callers (and the frontend's selected month) must not see the
    id change. ingest_month updates the months row's metadata instead.
    """
    conn.execute("DELETE FROM summary_stats WHERE month_id = ?", (month_id,))
    conn.execute("DELETE FROM top_documents WHERE month_id = ?", (month_id,))
    conn.execute("DELETE FROM top_questions WHERE month_id = ?", (month_id,))
    conn.execute("DELETE FROM feedback WHERE month_id = ?", (month_id,))
    conn.execute("DELETE FROM qa_log WHERE month_id = ?", (month_id,))


def ingest_month(
    parsed: dict,
    *,
    source_filename: str,
    db_path: Path | None = None,
    uploaded_at: str | None = None,
) -> dict:
    """Persist a parsed workbook. Idempotent: re-uploading month_label replaces.

    `parsed` shape (see parser.parse_workbook):
        {
          "month_label": str,
          "summary": [{"instance": str, "questions_asked": int, "active_users": int}, ...],
          "instances": {
              name: {
                  "documents": [{"date_uploaded","doc_url","doc_name","frequency"}],
                  "questions": [{"question","count"}],
                  "feedback":  [{"question","answer","feedback","count","likes","dislikes"}],
                  "qa":        [{"date","question","answer","source"}],
              }, ...
          }
        }
    Returns a summary of row counts written.
    """
    month_label = parsed["month_label"]
    uploaded_at = uploaded_at or datetime.now(timezone.utc).isoformat()
    sort_key = month_sort_key(month_label)

    with _connect(db_path) as conn:
        # Idempotent: if this month already exists, wipe its child rows and
        # reuse the same month_id (don't insert a second month row).
        existing = _month_id(conn, month_label)
        if existing is not None:
            _delete_month_cascade(conn, existing)
            conn.execute(
                "UPDATE months SET uploaded_at = ?, source_filename = ?, sort_key = ? WHERE month_id = ?",
                (uploaded_at, source_filename, sort_key, existing),
            )
            month_id = existing
        else:
            cur = conn.execute(
                "INSERT INTO months(month_label, sort_key, uploaded_at, source_filename) VALUES (?,?,?,?)",
                (month_label, sort_key, uploaded_at, source_filename),
            )
            month_id = int(cur.lastrowid)

        # Summary sheet
        seen_summary = set()
        for s in parsed.get("summary", []):
            iid = upsert_instance(conn, s["instance"])
            if iid in seen_summary:  # defensive: skip duplicate resolved names
                continue
            seen_summary.add(iid)
            conn.execute(
                "INSERT INTO summary_stats(month_id, instance_id, questions_asked, active_users) "
                "VALUES (?,?,?,?)",
                (month_id, iid, _to_int(s.get("questions_asked")), _to_int(s.get("active_users"))),
            )

        # Per-instance blocks
        n_doc = n_q = n_fb = n_qa = 0
        for name, inst in parsed.get("instances", {}).items():
            iid = upsert_instance(conn, name)

            for d in inst.get("documents", []):
                conn.execute(
                    "INSERT INTO top_documents(month_id, instance_id, date_uploaded, doc_url, doc_name, frequency) "
                    "VALUES (?,?,?,?,?,?)",
                    (month_id, iid, _to_str(d.get("date_uploaded")), _to_str(d.get("doc_url")),
                     _to_str(d.get("doc_name")), _to_int(d.get("frequency"))),
                )
                n_doc += 1

            for q in inst.get("questions", []):
                conn.execute(
                    "INSERT INTO top_questions(month_id, instance_id, question, count) VALUES (?,?,?,?)",
                    (month_id, iid, _to_str(q.get("question")), _to_int(q.get("count"))),
                )
                n_q += 1

            for f in inst.get("feedback", []):
                conn.execute(
                    "INSERT INTO feedback(month_id, instance_id, question, answer, feedback, count, likes, dislikes) "
                    "VALUES (?,?,?,?,?,?,?,?)",
                    (month_id, iid, _to_str(f.get("question")), _to_str(f.get("answer")),
                     _to_str(f.get("feedback")), _to_int(f.get("count")),
                     _to_int(f.get("likes")), _to_int(f.get("dislikes"))),
                )
                n_fb += 1

            for row in inst.get("qa", []):
                conn.execute(
                    "INSERT INTO qa_log(month_id, instance_id, date, question, answer, source) "
                    "VALUES (?,?,?,?,?,?)",
                    (month_id, iid, _to_str(row.get("date")), _to_str(row.get("question")),
                     _to_str(row.get("answer")), _to_str(row.get("source"))),
                )
                n_qa += 1

    return {
        "month_id": month_id,
        "month_label": month_label,
        "source_filename": source_filename,
        "counts": {
            "summary": len(parsed.get("summary", [])),
            "instances": len(parsed.get("instances", {})),
            "documents": n_doc,
            "questions": n_q,
            "feedback": n_fb,
            "qa_log": n_qa,
        },
    }


# --------------------------------------------------------------------------- #
# Query helpers (used by the API layer)
# --------------------------------------------------------------------------- #

def list_months(db_path: Path | None = None) -> list[dict]:
    with _connect(db_path) as conn:
        return _query(
            conn,
            "SELECT month_id, month_label, source_filename FROM months "
            "ORDER BY COALESCE(sort_key, month_label)",
        )


def get_month_id_by_label(month_label: str, db_path: Path | None = None) -> int | None:
    with _connect(db_path) as conn:
        return _month_id(conn, month_label)


def latest_month_id(db_path: Path | None = None) -> int | None:
    with _connect(db_path) as conn:
        row = _query_one(conn, "SELECT MAX(month_id) AS m FROM months")
        return int(row["m"]) if row and row["m"] is not None else None


def list_instances(month_id: int, db_path: Path | None = None) -> list[str]:
    with _connect(db_path) as conn:
        rows = _query(
            conn,
            "SELECT DISTINCT i.name FROM summary_stats s JOIN instances i "
            "ON i.instance_id = s.instance_id WHERE s.month_id = ? ORDER BY i.name",
            (month_id,),
        )
    return [r["name"] for r in rows]


def list_all_instances(db_path: Path | None = None) -> list[str]:
    """Every instance ever seen, across all months (for the Compare picker)."""
    with _connect(db_path) as conn:
        rows = _query(conn, "SELECT name FROM instances ORDER BY name")
    return [r["name"] for r in rows]


def _month_before(conn, month_id: int | None) -> int | None:
    if month_id is None:
        return None
    row = _query_one(
        conn,
        "SELECT m2.month_id AS m FROM months m2 JOIN months m1 ON m1.month_id = ? "
        "WHERE COALESCE(m2.sort_key, m2.month_label) < COALESCE(m1.sort_key, m1.month_label) "
        "ORDER BY COALESCE(m2.sort_key, m2.month_label) DESC LIMIT 1",
        (month_id,),
    )
    return int(row["m"]) if row and row["m"] is not None else None


def get_overview(month_id: int | None, db_path: Path | None = None) -> dict:
    """Trend across ALL months (from summary_stats only) + leaderboard for the
    selected month, plus the previous month's leaderboard (keyed by instance)
    so the frontend can render month-over-month deltas. Never sums qa_log --
    that table is unbounded."""
    with _connect(db_path) as conn:
        trend = _query(
            conn,
            "SELECT m.month_id, m.month_label, "
            "COALESCE(SUM(s.questions_asked),0) AS total_questions, "
            "COALESCE(SUM(s.active_users),0) AS total_active_users "
            "FROM months m LEFT JOIN summary_stats s ON s.month_id = m.month_id "
            "GROUP BY m.month_id ORDER BY COALESCE(m.sort_key, m.month_label)",
        )
        sel = month_id or (trend[-1]["month_id"] if trend else None)
        leaderboard: list[dict] = []
        prev_leaderboard: list[dict] = []
        prev_month_id = _month_before(conn, sel)
        if sel is not None:
            leaderboard = _query(
                conn,
                "SELECT i.name AS instance, s.questions_asked, s.active_users "
                "FROM summary_stats s JOIN instances i ON i.instance_id = s.instance_id "
                "WHERE s.month_id = ? ORDER BY s.questions_asked DESC",
                (sel,),
            )
        if prev_month_id is not None:
            prev_leaderboard = _query(
                conn,
                "SELECT i.name AS instance, s.questions_asked, s.active_users "
                "FROM summary_stats s JOIN instances i ON i.instance_id = s.instance_id "
                "WHERE s.month_id = ?",
                (prev_month_id,),
            )
    return {
        "selected_month_id": sel,
        "previous_month_id": prev_month_id,
        "trend": trend,
        "leaderboard": leaderboard,
        "previous_leaderboard": prev_leaderboard,
    }


def get_instance_detail(month_id: int, instance: str, db_path: Path | None = None) -> dict:
    with _connect(db_path) as conn:
        iid_row = _query_one(conn, "SELECT instance_id FROM instances WHERE name = ?", (instance,))
        if not iid_row:
            return {"instance": instance, "found": False}
        iid = iid_row["instance_id"]

        docs = _query(
            conn,
            "SELECT date_uploaded, doc_url, doc_name, frequency FROM top_documents "
            "WHERE month_id = ? AND instance_id = ? ORDER BY COALESCE(frequency,0) DESC",
            (month_id, iid),
        )

        questions = _query(
            conn,
            "SELECT question, count FROM top_questions "
            "WHERE month_id = ? AND instance_id = ? ORDER BY COALESCE(count,0) DESC",
            (month_id, iid),
        )

        fb_tot = _query_one(
            conn,
            "SELECT COALESCE(SUM(likes),0) AS likes, COALESCE(SUM(dislikes),0) AS dislikes "
            "FROM feedback WHERE month_id = ? AND instance_id = ?",
            (month_id, iid),
        )

        disliked = _query(
            conn,
            "SELECT question, answer, feedback, count, likes, dislikes FROM feedback "
            "WHERE month_id = ? AND instance_id = ? AND COALESCE(dislikes,0) > 0 "
            "ORDER BY dislikes DESC",
            (month_id, iid),
        )

        # Per-instance summary stats (questions asked + active users).
        ss = _query_one(
            conn,
            "SELECT COALESCE(s.questions_asked,0) AS questions_asked, "
            "COALESCE(s.active_users,0) AS active_users "
            "FROM summary_stats s WHERE s.month_id = ? AND s.instance_id = ?",
            (month_id, iid),
        )
        questions_asked = ss["questions_asked"] if ss else 0
        active_users = ss["active_users"] if ss else 0

    return {
        "instance": instance,
        "found": True,
        "questions_asked": questions_asked,
        "active_users": active_users,
        "top_documents": docs,
        "top_questions": questions,
        "feedback_totals": {"likes": fb_tot["likes"], "dislikes": fb_tot["dislikes"]},
        "disliked_qa": disliked,
    }


def get_instance_comparison(instances: list[str], db_path: Path | None = None) -> dict:
    """Per-month questions_asked/active_users for each requested instance, for
    the side-by-side Compare view. Instances that don't exist are ignored."""
    instances = [i.strip() for i in instances if i.strip()]
    if not instances:
        return {"months": [], "series": []}
    with _connect(db_path) as conn:
        placeholders = ",".join("?" for _ in instances)
        rows = _query(
            conn,
            "SELECT m.month_id, m.month_label, i.name AS instance, "
            "COALESCE(s.questions_asked,0) AS questions_asked, "
            "COALESCE(s.active_users,0) AS active_users "
            f"FROM months m JOIN summary_stats s ON s.month_id = m.month_id "
            f"JOIN instances i ON i.instance_id = s.instance_id "
            f"WHERE i.name IN ({placeholders}) "
            "ORDER BY COALESCE(m.sort_key, m.month_label)",
            tuple(instances),
        )
        months = _query(
            conn,
            "SELECT month_id, month_label FROM months ORDER BY COALESCE(sort_key, month_label)",
        )

    by_instance: dict[str, dict[int, dict]] = {name: {} for name in instances}
    for r in rows:
        by_instance.setdefault(r["instance"], {})[r["month_id"]] = r

    series = []
    for name in instances:
        points = []
        for m in months:
            rec = by_instance.get(name, {}).get(m["month_id"])
            points.append({
                "month_id": m["month_id"],
                "month_label": m["month_label"],
                "questions_asked": rec["questions_asked"] if rec else 0,
                "active_users": rec["active_users"] if rec else 0,
            })
        series.append({"instance": name, "points": points})

    return {"months": months, "series": series}


_STATUS_ORDER = {
    "Activated": 0, "High Growth": 1, "Recovery": 2, "Stable": 3,
    "Declining": 4, "Sharp Decline": 5, "Dormant": 6, "Never Active": 7,
}


def _classify_status(q_prev: int, q_cur: int) -> str:
    if q_cur == 0:
        return "Dormant" if q_prev > 0 else "Never Active"
    if q_prev == 0:
        return "Activated"
    delta = (q_cur - q_prev) / q_prev * 100
    if delta >= 50:
        return "High Growth"
    if delta >= 10:
        return "Recovery"
    if delta > -10:
        return "Stable"
    if delta > -50:
        return "Declining"
    return "Sharp Decline"


def _pct_delta(cur: int, prev: int) -> float | None:
    if not prev:
        return None
    return round((cur - prev) / prev * 100, 1)


def get_report(month_id: int | None, db_path: Path | None = None) -> dict:
    """Everything the Report tab needs, computed directly from stored data --
    instance comparison + rule-based status classification, real knowledge
    leverage citations (actual top documents/questions, not summarized),
    real feedback excerpts, cumulative performance across every loaded month,
    and rule-based (threshold-driven) next-steps + key insights. No LLM call
    touches this path; every number and quote is sourced straight from the
    ingested workbook."""
    with _connect(db_path) as conn:
        months = _query(
            conn, "SELECT month_id, month_label FROM months ORDER BY COALESCE(sort_key, month_label)"
        )
        if not months:
            return {"empty": True}

        sel = month_id or months[-1]["month_id"]
        sel_label = next((m["month_label"] for m in months if m["month_id"] == sel), None)
        if sel_label is None:
            sel = months[-1]["month_id"]
            sel_label = months[-1]["month_label"]
        prev_id = _month_before(conn, sel)
        prev_label = next((m["month_label"] for m in months if m["month_id"] == prev_id), None)

        cur_rows = _query(
            conn,
            "SELECT i.name AS instance, s.questions_asked, s.active_users "
            "FROM summary_stats s JOIN instances i ON i.instance_id = s.instance_id WHERE s.month_id = ?",
            (sel,),
        )
        prev_rows = _query(
            conn,
            "SELECT i.name AS instance, s.questions_asked, s.active_users "
            "FROM summary_stats s JOIN instances i ON i.instance_id = s.instance_id WHERE s.month_id = ?",
            (prev_id,),
        ) if prev_id else []

        docs_rows = _query(
            conn,
            "SELECT i.name AS instance, d.doc_name, d.doc_url, d.frequency FROM top_documents d "
            "JOIN instances i ON i.instance_id = d.instance_id WHERE d.month_id = ? "
            "ORDER BY COALESCE(d.frequency,0) DESC",
            (sel,),
        )
        q_rows = _query(
            conn,
            "SELECT i.name AS instance, q.question, q.count FROM top_questions q "
            "JOIN instances i ON i.instance_id = q.instance_id WHERE q.month_id = ? "
            "ORDER BY COALESCE(q.count,0) DESC",
            (sel,),
        )
        feedback_rows = _query(
            conn,
            "SELECT i.name AS instance, COALESCE(SUM(f.likes),0) AS likes, "
            "COALESCE(SUM(f.dislikes),0) AS dislikes, COUNT(*) AS responses "
            "FROM feedback f JOIN instances i ON i.instance_id = f.instance_id "
            "WHERE f.month_id = ? GROUP BY i.name",
            (sel,),
        )
        disliked_rows = _query(
            conn,
            "SELECT i.name AS instance, f.question, f.answer, f.feedback, f.dislikes, f.likes "
            "FROM feedback f JOIN instances i ON i.instance_id = f.instance_id "
            "WHERE f.month_id = ? AND COALESCE(f.dislikes,0) > 0 ORDER BY f.dislikes DESC",
            (sel,),
        )
        all_month_rows = _query(
            conn,
            "SELECT i.name AS instance, m.month_id, m.month_label, "
            "COALESCE(s.questions_asked,0) AS questions_asked, COALESCE(s.active_users,0) AS active_users "
            "FROM summary_stats s "
            "JOIN instances i ON i.instance_id = s.instance_id "
            "JOIN months m ON m.month_id = s.month_id "
            "ORDER BY COALESCE(m.sort_key, m.month_label)",
        )

    prev_by_name = {r["instance"]: r for r in prev_rows}
    comparison = []
    for r in cur_rows:
        prev = prev_by_name.get(r["instance"], {"questions_asked": 0, "active_users": 0})
        q_cur, q_prev = r["questions_asked"], prev["questions_asked"]
        u_cur, u_prev = r["active_users"], prev["active_users"]
        comparison.append({
            "instance": r["instance"],
            "users_prev": u_prev, "users_cur": u_cur,
            "questions_prev": q_prev, "questions_cur": q_cur,
            "delta_pct": _pct_delta(q_cur, q_prev),
            "qu_prev": round(q_prev / u_prev, 2) if u_prev else 0,
            "qu_cur": round(q_cur / u_cur, 2) if u_cur else 0,
            "status": _classify_status(q_prev, q_cur),
        })
    comparison.sort(key=lambda r: (-r["questions_cur"]))

    total_questions = sum(r["questions_cur"] for r in comparison)
    total_users = sum(r["users_cur"] for r in comparison)
    prev_total_questions = sum(r["questions_prev"] for r in comparison)
    active_instances = sum(1 for r in comparison if r["questions_cur"] > 0)

    def _group_top(rows, key_field, limit=5):
        grouped: dict[str, list[dict]] = {}
        for r in rows:
            bucket = grouped.setdefault(r["instance"], [])
            if len(bucket) < limit:
                bucket.append({k: v for k, v in r.items() if k != "instance"})
        return grouped

    docs_by_instance = _group_top(docs_rows, "doc_name")
    questions_by_instance = _group_top(q_rows, "question")

    knowledge_leverage = [
        {
            "instance": r["instance"],
            "questions_asked": r["questions_cur"],
            "top_documents": docs_by_instance.get(r["instance"], []),
            "top_questions": questions_by_instance.get(r["instance"], []),
        }
        for r in comparison
        if r["questions_cur"] > 0
    ]

    fb_by_instance = {r["instance"]: r for r in feedback_rows}
    disliked_by_instance: dict[str, list[dict]] = {}
    for r in disliked_rows:
        bucket = disliked_by_instance.setdefault(r["instance"], [])
        if len(bucket) < 3:
            bucket.append({k: v for k, v in r.items() if k != "instance"})
    total_likes = sum(r["likes"] for r in feedback_rows)
    total_dislikes = sum(r["dislikes"] for r in feedback_rows)
    feedback = {
        "instances_with_feedback": len(feedback_rows),
        "total_responses": sum(r["responses"] for r in feedback_rows),
        "likes": total_likes,
        "dislikes": total_dislikes,
        "per_instance": [
            {
                "instance": name,
                "likes": fb["likes"],
                "dislikes": fb["dislikes"],
                "responses": fb["responses"],
                "sample_dislikes": disliked_by_instance.get(name, []),
            }
            for name, fb in fb_by_instance.items()
        ],
    }

    all_month_labels = [m["month_label"] for m in months]
    by_instance_months: dict[str, dict[str, int]] = {}
    for r in all_month_rows:
        by_instance_months.setdefault(r["instance"], {})[r["month_label"]] = r["questions_asked"]
    cumulative = []
    for name, by_label in by_instance_months.items():
        # Every instance gets one entry per loaded month (0 if it had no
        # summary row that month), aligned by label so the report table's
        # columns line up correctly even for instances that only appear in a
        # subset of months.
        pts = [by_label.get(label, 0) for label in all_month_labels]
        total = sum(pts)
        trend_status = _classify_status(pts[-2], pts[-1]) if len(pts) >= 2 else "Stable"
        cumulative.append({
            "instance": name,
            "months": [{"month_label": label, "questions_asked": q} for label, q in zip(all_month_labels, pts)],
            "total_questions": total,
            "trend_status": trend_status,
        })
    cumulative.sort(key=lambda r: -r["total_questions"])

    curation_next_steps = _build_next_steps(comparison)
    key_insights = _build_key_insights(
        comparison, total_questions, prev_total_questions, total_users,
        total_likes, total_dislikes, sel_label, prev_label,
    )

    return {
        "month_id": sel,
        "month_label": sel_label,
        "previous_month_id": prev_id,
        "previous_month_label": prev_label,
        "overview": {
            "total_instances": len(comparison),
            "active_instances": active_instances,
            "total_questions": total_questions,
            "previous_total_questions": prev_total_questions,
            "total_users": total_users,
            "delta_pct": _pct_delta(total_questions, prev_total_questions),
        },
        "comparison": comparison,
        "knowledge_leverage": knowledge_leverage,
        "feedback": feedback,
        "cumulative": cumulative,
        "curation_next_steps": curation_next_steps,
        "key_insights": key_insights,
    }


def _build_next_steps(comparison: list[dict]) -> list[dict]:
    templates = {
        "Dormant": lambda r: (
            f"Recorded 0 questions this month after {r['questions_prev']} previously "
            f"({r['users_cur']} users still registered). Schedule a facilitated "
            "re-engagement or refresher session and audit the knowledge base for relevance."
        ),
        "Never Active": lambda r: (
            f"Never recorded a question despite {r['users_cur']} registered users. "
            "Plan a structured first-use / onboarding session before adding more users."
        ),
        "Activated": lambda r: (
            f"First meaningful engagement this month ({r['questions_cur']} questions). "
            "Sustain momentum — revisit next month to confirm it's a lasting activation, not a one-off."
        ),
        "High Growth": lambda r: (
            f"Question volume grew {r['delta_pct']}% month-over-month. Monitor for user "
            "concentration (a few power users driving most volume) and expand content depth in "
            "the areas driving demand."
        ),
        "Recovery": lambda r: (
            f"Recovering — up {r['delta_pct']}% vs last month. Continue the current content/outreach "
            "approach and watch for a second consecutive month of growth to confirm the trend."
        ),
        "Declining": lambda r: (
            f"Question volume fell {abs(r['delta_pct'])}% month-over-month. Investigate the cause "
            "(content gap, user turnover, event-driven usage) and consider a targeted re-engagement."
        ),
        "Sharp Decline": lambda r: (
            f"Sharp drop of {abs(r['delta_pct'])}% month-over-month. Urgent: contact the programme "
            "lead to understand the cause before the instance goes fully dormant."
        ),
        "Stable": lambda r: "Usage is steady. Continue the current content and engagement cadence.",
    }
    return [
        {"instance": r["instance"], "status": r["status"], "action": templates[r["status"]](r)}
        for r in comparison
    ]


def _build_key_insights(
    comparison, total_questions, prev_total_questions, total_users,
    total_likes, total_dislikes, sel_label, prev_label,
) -> list[dict]:
    insights = []
    delta = _pct_delta(total_questions, prev_total_questions)
    if prev_label:
        direction = "up" if (delta or 0) >= 0 else "down"
        insights.append({
            "heading": f"Programme volume is {direction} {abs(delta)}% month-over-month" if delta is not None
            else "Programme volume has no prior-month baseline yet",
            "detail": (
                f"{sel_label} recorded {total_questions:,} total questions across "
                f"{len(comparison)} instances, versus {prev_total_questions:,} in {prev_label}."
            ),
        })
    else:
        insights.append({
            "heading": "First month of data",
            "detail": f"{sel_label} recorded {total_questions:,} total questions across {len(comparison)} instances.",
        })

    with_prev = [r for r in comparison if r["questions_prev"] > 0 and r["delta_pct"] is not None]
    if with_prev:
        riser = max(with_prev, key=lambda r: r["delta_pct"])
        if riser["delta_pct"] > 0:
            insights.append({
                "heading": f"{riser['instance']} is the biggest riser",
                "detail": (
                    f"Questions grew {riser['delta_pct']}% ({riser['questions_prev']} \u2192 "
                    f"{riser['questions_cur']}) month-over-month."
                ),
            })
        decliner = min(with_prev, key=lambda r: r["delta_pct"])
        if decliner["delta_pct"] < 0:
            insights.append({
                "heading": f"{decliner['instance']} is the biggest decliner",
                "detail": (
                    f"Questions fell {abs(decliner['delta_pct'])}% ({decliner['questions_prev']} \u2192 "
                    f"{decliner['questions_cur']}) month-over-month."
                ),
            })

    activated = [r["instance"] for r in comparison if r["status"] == "Activated"]
    if activated:
        insights.append({
            "heading": f"{len(activated)} instance(s) newly activated",
            "detail": "First meaningful engagement this month: " + ", ".join(activated) + ".",
        })

    went_dormant = [r["instance"] for r in comparison if r["status"] == "Dormant"]
    if went_dormant:
        insights.append({
            "heading": f"{len(went_dormant)} instance(s) went dormant this month",
            "detail": (
                "Previously active, now at zero questions: " + ", ".join(went_dormant) +
                ". Preventable dormancy — worth investigating before next month."
            ),
        })

    never_active = [r["instance"] for r in comparison if r["status"] == "Never Active"]
    if len(never_active) >= 3:
        insights.append({
            "heading": f"{len(never_active)} instances have never recorded a question",
            "detail": (
                "Persistent zero-engagement instances: " + ", ".join(never_active[:8]) +
                (f", and {len(never_active) - 8} more" if len(never_active) > 8 else "") +
                ". These represent onboarding, not content, gaps."
            ),
        })

    total_feedback = total_likes + total_dislikes
    if total_questions:
        fb_rate = round(total_feedback / total_questions * 100, 2)
        if fb_rate < 2:
            insights.append({
                "heading": "Feedback response rate is very low",
                "detail": (
                    f"Only {total_feedback} feedback responses recorded against {total_questions:,} "
                    f"questions ({fb_rate}%). Feedback is a key quality signal — consider prompting "
                    "for it more actively."
                ),
            })
    if total_feedback:
        dislike_rate = round(total_dislikes / total_feedback * 100, 1)
        if dislike_rate >= 40:
            insights.append({
                "heading": "Dislike rate is elevated",
                "detail": (
                    f"{total_dislikes} of {total_feedback} feedback responses ({dislike_rate}%) were "
                    "dislikes this month — review the disliked Q&A pairs in the Feedback section for "
                    "content gaps."
                ),
            })

    return insights


def get_qa_log(
    month_id: int,
    instance: str,
    q: str | None = None,
    source: str | None = None,
    page: int = 1,
    page_size: int = 25,
    db_path: Path | None = None,
) -> dict:
    """Paginated, searchable qa_log. Uses FTS5 when available so the search
    box stays fast as the table grows; falls back to LIKE otherwise (small
    data volumes here make that entirely fine)."""
    page = max(1, int(page))
    page_size = max(1, min(200, int(page_size)))
    offset = (page - 1) * page_size

    with _connect(db_path) as conn:
        total, rows = _run_qa_query(conn, month_id, instance, q, source, page_size, offset)

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": (total + page_size - 1) // page_size if total else 0,
        "rows": rows,
    }


def _run_qa_query(conn, month_id, instance, q, source, page_size, offset):
    q = (q or "").strip()
    source = (source or "").strip()

    if q and _fts_ok:
        try:
            return _qa_query_fts(conn, month_id, instance, q, source, page_size, offset)
        except Exception:
            pass  # fall through to LIKE-based search
    return _qa_query_like(conn, month_id, instance, q, source, page_size, offset)


def _qa_query_fts(conn, month_id, instance, q, source, page_size, offset):
    tokens = [f'"{tok}"' for tok in q.split() if tok]
    params: list = [month_id, instance, " ".join(tokens)]
    source_clause = ""
    if source:
        source_clause = "AND q.source LIKE ?"
        params.append(f"%{source}%")
    base = (
        "FROM qa_log q JOIN instances i ON i.instance_id = q.instance_id "
        "WHERE q.month_id = ? AND i.name = ? "
        "AND q.id IN (SELECT rowid FROM qa_fts WHERE qa_fts MATCH ?) " + source_clause
    )
    total = _query_one(conn, f"SELECT COUNT(*) AS n {base}", params)["n"]
    rows = _query(
        conn,
        f"SELECT q.id, q.date, q.question, q.answer, q.source {base} "
        "ORDER BY q.id DESC LIMIT ? OFFSET ?",
        params + [page_size, offset],
    )
    return total, rows


def _qa_query_like(conn, month_id, instance, q, source, page_size, offset):
    params: list = [month_id, instance]
    clauses = []
    if q:
        clauses.append("(q.question LIKE ? OR q.answer LIKE ?)")
        params.extend([f"%{q}%", f"%{q}%"])
    if source:
        clauses.append("q.source LIKE ?")
        params.append(f"%{source}%")
    extra = (" AND " + " AND ".join(clauses)) if clauses else ""
    base = (
        "FROM qa_log q JOIN instances i ON i.instance_id = q.instance_id "
        f"WHERE q.month_id = ? AND i.name = ?{extra}"
    )
    total = _query_one(conn, f"SELECT COUNT(*) AS n {base}", params)["n"]
    rows = _query(
        conn,
        f"SELECT q.id, q.date, q.question, q.answer, q.source {base} "
        "ORDER BY q.id DESC LIMIT ? OFFSET ?",
        params + [page_size, offset],
    )
    return total, rows


# --------------------------------------------------------------------------- #
# Small coercions
# --------------------------------------------------------------------------- #

def _to_int(v):
    if v is None or v == "":
        return 0
    try:
        return int(float(v))
    except (ValueError, TypeError):
        return 0


def _to_str(v):
    if v is None:
        return None
    s = str(v).strip()
    return s if s else None
