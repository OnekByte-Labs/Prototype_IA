import type { ElementType, ReactNode } from "react";
import { cx } from "@/lib/design/cx";

/* -------------------------------------------------------------- SectionHeader */

/** Title row for a card, panel or page section: title (+ count) on the left, actions on the right. */
export function SectionHeader({
  title,
  count,
  description,
  aside,
  className,
  bordered = true,
}: {
  title: ReactNode;
  count?: ReactNode;
  description?: ReactNode;
  aside?: ReactNode;
  className?: string;
  bordered?: boolean;
}) {
  return (
    <header
      className={cx(
        "min-h-11 px-4 py-2 flex items-center justify-between gap-3 shrink-0",
        bordered && "border-b border-line",
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="text-section text-ink truncate">
          {title}
          {count !== undefined && <span className="ml-2 text-ink-3 font-normal tnum">{count}</span>}
        </h2>
        {description && <p className="text-caption text-ink-2 truncate">{description}</p>}
      </div>
      {aside && <div className="flex items-center gap-2 shrink-0">{aside}</div>}
    </header>
  );
}

/* ----------------------------------------------------------------------- Card */

type CardProps = {
  title?: ReactNode;
  count?: ReactNode;
  description?: ReactNode;
  aside?: ReactNode;
  children?: ReactNode;
  className?: string;
  /** Drop the inner padding: tables, lists and media run edge to edge. */
  flush?: boolean;
  /** No raised shadow — for surfaces that must stay structurally flat (tables, maps, video). */
  flat?: boolean;
  as?: ElementType;
  /** Extra classes for the body wrapper. */
  bodyClassName?: string;
};

/**
 * The one container. A surface plane on the canvas, hairline border, soft raised
 * shadow. Tables, maps and video use `flat` so they read as part of the page.
 */
export function Card({
  title,
  count,
  description,
  aside,
  children,
  className,
  flush,
  flat,
  as: Tag = "section",
  bodyClassName,
}: CardProps) {
  return (
    <Tag
      className={cx(
        "ds-card bg-surface border border-line rounded-lg flex flex-col min-h-0",
        !flat && "shadow-card",
        className,
      )}
    >
      {(title || aside) && <SectionHeader title={title} count={count} description={description} aside={aside} />}
      <div className={cx("flex-1 min-h-0", !flush && "p-4", bodyClassName)}>{children}</div>
    </Tag>
  );
}

/* ----------------------------------------------------------------------- Stat */

const STAT_TONE = {
  default: "text-ink",
  ok: "text-ok-ink",
  warn: "text-warn-ink",
  crit: "text-crit-ink",
} as const;

export type StatTone = keyof typeof STAT_TONE;

type StatProps = {
  label: string;
  value: ReactNode;
  /** One line of context under the value. */
  note?: ReactNode;
  /** Status colour for the value — only when the number itself is a status. */
  tone?: StatTone;
  onClick?: () => void;
  active?: boolean;
};

/**
 * A compact figure: quiet label, one number, one line of context. Meant to sit
 * in a <StatStrip>, not to be a giant card of its own.
 */
export function Stat({ label, value, note, tone = "default", onClick, active }: StatProps) {
  const body = (
    <>
      <div className="text-caption text-ink-2 truncate">{label}</div>
      <div className={cx("text-stat tnum mt-0.5 truncate", STAT_TONE[tone])}>{value}</div>
      {note && <div className="text-caption text-ink-3 mt-0.5 truncate">{note}</div>}
    </>
  );
  const cls = cx("block w-full text-left min-w-0 px-4 py-2.5", active && "bg-sunken shadow-inset-sm");
  return onClick ? (
    <button type="button" onClick={onClick} className={cx(cls, "hover:bg-hover")}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** One surface holding several Stats separated by hairlines. */
export function StatStrip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cx(
        "bg-surface border border-line rounded-lg shadow-card grid grid-flow-col auto-cols-fr divide-x divide-line overflow-hidden shrink-0",
        className,
      )}
    >
      {children}
    </div>
  );
}

/* ----------------------------------------------------------------- Key/value */

/** Two-column read-out for metadata. Label left in secondary ink, value right. */
export function KeyValue({
  label,
  children,
  mono,
  className,
}: {
  label: ReactNode;
  children: ReactNode;
  mono?: boolean;
  className?: string;
}) {
  return (
    <div className={cx("flex items-baseline justify-between gap-3 min-w-0", className)}>
      <dt className="text-caption text-ink-2 shrink-0">{label}</dt>
      <dd className={cx("text-ui text-ink text-right min-w-0 truncate", mono && "font-data text-data")}>{children}</dd>
    </div>
  );
}

/* ----------------------------------------------------------------- Empty state */

export function EmptyState({ message, hint, children }: { message: ReactNode; hint?: ReactNode; children?: ReactNode }) {
  return (
    <div className="h-full min-h-32 flex flex-col items-center justify-center gap-1.5 py-8 px-4 text-center">
      <p className="text-ui text-ink-2">{message}</p>
      {hint && <p className="text-caption text-ink-3 max-w-sm">{hint}</p>}
      {children && <div className="mt-2">{children}</div>}
    </div>
  );
}

/** Pulsing placeholder rows so a loading table is never a blank panel. */
export function SkeletonRows({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="divide-y divide-line">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="h-11 px-4 flex items-center gap-6">
          {Array.from({ length: cols }).map((_, c) => (
            <div
              key={c}
              className="h-2.5 bg-sunken animate-skeleton rounded-sm"
              style={{ width: `${[14, 22, 10, 18, 12][c % 5]}%`, animationDelay: `${(r * cols + c) * 40}ms` }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
