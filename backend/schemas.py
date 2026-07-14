"""Pydantic response models for the API (lightweight; mostly passthrough)."""

from __future__ import annotations

from pydantic import BaseModel


class IngestResult(BaseModel):
    month_id: int
    month_label: str
    source_filename: str
    counts: dict


class BlobUploadRequest(BaseModel):
    blob_url: str
    filename: str


class MonthInfo(BaseModel):
    month_id: int
    month_label: str
    source_filename: str
