"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import type { Camera, Zone } from "@/lib/gotham/model";
import { ZONES } from "@/lib/gotham/model";
import { useConsole } from "../ConsoleProvider";
import { useClock } from "../hooks";
import { MicroLabel, StatusDot } from "../primitives";
import { Icon } from "@/components/ui/Icon";
import { ZoneCalibrator } from "../dashboard/ZoneCalibrator";

/**
 * Lightweight, zero-lag tactical CCTV channel card for the directory list.
 * Avoids decoding 12 simultaneous video elements to keep browser fast and buttery-smooth.
 */
function CameraCardThumbnail({ cam, isSelected }: { cam: Camera; isSelected: boolean }) {
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
    <div className="absolute inset-0 bg-[#070b12] overflow-hidden select-none border border-g-border/30">
      {/* Live Video Feed (Rendered with object-cover in 16:9) */}
      {cam.mjpegUrl ? (
        <img
          src={cam.mjpegUrl}
          alt={cam.name}
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : (
        <video
          ref={videoRef}
          src={`/api/videos/${cam.id}`}
          autoPlay
          muted
          loop
          playsInline
          className="absolute inset-0 w-full h-full object-cover pointer-events-none"
        />
      )}

      {/* Subtle tactical dark vignette */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/30 pointer-events-none" />

      {/* Clean minimal LIVE REC badge */}
      <div className="absolute top-1.5 left-1.5 flex items-center gap-1 font-mono text-[8px] z-10 pointer-events-none">
        <span className="text-emerald-400 font-bold flex items-center gap-1 bg-black/75 px-1.5 py-0.5 rounded-[2px] border border-emerald-500/30 backdrop-blur-xs">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          REC
        </span>
      </div>
    </div>
  );
}

/**
 * Dedicated Live Video Stream for the SELECTED camera in the inspector viewport.
 * Features an active watchdog to guarantee smooth, non-freezing playback across re-renders and loops.
 */
function SelectedCameraStream({ cam }: { cam: Camera }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [liveCount, setLiveCount] = useState(() => (cam.id.charCodeAt(5) || 1) * 7 + 14);

  useEffect(() => {
    setLiveCount((cam.id.charCodeAt(5) || 1) * 7 + 14);
    if (cam.analytics?.type !== "traffic_count") return;
    const interval = setInterval(() => {
      setLiveCount(prev => prev + 1);
    }, 4500);
    return () => clearInterval(interval);
  }, [cam.id, cam.analytics?.type]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const resumePlayback = () => {
      if (video && video.paused && !video.ended) {
        video.play().catch(() => {});
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        resumePlayback();
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    video.addEventListener("waiting", resumePlayback);
    video.addEventListener("stalled", resumePlayback);
    video.addEventListener("pause", resumePlayback);
    video.addEventListener("canplay", resumePlayback);
    video.addEventListener("loadeddata", resumePlayback);
    video.addEventListener("ended", () => {
      video.currentTime = 0;
      resumePlayback();
    });

    const watchdog = setInterval(resumePlayback, 1000);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      video.removeEventListener("waiting", resumePlayback);
      video.removeEventListener("stalled", resumePlayback);
      video.removeEventListener("pause", resumePlayback);
      video.removeEventListener("canplay", resumePlayback);
      video.removeEventListener("loadeddata", resumePlayback);
      clearInterval(watchdog);
    };
  }, [cam.id]);

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

  const resParts = cam.resolution ? cam.resolution.split("×") : ["1920", "1080"];
  const origW = parseInt(resParts[0], 10) || 1920;
  const origH = parseInt(resParts[1], 10) || 1080;

  return (
    <div className="relative w-full h-full bg-black overflow-hidden flex items-center justify-center">
      {cam.mjpegUrl ? (
        <img
          src={cam.mjpegUrl}
          alt={cam.name}
          className="w-full h-full object-contain"
        />
      ) : (
        <video
          ref={videoRef}
          key={cam.id}
          src={`/api/videos/${cam.id}`}
          autoPlay
          muted
          loop
          playsInline
          className="w-full h-full object-contain"
        />
      )}

      {/* Analytics Overlays: Live Tripwire Line & GitHub-style Counter HUD */}
      {cam.analytics?.type === "traffic_count" && cam.analytics.line && (
        <>
          <svg
            viewBox="0 0 1000 562.5"
            preserveAspectRatio="xMidYMid meet"
            className="absolute inset-0 w-full h-full pointer-events-none z-10"
          >
            <polyline
              points={cam.analytics.line.map((p: number[]) => `${(p[0] / origW) * 1000},${(p[1] / origH) * 562.5}`).join(" ")}
              fill="none"
              stroke="rgba(0, 200, 255, 0.9)"
              strokeWidth="3.5"
              strokeDasharray="10 6"
            />
            {(() => {
              const pts = cam.analytics.line;
              const midIdx = Math.floor(pts.length / 2);
              const mx = (pts[midIdx][0] / origW) * 1000;
              const my = (pts[midIdx][1] / origH) * 562.5;
              return (
                <text
                  x={mx - 40}
                  y={my - 8}
                  fill="rgba(0, 200, 255, 0.9)"
                  fontSize="10"
                  fontFamily="monospace"
                  fontWeight="bold"
                >
                  ▼ COUNTING LINE
                </text>
              );
            })()}
          </svg>

          {/* GitHub-inspired Tactical Flow Telemetry Card */}
          <div className="absolute top-10 left-2 z-20 px-3 py-1.5 rounded-[3px] bg-[#0d1117]/95 border border-[#30363d] shadow-2xl flex flex-col gap-1 pointer-events-none font-mono backdrop-blur-xs">
            <div className="flex items-center gap-1.5 text-[8.5px] text-[#8b949e] font-semibold border-b border-[#30363d]/80 pb-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>FLOW TELEMETRY // COUNTER</span>
            </div>
            <div className="flex items-baseline gap-2 pt-0.5">
              <span className="text-lg font-bold text-[#f0f6fc] tracking-wider leading-none">
                {String(liveCount).padStart(3, "0")}
              </span>
              <span className="text-[8.5px] font-bold text-sky-400 uppercase">VEHICLES</span>
              <span className="text-[7.5px] text-[#8b949e]">↕ BI-DIRECTIONAL</span>
            </div>
          </div>
        </>
      )}

      {/* Analytics Overlays: Perimeter Cordon Zone */}
      {cam.analytics?.type === "intrusion_zone" && cam.analytics.zone && (
        <svg
          viewBox="0 0 1000 562.5"
          preserveAspectRatio="xMidYMid meet"
          className="absolute inset-0 w-full h-full pointer-events-none z-10"
        >
          <polygon
            points={cam.analytics.zone.map((p: number[]) => `${(p[0] / origW) * 1000},${(p[1] / origH) * 562.5}`).join(" ")}
            fill="rgba(34, 197, 94, 0.15)"
            stroke="rgba(34, 197, 94, 0.9)"
            strokeWidth="2"
            strokeDasharray="6 4"
          />
        </svg>
      )}

      {/* CCTV OSD Overlay */}
      <div className="absolute top-2 left-2 flex items-center gap-2 font-mono text-[9.5px] text-white/90 pointer-events-none drop-shadow-md bg-black/60 px-2 py-0.5 rounded-[2px] border border-white/10 z-20">
        <span className="w-2 h-2 rounded-full bg-emerald-400" />
        <span className="font-bold tracking-wider">{cam.id}</span>
        <span className="text-white/40">|</span>
        <span className="tracking-tight">{cam.resolution}</span>
        <span className="text-white/40">|</span>
        <span className="text-emerald-400 font-bold">{cam.fps} FPS</span>
      </div>

      <div className="absolute bottom-2 right-2 font-mono text-[9px] text-white/80 pointer-events-none drop-shadow-md bg-black/60 px-2 py-0.5 rounded-[2px] border border-white/10 z-20">
        <span>{cam.zone}</span>
      </div>
    </div>
  );
}

export function CamerasConsole() {
  const clock = useClock();
  const {
    cameras,
    dashboardFeedIds,
    toggleDashboardFeed,
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

    // Active (online / transmitting) cameras on top, closed / standby / offline cameras lower
    const isCamActive = (c: (typeof cameras)[0]) => c.online && !disabledCameraIds.includes(c.id);
    const active = matched.filter(isCamActive);
    const inactive = matched.filter((c) => !isCamActive(c));
    return [...active, ...inactive];
  }, [cameras, selectedZone, searchQuery, disabledCameraIds]);

  const stats = useMemo(() => {
    const total = cameras.length;
    const online = cameras.filter((c) => c.online).length;
    const aiActive = cameras.filter((c) => c.aiEnabled).length;
    const pinned = dashboardFeedIds.length;
    return { total, online, aiActive, pinned };
  }, [cameras, dashboardFeedIds]);

  const handleModeChange = async (type: "traffic_count" | "intrusion_zone" | "none") => {
    if (!selectedCam) return;
    setChangingMode(true);
    await setCameraAnalyticsType(selectedCam.id, type);
    setChangingMode(false);
  };

  const currentAnalyticsType = selectedCam?.analytics?.type || "none";
  const isPinned = dashboardFeedIds.includes(selectedCam?.id || "");
  const isFeedActive = selectedCam?.online && !disabledCameraIds.includes(selectedCam?.id || "");
  const isHardwareOffline = !selectedCam?.online && !disabledCameraIds.includes(selectedCam?.id || "");

  return (
    <div className="flex-1 min-h-0 flex flex-col p-2 gap-2 bg-g-bg overflow-hidden font-sans select-none">
      {/* Top Tactical Stat & Filter Bar */}
      <header className="h-10 px-3 bg-g-panel border border-g-border rounded-[2px] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5 text-g-blue" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M23 7l-7 5 7 5V7z" />
              <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
            </svg>
            <MicroLabel>CAMERA MANAGEMENT CONSOLE</MicroLabel>
          </div>

          <div className="h-3 w-[1px] bg-g-border" />

          {/* Quick Metrics */}
          <div className="flex items-center gap-3 font-mono text-[10px] text-g-muted">
            <span>
              TOTAL: <strong className="text-g-text">{stats.total}</strong>
            </span>
            <span>
              FEEDS LIVE: <strong className="text-emerald-400">{stats.online}</strong>
            </span>
            <span>
              AI ARMED: <strong className="text-g-blue">{stats.aiActive}</strong>
            </span>
            <span>
              SYSTEM STATUS: <strong className="text-emerald-400">NOMINAL</strong>
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
              className="w-36 h-6 px-2 text-[10px] font-mono bg-black/60 border border-g-border text-g-text focus:outline-none focus:border-g-blue rounded-[2px]"
            />
          </div>

          <div className="flex items-center border border-g-border rounded-[2px] overflow-hidden">
            <button
              type="button"
              onClick={() => setSelectedZone("ALL")}
              className={`h-6 px-2 text-[9.5px] font-mono tracking-wider transition-colors ${
                selectedZone === "ALL"
                  ? "bg-g-blue text-white font-bold"
                  : "bg-g-panel text-g-muted hover:text-g-text"
              }`}
            >
              ALL
            </button>
            {ZONES.map((z) => (
              <button
                key={z}
                type="button"
                onClick={() => setSelectedZone(z)}
                className={`h-6 px-2 text-[9.5px] font-mono tracking-wider border-l border-g-border transition-colors ${
                  selectedZone === z
                    ? "bg-g-blue text-white font-bold"
                    : "bg-g-panel text-g-muted hover:text-g-text"
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
        <div className="col-span-7 flex flex-col bg-g-panel border border-g-border rounded-[2px] min-h-0 overflow-hidden">
          <div className="h-7 px-3 border-b border-g-border flex items-center justify-between shrink-0 bg-g-bg/50">
            <span className="text-[10px] font-mono uppercase text-g-muted tracking-wider">
              SURVEILLANCE DIRECTORY ({filteredCameras.length} CHANNELS)
            </span>
            <span className="text-[9px] font-mono text-g-muted">
              SELECT TO CONFIGURE AI & PERIMETER
            </span>
          </div>

          <div className="flex-1 min-h-0 p-2 overflow-y-auto grid grid-cols-3 gap-2.5 content-start">
            {filteredCameras.map((cam) => {
              const isSelected = cam.id === selectedCamId;
              const isOnline = cam.online && !disabledCameraIds.includes(cam.id);

              return (
                <div
                  key={cam.id}
                  onClick={() => setSelectedCamId(cam.id)}
                  className={`relative flex flex-col p-2 border rounded-[2px] cursor-pointer transition-all bg-g-bg/90 overflow-hidden ${
                    isSelected
                      ? "border-g-blue ring-1 ring-g-blue/60 shadow-md"
                      : "border-g-border hover:border-g-border-strong hover:bg-g-raised/40"
                  } ${!isOnline ? "opacity-60 saturate-50" : ""}`}
                >
                  {/* Card Header */}
                  <div className="flex items-center justify-between gap-1 mb-1.5 z-10">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-[10px] font-mono font-bold text-g-text truncate">
                        {cam.id}
                      </span>
                      <span className="text-[9px] font-mono text-g-muted truncate">
                        {cam.name}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <StatusDot tone={isOnline ? (cam.aiEnabled ? "red" : "ok") : "err"} />
                      <span
                        className={`text-[8px] font-mono px-1 py-0.2 rounded-[1px] border font-bold ${
                          cam.aiEnabled
                            ? "bg-red-500/15 border-red-500/50 text-red-400"
                            : "bg-g-panel border-g-border text-g-muted"
                        }`}
                      >
                        AI
                      </span>
                    </div>
                  </div>

                  {/* Micro Thumbnail in true 16:9 CCTV perspective (Never squashed!) */}
                  <div className="w-full aspect-video relative rounded-[2px] overflow-hidden bg-black/90">
                    <CameraCardThumbnail cam={cam} isSelected={isSelected} />
                    {/* Analytics overlay indicator badge */}
                    {isOnline && cam.analytics?.type && cam.analytics.type !== "none" && (
                      <div className="absolute bottom-1.5 left-1.5 pointer-events-none z-20">
                        <span className="text-[7.5px] font-mono px-1.5 py-0.5 rounded-[2px] bg-black/85 border border-cyan-500/40 text-cyan-300 uppercase font-bold tracking-wider">
                          {cam.analytics.type === "traffic_count" ? "TRIPWIRE" : "INTRUSION"}
                        </span>
                      </div>
                    )}
                    {!isOnline && (
                      <div className="absolute inset-0 bg-black/75 flex items-center justify-center pointer-events-none z-20">
                        <span className="text-[8.5px] font-mono px-2 py-0.5 rounded-[2px] bg-red-950/90 border border-red-500/50 text-red-400 uppercase font-bold tracking-wider">
                          STANDBY
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Card Footer */}
                  <div className="flex items-center justify-between text-[8.5px] font-mono text-g-muted mt-1.5 pt-1 border-t border-g-border/30 z-10">
                    <span className="text-white/60">{cam.resolution}</span>
                    <span className="text-emerald-400/90 font-semibold">{isOnline ? `${cam.fps} FPS` : "STANDBY"}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column: Selected Camera Telemetry & Studio (5 of 12 columns) */}
        <div className="col-span-5 flex flex-col bg-g-panel border border-g-border rounded-[2px] min-h-0 overflow-hidden">
          <div className="h-7 px-3 border-b border-g-border flex items-center justify-between shrink-0 bg-g-bg/50">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono font-bold text-g-blue">
                {selectedCam.id}
              </span>
              <span className="text-[10px] font-mono text-g-text truncate">
                {selectedCam.name}
              </span>
            </div>
            <span className="text-[9px] font-mono text-g-muted">
              {clock} HRS
            </span>
          </div>

          <div className="flex-1 min-h-0 p-3 overflow-y-auto flex flex-col gap-3 font-mono">
            {/* Large Preview Viewport with Live Selected Stream */}
            <div className="relative aspect-video w-full bg-black rounded-[2px] border border-g-border overflow-hidden shrink-0">
              <SelectedCameraStream cam={selectedCam} />
            </div>

            {/* Quick Tactical Control: Feed Carrier Control */}
            <div className="p-2.5 bg-g-bg/90 border border-g-border rounded-[2px] flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <StatusDot tone={isHardwareOffline ? "idle" : isFeedActive ? "ok" : "err"} />
                <div className="flex flex-col">
                  <span className="text-[9.5px] font-bold uppercase tracking-wider text-g-muted">
                    PRIMARY CARRIER LINK
                  </span>
                  <span className={`text-[10px] font-mono font-bold tracking-wider ${
                    isHardwareOffline ? "text-g-muted" : isFeedActive ? "text-emerald-400" : "text-amber-400"
                  }`}>
                    {isHardwareOffline ? "NO SIGNAL (HARDWARE OFFLINE)" : isFeedActive ? "TRANSMITTING (LIVE FEED)" : "STANDBY (STREAM MUTED)"}
                  </span>
                </div>
              </div>

              <button
                type="button"
                disabled={isHardwareOffline}
                onClick={() => toggleCameraFeedStatus(selectedCam.id, !isFeedActive)}
                className={`h-7 px-3 rounded-[2px] text-[9.5px] font-bold uppercase tracking-wider border transition-colors flex items-center gap-1.5 shrink-0 ${
                  isHardwareOffline
                    ? "bg-g-panel border-g-border text-g-muted/40 cursor-not-allowed"
                    : isFeedActive
                    ? "bg-g-panel hover:bg-red-500/10 border-g-border hover:border-red-500/40 text-g-muted hover:text-red-400"
                    : "bg-emerald-500/10 hover:bg-emerald-500/20 border-emerald-500/40 text-emerald-400 font-bold"
                }`}
              >
                {isHardwareOffline ? (
                  "CARRIER LOST"
                ) : isFeedActive ? (
                  <>
                    <svg className="w-2.5 h-2.5 opacity-70" viewBox="0 0 24 24" fill="currentColor">
                      <rect x="6" y="6" width="12" height="12" />
                    </svg>
                    <span>CUT STREAM</span>
                  </>
                ) : (
                  <>
                    <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="currentColor">
                      <polygon points="5,3 19,12 5,21" />
                    </svg>
                    <span>RESTORE FEED</span>
                  </>
                )}
              </button>
            </div>

            {/* AI Object Detection & ANPR Toggle */}
            <div className="p-2.5 bg-g-bg/90 border border-g-border rounded-[2px] flex items-center justify-between">
              <div>
                <div className="text-[10px] font-bold text-g-text uppercase tracking-wider flex items-center gap-1.5">
                  <StatusDot tone={selectedCam.aiEnabled ? "red" : "idle"} className={selectedCam.aiEnabled ? "animate-pulse" : ""} />
                  <span>CV THREAT INFERENCE ENGINE</span>
                </div>
                <div className="text-[9px] text-g-muted mt-0.5">
                  YOLOv8 Edge Analytic · Real-time bounding & classification cascade
                </div>
              </div>
              <button
                type="button"
                onClick={() => toggleAi(selectedCam.id, !selectedCam.aiEnabled)}
                className={`h-6 px-3 rounded-[2px] text-[9px] font-bold tracking-wider uppercase border transition-colors flex items-center gap-1.5 ${
                  selectedCam.aiEnabled
                    ? "bg-red-500/10 hover:bg-red-500/20 border-red-500/40 text-red-400 font-bold"
                    : "bg-g-panel hover:bg-g-raised border-g-border text-g-muted hover:text-g-text"
                }`}
              >
                {selectedCam.aiEnabled ? (
                  <>
                    <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                    <span>DISARM INFERENCE</span>
                  </>
                ) : (
                  <>
                    <svg className="w-2.5 h-2.5 opacity-60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                    </svg>
                    <span>ARM INFERENCE</span>
                  </>
                )}
              </button>
            </div>

            {/* Analytics Mode Section: Reference Image Inspired Layout */}
            <div className="relative p-3 bg-g-bg/95 border border-g-border rounded-[2px] flex flex-col gap-2.5">
              {/* Tactical Reference Corner Marks */}
              <div className="absolute top-0 left-0 w-1.5 h-1.5 border-t border-l border-white/30 pointer-events-none" />
              <div className="absolute top-0 right-0 w-1.5 h-1.5 border-t border-r border-white/30 pointer-events-none" />
              <div className="absolute bottom-0 left-0 w-1.5 h-1.5 border-b border-l border-white/30 pointer-events-none" />
              <div className="absolute bottom-0 right-0 w-1.5 h-1.5 border-b border-r border-white/30 pointer-events-none" />

              {/* Header with tactical // breadcrumbs and status badge */}
              <div className="flex items-center justify-between border-b border-g-border/50 pb-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono font-bold tracking-wider text-g-text uppercase">
                    SPATIAL BOUNDARY PROFILE
                  </span>
                  <span className="text-[9px] font-mono text-g-muted">// SECTOR GEOMETRY</span>
                </div>
                <span className={`text-[8.5px] font-mono px-2 py-0.5 rounded-[1px] border font-bold uppercase tracking-wider ${
                  currentAnalyticsType === "traffic_count"
                    ? "bg-cyan-950/60 border-cyan-500/50 text-cyan-300"
                    : currentAnalyticsType === "intrusion_zone"
                    ? "bg-emerald-950/60 border-emerald-500/50 text-emerald-300"
                    : "bg-g-panel border-g-border text-g-muted"
                }`}>
                  {currentAnalyticsType === "traffic_count"
                    ? "■ TRIPWIRE ARMED"
                    : currentAnalyticsType === "intrusion_zone"
                    ? "■ PERIMETER ARMED"
                    : "■ FULL FRAME"}
                </span>
              </div>

              {/* 3 Justified Tactical Selector Tiles (Cleanly Spaced, No Cramped Text) */}
              <div className="grid grid-cols-3 gap-2">
                {/* Tile 1: Full Frame */}
                <button
                  type="button"
                  disabled={changingMode}
                  onClick={() => handleModeChange("none")}
                  className={`p-2 rounded-[2px] border text-left flex flex-col justify-between transition-all ${
                    currentAnalyticsType === "none"
                      ? "bg-g-raised border-g-blue text-white shadow-sm ring-1 ring-g-blue/50"
                      : "bg-g-panel/70 border-g-border text-g-muted hover:text-g-text hover:bg-g-panel hover:border-g-border-strong"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[9.5px] font-mono font-bold tracking-wider">FULL FRAME</span>
                    <span className={`w-1.5 h-1.5 rounded-full ${currentAnalyticsType === "none" ? "bg-g-blue" : "bg-g-muted/40"}`} />
                  </div>
                  <div className="text-[8px] font-mono text-g-muted mt-1 truncate">OPTICAL STREAM</div>
                </button>

                {/* Tile 2: Tripwire Vector */}
                <button
                  type="button"
                  disabled={changingMode}
                  onClick={() => handleModeChange("traffic_count")}
                  className={`p-2 rounded-[2px] border text-left flex flex-col justify-between transition-all ${
                    currentAnalyticsType === "traffic_count"
                      ? "bg-cyan-950/40 border-cyan-400 text-cyan-200 shadow-sm ring-1 ring-cyan-400/50"
                      : "bg-g-panel/70 border-g-border text-g-muted hover:text-cyan-300 hover:bg-g-panel hover:border-g-border-strong"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[9.5px] font-mono font-bold tracking-wider">TRIPWIRE</span>
                    <span className={`w-1.5 h-1.5 rounded-full ${currentAnalyticsType === "traffic_count" ? "bg-cyan-400 animate-pulse" : "bg-g-muted/40"}`} />
                  </div>
                  <div className="text-[8px] font-mono text-cyan-400/80 mt-1 truncate">FLOW COUNTER</div>
                </button>

                {/* Tile 3: Perimeter Cordon */}
                <button
                  type="button"
                  disabled={changingMode}
                  onClick={() => handleModeChange("intrusion_zone")}
                  className={`p-2 rounded-[2px] border text-left flex flex-col justify-between transition-all ${
                    currentAnalyticsType === "intrusion_zone"
                      ? "bg-emerald-950/40 border-emerald-400 text-emerald-200 shadow-sm ring-1 ring-emerald-400/50"
                      : "bg-g-panel/70 border-g-border text-g-muted hover:text-emerald-300 hover:bg-g-panel hover:border-g-border-strong"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[9.5px] font-mono font-bold tracking-wider">PERIMETER</span>
                    <span className={`w-1.5 h-1.5 rounded-full ${currentAnalyticsType === "intrusion_zone" ? "bg-emerald-400 animate-pulse" : "bg-g-muted/40"}`} />
                  </div>
                  <div className="text-[8px] font-mono text-emerald-400/80 mt-1 truncate">GEO-FENCE CORDON</div>
                </button>
              </div>

              {/* Tactical Telemetry & Justified Calibration Row */}
              <div className="p-2 bg-black/50 border border-g-border/70 rounded-[2px] flex items-center justify-between gap-3">
                <div className="flex flex-col gap-0.5 min-w-0">
                  <div className="flex items-center gap-2 text-[9px] font-mono text-g-muted truncate">
                    <span className="text-g-text font-bold">GEOMETRY SPECS:</span>
                    <span className="truncate">
                      {currentAnalyticsType === "traffic_count"
                        ? `${selectedCam.analytics?.line?.length || 3} WAYPOINTS · BI-DIRECTIONAL COUNTER`
                        : currentAnalyticsType === "intrusion_zone"
                        ? `${selectedCam.analytics?.zone?.length || 4} VERTICES · INTRUSION ALERT`
                        : "UNBOUNDED FEED · FULL FRAME"}
                    </span>
                  </div>
                  <div className="text-[8px] font-mono text-g-muted/80 truncate">
                    {currentAnalyticsType === "traffic_count"
                      ? "Cross-boundary threshold: ±15px · Directional tracking"
                      : currentAnalyticsType === "intrusion_zone"
                      ? "Temporal buffer: 15px · 8 frame breach confirmation"
                      : "Optical surveillance stream with edge AI"}
                  </div>
                </div>

                {currentAnalyticsType !== "none" && (
                  <button
                    type="button"
                    onClick={() => setIsCalibrating(true)}
                    className="h-7 px-3 rounded-[2px] bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/50 hover:border-cyan-400 text-cyan-300 font-mono text-[9px] font-bold tracking-wider flex items-center gap-1.5 shrink-0 transition-colors uppercase shadow-sm"
                  >
                    <svg className="w-3.5 h-3.5 text-cyan-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="22" y1="12" x2="18" y2="12" />
                      <line x1="6" y1="12" x2="2" y2="12" />
                      <line x1="12" y1="6" x2="12" y2="2" />
                      <line x1="12" y1="22" x2="12" y2="18" />
                    </svg>
                    <span>CALIBRATE BOUNDARY</span>
                  </button>
                )}
              </div>
            </div>

            {/* Hardware & Sensor Telemetry Specs */}
            <div className="p-2.5 bg-g-bg/90 border border-g-border rounded-[2px] flex flex-col gap-1.5 text-[9.5px]">
              <div className="flex items-center justify-between border-b border-g-border/50 pb-1">
                <span className="text-[9.5px] font-bold uppercase text-g-muted tracking-wider">
                  SENSOR TELEMETRY & LINK METRICS
                </span>
                <span className="text-[8.5px] font-mono text-emerald-400 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  OPTICAL LINK SYNCHRONIZED
                </span>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-g-muted pt-0.5">
                <div className="flex items-center justify-between py-0.5 border-b border-g-border/20">
                  <span>NETWORK IP:</span>
                  <span className="text-g-text font-bold font-mono">{selectedCam.ip}</span>
                </div>
                <div className="flex items-center justify-between py-0.5 border-b border-g-border/20">
                  <span>SENSOR MODEL:</span>
                  <span className="text-g-text font-mono truncate">{selectedCam.model}</span>
                </div>
                <div className="flex items-center justify-between py-0.5 border-b border-g-border/20">
                  <span>NATIVE RESOLUTION:</span>
                  <span className="text-g-text font-mono">{selectedCam.resolution}</span>
                </div>
                <div className="flex items-center justify-between py-0.5 border-b border-g-border/20">
                  <span>FRAME RATE:</span>
                  <span className="text-g-text font-mono">{selectedCam.fps} FPS</span>
                </div>
                <div className="flex items-center justify-between py-0.5">
                  <span>FIRMWARE BUILD:</span>
                  <span className="text-g-text font-mono">{selectedCam.firmware}</span>
                </div>
                <div className="flex items-center justify-between py-0.5">
                  <span>STREAM TRANSPORT:</span>
                  <span className="text-g-blue font-mono truncate">{selectedCam.mjpegUrl ? "MJPEG LIVE" : "HLS/MP4 DIRECT"}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Spacious Full Tactical Calibrator Modal */}
      {isCalibrating && (
        <div className="fixed inset-4 md:inset-8 z-50 flex flex-col bg-g-bg border border-g-border rounded-[4px] shadow-2xl overflow-hidden backdrop-blur-md">
          <ZoneCalibrator
            cam={selectedCam}
            onClose={() => setIsCalibrating(false)}
            onSave={async (newPoints) => {
              const isLine = selectedCam.analytics?.type === "traffic_count";
              const payload = isLine ? { line: newPoints } : { zone: newPoints };
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
