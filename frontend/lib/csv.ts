/** Minimal client-side CSV export -- no backend involved, works on any host. */
export function downloadCsv<T extends object>(filename: string, rows: T[], columns?: (keyof T)[]) {
  if (rows.length === 0) return;
  const cols = columns ?? (Object.keys(rows[0]) as (keyof T)[]);
  const escape = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [
    cols.join(","),
    ...rows.map((r) => cols.map((c) => escape(r[c])).join(",")),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
