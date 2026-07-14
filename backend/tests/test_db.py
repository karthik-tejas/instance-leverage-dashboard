"""DB-layer tests using a synthetic parsed structure (no real .xlsx needed).

Validates: schema, idempotent re-ingest, instance upsert, FTS5 search,
pagination, and every query endpoint's data path. The parser's block-splitting
(test_parser.py) is validated separately against the real file.
"""

import os
import tempfile
from pathlib import Path

import pytest

# Point the DB at a temp file BEFORE importing db.
_TMP = tempfile.mkdtemp()
os.environ["LEVERAGE_DB"] = str(Path(_TMP) / "test.db")
os.environ["LEVERAGE_UPLOADS"] = str(Path(_TMP) / "uploads")

import db  # noqa: E402

db.init_db()


def _sample_parsed():
    return {
        "month_label": "2026-06",
        "summary": [
            {"instance": "PCW", "questions_asked": 100, "active_users": 20},
            {"instance": "PUBLICHEALTH", "questions_asked": 80, "active_users": 15},
            {"instance": "IRENA", "questions_asked": 50, "active_users": 10},
        ],
        "instances": {
            "PCW": {
                "documents": [
                    {"date_uploaded": "2026-06-01", "doc_url": "http://x/a", "doc_name": "Guide A", "frequency": 40},
                    {"date_uploaded": "2026-06-02", "doc_url": "http://x/b", "doc_name": "Guide B", "frequency": 10},
                ],
                "questions": [
                    {"question": "How do I register?", "count": 30},
                    {"question": "Where is the clinic?", "count": 12},
                ],
                "feedback": [
                    {"question": "How do I register?", "answer": "Use the portal.", "feedback": "good", "count": 30, "likes": 25, "dislikes": 5},
                    {"question": "Where is the clinic?", "answer": "Downtown.", "feedback": "bad", "count": 12, "likes": 2, "dislikes": 10},
                ],
                "qa": [
                    {"date": "2026-06-03", "question": "How do I register?", "answer": "Use the online portal.", "source": "Portal"},
                    {"date": "2026-06-04", "question": "Where is the clinic located?", "answer": "Downtown branch.", "source": "Web"},
                    {"date": "2026-06-05", "question": "What are the hours?", "answer": "9 to 5.", "source": "Web"},
                ],
            },
            "PUBLICHEALTH": {
                "documents": [{"date_uploaded": "2026-06-01", "doc_url": "http://x/c", "doc_name": "Health C", "frequency": 22}],
                "questions": [{"question": "Vaccine schedule?", "count": 9}],
                "feedback": [{"question": "Vaccine schedule?", "answer": "Monthly.", "feedback": "ok", "count": 9, "likes": 8, "dislikes": 1}],
                "qa": [{"date": "2026-06-06", "question": "Vaccine schedule?", "answer": "Monthly cadence.", "source": "Portal"}],
            },
            "IRENA": {
                "documents": [],
                "questions": [],
                "feedback": [],
                "qa": [{"date": "2026-06-07", "question": "Renewal process?", "answer": "Submit form.", "source": "Email"}],
            },
        },
    }


def test_ingest_and_queries():
    res = db.ingest_month(_sample_parsed(), source_filename="real_file.xlsx")
    assert res["counts"]["instances"] == 3
    assert res["counts"]["qa_log"] == 5
    assert res["counts"]["documents"] == 3
    mid = res["month_id"]

    # Months list
    months = db.list_months()
    assert len(months) == 1
    assert months[0]["source_filename"] == "real_file.xlsx"

    # Overview trend + leaderboard
    ov = db.get_overview(mid)
    assert ov["trend"][0]["total_questions"] == 230  # 100+80+50
    assert ov["leaderboard"][0]["instance"] == "PCW"

    # Instance detail
    det = db.get_instance_detail(mid, "PCW")
    assert det["found"] is True
    assert det["top_documents"][0]["doc_name"] == "Guide A"  # sorted by freq
    assert det["feedback_totals"]["dislikes"] == 15
    assert det["disliked_qa"][0]["question"] == "Where is the clinic?"  # most dislikes first

    # Instances list
    assert set(db.list_instances(mid)) == {"PCW", "PUBLICHEALTH", "IRENA"}

    # qa_log pagination
    qa = db.get_qa_log(mid, "PCW", page=1, page_size=2)
    assert qa["total"] == 3
    assert qa["pages"] == 2
    assert len(qa["rows"]) == 2

    # FTS5 search
    found = db.get_qa_log(mid, "PCW", q="register")
    assert found["total"] == 1
    assert "register" in (found["rows"][0]["question"] or "").lower()

    # Source filter
    web = db.get_qa_log(mid, "PCW", source="Web")
    assert web["total"] == 2


def test_idempotent_reingest():
    r1 = db.ingest_month(_sample_parsed(), source_filename="real_file.xlsx")
    r2 = db.ingest_month(_sample_parsed(), source_filename="real_file_v2.xlsx")  # re-upload corrected
    # month_id must stay STABLE across re-uploads (frontend relies on it).
    assert r1["month_id"] == r2["month_id"], "re-upload must not change month_id"
    months = db.list_months()
    assert len(months) == 1, "re-upload must not create a second month row"
    assert months[0]["source_filename"] == "real_file_v2.xlsx"
    mid = months[0]["month_id"]
    # No doubled rows anywhere:
    assert db.get_overview(mid)["trend"][0]["total_questions"] == 230
    assert db.get_qa_log(mid, "PCW")["total"] == 3


def test_dynamic_instance_upsert():
    # A brand new instance should be added, never crash on a fixed list.
    extra = _sample_parsed()
    extra["instances"]["NEWORG"] = {
        "documents": [], "questions": [], "feedback": [],
        "qa": [{"date": "2026-06-08", "question": "Hi", "answer": "Hello", "source": "Web"}],
    }
    extra["summary"].append({"instance": "NEWORG", "questions_asked": 5, "active_users": 2})
    res = db.ingest_month(extra, source_filename="real_file.xlsx")
    assert "NEWORG" in db.list_instances(res["month_id"])
