"use client";

import { Icon } from "@/components/ui/Icon";
import {
  type DatasetSource,
} from "@/lib/datasets/dataset-definitions";

export type GridDensity = 9 | 16 | 32;
export type TileMode = "all" | "dynamic_alerts" | "fixed_only";

interface DatasetControlBarProps {
  activeDataset: DatasetSource | "ALL";
  onSelectDataset: (ds: DatasetSource | "ALL") => void;
  density: GridDensity;
  onChangeDensity: (density: GridDensity) => void;
  tileMode: TileMode;
  onChangeTileMode: (mode: TileMode) => void;
  showAiBoxes?: boolean;
  onToggleAiBoxes?: () => void;
  globalThermal: boolean;
  onToggleGlobalThermal: () => void;
  alertCount: number;
}

export function DatasetControlBar({
  activeDataset,
  onSelectDataset,
  density,
  onChangeDensity,
  tileMode,
  onChangeTileMode,
  globalThermal,
  onToggleGlobalThermal,
  alertCount,
}: DatasetControlBarProps) {
  const datasets: Array<{ id: DatasetSource | "ALL"; label: string; tag: string }> = [
    { id: "ALL", label: "ALL CHANNELS", tag: "32 CAMS" },
    { id: "VIRAT", label: "VIRAT HD", tag: "HD Video" },
    { id: "MOT20", label: "MOT20", tag: "Crowd Tracking" },
    { id: "LLVIP", label: "LLVIP", tag: "Thermal IR" },
    { id: "BORDER_THREAT", label: "BORDER THREAT", tag: "Intrusion" },
    { id: "VISDRONE", label: "VISDRONE", tag: "Tactical UAV" },
    { id: "UFPR_ALPR", label: "UFPR-ALPR", tag: "ANPR / OCR" },
  ];

  return (
    <div className="bg-g-panel border border-g-border rounded-[4px] p-2 flex flex-col gap-2 shrink-0">
      {/* Top Row: Pipeline Diagnostics & Status Strip */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-g-border pb-2 text-[11px] font-mono">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-g-text font-bold uppercase tracking-wider">
              STREAM INGESTION ENGINE
            </span>
          </div>
          <span className="text-g-muted">|</span>
          <span className="text-g-text-2">
            RTSP GATEWAY: <strong className="text-emerald-400">MediaMTX :8554</strong>
          </span>
          <span className="text-g-muted">|</span>
          <span className="text-g-text-2">
            INFERENCE: <strong className="text-cyan-400">NVIDIA DeepStream + YOLOv11x</strong>
          </span>
          <span className="text-g-muted">|</span>
          <span className="text-g-text-2">
            EVENT BUS: <strong className="text-purple-400">MQTT Daemon (JSON)</strong>
          </span>
        </div>

        <div className="flex items-center gap-3 text-g-muted">
          <span className="flex items-center gap-1">
            <Icon name="location_on" size={13} className="text-red-400" />
            <span>KUPWARA SECTOR · ELEV: 1685m MSL</span>
          </span>
          <span>43R WQ 1842 8112</span>
        </div>
      </div>

      {/* Middle Row: Dataset Filter Buttons */}
      <div className="flex items-center justify-between gap-2 overflow-x-auto">
        <div className="flex items-center gap-1">
          <span className="text-micro uppercase text-g-muted font-mono tracking-wider mr-1">
            DATASET:
          </span>
          {datasets.map((d) => {
            const active = activeDataset === d.id;
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => onSelectDataset(d.id)}
                className={`px-2 py-1 rounded-[2px] text-micro font-mono flex items-center gap-1.5 transition-none ${
                  active
                    ? "bg-g-blue text-white font-semibold"
                    : "bg-g-bg border border-g-border text-g-text-2 hover:bg-g-hover hover:border-g-border-strong"
                }`}
              >
                <span>{d.label}</span>
                <span
                  className={`text-[9px] px-1 rounded-[2px] ${
                    active ? "bg-black/20 text-white" : "bg-white/5 text-g-muted"
                  }`}
                >
                  {d.tag}
                </span>
              </button>
            );
          })}
        </div>

        {/* Global AI & Thermal Toggles */}
        <div className="flex items-center gap-1.5 shrink-0">
          <div
            title="Clean Real Surveillance Stream (Bounding boxes removed per operator spec)"
            className="px-2 py-1 rounded-[2px] text-micro font-mono flex items-center gap-1.5 bg-emerald-950/60 border border-emerald-500/50 text-emerald-300 select-none"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span>CLEAN STREAM · NO BOXES</span>
          </div>

          <button
            type="button"
            onClick={onToggleGlobalThermal}
            className={`px-2 py-1 rounded-[2px] text-micro font-mono flex items-center gap-1 transition-none ${
              globalThermal
                ? "bg-amber-950 border border-amber-500/70 text-amber-300"
                : "bg-g-bg border border-g-border text-g-muted hover:text-g-text"
            }`}
          >
            <Icon name="thermostat" size={13} />
            <span>FLIR IR {globalThermal ? "ACTIVE" : "OFF"}</span>
          </button>
        </div>
      </div>

      {/* Bottom Row: View Matrix Density & Dynamic Tile Surfacing Mode */}
      <div className="flex items-center justify-between gap-2 text-micro font-mono pt-1 border-t border-g-border/60">
        <div className="flex items-center gap-2">
          <span className="text-g-muted uppercase tracking-wider">GRID DENSITY:</span>
          {([9, 16, 32] as GridDensity[]).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => onChangeDensity(d)}
              className={`px-2 py-0.5 rounded-[2px] border ${
                density === d
                  ? "border-g-blue bg-g-blue/20 text-g-blue font-bold"
                  : "border-g-border bg-g-bg text-g-text-2 hover:border-g-border-strong"
              }`}
            >
              {d === 9 ? "9 TILES" : d === 16 ? "16 TILES (BATTALION)" : "32 TILES (FULL AI ARRAY)"}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-g-muted uppercase tracking-wider">TILE SURFACING:</span>
          <button
            type="button"
            onClick={() => onChangeTileMode("all")}
            className={`px-2 py-0.5 rounded-[2px] border ${
              tileMode === "all"
                ? "border-g-blue bg-g-blue/20 text-g-blue font-semibold"
                : "border-g-border bg-g-bg text-g-text-2"
            }`}
          >
            ALL CHANNELS
          </button>
          <button
            type="button"
            onClick={() => onChangeTileMode("dynamic_alerts")}
            className={`px-2 py-0.5 rounded-[2px] border flex items-center gap-1 ${
              tileMode === "dynamic_alerts"
                ? "border-red-500 bg-red-950/40 text-red-300 font-semibold"
                : "border-g-border bg-g-bg text-g-text-2"
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-ping" />
            DYNAMIC ALERT EVICTION ({alertCount})
          </button>
          <button
            type="button"
            onClick={() => onChangeTileMode("fixed_only")}
            className={`px-2 py-0.5 rounded-[2px] border ${
              tileMode === "fixed_only"
                ? "border-blue-500 bg-blue-950/40 text-blue-300 font-semibold"
                : "border-g-border bg-g-bg text-g-text-2"
            }`}
          >
            FIXED PINS ONLY (CORE)
          </button>
        </div>
      </div>
    </div>
  );
}
