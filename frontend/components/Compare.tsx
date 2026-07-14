"use client";

import { useEffect, useMemo, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { getAllInstances, getCompare, CompareResp } from "@/lib/api";
import { downloadCsv } from "@/lib/csv";
import { Card, Empty, Input, Button, Spinner, Badge } from "./ui";

const COLORS = ["#4f46e5", "#16a34a", "#db2777", "#d97706", "#7c3aed", "#0891b2", "#dc2626", "#65a30d"];

export default function Compare() {
  const [allInstances, setAllInstances] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [data, setData] = useState<CompareResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getAllInstances()
      .then((r) => setAllInstances(r.instances))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (selected.length === 0) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    getCompare(selected)
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const filtered = useMemo(
    () => allInstances.filter((n) => n.toLowerCase().includes(search.toLowerCase())),
    [allInstances, search]
  );

  function toggle(name: string) {
    setSelected((cur) => (cur.includes(name) ? cur.filter((n) => n !== name) : [...cur, name]));
  }

  const questionsChartData = useMemo(() => mergeSeries(data, "questions_asked"), [data]);
  const usersChartData = useMemo(() => mergeSeries(data, "active_users"), [data]);

  const exportRows = useMemo(() => {
    if (!data) return [];
    const rows: Record<string, unknown>[] = [];
    for (const s of data.series) {
      for (const p of s.points) {
        rows.push({
          instance: s.instance,
          month: p.month_label,
          questions_asked: p.questions_asked,
          active_users: p.active_users,
        });
      }
    }
    return rows;
  }, [data]);

  return (
    <div className="grid gap-5">
      <Card title="Pick instances to compare">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Input placeholder="Filter instances…" value={search} onChange={(e) => setSearch(e.target.value)} className="min-w-[200px]" />
          {selected.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
              Clear all ({selected.length})
            </Button>
          )}
        </div>
        {selected.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {selected.map((s, i) => (
              <button key={s} onClick={() => toggle(s)} className="group">
                <Badge tone="brand">
                  <span style={{ color: COLORS[i % COLORS.length] }} className="mr-1">●</span>
                  {s} <span className="ml-1 text-text-faint group-hover:text-text">×</span>
                </Badge>
              </button>
            ))}
          </div>
        )}
        <div className="grid max-h-56 grid-cols-2 gap-1 overflow-y-auto sm:grid-cols-3 md:grid-cols-4">
          {filtered.map((name) => (
            <label key={name} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-text hover:bg-surface-hover">
              <input type="checkbox" checked={selected.includes(name)} onChange={() => toggle(name)} className="accent-[var(--brand)]" />
              <span className="truncate">{name}</span>
            </label>
          ))}
          {filtered.length === 0 && <span className="text-sm text-text-faint">No matches.</span>}
        </div>
      </Card>

      {error && <p className="text-sm text-negative">{error}</p>}
      {loading && (
        <div className="flex items-center gap-2 text-sm text-text-muted">
          <Spinner /> Loading comparison…
        </div>
      )}

      {selected.length === 0 ? (
        <Empty>Select two or more instances above to compare their trends.</Empty>
      ) : data && data.months.length === 0 ? (
        <Empty>No monthly data yet for the selected instance(s).</Empty>
      ) : data ? (
        <>
          <div className="grid gap-5 lg:grid-cols-2">
            <Card title="Questions Asked — by month">
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={questionsChartData} margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month_label" tick={{ fontSize: 12 }} stroke="var(--border-strong)" />
                  <YAxis tick={{ fontSize: 12 }} stroke="var(--border-strong)" />
                  <Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, fontSize: 13 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {selected.map((s, i) => (
                    <Line key={s} type="monotone" dataKey={s} name={s} stroke={COLORS[i % COLORS.length]} strokeWidth={2.5} dot={{ r: 3 }} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </Card>

            <Card title="Active Users — by month">
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={usersChartData} margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month_label" tick={{ fontSize: 12 }} stroke="var(--border-strong)" />
                  <YAxis tick={{ fontSize: 12 }} stroke="var(--border-strong)" />
                  <Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, fontSize: 13 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {selected.map((s, i) => (
                    <Line key={s} type="monotone" dataKey={s} name={s} stroke={COLORS[i % COLORS.length]} strokeWidth={2.5} dot={{ r: 3 }} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </Card>
          </div>

          <Card
            title="Comparison data"
            action={
              <Button size="sm" onClick={() => downloadCsv("instance_comparison", exportRows)} disabled={!exportRows.length}>
                Export CSV
              </Button>
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="text-left text-xs font-semibold uppercase tracking-wide text-text-muted">
                    <th className="px-3 py-2">Instance</th>
                    {data.months.map((m) => (
                      <th key={m.month_id} className="px-3 py-2 text-right">{m.month_label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.series.map((s) => (
                    <tr key={s.instance} className="border-t border-border">
                      <td className="px-3 py-2 font-medium text-text">{s.instance}</td>
                      {s.points.map((p) => (
                        <td key={p.month_id} className="px-3 py-2 text-right tabular-nums text-text">
                          {p.questions_asked.toLocaleString()}
                          <span className="ml-1 text-xs text-text-faint">q</span>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      ) : null}
    </div>
  );
}

function mergeSeries(data: CompareResp | null, field: "questions_asked" | "active_users") {
  if (!data) return [];
  return data.months.map((m) => {
    const point: Record<string, string | number> = { month_label: m.month_label };
    for (const s of data.series) {
      const p = s.points.find((pt) => pt.month_id === m.month_id);
      point[s.instance] = p ? p[field] : 0;
    }
    return point;
  });
}
