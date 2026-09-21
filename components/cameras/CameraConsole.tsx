"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import {
  DATASET_CATALOG,
  TACTICAL_CAMERAS,
  type DatasetSource,
  type TacticalCamera,
} from "@/lib/datasets/dataset-definitions";
import { useConsole } from "@/components/gotham/ConsoleProvider";
import { useClock } from "@/components/gotham/hooks";
import { TacticalVideoFeed } from "@/components/gotham/dashboard/TacticalVideoFeed";
import { Button, MicroLabel, StatusDot } from "@/components/gotham/primitives";
import { useToast } from "@/components/gotham/Toast";

type GridDensity = "2x2" | "3x3" | "4x4" | "all" | "table";
type ZoneFilter = "ALL" | "HQ COMPLEX" | "PERIMETER EAST" | "PERIMETER WEST" | "DEPOT" | "MOTOR POOL";

export function CameraConsole() {
  const { alerts, triggerAlert } = useConsole();
  const clock = useClock();
  const toast = useToast();

  const [search, setSearch] = useState("");
  const [selectedZone, setSelectedZone] = useState<ZoneFilter>("ALL");
  const [selectedDataset, setSelectedDataset] = useState<DatasetSource | "ALL">("ALL");
  const [density, setDensity] = useState<GridDensity>("4x4");
  const [inspectedCamId, setInspectedCamId] = useState<string | null>(null);
  const [showAiBoxes, setShowAiBoxes] = useState(true);

  // Set of alerting camera IDs
  const alertingCameraIds = useMemo(() => {
    return new Set(alerts.filter((a) => a.status === "new").map((a) => a.cameraId));
  }, [alerts]);

  // Filtered cameras based on search, zone, dataset
  const filteredCameras = useMemo(() => {
    return TACTICAL_CAMERAS.filter((cam) => {
      if (selectedZone !== "ALL" && cam.zone !== selectedZone) return false;
      if (selectedDataset !== "ALL" && cam.dataset !== selectedDataset) return false;
      if (search.trim()) {
        const query = search.toLowerCase();
        const match =
          cam.id.toLowerCase().includes(query) ||
          cam.name.toLowerCase().includes(query) ||
          cam.ip.toLowerCase().includes(query) ||
          cam.model.toLowerCase().includes(query) ||
          cam.sector.toLowerCase().includes(query) ||
          cam.mgrs.toLowerCase().includes(query);
        if (!match) return false;
      }
      return true;
    });
  }, [search, selectedZone, selectedDataset]);

  const inspectedCamera = useMemo(() => {
    return TACTICAL_CAMERAS.find((c) => c.id === inspectedCamId) || null;
  }, [inspectedCamId]);

  // Handle manual diagnostic ping
  const handlePingAll = () => {
    toast(`Diagnostics ping sent to 32 tactical cameras · All 32 responded (avg 8.4ms)`, "ok");
  };

  // Copy RTSP URL
  const handleCopyRtsp = (cam: TacticalCamera) => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(cam.rtspUri);
      toast(`Copied ${cam.id} RTSP stream URI to clipboard`, "ok");
    }
  };

  // Trigger manual simulated alert on selected camera for testing
  const handleSimulateAlert = (cam: TacticalCamera) => {
    triggerAlert(cam.id, "intrusion", "high");
    toast(`Simulated intrusion breach triggered on ${cam.id}`, "warn");
  };

  const zones: ZoneFilter[] = [
    "ALL",
    "HQ COMPLEX",
    "PERIMETER EAST",
    "PERIMETER WEST",
    "DEPOT",
    "MOTOR POOL",
  ];

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-[#06080a] text-g-text overflow-hidden">
      {/* Top Telemetry & Health Banner */}
      <div className="h-11 shrink-0 px-3 bg-g-panel border-b border-g-border flex items-center justify-between gap-4">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <Icon name="videocam" size={16} className="text-cyan-400" />
            <span className="text-ui font-semibold uppercase tracking-wider text-white">
              Tactical Surveillance Wall
            </span>
          </div>

          <span className="w-px h-4 bg-g-border hidden sm:block" />

          <div className="hidden md:flex items-center gap-5 text-micro font-mono">
            <div className="flex items-center gap-1.5">
              <span className="text-g-muted">DEPLOYED:</span>
              <span className="text-cyan-300 font-bold">{TACTICAL_CAMERAS.length} CAMS</span>
            </div>
            <div className="flex items-center gap-1.5">
              <StatusDot tone="ok" />
              <span className="text-g-muted">ONLINE:</span>
              <span className="text-emerald-400 font-bold">
                {TACTICAL_CAMERAS.filter((c) => c.online).length} / 32
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-g-muted">OPTICAL FEEDS:</span>
              <span className="text-white font-bold">100% UNFILTERED</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-g-muted">UNACK ALERTS:</span>
              <span className={alertingCameraIds.size > 0 ? "text-rose-400 font-bold" : "text-emerald-400"}>
                {alertingCameraIds.size}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button size="sm" onClick={handlePingAll} title="Broadcast ICMP echo to all camera subnets">
            <Icon name="refresh" size={13} />
            <span className="hidden sm:inline">Echo Ping</span>
          </Button>

          <Button
            size="sm"
            onClick={() => setShowAiBoxes(!showAiBoxes)}
            title="Toggle real-time AI bounding box overlays"
            className={showAiBoxes ? "border-cyan-500/50 text-cyan-300 bg-cyan-950/30" : ""}
          >
            <Icon name="grid_on" size={13} />
            <span className="hidden sm:inline">AI HUD: {showAiBoxes ? "ON" : "OFF"}</span>
          </Button>
        </div>
      </div>

      {/* Filter and Density Control Toolbar */}
      <div className="px-3 py-2 bg-[#090d13] border-b border-g-border flex flex-wrap items-center justify-between gap-2.5">
        {/* Search Input */}
        <div className="relative min-w-[200px] max-w-xs flex-1">
          <Icon
            name="search"
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-g-muted pointer-events-none"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search ID, name, sector, IP, MGRS…"
            className="h-7 w-full pl-8 pr-2 bg-[#0d121b] border border-g-border-strong rounded-[2px] text-ui text-g-text placeholder:text-g-muted focus:border-cyan-400 focus:outline-none font-mono"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-g-muted hover:text-white"
            >
              ×
            </button>
          )}
        </div>

        {/* Zone Filter Pills */}
        <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0 custom-scroll">
          {zones.map((zone) => {
            const active = selectedZone === zone;
            const count =
              zone === "ALL"
                ? TACTICAL_CAMERAS.length
                : TACTICAL_CAMERAS.filter((c) => c.zone === zone).length;
            return (
              <button
                key={zone}
                type="button"
                onClick={() => setSelectedZone(zone)}
                className={`h-7 px-2 border rounded-[2px] text-[11px] font-mono whitespace-nowrap transition-colors ${
                  active
                    ? "border-cyan-500 bg-cyan-950/40 text-cyan-300 font-semibold"
                    : "border-g-border text-g-text-2 hover:text-white hover:bg-g-hover"
                }`}
              >
                {zone} ({count})
              </button>
            );
          })}
        </div>

        {/* Density Selector */}
        <div className="flex items-center gap-1 bg-[#0d121b] p-0.5 border border-g-border rounded-[2px]">
          {(
            [
              { id: "2x2", label: "2×2 Quad" },
              { id: "3x3", label: "3×3" },
              { id: "4x4", label: "4×4 Wall" },
              { id: "all", label: "All 32" },
              { id: "table", label: "Table" },
            ] as const
          ).map((mode) => (
            <button
              key={mode.id}
              type="button"
              onClick={() => setDensity(mode.id)}
              className={`h-6 px-2 text-[10px] font-mono rounded-[2px] transition-colors ${
                density === mode.id
                  ? "bg-cyan-600 text-black font-bold"
                  : "text-g-text-2 hover:text-white hover:bg-white/5"
              }`}
            >
              {mode.label}
            </button>
          ))}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Left/Center: Camera Wall Grid or Table View */}
        <div className="flex-1 min-h-0 p-2 overflow-y-auto custom-scroll">
          {density === "table" ? (
            /* Table View */
            <div className="border border-g-border rounded-[2px] overflow-hidden bg-g-panel">
              <table className="w-full text-left border-collapse text-ui">
                <thead>
                  <tr className="h-8 border-b border-g-border bg-[#0b0f17] text-micro uppercase text-g-muted font-mono">
                    <th className="px-3 py-1">Camera</th>
                    <th className="px-3 py-1">Sector / Zone</th>
                    <th className="px-3 py-1">Model</th>
                    <th className="px-3 py-1">Resolution & FPS</th>
                    <th className="px-3 py-1">IP & RTSP</th>
                    <th className="px-3 py-1">Dataset / AI</th>
                    <th className="px-3 py-1">Status</th>
                    <th className="px-3 py-1 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-g-border">
                  {filteredCameras.map((cam) => {
                    const isBreached = alertingCameraIds.has(cam.id);
                    return (
                      <tr
                        key={cam.id}
                        onClick={() => setInspectedCamId(cam.id)}
                        className={`h-11 hover:bg-g-hover cursor-pointer transition-colors ${
                          isBreached ? "bg-red-950/20 border-l-2 border-l-rose-500" : ""
                        } ${inspectedCamId === cam.id ? "bg-cyan-950/30" : ""}`}
                      >
                        <td className="px-3 font-mono font-bold text-cyan-300">
                          <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-emerald-400" />
                            {cam.id} · {cam.name}
                          </div>
                        </td>
                        <td className="px-3 text-g-text-2 text-micro font-mono">
                          {cam.sector} ({cam.zone})
                        </td>
                        <td className="px-3 text-micro text-g-text font-mono truncate max-w-[160px]">
                          {cam.model}
                        </td>
                        <td className="px-3 text-micro font-mono text-emerald-400">
                          {cam.resolution} @ {cam.fps}fps
                        </td>
                        <td className="px-3 text-micro font-mono text-g-muted truncate max-w-[180px]">
                          {cam.ip}
                        </td>
                        <td className="px-3">
                          <span className="px-1.5 py-0.5 rounded-[2px] bg-[#131b26] border border-cyan-800/60 text-cyan-300 text-[10px] font-mono">
                            {cam.dataset} · {cam.aiWorkload.toUpperCase()}
                          </span>
                        </td>
                        <td className="px-3">
                          <span
                            className={`text-[10px] font-mono uppercase px-1.5 py-0.5 rounded-[2px] ${
                              isBreached
                                ? "bg-rose-950 text-rose-300 border border-rose-600"
                                : "bg-emerald-950/60 text-emerald-300 border border-emerald-700/60"
                            }`}
                          >
                            {isBreached ? "BREACH ALERT" : "NOMINAL"}
                          </span>
                        </td>
                        <td className="px-3 text-right">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setInspectedCamId(cam.id);
                            }}
                            className="h-6 px-2 text-[11px] font-mono bg-g-bg border border-g-border hover:border-cyan-400 text-white rounded-[2px]"
                          >
                            Inspect
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            /* Video Grid View */
            <div
              className={`grid gap-2 ${
                density === "2x2"
                  ? "grid-cols-1 md:grid-cols-2"
                  : density === "3x3"
                    ? "grid-cols-1 md:grid-cols-2 lg:grid-cols-3"
                    : density === "4x4"
                      ? "grid-cols-2 md:grid-cols-3 lg:grid-cols-4"
                      : "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6"
              }`}
            >
              {filteredCameras.map((cam) => {
                const isBreached = alertingCameraIds.has(cam.id);
                const isInspected = inspectedCamId === cam.id;
                return (
                  <div
                    key={cam.id}
                    onClick={() => setInspectedCamId(cam.id)}
                    className={`relative rounded-[2px] overflow-hidden border transition-all cursor-pointer aspect-video bg-[#040608] ${
                      isInspected
                        ? "border-cyan-400 shadow-[0_0_12px_rgba(56,189,248,0.3)] ring-1 ring-cyan-400"
                        : isBreached
                          ? "border-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.4)]"
                          : "border-g-border hover:border-g-border-strong"
                    }`}
                  >
                    <TacticalVideoFeed
                      camera={cam}
                      clock={clock}
                      focused={isInspected}
                      showAiBoxes={showAiBoxes}
                      isBreached={isBreached}
                      onClick={() => setInspectedCamId(cam.id)}
                    />
                  </div>
                );
              })}
            </div>
          )}

          {filteredCameras.length === 0 && (
            <div className="h-64 flex flex-col items-center justify-center text-g-muted gap-2">
              <Icon name="search" size={24} />
              <div className="text-ui">No tactical cameras match current query & filters</div>
              <Button size="sm" onClick={() => { setSearch(""); setSelectedZone("ALL"); setSelectedDataset("ALL"); }}>
                Clear Filters
              </Button>
            </div>
          )}
        </div>

        {/* Right: Camera Inspector Drawer */}
        {inspectedCamera && (
          <aside className="w-80 lg:w-96 shrink-0 bg-g-panel border-l border-g-border flex flex-col overflow-y-auto custom-scroll">
            {/* Drawer Header */}
            <div className="h-11 shrink-0 px-3 bg-[#0d121a] border-b border-g-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <StatusDot tone="ok" />
                <span className="text-ui font-mono font-bold text-cyan-300">
                  {inspectedCamera.id} · TELEMETRY
                </span>
              </div>
              <button
                type="button"
                onClick={() => setInspectedCamId(null)}
                title="Close inspector"
                className="w-7 h-7 flex items-center justify-center text-g-muted hover:text-white rounded-[2px]"
              >
                ×
              </button>
            </div>

            {/* Active Stream Preview in Drawer */}
            <div className="p-3 border-b border-g-border bg-black/40">
              <div className="aspect-video w-full rounded-[2px] overflow-hidden border border-g-border relative bg-black">
                <TacticalVideoFeed
                  camera={inspectedCamera}
                  clock={clock}
                  focused={true}
                  showAiBoxes={showAiBoxes}
                  isBreached={alertingCameraIds.has(inspectedCamera.id)}
                />
              </div>

              <div className="mt-2 flex items-center justify-between text-micro font-mono">
                <span className="text-emerald-400 font-bold">LIVE OPTICAL SURVEILLANCE</span>
                <span className="text-g-muted">{inspectedCamera.resolution}</span>
              </div>
            </div>

            {/* Specs & Intelligence Details */}
            <div className="p-3 flex flex-col gap-4 text-ui">
              {/* Identity & Location */}
              <div>
                <MicroLabel>LOCATION & SENSOR</MicroLabel>
                <div className="mt-1 space-y-1 font-mono text-[11px] bg-[#070a0e] p-2 rounded border border-g-border">
                  <div className="flex justify-between">
                    <span className="text-g-muted">Name:</span>
                    <span className="text-white font-semibold">{inspectedCamera.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-g-muted">Sector:</span>
                    <span className="text-cyan-300">{inspectedCamera.sector}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-g-muted">Zone:</span>
                    <span className="text-white">{inspectedCamera.zone}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-g-muted">MGRS Grid:</span>
                    <span className="text-amber-300">{inspectedCamera.mgrs}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-g-muted">Elevation:</span>
                    <span className="text-white">{inspectedCamera.elevationM}m MSL</span>
                  </div>
                </div>
              </div>

              {/* Hardware & Video Ingest */}
              <div>
                <MicroLabel>HARDWARE & CARRIER</MicroLabel>
                <div className="mt-1 space-y-1 font-mono text-[11px] bg-[#070a0e] p-2 rounded border border-g-border">
                  <div className="flex justify-between">
                    <span className="text-g-muted">Hardware:</span>
                    <span className="text-white truncate max-w-[180px]">{inspectedCamera.model}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-g-muted">IP Address:</span>
                    <span className="text-cyan-300">{inspectedCamera.ip}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-g-muted">Sensor Uptime:</span>
                    <span className="text-emerald-400">{inspectedCamera.uptimePct}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-g-muted">Core Temp:</span>
                    <span className="text-white">{inspectedCamera.tempC}°C</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-g-muted">Packet Loss:</span>
                    <span className="text-emerald-400">{inspectedCamera.packetLossPct}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-g-muted">Carrier Status:</span>
                    <span className="text-emerald-400 font-bold">1000BASE-T LOCKED</span>
                  </div>
                </div>
              </div>

              {/* AI Detection Pipeline */}
              <div>
                <MicroLabel>AI DETECTION MODEL</MicroLabel>
                <div className="mt-1 space-y-1 font-mono text-[11px] bg-[#070a0e] p-2 rounded border border-g-border">
                  <div className="flex justify-between">
                    <span className="text-g-muted">Dataset:</span>
                    <span className="text-cyan-300 font-semibold">{inspectedCamera.dataset}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-g-muted">Inference Model:</span>
                    <span className="text-white">
                      {DATASET_CATALOG[inspectedCamera.dataset]?.inferenceModel || "YOLOv11-OpticalEdge"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-g-muted">Workload:</span>
                    <span className="text-emerald-400 uppercase font-semibold">
                      {inspectedCamera.aiWorkload}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-g-muted">Latency:</span>
                    <span className="text-white">
                      {DATASET_CATALOG[inspectedCamera.dataset]?.modelLatencyMs || 12.4} ms
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-g-muted">Palette:</span>
                    <span className="text-emerald-300">Natural RGB Optical</span>
                  </div>
                </div>
              </div>

              {/* Quick Actions */}
              <div className="pt-2 flex flex-col gap-2">
                <Button
                  size="sm"
                  onClick={() => handleCopyRtsp(inspectedCamera)}
                  className="w-full justify-center"
                >
                  <Icon name="link" size={13} />
                  <span>Copy RTSP URL</span>
                </Button>

                <Button
                  size="sm"
                  onClick={() => handleSimulateAlert(inspectedCamera)}
                  className="w-full justify-center border-rose-600/60 text-rose-300 hover:bg-rose-950/40"
                >
                  <Icon name="warning" size={13} />
                  <span>Test Trigger Incident Alert</span>
                </Button>
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
