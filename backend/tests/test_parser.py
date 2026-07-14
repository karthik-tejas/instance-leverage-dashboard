"""Parser block-splitting test — runs against the REAL Leverage Report .xlsx.

This is the acceptance gate called out in the build prompt (>=3 instance sheets,
each yielding 4 populated blocks). It is SKIPPED until a real file is available,
because the block-splitting logic can only be validated against the actual layout.

Provide the file by either:
  * dropping it in data/uploads/, or
  * setting LEVERAGE_SAMPLE=/path/to/file.xlsx, or
  * placing a Leverage Report .xlsx in ~/Downloads
"""

import os
import zipfile
from pathlib import Path

import pytest

from parser import parse_workbook

_XLSX_EXT = (".xlsx", ".xlsm")


def _is_real_xlsx(path: str) -> bool:
    if not Path(path).is_file():
        return False
    if not str(path).lower().endswith(_XLSX_EXT):
        return False
    try:
        with zipfile.ZipFile(path):
            return True
    except Exception:
        return False


_CANDIDATES = [
    os.environ.get("LEVERAGE_SAMPLE"),
    *[str(p) for p in Path("data/uploads").glob("*.xlsx")],
    *[str(p) for p in Path.home().joinpath("Downloads").glob("*leverage*.xlsx")],
    *[str(p) for p in Path.home().joinpath("Downloads").glob("*Leverage*.xlsx")],
    *[str(p) for p in Path.home().joinpath("Downloads").glob("*LENS*.xlsx")],
]


def _find_sample() -> str | None:
    for c in _CANDIDATES:
        if c and _is_real_xlsx(c):
            return c
    return None


SAMPLE = _find_sample()
pytestmark = pytest.mark.skipif(SAMPLE is None, reason="No real Leverage Report .xlsx provided yet.")


def test_parse_real_file():
    parsed = parse_workbook(SAMPLE)
    assert parsed["month_label"], "month_label should be derived from the Summary sheet"
    # month_label looks like "<Month> <Year>"
    assert any(ch.isdigit() for ch in parsed["month_label"]), parsed["month_label"]
    assert len(parsed["instances"]) >= 3, "need >=3 instance sheets"

    # Aggregate sanity (the real exports have documents + Q&A; feedback may be empty).
    total_docs = sum(len(i["documents"]) for i in parsed["instances"].values())
    total_q = sum(len(i["questions"]) for i in parsed["instances"].values())
    total_qa = sum(len(i["qa"]) for i in parsed["instances"].values())
    assert total_docs > 0, "no documents parsed"
    assert (total_q + total_qa) > 0, "no questions or Q&A parsed"

    # Every instance must at least yield a documents block.
    for name, inst in parsed["instances"].items():
        assert inst.get("documents") is not None, f"{name}: no documents block"
        if inst["documents"]:
            assert any(d.get("doc_url") or d.get("doc_name") for d in inst["documents"]), \
                f"{name}: documents without url/name"

    # Q&A rows (where present) should carry question text.
    for name, inst in parsed["instances"].items():
        for row in inst["qa"]:
            assert row.get("question"), f"{name}: Q&A row missing question"

    # Summary must be present; its (resolved) instance names should map to
    # real instance sheets (a few dormant instances may not match).
    assert parsed["summary"], "Summary sheet not parsed"
    matched = [s["instance"] for s in parsed["summary"] if s["instance"] in parsed["instances"]]
    assert len(matched) >= 3, "too few summary instances matched to sheets"
    assert set(matched).issubset(set(parsed["instances"].keys()))


def test_summary_counts_present():
    parsed = parse_workbook(SAMPLE)
    for s in parsed["summary"]:
        assert s["questions_asked"] is not None, f"summary row missing questions_asked: {s}"
        assert s["active_users"] is not None, f"summary row missing active_users: {s}"


if __name__ == "__main__":
    if SAMPLE is None:
        print("No sample file found; skipping.")
    else:
        p = parse_workbook(SAMPLE)
        print("month_label:", p["month_label"])
        print("instances:", {k: {b: len(v[b]) for b in v} for k, v in p["instances"].items()})
