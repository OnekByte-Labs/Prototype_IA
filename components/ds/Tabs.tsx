"use client";

import type { ReactNode } from "react";
import { cx } from "@/lib/design/cx";

export type TabItem<T extends string = string> = {
  id: T;
  label: ReactNode;
  count?: ReactNode;
  disabled?: boolean;
};

/**
 * Page-level tabs: text with an accent underline on the active one. Use for
 * switching between sections of the same screen.
 */
export function Tabs<T extends string>({
  items,
  value,
  onChange,
  className,
  label = "Sections",
}: {
  items: TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  className?: string;
  label?: string;
}) {
  return (
    <div role="tablist" aria-label={label} className={cx("flex items-end gap-5 border-b border-line", className)}>
      {items.map((it) => {
        const active = it.id === value;
        return (
          <button
            key={it.id}
            type="button"
            role="tab"
            aria-selected={active}
            data-testid={`tab-${it.id}`}
            disabled={it.disabled}
            onClick={() => onChange(it.id)}
            className={cx(
              "relative h-10 text-ui font-medium transition-colors disabled:opacity-45",
              active ? "text-ink" : "text-ink-2 hover:text-ink",
            )}
          >
            {it.label}
            {it.count !== undefined && <span className="ml-1.5 text-ink-3 font-normal tnum">{it.count}</span>}
            <span
              className={cx("absolute left-0 right-0 -bottom-px h-0.5 rounded-full", active ? "bg-accent" : "bg-transparent")}
            />
          </button>
        );
      })}
    </div>
  );
}

/**
 * Segmented control: a small set of mutually exclusive options (density, filter,
 * view mode). The selected segment is pressed in — inset, accent label.
 */
export function SegmentedControl<T extends string | number>({
  items,
  value,
  onChange,
  label,
  size = "md",
  className,
}: {
  items: { id: T; label: ReactNode; title?: string; disabled?: boolean }[];
  value: T;
  onChange: (id: T) => void;
  label: string;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cx("inline-flex items-center gap-0.5 p-0.5 rounded-md bg-surface border border-line", className)}
    >
      {items.map((it) => {
        const active = it.id === value;
        return (
          <button
            key={String(it.id)}
            type="button"
            role="radio"
            aria-checked={active}
            title={it.title}
            disabled={it.disabled}
            onClick={() => onChange(it.id)}
            className={cx(
              "rounded-[5px] font-medium whitespace-nowrap transition-[box-shadow,background-color,color] duration-100 disabled:opacity-45",
              size === "sm" ? "h-6 px-2 text-caption" : "h-7 px-2.5 text-ui",
              active
                ? "bg-canvas shadow-inset-sm text-accent-ink"
                : "text-ink-2 hover:text-ink hover:bg-hover",
            )}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}
