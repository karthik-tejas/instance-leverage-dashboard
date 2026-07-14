"""End-to-end API verification using FastAPI TestClient (no long-running server).

Uploads the three real .xlsx files through the real /api/upload endpoint, then
exercises every query endpoint. Also seeds the project DB (data/leverage.db)
so the dashboard has data when the user starts the servers.
"""
import os
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
ROOT = BACKEND.parent
sys.path.insert(0, str(BACKEND))
os.environ["LEVERAGE_DB"] = str(ROOT / "data" / "leverage.db")
os.environ["LEVERAGE_UPLOADS"] = str(ROOT / "data" / "uploads")

from fastapi.testclient import TestClient  # noqa: E402
from main import app  # noqa: E402

DOWNLOADS = Path.home() / "Downloads"
FILES = [
    "Leverage_report_April_2026.xlsx",
    "LENS Leverage report May 2026.xlsx",
    "LENS Leverage report June 2026.xlsx",
]

client = TestClient(app)

print("=== upload (real endpoint) ===")
for f in FILES:
    p = DOWNLOADS / f
    if not p.exists():
        print("  SKIP (not found):", f)
        continue
    with open(p, "rb") as fh:
        r = client.post(
            "/api/upload",
            files={"file": (f, fh, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        )
    print(f"  {f}: {r.status_code} -> {r.json().get('month_label')} {r.json().get('counts')}")

print("\n=== /api/months ===")
months = client.get("/api/months").json()
print(" ", [(m["month_id"], m["month_label"]) for m in months])

print("\n=== /api/overview (latest) ===")
ov = client.get("/api/overview").json()
print("  trend:", [(t["month_label"], t["total_questions"], t["total_active_users"]) for t in ov["trend"]])

mid = ov["selected_month_id"]
inst = client.get("/api/instances", params={"month_id": mid}).json()
print(f"\n=== /api/instances (month {mid}) -> {len(inst['instances'])} instances ===")
first = inst["instances"][0]
print("  first instance:", first)

det = client.get("/api/instance", params={"month_id": mid, "name": first}).json()
print(f"\n=== /api/instance {first} ===")
print("  docs:", len(det["top_documents"]), "questions:", len(det["top_questions"]),
      "feedback likes/dislikes:", det["feedback_totals"], "disliked:", len(det["disliked_qa"]))

print("\n=== /api/qa (paginated + FTS) ===")
qa = client.get("/api/qa", params={"month_id": mid, "instance": first, "page": 1, "page_size": 5}).json()
print(f"  total={qa['total']} pages={qa['pages']} page1_rows={len(qa['rows'])}")
qa2 = client.get("/api/qa", params={"month_id": mid, "instance": first, "q": "energy", "page": 1, "page_size": 5}).json()
print(f"  FTS 'energy' -> total={qa2['total']}")
print("\nALL ENDPOINTS OK")
