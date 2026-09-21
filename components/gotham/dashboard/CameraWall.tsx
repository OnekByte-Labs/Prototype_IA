"use client";

import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import {
  DATASET_ANNOTATION_PRESETS,
  DATASET_CATALOG,
  TACTICAL_CAMERAS,
  type DatasetSource,
} from "@/lib/datasets/dataset-definitions";
import { useClock } from "../hooks";
import { Button, MicroLabel } from "../primitives";
import type { GridDensity, TileMode } from "./DatasetControlBar";
import { TacticalVideoFeed } from "./TacticalVideoFeed";

interface CameraWallProps {
  density?: GridDensity;
  activeDataset?: DatasetSource | "ALL";
  tileMode?: TileMode;
  showAiBoxes?: boolean;
  globalThermal?: boolean;
  alertingCameraIds?: string[];
  onAcknowledgeCamera?: (camId: string) => void;
  selectedCameraId?: string | null;
  onClearSelectedCamera?: () => void;
}

export function CameraWall({
  density = 16,
  activeDataset = "ALL",
  tileMode = "all",
  showAiBoxes = false,
  globalThermal = false,
  alertingCameraIds = [],
  onAcknowledgeCamera,
  selectedCameraId = null,
  onClearSelectedCamera,
}: CameraWallProps) {
  const [internalFocusId, setInternalFocusId] = useState<string | null>(null);
  const focusId = selectedCameraId ?? internalFocusId;
  const clock = useClock();

  const handleCloseFocus = () => {
    setInternalFocusId(null);
    onClearSelectedCamera?.();
  };

  // Handle ESC key to exit focus mode
  useEffect(() => {
    if (!focusId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setInternalFocusId(null);
        onClearSelectedCamera?.();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusId, onClearSelectedCamera]);

  // Compute displayed cameras based on filter, dynamic alert eviction, and density
  const displayedCameras = useMemo(() => {
    let pool = [...TACTICAL_CAMERAS];

    // Filter by dataset if not ALL
    if (activeDataset !== "ALL") {
      pool = pool.filter((c) => c.dataset === activeDataset);
    }

    // Filter by tile mode
    if (tileMode === "fixed_only") {
      return pool.filter((c) => c.isFixed);
    }

    if (tileMode === "dynamic_alerts") {
      const alertSet = new Set(alertingCameraIds);
      const alerting = pool.filter((c) => alertSet.has(c.id));
      const fixed = pool.filter((c) => c.isFixed && !alertSet.has(c.id));
      return [...alerting, ...fixed].slice(0, density);
    }

    // Standard mode: Fixed cameras always pinned first, alerting cameras next, then remaining up to density
    const alertSet = new Set(alertingCameraIds);
    const fixed = pool.filter((c) => c.isFixed);
    const alerting = pool.filter((c) => alertSet.has(c.id) && !c.isFixed);
    const regular = pool.filter((c) => !c.isFixed && !alertSet.has(c.id));

    const combined = [...fixed, ...alerting, ...regular];
    return combined.slice(0, density);
  }, [activeDataset, tileMode, alertingCameraIds, density]);

  const focusedCam = TACTICAL_CAMERAS.find((c) => c.id === focusId);
  const focusedDataset = focusedCam ? DATASET_CATALOG[focusedCam.dataset] : null;
  const focusedAnnotations = focusedCam ? DATASET_ANNOTATION_PRESETS[focusedCam.dataset] || [] : [];
  const offlineCount = displayedCameras.filter((c) => !c.online).length;

  // Grid CSS classes based on density
  const gridClass = useMemo(() => {
    switch (density) {
      case 9:
        return "grid-cols-1 sm:grid-cols-2 md:grid-cols-3 auto-rows-[160px]";
      case 16:
        return "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 auto-rows-[135px]";
      case 32:
        return "grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 auto-rows-[110px]";
      default:
        return "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 auto-rows-[135px]";
    }
  }, [density]);

  return (
    <section className="flex-1 bg-g-panel border border-g-border rounded-[4px] flex flex-col min-h-0 overflow-hidden">
      {/* Header */}
      <header className="h-8 px-3 flex items-center justify-between border-b border-g-border shrink-0 bg-[#090d10]">
        <div className="flex items-center gap-2">
          <MicroLabel>TACTICAL SURVEILLANCE WALL</MicroLabel>
          <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-g-blue/20 text-g-blue border border-g-blue/40">
            {density} MATRIX
          </span>
          {activeDataset !== "ALL" && (
            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-purple-950/60 text-purple-300 border border-purple-600/40">
              {activeDataset} FILTERED
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          <span className="text-micro font-mono text-g-muted">
            {displayedCameras.length - offlineCount}/{displayedCameras.length} ONLINE
          </span>
          <span className="text-g-border-strong">|</span>
          <span className="text-micro font-mono text-emerald-400">
            AI WORKLOADS: {displayedCameras.filter((c) => c.aiEnabled).length} CHANNELS
          </span>
          {focusedCam && (
            <button
              type="button"
              onClick={handleCloseFocus}
              className="text-micro font-mono uppercase text-g-blue hover:underline flex items-center gap-1 ml-2"
            >
              <Icon name="fullscreen_exit" size={13} />
              EXIT FOCUS (ESC)
            </button>
          )}
        </div>
      </header>

      {/* Main Wall Content */}
      <div className="flex-1 min-h-0 relative p-1.5 bg-[#06090b]">
        {focusedCam ? (
          /* Focused Full-Panel Inspection Workspace */
          <div className="w-full h-full flex flex-col lg:flex-row gap-2 overflow-y-auto">
            {/* Left/Main: Expanded Video Feed */}
            <div className="flex-1 min-h-[360px] bg-black rounded border border-g-border overflow-hidden relative">
              <TacticalVideoFeed
                camera={focusedCam}
                clock={clock}
                focused={true}
                showAiBoxes={showAiBoxes}
                thermalOverride={globalThermal}
                isBreached={alertingCameraIds.includes(focusedCam.id)}
              />
            </div>

            {/* Right: Telemetry & Model Diagnostic Panel */}
            <div className="w-full lg:w-80 bg-g-panel border border-g-border rounded p-3 flex flex-col gap-3 font-mono text-micro shrink-0">
              <div className="flex items-center justify-between border-b border-g-border pb-2">
                <div>
                  <h3 className="font-bold text-g-text text-ui">{focusedCam.name}</h3>
                  <span className="text-g-muted">{focusedCam.id} · {focusedCam.sector}</span>
                </div>
                <Button size="sm" onClick={handleCloseFocus}>
                  CLOSE
                </Button>
              </div>

              {/* Hardware & Stream Telemetry */}
              <div className="space-y-1.5 bg-g-bg p-2 rounded border border-g-border">
                <div className="flex justify-between">
                  <span className="text-g-muted">MODEL:</span>
                  <span className="text-g-text font-bold">{focusedCam.model}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-g-muted">IP / RTSP:</span>
                  <span className="text-cyan-400 select-all">{focusedCam.ip}:554</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-g-muted">STREAM:</span>
                  <span className="text-g-text">{focusedCam.resolution} @ {focusedCam.fps}fps</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-g-muted">PACKET LOSS:</span>
                  <span className={focusedCam.packetLossPct > 0.05 ? "text-red-400" : "text-emerald-400"}>
                    {(focusedCam.packetLossPct * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-g-muted">CORE TEMP:</span>
                  <span className={focusedCam.tempC > 45 ? "text-amber-400" : "text-g-text"}>
                    {focusedCam.tempC}°C
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-g-muted">MGRS GRID:</span>
                  <span className="text-g-text-2">{focusedCam.mgrs}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-g-muted">ELEVATION:</span>
                  <span className="text-g-text-2">{focusedCam.elevationM}m MSL</span>
                </div>
              </div>

              {/* AI Inference Diagnostics */}
              {focusedDataset && (
                <div className="space-y-1.5 bg-g-bg p-2 rounded border border-g-border">
                  <div className="text-g-blue font-bold uppercase text-[10px] tracking-wider border-b border-g-border/50 pb-1">
                    AI WORKLOAD: {focusedCam.aiWorkload.toUpperCase()}
                  </div>
                  <div className="flex justify-between">
                    <span className="text-g-muted">INFERENCE ENGINE:</span>
                    <span className="text-g-text">{focusedDataset.inferenceModel}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-g-muted">MODEL LATENCY:</span>
                    <span className="text-emerald-400">{focusedDataset.modelLatencyMs} ms</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-g-muted">DATASET PROXIED:</span>
                    <span className="text-purple-400">{focusedDataset.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-g-muted">PROVIDER:</span>
                    <span className="text-g-muted">{focusedDataset.provider}</span>
                  </div>
                </div>
              )}

              {/* Detected Bounding Box Entities */}
              <div className="flex-1 space-y-1 bg-g-bg p-2 rounded border border-g-border">
                <div className="text-g-muted font-bold uppercase text-[10px] tracking-wider border-b border-g-border/50 pb-1 mb-1">
                  CURRENT DETECTIONS ({focusedAnnotations.length})
                </div>
                {focusedAnnotations.map((ann) => (
                  <div
                    key={ann.id}
                    className="flex items-center justify-between py-0.5 border-b border-g-border/30 text-[10px]"
                  >
                    <span className="text-g-text truncate">{ann.label}</span>
                    <span className="text-emerald-400 font-bold">{ann.confidence}%</span>
                  </div>
                ))}
              </div>

              {/* Action Buttons */}
              <div className="flex gap-2">
                <Button
                  className="flex-1"
                  variant="primary"
                  onClick={() => {
                    if (onAcknowledgeCamera) onAcknowledgeCamera(focusedCam.id);
                  }}
                >
                  ACK CHANNEL
                </Button>
                <Button
                  onClick={() => {
                    navigator.clipboard.writeText(focusedCam.rtspUri);
                  }}
                  title="Copy RTSP Stream URL"
                >
                  <Icon name="content_copy" size={13} />
                </Button>
              </div>
            </div>
          </div>
        ) : (
          /* Multi-Tile Video Matrix */
          <div className={`grid gap-1.5 h-full overflow-y-auto ${gridClass}`}>
            {displayedCameras.map((cam) => {
              const isAlerting = alertingCameraIds.includes(cam.id);
              return (
                <div
                  key={cam.id}
                  className={`rounded-[3px] overflow-hidden border transition-all ${
                    isAlerting
                      ? "border-red-500 shadow-[0_0_12px_rgba(239,68,68,0.5)]"
                      : "border-g-border hover:border-g-border-strong"
                  }`}
                >
                  <TacticalVideoFeed
                    camera={cam}
                    clock={clock}
                    focused={false}
                    showAiBoxes={showAiBoxes}
                    thermalOverride={globalThermal}
                    isBreached={isAlerting}
                    onClick={() => setInternalFocusId(cam.id)}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
