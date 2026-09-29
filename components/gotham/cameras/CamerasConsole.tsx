"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import type { Camera, Zone } from "@/lib/gotham/model";
import { ZONES } from "@/lib/gotham/model";
import { useConsole } from "../ConsoleProvider";
import { useClock } from "../hooks";
import { MicroLabel } from "../primitives";
import { Icon } from "@/components/ui/Icon";
import { ZoneCalibrator } from "../dashboard/ZoneCalibrator";
import { DecoupledStream } from "../dashboard/CameraWall";

/**
 * Lightweight CCTV channel thumbnail card for the directory grid.
 */
function CameraCardThumbnail({ cam }: { cam: Camera; isSelected?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !cam.online) return;
    const playVid = () => {
      if (video && video.paused) {
        video.play().catch(() => {});
      }
    };
    playVid();
  }, [cam.id, cam.online]);

  if (!cam.online) {
    return (
      <div className="absolute inset-0 bg-[#080d14] flex flex-col items-center justify-center select-none">
        <Icon name="videocam_off" size={24} className="text-g-red/60 mb-0.5" />
        <span className="text-[8.5px] font-mono uppercase text-g-red/80 tracking-wider font-bold">
          NO SIGNAL
        </span>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 bg-[#070b12] overflow-hidden select-none border border-outline-variant/30">
      <video
        ref={videoRef}
        src={`/api/videos/${cam.id}`}
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
        className="absolute inset-0 w-full h-full object-cover pointer-events-none"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/30 pointer-events-none" />
      <div className="absolute top-1.5 left-1.5 flex items-center gap-1 font-mono text-[8px] z-10 pointer-events-none">
        <span className="text-secondary font-bold flex items-center gap-1 bg-black/75 px-1.5 py-0.5 border border-secondary/30">
          <span className="w-1.5 h-1.5 rounded-full bg-secondary animate-pulse" />
          REC
        </span>
      </div>
    </div>
  );
}

/**
 * Dedicated Live Video Stream for the SELECTED camera in the inspector viewport.
 * Uses zero-lag hardware-accelerated DecoupledStream with precomputed AI detection overlays.
 */
function SelectedCameraStream({ cam }: { cam: Camera }) {
  if (!cam.online) {
    return (
      <div className="absolute inset-0 bg-[#080d14] flex flex-col items-center justify-center select-none">
        <Icon name="videocam_off" size={48} className="text-g-red mb-1.5" />
        <span className="text-[12px] font-mono uppercase text-g-red tracking-widest font-bold">
          NO SIGNAL
        </span>
        <span className="text-[9px] font-mono text-g-muted mt-1">
          CHANNEL STANDBY OR CARRIER LOST
        </span>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full bg-black overflow-hidden flex items-center justify-center">
      <DecoupledStream cam={cam} />

      {/* CCTV OSD Overlay */}
      <div className="absolute bottom-2 left-2 flex items-center gap-2 font-mono text-[9px] text-on-surface/90 pointer-events-none bg-surface-container-lowest/80 px-2 py-0.5 border border-outline-variant z-20">
        <span className="w-1.5 h-1.5 rounded-full bg-secondary" />
        <span className="font-semibold text-primary">{cam.id}</span>
        <span className="text-outline">|</span>
        <span>{cam.resolution}</span>
        <span className="text-outline">|</span>
        <span className="text-secondary font-semibold">{cam.fps} FPS</span>
      </div>

      <div className="absolute bottom-2 right-2 font-mono text-[9px] text-outline pointer-events-none bg-surface-container-lowest/80 px-2 py-0.5 border border-outline-variant z-20">
        <span>{cam.zone}</span>
      </div>
    </div>
  );
}

export function CamerasConsole() {
  const clock = useClock();
  const {
    cameras,
    disabledCameraIds,
    toggleCameraFeedStatus,
    toggleAi,
    updateZone,
    setCameraAnalyticsType,
  } = useConsole();

  const [selectedCamId, setSelectedCamId] = useState<string>("CAM-01");
  const [selectedZone, setSelectedZone] = useState<Zone | "ALL">("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [isCalibrating, setIsCalibrating] = useState<boolean>(false);
  const [changingMode, setChangingMode] = useState<boolean>(false);

  const selectedCam = useMemo(() => {
    return cameras.find((c) => c.id === selectedCamId) || cameras[0];
  }, [cameras, selectedCamId]);

  const filteredCameras = useMemo(() => {
    const matched = cameras.filter((c) => {
      const matchZone = selectedZone === "ALL" || c.zone === selectedZone;
      const q = searchQuery.toLowerCase().trim();
      const matchQuery =
        !q ||
        c.id.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q) ||
        c.zone.toLowerCase().includes(q) ||
        c.ip.toLowerCase().includes(q);
      return matchZone && matchQuery;
    });

    const isCamActive = (c: (typeof cameras)[0]) => c.online && !disabledCameraIds.includes(c.id);
    const active = matched.filter(isCamActive);
    const inactive = matched.filter((c) => !isCamActive(c));
    return [...active, ...inactive];
  }, [cameras, selectedZone, searchQuery, disabledCameraIds]);

  const stats = useMemo(() => {
    const total = cameras.length;
    const online = cameras.filter((c) => c.online && !disabledCameraIds.includes(c.id)).length;
    const aiActive = cameras.filter((c) => c.aiEnabled).length;
    return { total, online, aiActive };
  }, [cameras, disabledCameraIds]);

  const handleModeChange = async (type: "traffic_count" | "intrusion_zone" | "none") => {
    if (!selectedCam) return;
    setChangingMode(true);
    await setCameraAnalyticsType(selectedCam.id, type);
    setChangingMode(false);
  };

  const currentAnalyticsType = selectedCam?.analytics?.type || "none";
  const isFeedActive = selectedCam?.online && !disabledCameraIds.includes(selectedCam?.id || "");
  const isHardwareOffline = !selectedCam?.online && !disabledCameraIds.includes(selectedCam?.id || "");

  return (
    <div className="flex-1 min-h-0 flex flex-col p-2 gap-2 bg-g-bg overflow-hidden font-sans select-none">
      {/* Top Tactical Stat & Filter Bar */}
      <header className="h-10 px-3 bg-surface-container border border-outline-variant flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Icon name="videocam" size={16} className="text-primary align-middle" />
            <MicroLabel>CAMERA MANAGEMENT CONSOLE</MicroLabel>
          </div>

          <div className="h-3 w-[1px] bg-outline-variant" />

          {/* Quick Metrics */}
          <div className="flex items-center gap-3 font-mono text-[10px] text-outline">
            <span>
              TOTAL: <strong className="text-on-surface">{stats.total}</strong>
            </span>
            <span>
              FEEDS LIVE: <strong className="text-secondary">{stats.online}</strong>
            </span>
            <span>
              AI ARMED: <strong className="text-red-400 font-semibold">{stats.aiActive}</strong>
            </span>
            <span>
              SYSTEM STATUS: <strong className="text-secondary">NOMINAL</strong>
            </span>
          </div>
        </div>

        {/* Sector Tabs & Search */}
        <div className="flex items-center gap-2">
          <div className="relative">
            <input
              type="text"
              placeholder="SEARCH CAMS / IP..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-36 h-6 px-2 text-[10px] font-mono bg-surface-container-lowest border border-outline-variant text-on-surface focus:outline-none focus:border-primary"
            />
          </div>

          <div className="flex items-center border border-outline-variant overflow-hidden">
            <button
              type="button"
              onClick={() => setSelectedZone("ALL")}
              className={`h-6 px-2 text-[9.5px] font-mono tracking-wider transition-colors ${
                selectedZone === "ALL"
                  ? "bg-surface-container-high text-primary font-bold"
                  : "bg-surface-container text-outline hover:text-on-surface"
              }`}
            >
              ALL
            </button>
            {ZONES.map((z) => (
              <button
                key={z}
                type="button"
                onClick={() => setSelectedZone(z)}
                className={`h-6 px-2 text-[9.5px] font-mono tracking-wider border-l border-outline-variant transition-colors ${
                  selectedZone === z
                    ? "bg-surface-container-high text-primary font-bold"
                    : "bg-surface-container text-outline hover:text-on-surface"
                }`}
              >
                {z.replace("PERIMETER ", "PERIM. ")}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Main 2-Column Interface */}
      <div className="flex-1 min-h-0 grid grid-cols-12 gap-2 overflow-hidden">
        {/* Left Column: Camera Directory Grid (7 of 12 columns) */}
        <div className="col-span-7 flex flex-col bg-surface-container-low border border-outline-variant min-h-0 overflow-hidden">
          <div className="h-7 px-3 border-b border-outline-variant flex items-center justify-between shrink-0 bg-surface-container">
            <span className="text-[10px] font-mono uppercase text-outline tracking-wider">
              SURVEILLANCE DIRECTORY ({filteredCameras.length} CHANNELS)
            </span>
            <span className="text-[9px] font-mono text-outline">
              SELECT CHANNEL TO INSPECT & CONFIGURE
            </span>
          </div>

          <div className="flex-1 min-h-0 p-2 overflow-y-auto grid grid-cols-3 gap-2 content-start">
            {filteredCameras.map((cam) => {
              const isSelected = cam.id === selectedCamId;
              const isOnline = cam.online && !disabledCameraIds.includes(cam.id);

              return (
                <div
                  key={cam.id}
                  onClick={() => setSelectedCamId(cam.id)}
                  className={`relative flex flex-col p-1.5 border cursor-pointer transition-colors bg-surface-container-lowest overflow-hidden ${
                    isSelected
                      ? "border-primary bg-surface-container-high/40"
                      : "border-outline-variant/60 hover:border-outline hover:bg-surface-container"
                  } ${!isOnline ? "opacity-60 saturate-50" : ""}`}
                >
                  {/* Card Header */}
                  <div className="flex items-center justify-between gap-1 mb-1 z-10">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isOnline ? "bg-secondary" : "bg-error"}`} />
                      <span className="text-[10px] font-mono font-bold text-on-surface truncate">
                        {cam.id}
                      </span>
                      <span className="text-[9px] font-mono text-outline truncate">
                        {cam.name}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="text-[8px] font-mono text-outline/80 hidden sm:inline">{cam.ip}</span>
                      {cam.aiEnabled && (
                        <span className="text-[8.5px] font-mono font-bold px-1.5 py-0.5 bg-red-950/60 border border-red-900/40 text-red-400 tracking-wider">
                          AI
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Micro Thumbnail in true 16:9 */}
                  <div className="w-full aspect-video relative overflow-hidden bg-black/90">
                    <CameraCardThumbnail cam={cam} isSelected={isSelected} />
                    {isOnline && cam.analytics?.type && cam.analytics.type !== "none" && (
                      <div className="absolute bottom-1 left-1 pointer-events-none z-20">
                        <span className="text-[7.5px] font-mono px-1 py-0.2 bg-black/85 border border-sky-500/40 text-sky-300 uppercase font-semibold">
                          {cam.analytics.type === "traffic_count" ? "TRIPWIRE" : "CORDON"}
                        </span>
                      </div>
                    )}
                    {!isOnline && (
                      <div className="absolute inset-0 bg-black/75 flex items-center justify-center pointer-events-none z-20">
                        <span className="text-[8.5px] font-mono px-1.5 py-0.5 bg-error-container text-error border border-error uppercase font-bold tracking-wider">
                          STANDBY
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Card Footer */}
                  <div className="flex items-center justify-between text-[8px] font-mono text-outline mt-1 pt-0.5 border-t border-outline-variant/30 z-10">
                    <span className="text-primary truncate max-w-[120px] font-semibold">{cam.sector || cam.zone}</span>
                    <span className="text-secondary font-semibold">{isOnline ? `${cam.resolution} · ${cam.fps} FPS` : "STANDBY"}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column: Selected Camera Telemetry & Unified Tactical Controls (5 of 12 columns) */}
        <div className="col-span-5 flex flex-col bg-surface-container-low border border-outline-variant min-h-0 overflow-hidden">
          <div className="h-7 px-3 border-b border-outline-variant flex items-center justify-between shrink-0 bg-surface-container">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono font-bold text-primary">
                {selectedCam.id}
              </span>
              <span className="text-[10px] font-mono text-on-surface truncate">
                {selectedCam.name}
              </span>
            </div>
            <span className="text-[9px] font-mono text-outline">
              {clock} HRS
            </span>
          </div>

          <div className="flex-1 min-h-0 p-2.5 overflow-y-auto flex flex-col gap-2 font-mono">
            {/* Large Preview Viewport with Live Selected Stream */}
            <div className="relative aspect-video w-full bg-black border border-outline-variant overflow-hidden shrink-0">
              <SelectedCameraStream cam={selectedCam} />
            </div>

            {/* Unified Tactical Controls Panel: Feed, AI, Boundary, and Telemetry in website theme */}
            <div className="border border-outline-variant bg-surface-container flex flex-col divide-y divide-outline-variant/60">
              {/* Row 1: Parallel Feed Status & AI Detection */}
              <div className="grid grid-cols-2 divide-x divide-outline-variant/60 bg-surface-container-lowest/60">
                {/* Left: Feed Status & Mute Control */}
                <div className="p-2 flex items-center justify-between gap-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className={`w-1.5 h-1.5 shrink-0 ${isHardwareOffline ? "bg-outline" : isFeedActive ? "bg-secondary" : "bg-tertiary"}`} />
                    <span className="text-[9px] font-mono font-bold tracking-wider text-on-surface uppercase truncate">
                      FEED: {isHardwareOffline ? "OFF" : isFeedActive ? "LIVE" : "MUTED"}
                    </span>
                  </div>

                  <button
                    type="button"
                    disabled={isHardwareOffline}
                    onClick={() => toggleCameraFeedStatus(selectedCam.id, !isFeedActive)}
                    className={`h-6 px-2.5 text-[8.5px] font-mono font-semibold tracking-wider uppercase border transition-colors flex items-center justify-center shrink-0 ${
                      isHardwareOffline
                        ? "bg-surface-container-lowest border-outline-variant/40 text-outline/40 cursor-not-allowed"
                        : isFeedActive
                        ? "bg-surface-container-high hover:bg-surface-bright border-outline-variant text-outline hover:text-on-surface"
                        : "bg-secondary/15 hover:bg-secondary/25 border-secondary/50 text-secondary"
                    }`}
                  >
                    <span>{isHardwareOffline ? "OFF" : isFeedActive ? "MUTE" : "LIVE"}</span>
                  </button>
                </div>

                {/* Right: AI Detection */}
                <div className="p-2 flex items-center justify-between gap-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-[8.5px] font-mono font-bold px-1.5 py-0.5 bg-red-950/60 border border-red-900/40 text-red-400 tracking-wider">
                      AI
                    </span>
                    <span className="text-[9px] font-mono font-bold text-on-surface tracking-wider uppercase truncate">
                      DETECTION
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => toggleAi(selectedCam.id, !selectedCam.aiEnabled)}
                    className={`h-6 px-2.5 text-[8.5px] font-mono font-semibold tracking-wider uppercase border transition-colors flex items-center justify-center shrink-0 ${
                      selectedCam.aiEnabled
                        ? "bg-red-950/60 hover:bg-red-900/50 border-red-500/40 text-red-400"
                        : "bg-surface-container-high hover:bg-surface-bright border-outline-variant text-outline hover:text-on-surface"
                    }`}
                  >
                    <span>{selectedCam.aiEnabled ? "ACTIVE" : "INACTIVE"}</span>
                  </button>
                </div>
              </div>

              {/* Row 2: Spatial Boundary Selector */}
              <div className="p-2 flex flex-col gap-1.5 bg-surface-container-lowest/60">
                <div className="flex items-center justify-between">
                  <span className="text-[9.5px] font-mono font-bold tracking-wider text-on-surface uppercase">
                    SPATIAL BOUNDARY
                  </span>
                  <span className={`text-[8.5px] font-mono px-1.5 py-0.5 border font-semibold uppercase tracking-wider ${
                    currentAnalyticsType === "traffic_count"
                      ? "bg-sky-950/60 border-sky-400 text-sky-300"
                      : currentAnalyticsType === "intrusion_zone"
                      ? "bg-secondary-container/20 border-secondary text-secondary"
                      : "bg-surface-container-high border-outline-variant text-outline"
                  }`}>
                    {currentAnalyticsType === "traffic_count"
                      ? "TRIPWIRE"
                      : currentAnalyticsType === "intrusion_zone"
                      ? "PERIMETER"
                      : "FULL FRAME"}
                  </span>
                </div>

                {/* 3 Clean Selector Tiles */}
                <div className="grid grid-cols-3 gap-1.5">
                  <button
                    type="button"
                    disabled={changingMode}
                    onClick={() => handleModeChange("none")}
                    className={`h-7 px-2 border text-center flex items-center justify-center transition-colors text-[9px] font-mono font-semibold tracking-wider uppercase ${
                      currentAnalyticsType === "none"
                        ? "bg-surface-container-high border-primary text-primary"
                        : "bg-surface-container-lowest border-outline-variant text-outline hover:text-on-surface"
                    }`}
                  >
                    FULL FRAME
                  </button>

                  <button
                    type="button"
                    disabled={changingMode}
                    onClick={() => handleModeChange("traffic_count")}
                    className={`h-7 px-2 border text-center flex items-center justify-center transition-colors text-[9px] font-mono font-semibold tracking-wider uppercase ${
                      currentAnalyticsType === "traffic_count"
                        ? "bg-sky-950/60 border-sky-400 text-sky-200"
                        : "bg-surface-container-lowest border-outline-variant text-outline hover:text-sky-300"
                    }`}
                  >
                    TRIPWIRE
                  </button>

                  <button
                    type="button"
                    disabled={changingMode}
                    onClick={() => handleModeChange("intrusion_zone")}
                    className={`h-7 px-2 border text-center flex items-center justify-center transition-colors text-[9px] font-mono font-semibold tracking-wider uppercase ${
                      currentAnalyticsType === "intrusion_zone"
                        ? "bg-secondary-container/20 border-secondary text-secondary"
                        : "bg-surface-container-lowest border-outline-variant text-outline hover:text-secondary"
                    }`}
                  >
                    PERIMETER
                  </button>
                </div>

                {/* Calibration Action */}
                {currentAnalyticsType !== "none" && (
                  <div className="pt-1 flex items-center justify-between border-t border-outline-variant/40">
                    <span className="text-[8.5px] font-mono text-outline">
                      {currentAnalyticsType === "traffic_count"
                        ? `${selectedCam.analytics?.line?.length || 2} WAYPOINTS SET`
                        : `${selectedCam.analytics?.zone?.length || 4} VERTICES SET`}
                    </span>
                    <button
                      type="button"
                      onClick={() => setIsCalibrating(true)}
                      className="h-6 px-2.5 bg-surface-container-high hover:bg-surface-bright border border-outline-variant text-primary font-mono text-[9px] font-semibold tracking-wider flex items-center transition-colors uppercase"
                    >
                      CALIBRATE BOUNDARY
                    </button>
                  </div>
                )}
              </div>

              {/* Row 4: Sensor Telemetry & Link Metrics Grid */}
              <div className="p-2 flex flex-col gap-1.5 bg-surface-container-lowest/60">
                <div className="flex items-center justify-between">
                  <span className="text-[9px] font-bold uppercase text-outline tracking-wider font-mono">
                    SENSOR TELEMETRY & LINK METRICS
                  </span>
                  <span className="text-[8.5px] font-mono text-secondary flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-secondary animate-pulse" />
                    OPTICAL LINK SYNCHRONIZED
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1 text-[9px] font-mono pt-0.5">
                  <div className="p-1 bg-surface-container-lowest border border-outline-variant flex items-center justify-between">
                    <span className="text-outline">NETWORK IP:</span>
                    <span className="text-on-surface font-bold">{selectedCam.ip}</span>
                  </div>
                  <div className="p-1 bg-surface-container-lowest border border-outline-variant flex items-center justify-between">
                    <span className="text-outline">MODEL:</span>
                    <span className="text-on-surface font-semibold truncate ml-1">{selectedCam.model}</span>
                  </div>
                  <div className="p-1 bg-surface-container-lowest border border-outline-variant flex items-center justify-between">
                    <span className="text-outline">SECTOR:</span>
                    <span className="text-sky-300 font-semibold truncate ml-1">{selectedCam.sector || "SECTOR-1 HQ"}</span>
                  </div>
                  <div className="p-1 bg-surface-container-lowest border border-outline-variant flex items-center justify-between">
                    <span className="text-outline">ZONE:</span>
                    <span className="text-on-surface font-semibold">{selectedCam.zone}</span>
                  </div>
                  <div className="p-1 bg-surface-container-lowest border border-outline-variant flex items-center justify-between">
                    <span className="text-outline">RESOLUTION:</span>
                    <span className="text-on-surface font-semibold">{selectedCam.resolution}</span>
                  </div>
                  <div className="p-1 bg-surface-container-lowest border border-outline-variant flex items-center justify-between">
                    <span className="text-outline">FRAME RATE:</span>
                    <span className="text-secondary font-semibold">{selectedCam.fps} FPS</span>
                  </div>
                  <div className="p-1 bg-surface-container-lowest border border-outline-variant flex items-center justify-between">
                    <span className="text-outline">MGRS GRID:</span>
                    <span className="text-amber-300 font-semibold">{selectedCam.mgrs || "43R WQ 1820 8120"}</span>
                  </div>
                  <div className="p-1 bg-surface-container-lowest border border-outline-variant flex items-center justify-between">
                    <span className="text-outline">ELEVATION:</span>
                    <span className="text-on-surface font-semibold">{selectedCam.elevationM ? `${selectedCam.elevationM}m MSL` : "1680m MSL"}</span>
                  </div>
                  <div className="p-1 bg-surface-container-lowest border border-outline-variant flex items-center justify-between">
                    <span className="text-outline">UPTIME:</span>
                    <span className="text-secondary font-semibold">{selectedCam.uptime ? `${selectedCam.uptime}%` : "99.9%"}</span>
                  </div>
                  <div className="p-1 bg-surface-container-lowest border border-outline-variant flex items-center justify-between">
                    <span className="text-outline">AI PIPELINE:</span>
                    <span className="text-red-400 font-semibold truncate ml-1">{selectedCam.dataset || "VIRAT"} · {(selectedCam.aiWorkload || "TRACKING").toUpperCase()}</span>
                  </div>
                  <div className="p-1 bg-surface-container-lowest border border-outline-variant flex items-center justify-between">
                    <span className="text-outline">FIRMWARE:</span>
                    <span className="text-on-surface font-semibold">{selectedCam.firmware}</span>
                  </div>
                  <div className="p-1 bg-surface-container-lowest border border-outline-variant flex items-center justify-between">
                    <span className="text-outline">STREAM ENGINE:</span>
                    <span className="text-primary font-semibold truncate ml-1">{selectedCam.mjpegUrl ? "MJPEG LIVE" : "PRECOMPUTED 60FPS"}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Spacious Full Tactical Calibrator Modal */}
      {isCalibrating && (
        <div className="fixed inset-4 md:inset-8 z-50 flex flex-col bg-surface-container border border-outline-variant shadow-2xl overflow-hidden backdrop-blur-md">
          <ZoneCalibrator
            cam={selectedCam}
            onClose={() => setIsCalibrating(false)}
            onSave={async (newPoints) => {
              const isLine = selectedCam.analytics?.type === "traffic_count";
              const payload = isLine
                ? { line: newPoints, type: "traffic_count" as const }
                : { zone: newPoints, type: "intrusion_zone" as const };
              const ok = await updateZone(selectedCam.id, payload);
              if (ok) setIsCalibrating(false);
              return ok;
            }}
          />
        </div>
      )}
    </div>
  );
}
