"use client";

import { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { getInstance, InstanceDetail } from "@/lib/api";
import { downloadCsv } from "@/lib/csv";
import { Card, Empty, Select, Button, Spinner, StatCard } from "./ui";
import QaTable from "./QaTable";

const COLORS = ["#4f46e5", "#16a34a", "#db2777", "#d97706", "#7c3aed", "#0891b2", "#dc2626", "#65a30d", "#9333ea", "#0d9488"];

export default function InstanceDrilldown({
  monthId,
  instances,
  selected,
  onSelect,
}: {
  monthId: number;
  instances: string[];
  selected: string | null;
  onSelect: (name: string) => void;
}) {
  const [detail, setDetail] = useState<InstanceDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getInstance(monthId, selected)
      .then((d) => !cancelled && setDetail(d))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [monthId, selected]);

  if (!selected) {
    return <Empty />;
  }

  const docs = detail?.top_documents.slice(0, 12) ?? [];
  const questions = detail?.top_questions.slice(0, 12) ?? [];
  const { likes = 0, dislikes = 0 } = detail?.feedback_totals ?? {};

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm text-text-muted">Instance:</label>
        <Select value={selected} onChange={(e) => onSelect(e.target.value)} className="min-w-[220px]">
          {instances.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </Select>
        {loading && <Spinner />}
      </div>

      {error && <p className="text-sm text-negative">{error}</p>}

      {detail && (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard label="Questions Asked" value={detail.questions_asked.toLocaleString()} color="brand" />
            <StatCard label="Active Users" value={detail.active_users.toLocaleString()} color="positive" />
            <StatCard label="Likes" value={likes.toLocaleString()} color="positive" />
            <StatCard label="Dislikes" value={dislikes.toLocaleString()} color="negative" />
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card
              title="Top Documents Sourced (by frequency)"
              action={
                <Button size="sm" onClick={() => downloadCsv(`${detail.instance}_top_documents`, detail.top_documents)} disabled={!detail.top_documents.length}>
                  Export CSV
                </Button>
              }
            >
              {docs.length ? (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart layout="vertical" data={docs} margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" tick={{ fontSize: 11 }} stroke="var(--border-strong)" />
                    <YAxis type="category" dataKey="doc_name" width={150} tick={{ fontSize: 10 }} stroke="var(--border-strong)" />
                    <Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, fontSize: 13 }} />
                    <Bar dataKey="frequency" radius={[0, 4, 4, 0]}>
                      {docs.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <Empty />
              )}
            </Card>

            <Card
              title="Top Questions Asked (by count)"
              action={
                <Button size="sm" onClick={() => downloadCsv(`${detail.instance}_top_questions`, detail.top_questions)} disabled={!detail.top_questions.length}>
                  Export CSV
                </Button>
              }
            >
              {questions.length ? (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart layout="vertical" data={questions} margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" tick={{ fontSize: 11 }} stroke="var(--border-strong)" />
                    <YAxis type="category" dataKey="question" width={150} tick={{ fontSize: 10 }} stroke="var(--border-strong)" />
                    <Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, fontSize: 13 }} />
                    <Bar dataKey="count" fill="var(--chart-2)" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <Empty />
              )}
            </Card>
          </div>

          <Card
            title={`Q&A pairs with dislikes (${detail.disliked_qa.length})`}
            action={
              <Button size="sm" onClick={() => downloadCsv(`${detail.instance}_disliked_qa`, detail.disliked_qa)} disabled={!detail.disliked_qa.length}>
                Export CSV
              </Button>
            }
          >
            {detail.disliked_qa.length ? (
              <div className="max-h-72 overflow-y-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="text-left text-xs font-semibold uppercase tracking-wide text-text-muted">
                      <th className="px-3 py-2">Dislikes</th>
                      <th className="px-3 py-2">Question</th>
                      <th className="px-3 py-2">Answer</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.disliked_qa.map((d, i) => (
                      <tr key={i} className="border-t border-border align-top">
                        <td className="px-3 py-2 font-semibold text-negative">{d.dislikes}</td>
                        <td className="max-w-[360px] px-3 py-2 text-text">{d.question}</td>
                        <td className="max-w-[420px] px-3 py-2 text-text-muted">{d.answer}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty>No disliked Q&A for this instance.</Empty>
            )}
          </Card>

          <Card title={`Full Q&A Log — searchable & paginated (${detail.instance})`}>
            <QaTable monthId={monthId} instance={detail.instance} />
          </Card>
        </>
      )}
    </div>
  );
}
