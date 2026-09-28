import type { ReactNode } from "react";
import type { AlertClass, AlertStatus, Severity } from "@/lib/gotham/model";

/* ---------------------------------------------------------------- micro label */

/** 10px uppercase tracked label. The only "header" this design system has. */
export function MicroLabel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={`text-micro uppercase text-g-muted ${className}`}>{children}</span>
  );
}

/* ---------------------------------------------------------------------- panel */

type PanelProps = {
  label?: string;
  /** Right-hand side of the label rule: counts, filters, a "view all" action. */
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Drop the inner padding when the panel holds a table or a grid. */
  flush?: boolean;
};

/**
 * Flat panel: hairline border, 4px radius, no shadow, no filled title bar —
 * just a micro label over a hairline rule.
 */
export function Panel({ label, aside, children, className = "", flush }: PanelProps) {
  return (
    <section
      className={`bg-g-panel border border-g-border rounded-[4px] flex flex-col min-h-0 ${className}`}
    >
      {(label || aside) && (
        <header className="h-8 px-3 flex items-center justify-between border-b border-g-border shrink-0">
          <MicroLabel>{label}</MicroLabel>
          {aside}
        </header>
      )}
      <div className={`flex-1 min-h-0 ${flush ? "" : "p-3"}`}>{children}</div>
    </section>
  );
}

/* ----------------------------------------------------------------- status dot */

const DOT: Record<string, string> = {
  ok: "bg-g-green",
  green: "bg-g-green",
  warn: "bg-g-amber",
  amber: "bg-g-amber",
  err: "bg-g-red",
  red: "bg-g-red",
  blue: "bg-g-blue",
  idle: "bg-g-muted",
};

/** 6px square. Square, not round — nothing in this console is a pill. */
export function StatusDot({ tone = "idle", className = "" }: { tone?: string; className?: string }) {
  return <span className={`w-1.5 h-1.5 shrink-0 ${DOT[tone] ?? DOT.idle} ${className}`} />;
}

/* ------------------------------------------------------------------ class tag */

const CLASS_STYLE: Record<AlertClass, string> = {
  person: "text-g-blue border-g-blue/40",
  vehicle: "text-g-violet border-g-violet/40",
  animal: "text-g-green border-g-green/40",
};

const CLASS_TEXT: Record<AlertClass, string> = {
  person: "Person",
  vehicle: "Vehicle",
  animal: "Animal",
};

export function ClassTag({ cls }: { cls: AlertClass }) {
  return (
    <span
      className={`inline-block px-1.5 h-[17px] leading-[15px] border rounded-[2px] text-micro uppercase ${CLASS_STYLE[cls]}`}
    >
      {CLASS_TEXT[cls]}
    </span>
  );
}

/* --------------------------------------------------------------- severity chip */

const SEV_STYLE: Record<Severity, string> = {
  high: "text-g-red border-g-red/50",
  med: "text-g-amber border-g-amber/50",
  low: "text-g-text-2 border-g-border-strong",
};

const SEV_TEXT: Record<Severity, string> = { high: "High", med: "Med", low: "Low" };

export function SeverityChip({ severity }: { severity: Severity }) {
  return (
    <span
      className={`inline-block px-1.5 h-[17px] leading-[15px] border rounded-[2px] text-micro uppercase ${SEV_STYLE[severity]}`}
    >
      {SEV_TEXT[severity]}
    </span>
  );
}

/* ----------------------------------------------------------------- status cell */

export function StatusCell({ status, by }: { status: AlertStatus; by?: string }) {
  if (status === "new") {
    return (
      <span className="inline-flex items-center gap-1.5 text-g-red">
        <StatusDot tone="red" />
        Unack
      </span>
    );
  }
  if (status === "dispatched") {
    return (
      <span className="inline-flex items-center gap-1.5 text-g-blue">
        <StatusDot tone="blue" />
        Dispatched
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-g-muted">
      <StatusDot tone="idle" />
      Ack{by ? ` · ${by}` : ""}
    </span>
  );
}

/* -------------------------------------------------------------------- kpi card */

type KpiProps = {
  label: string;
  value: ReactNode;
  /** Small mono line under the number: context, never decoration. */
  note?: string;
  tone?: "default" | "red" | "amber" | "green";
  onClick?: () => void;
  active?: boolean;
};

const KPI_TONE = {
  default: "text-g-text",
  red: "text-g-red",
  amber: "text-g-amber",
  green: "text-g-green",
} as const;

/** No icon, no chart, no shadow. A label, a number, one line of context. */
export function KpiCard({ label, value, note, tone = "default", onClick, active }: KpiProps) {
  const body = (
    <>
      <MicroLabel>{label}</MicroLabel>
      <div className={`text-kpi font-data mt-1.5 ${KPI_TONE[tone]}`}>{value}</div>
      {note && <div className="text-micro font-data text-g-muted mt-1 truncate">{note}</div>}
    </>
  );

  const base = `bg-g-panel border rounded-[4px] px-3 py-2.5 text-left block w-full ${
    active ? "border-g-blue" : "border-g-border"
  }`;

  return onClick ? (
    <button type="button" onClick={onClick} className={`${base} hover:bg-g-hover transition-none`}>
      {body}
    </button>
  ) : (
    <div className={base}>{body}</div>
  );
}

/* --------------------------------------------------------------------- buttons */

type BtnProps = {
  children: ReactNode;
  onClick?: () => void;
  variant?: "default" | "primary" | "danger" | "ghost";
  size?: "sm" | "md";
  title?: string;
  disabled?: boolean;
  type?: "button" | "submit";
  className?: string;
};

const VARIANT = {
  default:
    "bg-g-raised border border-g-border-strong text-g-text hover:bg-g-hover hover:border-g-blue/60",
  primary: "bg-g-blue border border-g-blue text-g-bg font-medium hover:bg-[#4fa2dc]",
  danger:
    "bg-transparent border border-g-red/50 text-g-red hover:bg-g-red hover:text-g-bg",
  ghost: "bg-transparent border border-transparent text-g-text-2 hover:text-g-text hover:bg-g-hover",
} as const;

export function Button({
  children,
  onClick,
  variant = "default",
  size = "md",
  title,
  disabled,
  type = "button",
  className = "",
}: BtnProps) {
  const dim = size === "sm" ? "h-6 px-2 text-micro uppercase" : "h-7 px-2.5 text-ui";
  return (
    <button
      type={type}
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`${dim} ${VARIANT[variant]} rounded-[2px] inline-flex items-center gap-1.5 transition-none disabled:opacity-40 ${className}`}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------- skeletons */

/** Pulsing placeholder rows. Tables render these instead of a blank panel. */
export function SkeletonRows({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="divide-y divide-g-border">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="h-8 px-3 flex items-center gap-4">
          {Array.from({ length: cols }).map((_, c) => (
            <div
              key={c}
              className="h-2 bg-g-raised animate-g-skeleton rounded-[1px]"
              style={{ width: `${[14, 22, 10, 18, 12][c % 5]}%`, animationDelay: `${(r * cols + c) * 40}ms` }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Never show a blank region: say what is missing and offer the way out. */
export function EmptyState({
  message,
  actionLabel,
  onAction,
}: {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="h-full min-h-32 flex flex-col items-center justify-center gap-2 py-8">
      <p className="text-ui text-g-muted">{message}</p>
      {actionLabel && onAction && (
        <Button size="sm" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
