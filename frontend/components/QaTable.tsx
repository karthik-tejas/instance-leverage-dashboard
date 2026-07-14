"use client";

import { useEffect, useState } from "react";
import { getQa, getAllQa, QaResp } from "@/lib/api";
import { downloadCsv } from "@/lib/csv";
import { Input, Button, Spinner } from "./ui";

export default function QaTable({ monthId, instance }: { monthId: number; instance: string }) {
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [source, setSource] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<QaResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pageSize = 25;

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 350);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    setPage(1);
  }, [debouncedQ, source, monthId, instance]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getQa({ monthId, instance, q: debouncedQ || undefined, source: source || undefined, page, pageSize })
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [monthId, instance, debouncedQ, source, page]);

  async function handleExport() {
    setExporting(true);
    try {
      const rows = await getAllQa(monthId, instance, debouncedQ || undefined, source || undefined);
      downloadCsv(`${instance}_qa_log`, rows, ["id", "date", "question", "answer", "source"]);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2.5">
        <Input placeholder="Search question / answer text…" value={q} onChange={(e) => setQ(e.target.value)} className="min-w-[220px]" />
        <Input placeholder="Filter by source…" value={source} onChange={(e) => setSource(e.target.value)} className="min-w-[180px]" />
        <span className="flex items-center gap-1.5 text-sm text-text-muted">
          {data ? `${data.total.toLocaleString()} rows` : ""}
          {loading && <Spinner />}
        </span>
        <div className="ml-auto">
          <Button size="sm" onClick={handleExport} disabled={exporting || !data?.total}>
            {exporting ? <Spinner /> : null} Export CSV
          </Button>
        </div>
      </div>

      {error && <p className="mb-2 text-sm text-negative">{error}</p>}

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-left text-xs font-semibold uppercase tracking-wide text-text-muted">
              <th className="px-3 py-2.5">#</th>
              <th className="px-3 py-2.5">Date</th>
              <th className="px-3 py-2.5">Question</th>
              <th className="px-3 py-2.5">Answer</th>
              <th className="px-3 py-2.5">Source</th>
            </tr>
          </thead>
          <tbody>
            {data?.rows.map((r) => (
              <tr key={r.id} className="border-t border-border align-top">
                <td className="px-3 py-2.5 text-text-muted">{r.id}</td>
                <td className="px-3 py-2.5 whitespace-nowrap text-text-muted">{r.date ?? "—"}</td>
                <td className="max-w-[360px] px-3 py-2.5 text-text">{r.question ?? "—"}</td>
                <td className="max-w-[480px] px-3 py-2.5 text-text-muted">{r.answer ?? "—"}</td>
                <td className="px-3 py-2.5 text-text-muted">{r.source ?? "—"}</td>
              </tr>
            ))}
            {data && data.rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-text-faint">
                  No Q&A rows match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center gap-2.5">
        <Button size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
          ‹ Prev
        </Button>
        <span className="text-sm text-text-muted">
          Page {data?.page ?? 1} / {data?.pages ?? 1}
        </span>
        <Button size="sm" onClick={() => setPage((p) => Math.min(data?.pages ?? 1, p + 1))} disabled={!data || page >= (data.pages ?? 1)}>
          Next ›
        </Button>
      </div>
    </div>
  );
}
