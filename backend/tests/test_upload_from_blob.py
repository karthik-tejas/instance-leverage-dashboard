"""Validation tests for POST /api/upload-from-blob.

Covers the request-shape and SSRF-guard rejections that don't require an
actual network fetch. The happy path (fetching real bytes from Vercel Blob
storage and ingesting them) is exercised manually against a live deployment,
since it depends on an external service that isn't available in CI/local
test runs.
"""

import os
import sys
import tempfile
from pathlib import Path

import pytest

_TMP = tempfile.mkdtemp()
os.environ["LEVERAGE_DB"] = str(Path(_TMP) / "test.db")
os.environ["LEVERAGE_UPLOADS"] = str(Path(_TMP) / "uploads")

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from fastapi.testclient import TestClient  # noqa: E402
from main import app  # noqa: E402

client = TestClient(app)


@pytest.mark.parametrize(
    "payload",
    [
        {"blob_url": "https://abc123.public.blob.vercel-storage.com/report.csv", "filename": "report.csv"},
        {"blob_url": "https://abc123.public.blob.vercel-storage.com/report.txt", "filename": "report"},
    ],
)
def test_rejects_non_workbook_filename(payload):
    r = client.post("/api/upload-from-blob", json=payload)
    assert r.status_code == 400
    assert "xlsx" in r.json()["detail"].lower()


@pytest.mark.parametrize(
    "blob_url",
    [
        "http://abc123.public.blob.vercel-storage.com/report.xlsx",  # not https
        "https://evil.example.com/report.xlsx",  # wrong host entirely
        "https://abc123.public.blob.vercel-storage.com.evil.com/report.xlsx",  # lookalike suffix attack
        "https://internal-metadata.service/report.xlsx",  # arbitrary SSRF target
        "not-a-url",
    ],
)
def test_rejects_urls_outside_vercel_blob_domain(blob_url):
    r = client.post("/api/upload-from-blob", json={"blob_url": blob_url, "filename": "report.xlsx"})
    assert r.status_code == 400
    assert "vercel blob" in r.json()["detail"].lower()


def test_accepts_well_formed_public_blob_url_shape():
    # Passes the guard (400 -> further along the pipeline) even though the
    # domain doesn't actually exist; the real HTTP fetch then fails with a
    # 502, proving the SSRF guard let a correctly-shaped URL through.
    r = client.post(
        "/api/upload-from-blob",
        json={
            "blob_url": "https://doesnotexist123456.public.blob.vercel-storage.com/report.xlsx",
            "filename": "report.xlsx",
        },
    )
    assert r.status_code == 502
    assert "could not fetch" in r.json()["detail"].lower()
