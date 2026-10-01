import type { ReactNode } from "react";
import { cx } from "@/lib/design/cx";

/**
 * Frame for one camera. The picture is the content, so the tile is only a
 * raised, hairline-bordered mat around dark video: selection is an accent ring,
 * an active alert a red one. Nothing glows.
 */
export function CameraTile({
  children,
  selected,
  alerting,
  onClick,
  className,
}: {
  children: ReactNode;
  selected?: boolean;
  alerting?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <div
      onClick={onClick}
      className={cx(
        "relative rounded-md overflow-hidden bg-video border shadow-tile transition-shadow",
        alerting ? "border-crit ring-2 ring-crit/70" : selected ? "border-accent ring-2 ring-accent" : "border-line-strong",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Empty slot in the wall: sunken, so it reads as "nothing mounted here". */
export function CameraSlotEmpty() {
  return <div className="rounded-md bg-sunken/70 border border-dashed border-line-strong" />;
}

/**
 * Small readout laid over video. Solid dark chip (no blur) so text stays legible
 * on any footage.
 */
export function VideoChip({
  children,
  tone = "neutral",
  className,
  title,
  glass,
  ...rest
}: {
  children: ReactNode;
  tone?: "neutral" | "ok" | "warn" | "crit";
  className?: string;
  title?: string;
  /** Liquid-glass dashboard chip: mono, fine border, no blur (blur over live video is costly). */
  glass?: boolean;
} & Record<`data-${string}`, string | undefined>) {
  const toneCls = {
    neutral: "text-video-ink",
    ok: "text-video-ok",
    warn: "text-video-warn",
    crit: "text-video-crit",
  }[tone];
  return (
    <span
      title={title}
      className={cx(
        "inline-flex items-center gap-1.5 whitespace-nowrap",
        glass
          ? "px-1.5 py-0.5 rounded bg-black/65 border border-white/10 text-[10px] font-data font-medium"
          : "h-5 px-1.5 rounded-sm bg-video/80 text-caption font-medium",
        toneCls,
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}
