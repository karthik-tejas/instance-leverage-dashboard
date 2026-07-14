// Server-side counterpart of the client-direct-to-Blob upload flow. Deliberately
// NOT under /api/* -- vercel.json rewrites every /api/* request to the Python
// backend Service, so this route (handled natively by the Next.js frontend
// Service) needs its own path.
//
// Why this exists at all: Vercel Functions cap request bodies at a hard,
// non-configurable 4.5MB. Some monthly workbooks exceed that, so for large
// files the browser uploads straight to Vercel Blob storage (bypassing our
// function entirely) and only a short blob URL is later sent to the Python
// backend, which fetches + parses it server-side. Small files still go
// through the plain multipart POST to /api/upload, unchanged.
import { del } from "@vercel/blob";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";

export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: [
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
          "application/vnd.ms-excel.sheet.macroEnabled.12", // .xlsm
          "application/octet-stream", // some browsers report this for .xlsx/.xlsm
        ],
        addRandomSuffix: true,
        maximumSizeInBytes: 200 * 1024 * 1024, // 200MB, generous headroom over real workbook sizes
      }),
      onUploadCompleted: async () => {
        // No-op: the client explicitly calls /api/upload-from-blob itself
        // right after upload() resolves, so ingestion doesn't depend on this
        // webhook firing (it also doesn't fire on localhost per Vercel docs).
      },
    });
    return NextResponse.json(jsonResponse);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 }
    );
  }
}

// Best-effort cleanup once the backend has ingested a blob's contents into
// the database -- we don't need the raw file afterwards. Failures here are
// non-fatal; the frontend caller ignores errors from this endpoint.
export async function DELETE(request: Request): Promise<NextResponse> {
  const url = new URL(request.url).searchParams.get("url");
  if (!url || !url.includes(".blob.vercel-storage.com/")) {
    return NextResponse.json({ error: "invalid blob url" }, { status: 400 });
  }
  try {
    await del(url);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 }
    );
  }
}
