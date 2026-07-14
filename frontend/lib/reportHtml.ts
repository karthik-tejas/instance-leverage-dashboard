import { Report } from "./api";

function esc(s: unknown): string {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString();
}

function pct(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `${n > 0 ? "+" : ""}${n}%`;
}

const STATUS_COLORS: Record<string, string> = {
  Activated: "#16a34a",
  "High Growth": "#16a34a",
  Recovery: "#4f46e5",
  Stable: "#64748b",
  Declining: "#d97706",
  "Sharp Decline": "#dc2626",
  Dormant: "#dc2626",
  "Never Active": "#64748b",
};

function statusChip(status: string): string {
  const color = STATUS_COLORS[status] ?? "#64748b";
  return `<span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;color:${color};background:${color}1a;white-space:nowrap;">${esc(status)}</span>`;
}

/** Builds a fully self-contained, print/PDF-friendly HTML document for the
 * Instance Utilisation Report -- no external stylesheet/script dependencies,
 * so it opens correctly whether printed, saved standalone, or emailed. */
export function buildReportDocument(report: Report): string {
  const { overview } = report;
  const genDate = new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

  const comparisonRows = report.comparison
    .map(
      (r) => `<tr>
        <td>${esc(r.instance)}</td>
        <td class="num">${fmt(r.users_prev)}</td>
        <td class="num">${fmt(r.users_cur)}</td>
        <td class="num">${fmt(r.questions_prev)}</td>
        <td class="num">${fmt(r.questions_cur)}</td>
        <td class="num">${pct(r.delta_pct)}</td>
        <td class="num">${r.qu_prev}</td>
        <td class="num">${r.qu_cur}</td>
        <td>${statusChip(r.status)}</td>
      </tr>`
    )
    .join("");

  const highPerforming = report.comparison
    .filter((r) => ["Activated", "High Growth", "Recovery"].includes(r.status))
    .slice(0, 6);
  const highPerformingHtml = highPerforming.length
    ? highPerforming
        .map(
          (r) => `<div class="stat-block">
            <div class="stat-block-title">${esc(r.instance)} ${statusChip(r.status)}</div>
            <div class="stat-row">
              <div><div class="stat-num">${fmt(r.users_cur)}</div><div class="stat-label">Users</div></div>
              <div><div class="stat-num">${fmt(r.questions_cur)}</div><div class="stat-label">Questions (${pct(r.delta_pct)})</div></div>
              <div><div class="stat-num">${r.qu_cur}</div><div class="stat-label">Q/User</div></div>
            </div>
          </div>`
        )
        .join("")
    : `<p class="muted">No newly activated / high-growth / recovering instances this month.</p>`;

  const decliningRows = report.comparison
    .filter((r) => ["Declining", "Sharp Decline"].includes(r.status))
    .map(
      (r) => `<tr>
        <td>${esc(r.instance)}</td>
        <td class="num">${fmt(r.questions_cur)}</td>
        <td class="num">${fmt(r.users_cur)}</td>
        <td class="num">${r.qu_cur}</td>
        <td>${statusChip(r.status)} ${pct(r.delta_pct)}</td>
      </tr>`
    )
    .join("");

  const dormantRows = report.comparison
    .filter((r) => ["Dormant", "Never Active"].includes(r.status))
    .map(
      (r) => `<tr>
        <td>${esc(r.instance)}</td>
        <td class="num">${fmt(r.users_cur)}</td>
        <td class="num">${fmt(r.questions_cur)}</td>
        <td>${statusChip(r.status)}</td>
      </tr>`
    )
    .join("");

  const leverageHtml = report.knowledge_leverage.length
    ? report.knowledge_leverage
        .map(
          (k) => `<div class="leverage-block">
            <h4>${esc(k.instance)} <span class="muted">(${fmt(k.questions_asked)} questions)</span></h4>
            <div class="leverage-cols">
              <div>
                <div class="leverage-col-title">Top documents</div>
                <ul>${
                  k.top_documents.length
                    ? k.top_documents.map((d) => `<li>${esc(d.doc_name || d.doc_url || "—")} <span class="muted">(${fmt(d.frequency)} citations)</span></li>`).join("")
                    : `<li class="muted">No document data.</li>`
                }</ul>
              </div>
              <div>
                <div class="leverage-col-title">Top questions</div>
                <ul>${
                  k.top_questions.length
                    ? k.top_questions.map((q) => `<li>"${esc(q.question)}" <span class="muted">(${fmt(q.count)}×)</span></li>`).join("")
                    : `<li class="muted">No question data.</li>`
                }</ul>
              </div>
            </div>
          </div>`
        )
        .join("")
    : `<p class="muted">No active instances this month.</p>`;

  const fb = report.feedback;
  const fbInstancesHtml = fb.per_instance.length
    ? fb.per_instance
        .map(
          (f) => `<div class="leverage-block">
            <h4>${esc(f.instance)} Feedback <span class="muted">(${f.likes} likes, ${f.dislikes} dislikes, ${f.responses} responses)</span></h4>
            ${
              f.sample_dislikes.length
                ? `<ul>${f.sample_dislikes
                    .map(
                      (d) =>
                        `<li><b>Dislike${d.dislikes && d.dislikes > 1 ? ` ×${d.dislikes}` : ""}:</b> "${esc(d.question)}" ${d.answer ? `<span class="muted">— ${esc(d.answer)}</span>` : ""}</li>`
                    )
                    .join("")}</ul>`
                : `<p class="muted">No disliked Q&amp;A recorded.</p>`
            }
          </div>`
        )
        .join("")
    : `<p class="muted">No feedback recorded this month.</p>`;

  const cumulativeMonths = report.cumulative[0]?.months.map((m) => m.month_label) ?? [];
  const cumulativeRows = report.cumulative
    .map(
      (c) => `<tr>
        <td>${esc(c.instance)}</td>
        ${c.months.map((m) => `<td class="num">${fmt(m.questions_asked)}</td>`).join("")}
        <td class="num"><b>${fmt(c.total_questions)}</b></td>
        <td>${statusChip(c.trend_status)}</td>
      </tr>`
    )
    .join("");

  const nextStepsRows = report.curation_next_steps
    .map(
      (n) => `<tr>
        <td>${esc(n.instance)}</td>
        <td>${statusChip(n.status)}</td>
        <td>${esc(n.action)}</td>
      </tr>`
    )
    .join("");

  const insightsHtml = report.key_insights
    .map(
      (k, i) => `<div class="insight">
        <div class="insight-num">${i + 1}</div>
        <div>
          <div class="insight-heading">${esc(k.heading)}</div>
          <div class="insight-detail">${esc(k.detail)}</div>
        </div>
      </div>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Instance Utilisation Report — ${esc(report.month_label)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #0f172a; margin: 0; padding: 32px 40px 80px; max-width: 980px; }
  h1 { font-size: 26px; margin: 0 0 4px; }
  h2 { font-size: 19px; margin: 40px 0 6px; padding-bottom: 6px; border-bottom: 2px solid #0f172a; }
  h3 { font-size: 15px; margin: 24px 0 10px; color: #334155; }
  h4 { font-size: 13px; margin: 0 0 8px; }
  p { line-height: 1.55; font-size: 13.5px; }
  .muted { color: #64748b; font-size: 12px; }
  .subtitle { color: #64748b; font-size: 13px; margin: 0 0 24px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; margin: 10px 0 8px; }
  th, td { border: 1px solid #e2e8f0; padding: 6px 8px; text-align: left; vertical-align: top; }
  th { background: #f8fafc; font-weight: 600; }
  td.num, th.num { text-align: right; }
  .stat-cards { display: flex; gap: 14px; flex-wrap: wrap; margin: 12px 0 20px; }
  .stat-card { border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px 16px; min-width: 140px; flex: 1; }
  .stat-card .num { font-size: 22px; font-weight: 700; }
  .stat-card .label { font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.03em; }
  .stat-block { border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px 16px; margin-bottom: 10px; }
  .stat-block-title { font-weight: 600; font-size: 13px; margin-bottom: 8px; display: flex; gap: 8px; align-items: center; }
  .stat-row { display: flex; gap: 24px; }
  .stat-row .stat-num { font-size: 18px; font-weight: 700; }
  .stat-row .stat-label { font-size: 11px; color: #64748b; }
  .leverage-block { border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px 16px; margin-bottom: 10px; }
  .leverage-cols { display: flex; gap: 24px; }
  .leverage-cols > div { flex: 1; }
  .leverage-col-title { font-size: 11px; text-transform: uppercase; letter-spacing: 0.03em; color: #64748b; margin-bottom: 4px; }
  ul { margin: 0; padding-left: 18px; font-size: 12.5px; }
  li { margin-bottom: 3px; }
  .insight { display: flex; gap: 12px; margin-bottom: 12px; }
  .insight-num { flex-shrink: 0; width: 22px; height: 22px; border-radius: 50%; background: #0f172a; color: #fff; font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center; }
  .insight-heading { font-weight: 600; font-size: 13px; }
  .insight-detail { font-size: 12.5px; color: #475569; margin-top: 2px; }
  .note { background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 10px 14px; font-size: 12px; color: #92400e; margin-top: 20px; }
  @media print {
    body { padding: 0 24px; }
    h2 { page-break-before: auto; }
    .stat-block, .leverage-block { page-break-inside: avoid; }
  }
</style>
</head>
<body>
  <h1>Instance Utilisation Report</h1>
  <p class="subtitle">${esc(report.month_label)}${report.previous_month_label ? ` — compared with ${esc(report.previous_month_label)}` : ""} · Generated ${esc(genDate)}</p>

  <h2>Purpose</h2>
  <p>This report provides a data-driven assessment of chatbot instance utilisation for <b>${esc(report.month_label)}</b>.
  It covers instance-level performance, month-on-month trend analysis, knowledge leverage, feedback analysis,
  cumulative performance across all loaded months, and curation next steps. Every figure and quote below is
  computed directly from the ingested Leverage Report data — no content is inferred or generated by an LLM.</p>

  <h2>1. Instance-Level Performance Analysis</h2>
  <h3>1.1 Programme Overview</h3>
  <div class="stat-cards">
    <div class="stat-card"><div class="num">${fmt(overview.total_instances)}</div><div class="label">Total instances</div></div>
    <div class="stat-card"><div class="num">${fmt(overview.total_questions)}</div><div class="label">Total questions (${esc(report.month_label)})</div></div>
    <div class="stat-card"><div class="num">${pct(overview.delta_pct)}</div><div class="label">vs ${esc(report.previous_month_label ?? "prior month")} (${fmt(overview.previous_total_questions)})</div></div>
    <div class="stat-card"><div class="num">${fmt(overview.active_instances)}</div><div class="label">Active instances (≥ 1 question)</div></div>
    <div class="stat-card"><div class="num">${fmt(overview.total_users)}</div><div class="label">Total active users</div></div>
  </div>

  <h3>1.2 Full Instance Comparison</h3>
  <p class="muted">Instances ranked by this month's question volume. Q/U = Questions per user.</p>
  <table>
    <thead><tr><th>Instance</th><th class="num">Users (prev)</th><th class="num">Users</th><th class="num">Q's (prev)</th><th class="num">Q's</th><th class="num">Δ Q's</th><th class="num">Q/U (prev)</th><th class="num">Q/U</th><th>Status</th></tr></thead>
    <tbody>${comparisonRows}</tbody>
  </table>

  <h3>1.3 High-Performing Instances</h3>
  ${highPerformingHtml}

  <h3>1.4 Declining / Partial Instances</h3>
  ${decliningRows ? `<table><thead><tr><th>Instance</th><th class="num">Q's</th><th class="num">Users</th><th class="num">Q/U</th><th>Status</th></tr></thead><tbody>${decliningRows}</tbody></table>` : `<p class="muted">No declining instances this month.</p>`}

  <h3>1.5 Dormant Instances</h3>
  ${dormantRows ? `<table><thead><tr><th>Instance</th><th class="num">Users</th><th class="num">Q's</th><th>Status</th></tr></thead><tbody>${dormantRows}</tbody></table>` : `<p class="muted">No dormant instances this month.</p>`}

  <h2>2. Knowledge Leverage Analysis</h2>
  <p class="muted">Real top-cited documents and top questions for every instance with at least one question this month.</p>
  ${leverageHtml}

  <h2>3. Feedback Analysis</h2>
  <div class="stat-cards">
    <div class="stat-card"><div class="num">${fmt(fb.instances_with_feedback)}</div><div class="label">Instances with feedback</div></div>
    <div class="stat-card"><div class="num">${fmt(fb.total_responses)}</div><div class="label">Total feedback responses</div></div>
    <div class="stat-card"><div class="num">${fmt(fb.likes)}</div><div class="label">Likes</div></div>
    <div class="stat-card"><div class="num">${fmt(fb.dislikes)}</div><div class="label">Dislikes</div></div>
  </div>
  ${fbInstancesHtml}

  <h2>4. Cumulative Performance (all loaded months)</h2>
  <table>
    <thead><tr><th>Instance</th>${cumulativeMonths.map((m) => `<th class="num">${esc(m)}</th>`).join("")}<th class="num">Total</th><th>Recent trend</th></tr></thead>
    <tbody>${cumulativeRows}</tbody>
  </table>

  <h2>5. Curation Next Steps</h2>
  <table>
    <thead><tr><th>Instance</th><th>Status</th><th>Action required</th></tr></thead>
    <tbody>${nextStepsRows}</tbody>
  </table>

  <h2>6. Key Insights &amp; Takeaways</h2>
  ${insightsHtml}

  <div class="note">
    <b>Note:</b> A "Partner Utilisation Summary" section (assets uploaded / shared to the collective) is not
    included — that data isn't currently captured by the Leverage Report parser. Add it to the data model if
    you'd like it in future reports.
  </div>
</body>
</html>`;
}

export function downloadReportHtml(report: Report) {
  const html = buildReportDocument(report);
  const blob = new Blob([html], { type: "text/html;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Instance_Utilisation_Report_${report.month_label.replace(/\s+/g, "_")}.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function printReport(report: Report) {
  const html = buildReportDocument(report);
  const win = window.open("", "_blank");
  if (!win) return;
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.focus();
  // Give the new document a tick to finish laying out before invoking print.
  setTimeout(() => win.print(), 250);
}
