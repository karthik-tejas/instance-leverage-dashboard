"use client";

import { useMemo, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  BarChart, Bar, Cell,
} from "recharts";
import { Overview as OverviewType, LeaderboardRow } from "@/lib/api";
import { downloadCsv } from "@/lib/csv";
import { Card, Empty, StatCard, Delta, Button } from "./ui";

const COLORS = ["#4f46e5", "#16a34a", "#db2777", "#d97706", "#7c3aed", "#0891b2", "#dc2626", "#65a30d", "#9333ea", "#0d9488"];

function pctDelta(cur: number, prev: number): number | null {
  if (!prev) return cur > 0 ? null : 0;
  return ((cur - prev) / prev) * 100;
}

type SortKey = "instance" | "questions_asked" | "active_users" | "q_delta" | "u_delta";

export default function Overview({ data, monthLabel }: { data: OverviewType; monthLabel?: string }) {
  const prevByInstance = useMemo(() => {
    const m = new Map<string, LeaderboardRow>();
    for (const r of data.previous_leaderboard) m.set(r.instance, r);
    return m;
  }, [data.previous_leaderboard]);

  const rows = useMemo(
    () =>
      data.leaderboard.map((r) => {
        const prev = prevByInstance.get(r.instance);
        return {
          ...r,
          q_delta: prev ? pctDelta(r.questions_asked, prev.questions_asked) : null,
          u_delta: prev ? pctDelta(r.active_users, prev.active_users) : null,
        };
      }),
    [data.leaderboard, prevByInstance]
  );

  const [sortKey, setSortKey] = useState<SortKey>("questions_asked");
  const [sortDir, setSortDir] = useState<1 | -1>(-1);

  const sortedRows = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = a[sortKey] ?? -Infinity;
      const bv = b[sortKey] ?? -Infinity;
      if (typeof av === "string" || typeof bv === "string") {
        return String(av).localeCompare(String(bv)) * sortDir;
      }
      return ((av as number) - (bv as number)) * sortDir;
    });
    return copy;
  }, [rows, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === 1 ? -1 : 1));
    } else {
      setSortKey(key);
      setSortDir(-1);
    }
  }

  const totalQuestions = data.leaderboard.reduce((s, r) => s + r.questions_asked, 0);
  const totalUsers = data.leaderboard.reduce((s, r) => s + r.active_users, 0);
  const prevTotalQuestions = data.previous_leaderboard.reduce((s, r) => s + r.questions_asked, 0);
  const prevTotalUsers = data.previous_leaderboard.reduce((s, r) => s + r.active_users, 0);
  const qDelta = data.previous_month_id != null ? pctDelta(totalQuestions, prevTotalQuestions) : null;
  const uDelta = data.previous_month_id != null ? pctDelta(totalUsers, prevTotalUsers) : null;

  return (
    <div className="grid gap-5">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard
          label="Questions Asked"
          value={totalQuestions.toLocaleString()}
          color="brand"
          delta={<Delta value={qDelta} />}
        />
        <StatCard
          label="Active Users"
          value={totalUsers.toLocaleString()}
          color="positive"
          delta={<Delta value={uDelta} />}
        />
        <StatCard label="Instances" value={data.leaderboard.length} />
        <StatCard label="Month" value={monthLabel ?? "—"} />
      </div>

      <Card title="Questions & Active Users by Month">
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={data.trend} margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="month_label" tick={{ fontSize: 12 }} stroke="var(--border-strong)" />
            <YAxis tick={{ fontSize: 12 }} stroke="var(--border-strong)" />
            <Tooltip
              contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, fontSize: 13 }}
            />
            <Legend wrapperStyle={{ fontSize: 13 }} />
            <Line type="monotone" dataKey="total_questions" name="Questions" stroke="var(--chart-1)" strokeWidth={2.5} dot={{ r: 3 }} />
            <Line type="monotone" dataKey="total_active_users" name="Active Users" stroke="var(--chart-2)" strokeWidth={2.5} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Questions per Instance (selected month)">
          {data.leaderboard.length === 0 ? (
            <Empty />
          ) : (
            <ResponsiveContainer width="100%" height={320}>
              <BarChart
                layout="vertical"
                data={data.leaderboard.slice(0, 12)}
                margin={{ top: 4, right: 20, bottom: 4, left: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" tick={{ fontSize: 11 }} stroke="var(--border-strong)" />
                <YAxis type="category" dataKey="instance" width={110} tick={{ fontSize: 11 }} stroke="var(--border-strong)" />
                <Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, fontSize: 13 }} />
                <Bar dataKey="questions_asked" name="Questions" radius={[0, 4, 4, 0]}>
                  {data.leaderboard.slice(0, 12).map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card title="Active Users per Instance (selected month)">
          {data.leaderboard.length === 0 ? (
            <Empty />
          ) : (
            <ResponsiveContainer width="100%" height={320}>
              <BarChart
                layout="vertical"
                data={data.leaderboard.slice(0, 12)}
                margin={{ top: 4, right: 20, bottom: 4, left: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" tick={{ fontSize: 11 }} stroke="var(--border-strong)" />
                <YAxis type="category" dataKey="instance" width={110} tick={{ fontSize: 11 }} stroke="var(--border-strong)" />
                <Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, fontSize: 13 }} />
                <Bar dataKey="active_users" name="Active Users" fill="var(--chart-2)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      <Card
        title="Leaderboard — month-over-month"
        action={
          <Button
            size="sm"
            onClick={() =>
              downloadCsv(`leaderboard_${monthLabel ?? "month"}`, sortedRows, [
                "instance", "questions_asked", "q_delta", "active_users", "u_delta",
              ])
            }
            disabled={sortedRows.length === 0}
          >
            Export CSV
          </Button>
        }
      >
        {sortedRows.length === 0 ? (
          <Empty />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="text-left text-text-muted">
                  <Th onClick={() => toggleSort("instance")} active={sortKey === "instance"} dir={sortDir}>Instance</Th>
                  <Th onClick={() => toggleSort("questions_asked")} active={sortKey === "questions_asked"} dir={sortDir} align="right">Questions</Th>
                  <Th onClick={() => toggleSort("q_delta")} active={sortKey === "q_delta"} dir={sortDir} align="right">MoM Δ</Th>
                  <Th onClick={() => toggleSort("active_users")} active={sortKey === "active_users"} dir={sortDir} align="right">Active Users</Th>
                  <Th onClick={() => toggleSort("u_delta")} active={sortKey === "u_delta"} dir={sortDir} align="right">MoM Δ</Th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((r) => (
                  <tr key={r.instance} className="border-t border-border">
                    <td className="px-3 py-2 font-medium text-text">{r.instance}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-text">{r.questions_asked.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right"><Delta value={r.q_delta} /></td>
                    <td className="px-3 py-2 text-right tabular-nums text-text">{r.active_users.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right"><Delta value={r.u_delta} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function Th({
  children, onClick, active, dir, align = "left",
}: { children: React.ReactNode; onClick: () => void; active: boolean; dir: 1 | -1; align?: "left" | "right" }) {
  return (
    <th
      onClick={onClick}
      className={`cursor-pointer select-none px-3 py-2 text-xs font-semibold uppercase tracking-wide hover:text-text ${align === "right" ? "text-right" : "text-left"}`}
    >
      {children} {active ? (dir === 1 ? "↑" : "↓") : ""}
    </th>
  );
}
