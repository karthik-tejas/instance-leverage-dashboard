"use client";

import { useState } from "react";
import { uploadFile } from "@/lib/api";
import { Spinner } from "./ui";

export default function Upload({ onUploaded }: { onUploaded: (monthId: number) => void }) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [phase, setPhase] = useState<"uploading" | "processing">("uploading");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function handle(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setProgress(null);
    setPhase("uploading");
    setErr(null);
    setMsg(null);
    try {
      const r = await uploadFile(file, (pct, ph) => {
        setProgress(Math.round(pct));
        setPhase(ph);
      });
      setMsg(`Loaded "${r.month_label}" — ${r.counts.instances} instances, ${r.counts.qa_log} Q&A rows.`);
      onUploaded(r.month_id);
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Upload failed");
    } finally {
      setBusy(false);
      setProgress(null);
      e.target.value = "";
    }
  }

  const label =
    progress == null
      ? "Uploading…"
      : phase === "processing"
        ? "Processing on server…"
        : `Uploading… ${progress}%`;

  return (
    <div className="flex flex-col items-end gap-1.5">
      <label
        className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-brand-text-on shadow-sm transition-colors hover:bg-brand-hover aria-disabled:cursor-default aria-disabled:opacity-60"
        aria-disabled={busy}
      >
        {busy ? (
          <>
            <Spinner className="text-brand-text-on/80" /> {label}
          </>
        ) : (
          <>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 3v12m0-12l4 4m-4-4L8 7M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Upload .xlsx
          </>
        )}
        <input type="file" accept=".xlsx,.xlsm" onChange={handle} disabled={busy} hidden />
      </label>
      {msg && <span className="max-w-xs text-right text-xs text-positive">{msg}</span>}
      {err && <span className="max-w-xs text-right text-xs text-negative">{err}</span>}
    </div>
  );
}
