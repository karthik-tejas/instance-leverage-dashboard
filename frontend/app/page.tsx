"use client";

import { useEffect, useState } from "react";
import {
  getMonths, getOverview, getInstances, Month, Overview as OverviewType,
} from "@/lib/api";
import Overview from "@/components/Overview";
import InstanceDrilldown from "@/components/InstanceDrilldown";
import Compare from "@/components/Compare";
import Report from "@/components/Report";
import Upload from "@/components/Upload";
import ThemeToggle from "@/components/ThemeToggle";
import { Select, Tab } from "@/components/ui";

type View = "overview" | "instance" | "compare" | "report";

export default function Page() {
  const [months, setMonths] = useState<Month[]>([]);
  const [monthId, setMonthId] = useState<number | null>(null);
  const [overview, setOverview] = useState<OverviewType | null>(null);
  const [instances, setInstances] = useState<string[]>([]);
  const [view, setView] = useState<View>("overview");
  const [selectedInstance, setSelectedInstance] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped on every successful upload so tabs refetch even when re-uploading
  // (replacing) the month that's already selected -- monthId alone wouldn't
  // change in that case, so nothing would otherwise signal a refresh.
  const [dataVersion, setDataVersion] = useState(0);

  async function refreshMonths() {
    try {
      const m = await getMonths();
      setMonths(m);
      if (m.length) {
        const last = m[m.length - 1].month_id;
        setMonthId((cur) => cur ?? last);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load months");
    }
  }

  async function handleUploaded(uploadedMonthId: number) {
    await refreshMonths();
    // Always jump to the month that was just uploaded -- that's what the
    // user just looked at and most likely wants to see reflected.
    setMonthId(uploadedMonthId);
    setDataVersion((v) => v + 1);
  }

  useEffect(() => {
    refreshMonths();
  }, []);

  useEffect(() => {
    if (monthId == null) return;
    getOverview(monthId).then(setOverview).catch((e) => setError(e instanceof Error ? e.message : "err"));
    getInstances(monthId)
      .then((r) => {
        setInstances(r.instances);
        setSelectedInstance((cur) => (cur && r.instances.includes(cur) ? cur : r.instances[0] ?? null));
      })
      .catch(() => {});
  }, [monthId, dataVersion]);

  const monthLabel = months.find((m) => m.month_id === monthId)?.month_label;

  return (
    <div className="mx-auto max-w-6xl px-5 pb-16 pt-6 sm:px-6">
      <header className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-text sm:text-2xl">Leverage Report Dashboard</h1>
          <p className="mt-0.5 text-sm text-text-muted">
            Apurva.ai chatbot usage across instances &amp; months
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Upload onUploaded={handleUploaded} />
          <ThemeToggle />
        </div>
      </header>

      <div className="my-5 flex flex-wrap items-center gap-3">
        <label className="text-sm text-text-muted">Month:</label>
        <Select value={monthId ?? ""} onChange={(e) => setMonthId(Number(e.target.value))} className="min-w-[200px]">
          {months.map((m) => (
            <option key={m.month_id} value={m.month_id}>
              {m.month_label}
            </option>
          ))}
          {months.length === 0 && <option value="">(no data — upload a file)</option>}
        </Select>

        <div className="flex gap-1.5 rounded-xl border border-border bg-surface p-1">
          <Tab active={view === "overview"} onClick={() => setView("overview")}>
            Overview
          </Tab>
          <Tab active={view === "instance"} onClick={() => setView("instance")}>
            Instance Drill-down
          </Tab>
          <Tab active={view === "compare"} onClick={() => setView("compare")}>
            Compare
          </Tab>
          <Tab active={view === "report"} onClick={() => setView("report")}>
            Report
          </Tab>
        </div>
      </div>

      {error && <p className="mb-3 text-sm text-negative">{error}</p>}

      {months.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-dashed border-border bg-surface p-10 text-center text-text-muted">
          No months loaded yet. Use <b className="text-text">Upload .xlsx</b> to ingest a Leverage Report.
        </div>
      ) : view === "overview" ? (
        overview && <Overview data={overview} monthLabel={monthLabel} />
      ) : view === "instance" ? (
        <InstanceDrilldown
          key={dataVersion}
          monthId={monthId!}
          instances={instances}
          selected={selectedInstance}
          onSelect={setSelectedInstance}
        />
      ) : view === "compare" ? (
        <Compare key={dataVersion} />
      ) : (
        <Report key={dataVersion} monthId={monthId} />
      )}
    </div>
  );
}
