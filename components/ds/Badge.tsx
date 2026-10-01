import type { ReactNode } from "react";
import { cx } from "@/lib/design/cx";
import type { Tone } from "@/lib/design/tokens";

/* ------------------------------------------------------------------- Badge */

const BADGE: Record<Tone, string> = {
  neutral: "bg-hover text-ink-2",
  accent: "bg-accent-wash text-accent-ink",
  ok: "bg-ok-wash text-ok-ink",
  warn: "bg-warn-wash text-warn-ink",
  crit: "bg-crit-wash text-crit-ink",
};

/** A quiet label chip. Tinted wash + readable ink; no border, no outline. */
export function Badge({
  children,
  tone = "neutral",
  className,
  title,
  mono,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
  title?: string;
  mono?: boolean;
}) {
  return (
    <span
      title={title}
      className={cx(
        "inline-flex items-center gap-1 h-5 px-1.5 rounded-sm text-caption font-medium whitespace-nowrap",
        mono && "font-data",
        BADGE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/* --------------------------------------------------------- StatusIndicator */

export type StatusTone = Tone | "idle";

const DOT: Record<StatusTone, string> = {
  neutral: "bg-ink-3",
  idle: "bg-line-strong",
  accent: "bg-accent",
  ok: "bg-ok",
  warn: "bg-warn",
  crit: "bg-crit",
};

const TEXT: Record<StatusTone, string> = {
  neutral: "text-ink-2",
  idle: "text-ink-2",
  accent: "text-accent-ink",
  ok: "text-ok-ink",
  warn: "text-warn-ink",
  crit: "text-crit-ink",
};

/** Legacy tone names (`err`, `red`, `green`, …) still used by older call sites. */
const ALIAS: Record<string, StatusTone> = {
  ok: "ok",
  green: "ok",
  warn: "warn",
  amber: "warn",
  err: "crit",
  red: "crit",
  crit: "crit",
  blue: "accent",
  accent: "accent",
  neutral: "neutral",
  idle: "idle",
};

export function toTone(t: string | undefined): StatusTone {
  return (t && ALIAS[t]) || "idle";
}

/** 8px round indicator. Status is never carried by colour alone — pair with a label. */
export function StatusDot({
  tone = "idle",
  pulse,
  className,
}: {
  tone?: string;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cx("w-2 h-2 rounded-full shrink-0", DOT[toTone(tone)], pulse && "animate-breathe", className)}
    />
  );
}

/** Dot + text label. The label carries the meaning; the dot just makes it scannable. */
export function StatusIndicator({
  tone = "idle",
  children,
  pulse,
  className,
  dim,
}: {
  tone?: string;
  children: ReactNode;
  pulse?: boolean;
  className?: string;
  /** Render the label in secondary ink (healthy rows stay quiet). */
  dim?: boolean;
}) {
  const t = toTone(tone);
  return (
    <span className={cx("inline-flex items-center gap-1.5 text-ui", dim ? "text-ink-2" : TEXT[t], className)}>
      <StatusDot tone={t} pulse={pulse} />
      {children}
    </span>
  );
}

/* --------------------------------------------------------- HealthIndicator */

const FILL: Record<StatusTone, string> = DOT;

/**
 * Compact health meter: a thin inset track with a tone-coloured fill and the
 * number beside it. For channels-up, disk used, load — anything with a ratio.
 */
export function HealthIndicator({
  value,
  max = 100,
  tone = "ok",
  label,
  width = "w-16",
  className,
}: {
  value: number;
  max?: number;
  tone?: string;
  /** Visible text, defaults to the percentage. */
  label?: ReactNode;
  width?: string;
  className?: string;
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, Math.round((value / max) * 100))) : 0;
  return (
    <div className={cx("flex items-center gap-2", className)}>
      <div
        role="meter"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        className={cx("h-1.5 rounded-full bg-sunken shadow-inset-sm overflow-hidden", width)}
      >
        <div className={cx("h-full rounded-full", FILL[toTone(tone)])} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-data font-data text-ink-2 tnum min-w-8 text-right">{label ?? `${pct}%`}</span>
    </div>
  );
}
