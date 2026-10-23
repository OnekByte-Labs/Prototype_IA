import { cx } from "@/lib/design/cx";

interface PlateBadgeProps {
  plate: string;
  size?: "sm" | "md" | "lg";
  className?: string;
  isCommercial?: boolean; // Yellow background for commercial/taxi/truck
}

export function PlateBadge({
  plate,
  size = "md",
  className,
  isCommercial = false,
}: PlateBadgeProps) {
  const clean = (plate || "UNKNOWN").toUpperCase();

  const sizeClasses = {
    sm: "h-5 text-[11px] px-1.5 gap-1",
    md: "h-6 text-[12px] px-2 gap-1.5",
    lg: "h-8 text-[14px] px-3 gap-2 tracking-wider",
  }[size];

  const bgStyle = isCommercial
    ? { backgroundColor: "#fbbf24", borderColor: "#d97706", color: "#000000" }
    : { backgroundColor: "#ffffff", borderColor: "#94a3b8", color: "#000000" };

  return (
    <span
      className={cx(
        "inline-flex items-center rounded border font-mono font-bold select-none shrink-0 shadow-sm transition-transform",
        sizeClasses,
        className
      )}
      style={{
        ...bgStyle,
        boxShadow: "0 1px 2px rgba(0,0,0,0.25)",
      }}
      title={`License plate: ${clean}`}
    >
      {/* IND hologram strip */}
      <span
        className="flex items-center gap-0.5 text-[8px] font-bold select-none pr-1 shrink-0"
        style={{
          borderRight: "1px solid rgba(0,0,0,0.3)",
          color: "#1d4ed8",
        }}
      >
        <span className="text-[7px] leading-none">🇮🇳</span>
        <span className="tracking-tighter font-mono font-black" style={{ color: "#1e40af" }}>
          IND
        </span>
      </span>
      {/* Plate characters */}
      <span
        className="font-mono tracking-wider uppercase text-center px-0.5"
        style={{
          color: "#000000",
          fontWeight: 900,
          letterSpacing: "0.08em",
        }}
      >
        {clean}
      </span>
    </span>
  );
}

