"""FastAPI backend for the Leverage Report dashboard.

Endpoints:
  GET  /api/health                 backend + storage status
  POST /api/upload                 multipart .xlsx -> parse + idempotent ingest
  GET  /api/months                 list of loaded months (for the selector)
  GET  /api/instances?month_id=    instance names for a month (drill-down dropdown)
  GET  /api/all-instances          every instance ever seen (Compare picker)
  GET  /api/overview?month_id=     cross-month trend + leaderboard (+ prev month, for MoM deltas)
  GET  /api/instance?month_id=&name=       documents/questions/feedback/dislikes
  GET  /api/qa?month_id=&instance=&q=&source=&page=&page_size=  paginated Q&A log
  GET  /api/compare?instances=a,b,c        per-month series for 2+ instances, for the Compare view
  GET  /api/report?month_id=               programme-level report: comparison, leverage, feedback,
                                            cumulative performance, curation next-steps, key insights

In production (Vercel) this runs as its own Service behind a `/api/*` rewrite,
same-origin with the Next.js frontend, so no CORS is needed there. CORS below
only matters for local dev, where the frontend and backend run on different
ports. No LLM call touches the render path.
"""

from __future__ import annotations

import os
import shutil
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

import db
from schemas import IngestResult
from parser import parse_workbook

if db.PERSIST_RAW_UPLOADS:
    db.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
db.init_db()  # create tables (+ best-effort FTS5) on first boot

app = FastAPI(title="Leverage Report Dashboard API", version="1.0.0")

# Allow the Next.js dev server (both hostname spellings, since browsers treat
# localhost and 127.0.0.1 as different origins). Override with LEVERAGE_CORS
# for other origins -- a blank/whitespace-only value is treated as unset, not
# as "block everything". In production behind Vercel Services this is
# same-origin and unused.
_DEFAULT_CORS = "http://localhost:3000,http://127.0.0.1:3000"
_CORS_ORIGINS = [
    o.strip()
    for o in (os.environ.get("LEVERAGE_CORS", "").strip() or _DEFAULT_CORS).split(",")
    if o.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _resolve_month(month_id: int | None) -> int:
    if month_id is not None:
        return month_id
    mid = db.latest_month_id()
    if mid is None:
        raise HTTPException(status_code=404, detail="No months loaded yet.")
    return mid


def _safe_filename(label: str) -> str:
    return "".join(c if c.isalnum() or c in "-_." else "_" for c in label).strip("_") or "month"


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "months": len(db.list_months()),
        "storage": "turso" if db.USING_TURSO else "sqlite",
    }


@app.post("/api/upload", response_model=IngestResult)
async def upload(file: UploadFile = File(...)):
    if not file.filename or not file.filename.lower().endswith((".xlsx", ".xlsm")):
        raise HTTPException(status_code=400, detail="Expected an .xlsx file.")
    original_name = Path(file.filename).name

    # Always parse from a temp file (works identically on serverless /tmp and
    # local disk); only additionally archive the raw bytes when we have a
    # real persistent filesystem to put them on (local dev, not Turso/Vercel).
    with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as tmp_f:
        shutil.copyfileobj(file.file, tmp_f)
        tmp_path = Path(tmp_f.name)

    try:
        parsed = parse_workbook(tmp_path)
    except Exception as exc:  # surface parse errors to the user
        tmp_path.unlink(missing_ok=True)
        raise HTTPException(status_code=422, detail=f"Failed to parse workbook: {exc}")

    if not parsed["instances"]:
        tmp_path.unlink(missing_ok=True)
        raise HTTPException(
            status_code=422,
            detail="No instance sheets detected. Is this a Leverage Report file?",
        )

    if db.PERSIST_RAW_UPLOADS:
        raw_path = db.UPLOAD_DIR / f"{_safe_filename(parsed['month_label'])}.xlsx"
        shutil.copy(str(tmp_path), str(raw_path))
    tmp_path.unlink(missing_ok=True)

    result = db.ingest_month(parsed, source_filename=original_name)
    return IngestResult(**result)


@app.get("/api/months")
def months():
    return db.list_months()


@app.get("/api/instances")
def instances(month_id: int | None = None):
    mid = _resolve_month(month_id)
    return {"month_id": mid, "instances": db.list_instances(mid)}


@app.get("/api/all-instances")
def all_instances():
    return {"instances": db.list_all_instances()}


@app.get("/api/overview")
def overview(month_id: int | None = None):
    return db.get_overview(month_id)


@app.get("/api/instance")
def instance(month_id: int | None = None, name: str = ""):
    mid = _resolve_month(month_id)
    if not name:
        raise HTTPException(status_code=400, detail="instance name required")
    return db.get_instance_detail(mid, name)


@app.get("/api/qa")
def qa(
    month_id: int | None = None,
    instance: str = "",
    q: str | None = None,
    source: str | None = None,
    page: int = 1,
    page_size: int = 25,
):
    mid = _resolve_month(month_id)
    if not instance:
        raise HTTPException(status_code=400, detail="instance name required")
    return db.get_qa_log(mid, instance, q=q, source=source, page=page, page_size=page_size)


@app.get("/api/compare")
def compare(instances: str = ""):
    names = [n for n in instances.split(",") if n.strip()]
    if len(names) < 1:
        raise HTTPException(status_code=400, detail="at least one instance required")
    return db.get_instance_comparison(names)


@app.get("/api/report")
def report(month_id: int | None = None):
    return db.get_report(month_id)
