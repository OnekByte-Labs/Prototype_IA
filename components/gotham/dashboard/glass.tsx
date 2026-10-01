"use client";

import type { ElementType, ReactNode, Ref } from "react";
import { Icon } from "@/components/ds";
import { cx } from "@/lib/design/cx";

/**
 * Building blocks of the liquid-glass dashboard (Stitch "ISCC Liquid Glass
 * Command Console"). Materials are in app/glass.css; colours come from the
 * `.theme-glass` token scope. Every dashboard section is composed from these.
 */

/* ------------------------------------------------------------------- panel */

export function GlassPanel({
  children,
  className,
  variant,
  as: Tag = "div",
  ref,
}: {
  children: ReactNode;
  className?: string;
  variant?: "bar" | "kpi" | "warn";
  as?: ElementType;
  ref?: Ref<HTMLElement>;
}) {
  return (
    <Tag
      ref={ref}
      className={cx(
        "glass-panel",
        variant === "bar" && "glass-panel-bar",
        (variant === "kpi" || variant === "warn") && "glass-panel-kpi",
        variant === "warn" && "glass-panel-warn",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

/** Panel toolbar: icon tile + title on the left, readouts on the right, hairline below. */
export function PanelHeader({
  icon,
  title,
  left,
  right,
  className,
}: {
  icon?: string;
  title: ReactNode;
  left?: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("flex items-center justify-between gap-3 pb-2 mb-2 border-b border-white/[0.06] shrink-0", className)}>
      <div className="flex items-center gap-2 min-w-0">
        {icon && (
          <span className="w-5 h-5 shrink-0 rounded-md bg-white/10 text-white flex items-center justify-center">
            <Icon name={icon} size={14} />
          </span>
        )}
        <span className="text-xs font-semibold text-ink tracking-tight truncate">{title}</span>
        {left}
      </div>
      {right && <div className="flex items-center gap-3 shrink-0 text-[10px] font-data text-ink-3">{right}</div>}
    </div>
  );
}

/* -------------------------------------------------------------------- pill */

export type PillTone = "neutral" | "ok" | "warn" | "crit" | "accent";

const PILL: Record<PillTone, string> = {
  neutral: "bg-white/10 text-white/90 border-white/15",
  ok: "bg-ok/10 text-ok-ink border-ok/20",
  warn: "bg-warn/10 text-warn-ink border-warn/20",
  crit: "bg-crit/10 text-crit-ink border-crit/20",
  accent: "bg-accent/15 text-accent-ink border-accent/20",
};

const DOT: Record<PillTone, string> = {
  neutral: "bg-white/80",
  ok: "bg-ok-ink",
  warn: "bg-warn-ink",
  crit: "bg-crit-ink",
  accent: "bg-accent-ink",
};

/** Small mono status chip, optionally led by a (pulsing) dot. */
export function Pill({
  children,
  tone = "neutral",
  dot,
  pulse,
  round = true,
  className,
  title,
}: {
  children: ReactNode;
  tone?: PillTone;
  dot?: boolean;
  pulse?: boolean;
  round?: boolean;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cx(
        "inline-flex items-center gap-1.5 px-2 py-0.5 border text-[10px] font-data font-medium whitespace-nowrap",
        round ? "rounded-full" : "rounded-md",
        PILL[tone],
        className,
      )}
    >
      {dot && <span className={cx("w-1.5 h-1.5 rounded-full shrink-0", DOT[tone], pulse && "glass-pulse")} />}
      {children}
    </span>
  );
}

/* ----------------------------------------------------------------- segment */

/** Recessed segmented control: the selected option is a lifted glass chip. */
export function GlassSegment<T extends string | number>({
  items,
  value,
  onChange,
  label,
  className,
}: {
  items: { id: T; label: ReactNode; title?: string }[];
  value: T;
  onChange: (id: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={cx("flex items-center bg-black/40 border border-white/[0.08] rounded-md p-0.5 text-[10px]", className)}>
      {items.map((it) => {
        const on = it.id === value;
        return (
          <button
            key={String(it.id)}
            type="button"
            aria-pressed={on}
            title={it.title}
            onClick={() => onChange(it.id)}
            className={cx(
              "px-2 py-0.5 rounded transition whitespace-nowrap",
              on ? "bg-white/10 text-white font-medium shadow-xs" : "text-ink-2 hover:text-white",
            )}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------- icon button */

export function GlassIconButton({
  icon,
  label,
  onClick,
  size = 15,
  className,
  tone,
}: {
  icon: string;
  label: string;
  onClick?: () => void;
  size?: number;
  className?: string;
  tone?: "crit";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cx(
        "glass-button w-7 h-7 rounded-lg flex items-center justify-center",
        tone === "crit" ? "text-crit-ink hover:text-crit-ink" : "text-ink-2 hover:text-white",
        className,
      )}
    >
      <Icon name={icon} size={size} />
    </button>
  );
}
