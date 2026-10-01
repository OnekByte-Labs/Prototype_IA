import type { ReactNode } from "react";
import { cx } from "@/lib/design/cx";

/** CSS-only hover/focus tooltip. Dark ink on light UI is the one deliberate inversion. */
export function Tooltip({
  text,
  children,
  side = "right",
  className,
}: {
  text: ReactNode;
  children: ReactNode;
  side?: "right" | "bottom" | "top";
  className?: string;
}) {
  const pos =
    side === "right"
      ? "left-[calc(100%+8px)] top-1/2 -translate-y-1/2"
      : side === "bottom"
        ? "top-[calc(100%+6px)] left-1/2 -translate-x-1/2"
        : "bottom-[calc(100%+6px)] left-1/2 -translate-x-1/2";
  return (
    <span className={cx("group/tip relative inline-flex", className)}>
      {children}
      <span
        role="tooltip"
        className={cx(
          "pointer-events-none absolute z-[90] hidden group-hover/tip:block group-focus-within/tip:block",
          "px-2 py-1 rounded-md bg-ink text-canvas text-caption whitespace-nowrap shadow-pop",
          pos,
        )}
      >
        {text}
      </span>
    </span>
  );
}
