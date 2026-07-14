"use client";

import { useEffect, useState } from "react";
import { getReport, Report as ReportType } from "@/lib/api";
import { downloadReportHtml, printReport } from "@/lib/reportHtml";
import { downloadCsv } from "@/lib/csv";
import { Card, Empty, StatCard, Delta, Button, StatusBadge, Spinner } from "./ui";

export default function Report({ monthId }: { monthId: number | null }) {
  const [data, setData] = useState<ReportType | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (monthId == null) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    getReport(monthId)
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Failed to load report"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [monthId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-16 justify-center text-text-muted">
        <Spinner /> Building report…
      </div>
    );
  }
  if (error) return <p className="text-sm text-negative">{error}</p>;
  if (!data || data.empty) return <Empty>No data available for the report yet.</Empty>;

  const { overview, comparison, knowledge_leverage, feedback, cumulative, curation_next_steps, key_insights } = data;
  const highPerforming = comparison.filter((r) => ["Activated", "High Growth", "Recovery"].includes(r.status)).slice(0, 6);
  const declining = comparison.filter((r) => ["Declining", "Sharp Decline"].includes(r.status));
  const dormant = comparison.filter((r) => ["Dormant", "Never Active"].includes(r.status));
  const cumulativeMonths = cumulative[0]?.months.map((m) => m.month_label) ?? [];

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-text">Instance Utilisation Report</h2>
          <p className="text-sm text-text-muted">
            {data.month_label}
            {data.previous_month_label ? ` · compared with ${data.previous_month_label}` : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => printReport(data)}>
            Print / Save as PDF
          </Button>
          <Button size="sm" variant="primary" onClick={() => downloadReportHtml(data)}>
            Download report (HTML)
          </Button>
        </div>
      </div>

      <Card title="Purpose">
        <p className="text-sm leading-relaxed text-text-muted">
          This report provides a data-driven assessment of chatbot instance utilisation for{" "}
          <b className="text-text">{data.month_label}</b>. It covers instance-level performance, month-on-month
          trend analysis, knowledge leverage, feedback analysis, cumulative performance across all loaded months,
          and curation next steps. Every figure and quote below is computed directly from the ingested Leverage
          Report data — nothing here is generated or inferred by an LLM.
        </p>
      </Card>

      <section>
        <h3 className="mb-3 text-base font-semibold text-text">1. Instance-Level Performance Analysis</h3>

        <h4 className="mb-2 text-sm font-semibold text-text-muted">1.1 Programme Overview</h4>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <StatCard label="Total Instances" value={overview.total_instances} />
          <StatCard label={`Total Questions (${data.month_label})`} value={overview.total_questions.toLocaleString()} color="brand" />
          <StatCard
            label={`vs ${data.previous_month_label ?? "prior month"} (${overview.previous_total_questions.toLocaleString()})`}
            value={<Delta value={overview.delta_pct} />}
          />
          <StatCard label="Active Instances (≥1 Q)" value={overview.active_instances} color="positive" />
          <StatCard label="Total Active Users" value={overview.total_users.toLocaleString()} />
        </div>

        <h4 className="mb-2 mt-6 text-sm font-semibold text-text-muted">1.2 Full Instance Comparison</h4>
        <Card
          action={
            <Button
              size="sm"
              onClick={() =>
                downloadCsv(`instance_comparison_${data.month_label}`, comparison, [
                  "instance", "users_prev", "users_cur", "questions_prev", "questions_cur", "delta_pct", "qu_prev", "qu_cur", "status",
                ])
              }
            >
              Export CSV
            </Button>
          }
        >
          <p className="mb-3 text-xs text-text-faint">
            Ranked by this month&apos;s question volume. Q/U = questions per user.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-text-muted">
                  <th className="px-3 py-2">Instance</th>
                  <th className="px-3 py-2 text-right">Users (prev)</th>
                  <th className="px-3 py-2 text-right">Users</th>
                  <th className="px-3 py-2 text-right">Q&apos;s (prev)</th>
                  <th className="px-3 py-2 text-right">Q&apos;s</th>
                  <th className="px-3 py-2 text-right">Δ Q&apos;s</th>
                  <th className="px-3 py-2 text-right">Q/U (prev)</th>
                  <th className="px-3 py-2 text-right">Q/U</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {comparison.map((r) => (
                  <tr key={r.instance} className="border-t border-border">
                    <td className="px-3 py-2 font-medium text-text">{r.instance}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-text-muted">{r.users_prev.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-text">{r.users_cur.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-text-muted">{r.questions_prev.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-text">{r.questions_cur.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right"><Delta value={r.delta_pct} /></td>
                    <td className="px-3 py-2 text-right tabular-nums text-text-muted">{r.qu_prev}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-text">{r.qu_cur}</td>
                    <td className="px-3 py-2"><StatusBadge status={r.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <h4 className="mb-2 mt-6 text-sm font-semibold text-text-muted">1.3 High-Performing Instances</h4>
        {highPerforming.length === 0 ? (
          <Empty>No newly activated / high-growth / recovering instances this month.</Empty>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {highPerforming.map((r) => (
              <Card key={r.instance}>
                <div className="mb-3 flex items-center gap-2">
                  <span className="font-semibold text-text">{r.instance}</span>
                  <StatusBadge status={r.status} />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <MiniStat label="Users" value={r.users_cur.toLocaleString()} />
                  <MiniStat label={`Q's (${r.delta_pct !== null ? `${r.delta_pct > 0 ? "+" : ""}${r.delta_pct}%` : "new"})`} value={r.questions_cur.toLocaleString()} />
                  <MiniStat label="Q/User" value={String(r.qu_cur)} />
                </div>
              </Card>
            ))}
          </div>
        )}

        <h4 className="mb-2 mt-6 text-sm font-semibold text-text-muted">1.4 Declining / Partial Instances</h4>
        {declining.length === 0 ? (
          <Empty>No declining instances this month.</Empty>
        ) : (
          <SimpleTable
            rows={declining}
            columns={[
              { key: "instance", label: "Instance" },
              { key: "questions_cur", label: "Q's", align: "right" },
              { key: "users_cur", label: "Users", align: "right" },
              { key: "qu_cur", label: "Q/U", align: "right" },
              { key: "status", label: "Status", render: (r) => <span className="flex items-center gap-2"><StatusBadge status={r.status} /><Delta value={r.delta_pct} /></span> },
            ]}
          />
        )}

        <h4 className="mb-2 mt-6 text-sm font-semibold text-text-muted">1.5 Dormant Instances</h4>
        {dormant.length === 0 ? (
          <Empty>No dormant instances this month.</Empty>
        ) : (
          <SimpleTable
            rows={dormant}
            columns={[
              { key: "instance", label: "Instance" },
              { key: "users_cur", label: "Users", align: "right" },
              { key: "questions_cur", label: "Q's", align: "right" },
              { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} /> },
            ]}
          />
        )}
      </section>

      <section>
        <h3 className="mb-1 text-base font-semibold text-text">2. Knowledge Leverage Analysis</h3>
        <p className="mb-3 text-xs text-text-faint">
          Real top-cited documents and top questions for every instance with at least one question this month.
        </p>
        {knowledge_leverage.length === 0 ? (
          <Empty>No active instances this month.</Empty>
        ) : (
          <div className="grid gap-3">
            {knowledge_leverage.map((k) => (
              <Card key={k.instance} title={`${k.instance}`} action={<span className="text-xs text-text-faint">{k.questions_asked.toLocaleString()} questions</span>}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-faint">Top documents</div>
                    {k.top_documents.length === 0 ? (
                      <p className="text-sm text-text-faint">No document data.</p>
                    ) : (
                      <ul className="space-y-1 text-sm text-text-muted">
                        {k.top_documents.map((d, i) => (
                          <li key={i}>
                            {d.doc_name || d.doc_url || "—"}{" "}
                            <span className="text-text-faint">({d.frequency ?? 0}×)</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div>
                    <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-faint">Top questions</div>
                    {k.top_questions.length === 0 ? (
                      <p className="text-sm text-text-faint">No question data.</p>
                    ) : (
                      <ul className="space-y-1 text-sm text-text-muted">
                        {k.top_questions.map((q, i) => (
                          <li key={i}>
                            &ldquo;{q.question}&rdquo; <span className="text-text-faint">({q.count ?? 0}×)</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section>
        <h3 className="mb-3 text-base font-semibold text-text">3. Feedback Analysis</h3>
        <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard label="Instances with Feedback" value={feedback.instances_with_feedback} />
          <StatCard label="Total Responses" value={feedback.total_responses} />
          <StatCard label="Likes" value={feedback.likes} color="positive" />
          <StatCard label="Dislikes" value={feedback.dislikes} color="negative" />
        </div>
        {feedback.per_instance.length === 0 ? (
          <Empty>No feedback recorded this month.</Empty>
        ) : (
          <div className="grid gap-3">
            {feedback.per_instance.map((f) => (
              <Card
                key={f.instance}
                title={f.instance}
                action={
                  <span className="text-xs text-text-faint">
                    {f.likes} likes · {f.dislikes} dislikes · {f.responses} responses
                  </span>
                }
              >
                {f.sample_dislikes.length === 0 ? (
                  <p className="text-sm text-text-faint">No disliked Q&amp;A recorded.</p>
                ) : (
                  <ul className="space-y-2 text-sm text-text-muted">
                    {f.sample_dislikes.map((d, i) => (
                      <li key={i}>
                        <span className="font-medium text-negative">Dislike{d.dislikes && d.dislikes > 1 ? ` ×${d.dislikes}` : ""}:</span>{" "}
                        &ldquo;{d.question}&rdquo;
                        {d.answer && <span className="text-text-faint"> — {d.answer}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            ))}
          </div>
        )}
      </section>

      <section>
        <h3 className="mb-1 text-base font-semibold text-text">4. Cumulative Performance</h3>
        <p className="mb-3 text-xs text-text-faint">Across all {cumulativeMonths.length} loaded month(s).</p>
        <Card
          action={
            <Button
              size="sm"
              onClick={() =>
                downloadCsv(
                  `cumulative_performance`,
                  cumulative.map((c) => ({
                    instance: c.instance,
                    ...Object.fromEntries(c.months.map((m) => [m.month_label, m.questions_asked])),
                    total_questions: c.total_questions,
                    trend_status: c.trend_status,
                  }))
                )
              }
            >
              Export CSV
            </Button>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] border-collapse text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-text-muted">
                  <th className="px-3 py-2">Instance</th>
                  {cumulativeMonths.map((m) => (
                    <th key={m} className="px-3 py-2 text-right">{m}</th>
                  ))}
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2">Recent Trend</th>
                </tr>
              </thead>
              <tbody>
                {cumulative.map((c) => (
                  <tr key={c.instance} className="border-t border-border">
                    <td className="px-3 py-2 font-medium text-text">{c.instance}</td>
                    {c.months.map((m, i) => (
                      <td key={i} className="px-3 py-2 text-right tabular-nums text-text-muted">{m.questions_asked.toLocaleString()}</td>
                    ))}
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-text">{c.total_questions.toLocaleString()}</td>
                    <td className="px-3 py-2"><StatusBadge status={c.trend_status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </section>

      <section>
        <h3 className="mb-3 text-base font-semibold text-text">5. Curation Next Steps</h3>
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] border-collapse text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-text-muted">
                  <th className="px-3 py-2">Instance</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Action Required</th>
                </tr>
              </thead>
              <tbody>
                {curation_next_steps.map((n) => (
                  <tr key={n.instance} className="border-t border-border align-top">
                    <td className="px-3 py-2 font-medium text-text whitespace-nowrap">{n.instance}</td>
                    <td className="px-3 py-2 whitespace-nowrap"><StatusBadge status={n.status} /></td>
                    <td className="px-3 py-2 text-text-muted">{n.action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </section>

      <section>
        <h3 className="mb-3 text-base font-semibold text-text">6. Key Insights &amp; Takeaways</h3>
        {key_insights.length === 0 ? (
          <Empty>Not enough data yet to derive insights.</Empty>
        ) : (
          <div className="grid gap-2.5">
            {key_insights.map((k, i) => (
              <Card key={i} className="flex gap-3 !p-4">
                <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-brand text-xs font-bold text-brand-text-on">
                  {i + 1}
                </div>
                <div>
                  <div className="text-sm font-semibold text-text">{k.heading}</div>
                  <div className="mt-0.5 text-sm text-text-muted">{k.detail}</div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      <div className="rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm text-warning">
        <b>Note:</b>{" "}
        A &ldquo;Partner Utilisation Summary&rdquo; section (assets uploaded / shared to the collective) isn&apos;t
        included — that data isn&apos;t currently captured by the Leverage Report parser.
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-sm font-bold tabular-nums text-text">{value}</div>
      <div className="text-[11px] text-text-faint">{label}</div>
    </div>
  );
}

function SimpleTable<T extends { instance: string }>({
  rows,
  columns,
}: {
  rows: T[];
  columns: { key: keyof T; label: string; align?: "left" | "right"; render?: (r: T) => React.ReactNode }[];
}) {
  return (
    <Card>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[500px] border-collapse text-sm">
          <thead>
            <tr className="text-left text-xs font-semibold uppercase tracking-wide text-text-muted">
              {columns.map((c) => (
                <th key={String(c.key)} className={`px-3 py-2 ${c.align === "right" ? "text-right" : "text-left"}`}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.instance} className="border-t border-border">
                {columns.map((c) => (
                  <td
                    key={String(c.key)}
                    className={`px-3 py-2 ${c.align === "right" ? "text-right tabular-nums" : ""} ${c.key === "instance" ? "font-medium text-text" : "text-text-muted"}`}
                  >
                    {c.render ? c.render(r) : String(r[c.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
