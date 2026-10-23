import { cx } from "@/lib/design/cx";

interface PlateBadgeProps {
  plate: string;
  size?: "sm" | "md" | "lg";
  className?: string;
  isCommercial?: boolean; // Yellow background for commercial/taxi/truck
  fixedWidth?: boolean;   // Standardized justifiable plate dimensions
}

export function PlateBadge({
  plate,
  size = "md",
  className,
  isCommercial = false,
  fixedWidth = true,
}: PlateBadgeProps) {
  const clean = (plate || "UNKNOWN").toUpperCase();

  // Standardized, justifiable dimensions matching physical license plates (ratio ~4.2:1)
  const sizeConfig = {
    sm: {
      container: fixedWidth ? "h-[25px] w-[128px]" : "h-[25px] px-2",
      indStrip: "w-[28px] text-[7.5px] gap-0.5",
      flag: "text-[7px]",
      indText: "text-[8px] font-bold",
      plateText: "text-[11.5px] tracking-wider",
    },
    md: {
      container: fixedWidth ? "h-[32px] w-[164px]" : "h-[32px] px-2.5",
      indStrip: "w-[34px] text-[9px] gap-0.5",
      flag: "text-[8.5px]",
      indText: "text-[9px] font-bold",
      plateText: "text-[14px] tracking-widest",
    },
    lg: {
      container: fixedWidth ? "h-[44px] w-[224px]" : "h-[44px] px-4",
      indStrip: "w-[44px] text-[10px] gap-1",
      flag: "text-[10px]",
      indText: "text-[11px] font-black",
      plateText: "text-[17px] tracking-widest",
    },
  }[size];

  const bgStyle = isCommercial
    ? {
        backgroundColor: "#f59e0b", // Reflective taxi amber/yellow
        borderColor: "#b45309",
        color: "#000000",
      }
    : {
        backgroundColor: "#ffffff", // Pure reflective white
        borderColor: "#94a3b8",
        color: "#000000",
      };

  return (
    <div
      className={cx(
        "relative inline-flex items-center rounded border font-mono font-bold select-none shrink-0 shadow-sm transition-transform",
        sizeConfig.container,
        className
      )}
      style={{
        ...bgStyle,
        boxShadow: "0 1px 3px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.6)",
      }}
      title={`License plate: ${clean}`}
    >
      {/* Subtle mounting rivet dots for physical plate authenticity */}
      {size === "lg" && (
        <>
          <div className="absolute top-1.5 left-14 w-1.5 h-1.5 rounded-full bg-slate-400 border border-slate-600 shadow-inner" />
          <div className="absolute top-1.5 right-2 w-1.5 h-1.5 rounded-full bg-slate-400 border border-slate-600 shadow-inner" />
        </>
      )}

      {/* IND Hologram Strip with Indian flag */}
      <div
        className={cx(
          "h-full flex items-center justify-center select-none shrink-0",
          sizeConfig.indStrip
        )}
        style={{
          borderRight: "1px solid rgba(0,0,0,0.25)",
          background: isCommercial
            ? "linear-gradient(180deg, #d97706 0%, #b45309 100%)"
            : "linear-gradient(180deg, #1e3a8a 0%, #1e40af 100%)",
          color: "#ffffff",
        }}
      >
        <span className={cx("leading-none", sizeConfig.flag)}>🇮🇳</span>
        <span className={cx("tracking-tighter font-mono", sizeConfig.indText)}>
          IND
        </span>
      </div>

      {/* Plate Characters: Monospace, bold, centered & justifiable */}
      <div
        className={cx(
          "flex-1 text-center font-mono uppercase overflow-hidden text-ellipsis whitespace-nowrap px-1",
          sizeConfig.plateText
        )}
        style={{
          color: "#000000",
          letterSpacing: size === "lg" ? "0.12em" : "0.08em",
          fontWeight: 900,
        }}
      >
        {clean}
      </div>
    </div>
  );
}
