"use client";

import clsx from "clsx";

export function Card({
  title,
  action,
  children,
  className,
}: {
  title?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={clsx(
        "rounded-2xl border border-border bg-surface p-5 shadow-sm",
        className
      )}
    >
      {(title || action) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          {title && <h3 className="text-sm font-semibold text-text">{title}</h3>}
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

export function Empty({ children = "No data for this selection." }: { children?: React.ReactNode }) {
  return (
    <div className="flex min-h-[120px] items-center justify-center rounded-xl border border-dashed border-border text-center text-sm text-text-faint">
      {children}
    </div>
  );
}

export function Select({
  value,
  onChange,
  children,
  className,
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      value={value}
      onChange={onChange}
      className={clsx(
        "rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text outline-none transition-colors focus:border-brand disabled:opacity-50",
        className
      )}
      {...rest}
    >
      {children}
    </select>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={clsx(
        "rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text placeholder-text-faint outline-none transition-colors focus:border-brand",
        props.className
      )}
    />
  );
}

export function Button({
  variant = "secondary",
  size = "md",
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md";
}) {
  return (
    <button
      className={clsx(
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-3.5 py-2 text-sm",
        variant === "primary" && "bg-brand text-brand-text-on hover:bg-brand-hover",
        variant === "secondary" &&
          "border border-border bg-surface text-text hover:bg-surface-hover",
        variant === "ghost" && "text-text-muted hover:bg-surface-hover hover:text-text",
        className
      )}
      {...rest}
    />
  );
}

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "positive" | "negative" | "brand" | "warning";
  children: React.ReactNode;
}) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        tone === "neutral" && "bg-surface-hover text-text-muted",
        tone === "positive" && "bg-positive-soft text-positive",
        tone === "negative" && "bg-negative-soft text-negative",
        tone === "brand" && "bg-brand-soft text-brand",
        tone === "warning" && "bg-warning/15 text-warning"
      )}
    >
      {children}
    </span>
  );
}

const STATUS_TONE: Record<string, "neutral" | "positive" | "negative" | "brand" | "warning"> = {
  Activated: "positive",
  "High Growth": "positive",
  Recovery: "brand",
  Stable: "neutral",
  Declining: "warning",
  "Sharp Decline": "negative",
  Dormant: "negative",
  "Never Active": "neutral",
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONE[status] ?? "neutral"}>{status}</Badge>;
}

/** Month-over-month style delta pill: +12.4% / -3.1% / flat, colored. */
export function Delta({ value, suffix = "%" }: { value: number | null; suffix?: string }) {
  if (value === null || !Number.isFinite(value)) {
    return <Badge tone="neutral">—</Badge>;
  }
  const rounded = Math.round(value * 10) / 10;
  if (rounded === 0) return <Badge tone="neutral">0{suffix}</Badge>;
  const tone = rounded > 0 ? "positive" : "negative";
  const arrow = rounded > 0 ? "\u2191" : "\u2193";
  return (
    <Badge tone={tone}>
      {arrow} {Math.abs(rounded)}
      {suffix}
    </Badge>
  );
}

export function StatCard({
  label,
  value,
  delta,
  color = "text",
}: {
  label: string;
  value: React.ReactNode;
  delta?: React.ReactNode;
  color?: "text" | "brand" | "positive" | "negative";
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-text-faint">{label}</div>
      <div className="mt-1.5 flex items-baseline gap-2">
        <span
          className={clsx(
            "text-2xl font-bold tabular-nums",
            color === "text" && "text-text",
            color === "brand" && "text-brand",
            color === "positive" && "text-positive",
            color === "negative" && "text-negative"
          )}
        >
          {value}
        </span>
        {delta}
      </div>
    </div>
  );
}

export function Tab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "rounded-lg px-3.5 py-2 text-sm font-medium transition-colors",
        active ? "bg-brand text-brand-text-on shadow-sm" : "text-text-muted hover:bg-surface-hover hover:text-text"
      )}
    >
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={clsx("animate-spin text-text-faint", className)}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}
