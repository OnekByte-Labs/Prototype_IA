"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PlaybackStats, WebRtcProfile } from "@/lib/live-video";
import { Badge, Button, CameraTile, Icon } from "@/components/ds";
import { cx } from "@/lib/design/cx";
import { TACTICAL_CAMERAS, type TacticalCamera } from "@/lib/datasets/dataset-definitions";
import { useConsole } from "../ConsoleProvider";

export type GridDensity = 12 | 16 | 32;
import { GlassIconButton, GlassPanel, GlassSegment, PanelHeader } from "./glass";
import { DetectionModeSelector } from "./DetectionModeSelector";
import { ModeAnalyticsPanel } from "./ModeAnalyticsPanel";
import { RestrictedZoneEditor } from "./RestrictedZoneEditor";
import { TacticalVideoFeed } from "./TacticalVideoFeed";

type LiveDetection = { id: number; class: string; confidence: number; plate?: string; model?: string };
type LiveSnapshot = {
  detections: LiveDetection[];
  fps: number;
  frameId: number;
  analytics: Record<string, unknown>;
  mode?: string;
};

/**
 * Subscribe to a camera's live pipeline metadata (SSE) and expose a snapshot
 * throttled to 4 Hz — the stream itself runs at up to 15 fps.
 */
function useLiveMetadata(url?: string): LiveSnapshot | null {
  const [snap, setSnap] = useState<LiveSnapshot | null>(null);
  useEffect(() => {
    if (!url) return;
    const es = new EventSource(url);
    let latest: {
      detections?: LiveDetection[]; frame_id?: number; analytics?: Record<string, unknown>; detection_mode?: string;
    } | null = null;
    const arrivals: number[] = [];
    es.onmessage = (e) => {
      try {
        latest = JSON.parse(e.data);
        arrivals.push(performance.now());
        if (arrivals.length > 30) arrivals.shift();
      } catch {
        /* ignore malformed event */
      }
    };
    const timer = setInterval(() => {
      if (!latest) return;
      const span = arrivals.length > 1 ? arrivals[arrivals.length - 1] - arrivals[0] : 0;
      setSnap({
        detections: latest.detections ?? [],
        fps: span > 0 ? ((arrivals.length - 1) * 1000) / span : 0,
        frameId: latest.frame_id ?? 0,
        analytics: latest.analytics ?? {},
        mode: latest.detection_mode,
      });
    }, 250);
    return () => {
      es.close();
      clearInterval(timer);
      setSnap(null);
    };
  }, [url]);
  return snap;
}

/**
 * NVR channels shown on the wall, in tile order. Channel numbers repeat across
 * NVRs (CP Plus 3 vs Hikvision 3), so each entry names its NVR; `id` is the
 * camera used until the backend reports which camera is bound to the channel.
 */
const WALL_FEEDS: { nvr: string; channel: number; id: string }[] = [
  { nvr: "FILE-01", channel: 1, id: "CAM-01" },
  { nvr: "FILE-01", channel: 2, id: "CAM-02" },
  { nvr: "FILE-01", channel: 3, id: "CAM-03" },
  { nvr: "FILE-01", channel: 4, id: "CAM-04" },
  { nvr: "FILE-01", channel: 5, id: "CAM-05" },
  { nvr: "FILE-01", channel: 6, id: "CAM-06" },
  { nvr: "FILE-01", channel: 7, id: "CAM-07" },
  { nvr: "FILE-01", channel: 8, id: "CAM-08" },
  { nvr: "FILE-01", channel: 9, id: "CAM-09" },
  { nvr: "FILE-01", channel: 10, id: "CAM-10" },
  { nvr: "FILE-01", channel: 11, id: "CAM-11" },
  { nvr: "FILE-01", channel: 12, id: "CAM-12" },
];

interface CameraWallProps {
  density?: GridDensity;
  onChangeDensity?: (density: GridDensity) => void;
  /** "Dynamic" layout: tiles with an active alert surface first. */
  alertFirst?: boolean;
  onChangeAlertFirst?: (on: boolean) => void;
  showAiBoxes?: boolean;
  alertingCameraIds?: string[];
  onAcknowledgeCamera?: (camId: string) => void;
  selectedCameraId?: string | null;
  onClearSelectedCamera?: () => void;
}

/** Grid shapes per density: columns × rows fill the panel exactly, as in the Stitch 3×3 matrix. */
const GRID: Record<GridDensity, { cols: number; rows: number }> = {
  12: { cols: 4, rows: 3 },
  16: { cols: 4, rows: 4 },
  32: { cols: 8, rows: 4 },
};

type LayoutId = "g12" | "g16" | "g32" | "dynamic";

export function CameraWall({
  density = 12,
  onChangeDensity,
  alertFirst = false,
  onChangeAlertFirst,
  showAiBoxes = true,
  alertingCameraIds = [],
  onAcknowledgeCamera,
  selectedCameraId = null,
  onClearSelectedCamera,
}: CameraWallProps) {
  const [internalFocusId, setInternalFocusId] = useState<string | null>(null);
  const focusId = selectedCameraId ?? internalFocusId;
  const { liveStreams, cameras, pipelines, streamHealth, feedLink } = useConsole();
  const [focusPlayback, setFocusPlayback] = useState<{
    transport: "WEBRTC" | "MJPEG" | null; profile: WebRtcProfile | null; stats: PlaybackStats | null;
  } | null>(null);
  const onFocusPlayback = useCallback(
    (p: { transport: "WEBRTC" | "MJPEG" | null; profile: WebRtcProfile | null; stats: PlaybackStats | null }) =>
      setFocusPlayback(p),
    [],
  );
  const [zoneEditorOpen, setZoneEditorOpen] = useState(false);

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

  // The wall shows exactly these NVR channels, in this order, from the first
  // tile on; every remaining tile stays an empty box.
  const displayedCameras = useMemo(() => {
    const bound = Object.entries(liveStreams);
    const feeds = WALL_FEEDS
      .map((f) => {
        const id = bound.find(([, st]) => st.nvrId === f.nvr && st.channel === f.channel)?.[0] ?? f.id;
        return TACTICAL_CAMERAS.find((c) => c.id === id);
      })
      .filter((c): c is TacticalCamera => !!c);
    // Dynamic layout: alerting tiles surface first (stable otherwise)
    if (alertFirst) {
      feeds.sort((a, b) => Number(alertingCameraIds.includes(b.id)) - Number(alertingCameraIds.includes(a.id)));
    }
    return feeds.slice(0, density);
  }, [density, liveStreams, alertFirst, alertingCameraIds]);
  const blankSlots = Math.max(0, density - displayedCameras.length);

  const focusedCam = TACTICAL_CAMERAS.find((c) => c.id === focusId);
  const focusedStream = focusedCam ? liveStreams[focusedCam.id] : undefined;
  const live = useLiveMetadata(focusedStream?.metadataUrl);
  const [focusDetections, setFocusDetections] = useState<
    Array<{ id: number; class: string; confidence: number; plate?: string; model?: string }>
  >([]);

  const activeMode = focusedCam ? pipelines[focusedCam.id]?.mode ?? "both" : "both";
  const rawDetections = live?.detections && live.detections.length > 0 ? live.detections : focusDetections;

  const liveDetections = useMemo(() => {
    if (activeMode === "none") return [];
    return rawDetections
      .filter((d) => (activeMode === "anpr" ? !!d.plate : true))
      .filter((d) => (d.confidence ?? 1) >= 0.35)
      .map((d) => ({
        ...d,
        class: d.class.toLowerCase().includes("truck") ? "truck" : d.class,
      }))
      .sort((a, b) => b.confidence - a.confidence);
  }, [rawDetections, activeMode]);

  const classCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const d of liveDetections) counts[d.class] = (counts[d.class] ?? 0) + 1;
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [liveDetections]);
  // Header readouts: real ingest fps of the live tiles and the codec they carry
  const wallLive = displayedCameras.filter((c) => liveStreams[c.id]?.sourceType === "rtsp");
  const fpsVals = wallLive.map((c) => streamHealth[c.id]?.fps).filter((f): f is number => typeof f === "number" && f > 0);
  const avgFps = fpsVals.length ? fpsVals.reduce((a, b) => a + b, 0) / fpsVals.length : null;
  const codecs = wallLive.map((c) => liveStreams[c.id]?.codec).filter((c): c is string => !!c);
  const codec = codecs.length
    ? Object.entries(codecs.reduce<Record<string, number>>((m, c) => ((m[c] = (m[c] ?? 0) + 1), m), {})).sort((a, b) => b[1] - a[1])[0][0]
    : null;
  const panelRef = useRef<HTMLElement>(null);
  const layout: LayoutId = alertFirst ? "dynamic" : (`g${density}` as LayoutId);
  const setLayout = (id: LayoutId) => {
    if (id === "dynamic") {
      onChangeAlertFirst?.(true);
      return;
    }
    onChangeAlertFirst?.(false);
    onChangeDensity?.(Number(id.slice(1)) as GridDensity);
  };
  const grid = GRID[density] ?? GRID[12];

  return (
    <GlassPanel as="section" ref={panelRef} className="flex-1 rounded-2xl p-3 flex flex-col min-h-0 overflow-hidden">
      <PanelHeader
        icon="grid_view"
        title="Surveillance Matrix"
        left={
          <GlassSegment<LayoutId>
            label="Matrix layout"
            className="ml-2"
            value={layout}
            onChange={setLayout}
            items={[
              { id: "g12", label: "4×3 Grid", title: "12 tiles" },
              { id: "g16", label: "4×4 Grid", title: "16 tiles (battalion)" },
              { id: "g32", label: "8×4 Grid", title: "32 tiles (full AI array)" },
              { id: "dynamic", label: "Dynamic", title: `Dynamic alert eviction: tiles with an active alert surface first (${alertingCameraIds.length} now)` },
            ]}
          />
        }
        right={
          <>
            <span className="flex items-center gap-1.5" title="Mean ingest rate of the live AI channels on the wall">
              <span className={cx("w-1.5 h-1.5 rounded-full", avgFps ? "bg-ok-ink" : "bg-crit-ink")} />
              <span className="text-ink-2 tnum">{avgFps ? `${avgFps.toFixed(0)} FPS` : "NO LIVE FPS"}</span>
            </span>
            {codec && (
              <>
                <span className="text-white/15">/</span>
                <span className="text-ink-2 font-medium uppercase">{codec}</span>
              </>
            )}
            <span className="text-white/15">/</span>
            <span className="text-ink-2 tnum" data-testid="wall-live">
              {wallLive.length}/{displayedCameras.length} LIVE AI
            </span>
            {focusedCam && (
              <button
                type="button"
                onClick={handleCloseFocus}
                className="glass-button h-6 px-2 rounded flex items-center gap-1 text-ink-2 hover:text-white"
              >
                <Icon name="fullscreen_exit" size={13} />
                Exit focus <span className="text-ink-3">Esc</span>
              </button>
            )}
            <GlassIconButton
              icon="fullscreen"
              label="Fullscreen"
              size={13}
              className="w-6 h-6 rounded"
              onClick={() => {
                const el = panelRef.current;
                if (!el) return;
                if (document.fullscreenElement) void document.exitFullscreen();
                else void el.requestFullscreen?.();
              }}
            />
          </>
        }
      />

      {/* Wall: live tiles fill the panel (or the focused inspection workspace) */}
      <div className="flex-1 min-h-0 relative">
        {focusedCam ? (
          /* Focused full-panel inspection workspace */
          <div className="w-full h-full flex flex-col lg:flex-row gap-3 overflow-y-auto">
            {/* Expanded video feed */}
            <CameraTile
              className="flex-1 min-h-[360px]"
              selected
              alerting={alertingCameraIds.includes(focusedCam.id)}
            >
              <TacticalVideoFeed
                camera={focusedCam}
                liveMjpegUrl={focusedStream?.mjpegUrl}
                pipeline={pipelines[focusedCam.id]}
                stream={focusedStream}
                health={streamHealth[focusedCam.id]}
                feedLink={feedLink}
                onPlayback={onFocusPlayback}
                focused={true}
                glass
                showAiBoxes={showAiBoxes}
                isBreached={alertingCameraIds.includes(focusedCam.id)}
                onDetections={setFocusDetections}
              />
            </CameraTile>

            {/* Telemetry and model diagnostics */}
            <div className="w-full lg:w-[340px] bg-surface border border-line rounded-lg p-4 flex flex-col gap-4 shrink-0 overflow-y-auto">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="text-section text-ink truncate">{focusedCam.name}</h3>
                  <span className="text-caption text-ink-2 font-data">
                    {focusedCam.id} · {focusedCam.sector}
                  </span>
                </div>
                <Button size="sm" onClick={handleCloseFocus}>
                  Close
                </Button>
              </div>

              {/* Stream telemetry (real: backend stream health + browser playback) */}
              {focusedStream?.sourceType === "rtsp" ? (() => {
                const h = streamHealth[focusedCam.id];
                const pb = focusPlayback?.stats;
                const row = (k: string, v: React.ReactNode, cls = "text-ink") => (
                  <div className="flex justify-between gap-3">
                    <span className="text-ink-2 shrink-0">{k}</span>
                    <span className={`${cls} text-right truncate`}>{v}</span>
                  </div>
                );
                const st = h?.status ?? "RECONNECTING";
                return (
                  <div data-testid="focus-stream" className="space-y-1.5 bg-canvas p-3 rounded-md shadow-inset-sm text-caption font-data">
                    {row("Source", `Live · ${focusedStream.nvrId} CH${String(focusedStream.channel).padStart(2, "0")}`)}
                    {row("Status", `${st}${h?.reason ? ` · ${h.reason}` : ""}`,
                      st === "CONNECTED" ? "text-ok-ink" : st === "DEGRADED" || st === "RECONNECTING" ? "text-warn-ink" : "text-crit-ink")}
                    {row("AI stream", `${focusedStream.width}×${focusedStream.height} ${h?.codec ?? focusedStream.codec ?? ""} · ${(h?.fps ?? 0).toFixed(1)}/${h?.target_fps ?? "--"} fps`)}
                    {row("Decoder", h?.decoder ?? "--")}
                    {row("AI latency", h?.latency_ms != null ? `${h.latency_ms.toFixed(0)} ms (decode → result)` : "--")}
                    {row("Bitrate", h?.bitrate_kbps != null ? `${(h.bitrate_kbps / 1000).toFixed(2)} Mbit/s` : "--")}
                    {row("Reconnects", `${h?.reconnects ?? 0} ingest · ${h?.upstream_reconnects ?? 0} NVR`,
                      (h?.reconnects ?? 0) + (h?.upstream_reconnects ?? 0) > 0 ? "text-warn-ink" : "text-ink")}
                    {row("View", focusPlayback?.transport === "WEBRTC"
                      ? `WebRTC ${focusPlayback.profile === "main_h264" ? "main (H.264 GPU)" : focusPlayback.profile}${pb?.width ? ` ${pb.width}×${pb.height}` : ""}${pb?.fps != null ? ` · ${pb.fps.toFixed(0)} fps` : ""}`
                      : focusPlayback?.transport === "MJPEG" ? "MJPEG (AI stream)" : "connecting…")}
                    {focusPlayback?.transport === "WEBRTC" && row("Playout delay", pb?.jitterMs != null ? `${pb.jitterMs.toFixed(0)} ms jitter buffer` : "--")}
                  </div>
                );
              })() : (
                <div className="space-y-1.5 bg-canvas p-3 rounded-md shadow-inset-sm text-caption font-data">
                  <div className="flex justify-between">
                    <span className="text-ink-2">Source</span>
                    <span className="text-ink font-medium">{focusedStream ? "Recorded clip" : "No feed"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ink-2">Stream</span>
                    <span className="text-ink">{focusedCam.resolution}</span>
                  </div>
                </div>
              )}

              {/* Runtime detection mode (backend-controlled pipeline) */}
              <DetectionModeSelector cameraId={focusedCam.id} />

              <div className="space-y-1.5 bg-canvas p-3 rounded-md shadow-inset-sm text-caption font-data">
                <div className="flex justify-between">
                  <span className="text-ink-2">Pipeline stream</span>
                  <span className={focusedStream ? "text-ink" : "text-crit-ink"}>
                    {focusedStream?.streamId ?? "Offline"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-ink-2">Live FPS</span>
                  <span className="text-ink">{live ? live.fps.toFixed(1) : "--"}</span>
                </div>
              </div>

              <ModeAnalyticsPanel
                cameraId={focusedCam.id}
                mode={pipelines[focusedCam.id]?.activeMode ?? null}
                analytics={live?.analytics ?? {}}
              />

              {/* Live detections from the AI pipeline (tracked objects in the current frame) */}
              <div className="min-h-32 flex-1 flex flex-col">
                <div className="flex items-baseline justify-between pb-1.5 border-b border-line">
                  <h4 className="text-ui font-semibold text-ink">
                    Current detections <span className="text-ink-3 font-normal tnum">{liveDetections.length}</span>
                  </h4>
                  {live && <span className="text-caption text-ink-3 font-data">Frame {live.frameId}</span>}
                </div>
                {classCounts.length > 0 && (
                  <div className="flex flex-wrap gap-1 py-1.5">
                    {classCounts.map(([cls, n]) => (
                      <Badge key={cls} mono>
                        {cls} ×{n}
                      </Badge>
                    ))}
                  </div>
                )}
                <div className="flex-1 min-h-0 overflow-y-auto">
                  {liveDetections.length === 0 ? (
                    <div className="text-caption text-ink-2 py-2">
                      {activeMode === "none" ? "No detections active (mode: None)" : "No objects in view."}
                    </div>
                  ) : (
                    liveDetections.map((d) => (
                      <div
                        key={d.id}
                        className="flex items-center justify-between py-1 border-b border-line last:border-0 text-ui"
                      >
                        <span className="text-ink truncate capitalize">
                          {activeMode === "anpr" ? (
                            <span className="text-accent-ink font-data text-data font-semibold">
                              Plate : {d.plate}
                            </span>
                          ) : activeMode === "vehicle" ? (
                            <>
                              {d.class}
                              {d.model && <span className="text-ink-2 font-data text-data"> : {d.model}</span>}
                            </>
                          ) : (
                            <>
                              {d.class}
                              {d.model && <span className="text-ink-2 font-data text-data"> : {d.model}</span>}
                              {d.plate && <span className="text-accent-ink font-data text-data"> | {d.plate}</span>}
                            </>
                          )}
                        </span>
                        <span className="text-ink font-data text-data tnum">{(d.confidence * 100).toFixed(1)}%</span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Zone / line for the camera's current mode */}
              {(() => {
                const mode = pipelines[focusedCam.id]?.mode;
                const geom = cameras.find((c) => c.id === focusedCam.id)?.analytics;
                if (mode === "intrusion") {
                  return (
                    <Button variant="danger" onClick={() => setZoneEditorOpen(true)}>
                      {(geom?.zone?.length ?? 0) >= 3 ? "Edit restricted zone" : "Draw restricted zone"}
                    </Button>
                  );
                }
                if (mode === "vehicle_counting" || mode === "person_counting") {
                  return (
                    <Button onClick={() => setZoneEditorOpen(true)}>
                      {(geom?.line?.length ?? 0) >= 2 ? "Edit counting line" : "Draw counting line"}
                    </Button>
                  );
                }
                return null;
              })()}

              {/* Actions */}
              <div className="flex gap-2">
                <Button
                  className="flex-1"
                  variant="primary"
                  onClick={() => {
                    if (onAcknowledgeCamera) onAcknowledgeCamera(focusedCam.id);
                  }}
                >
                  Acknowledge channel
                </Button>
                <Button
                  onClick={() => {
                    navigator.clipboard.writeText(
                      focusedStream?.sourceType === "rtsp"
                        ? `${focusedCam.id} ${focusedStream.nvrId} channel ${focusedStream.channel}`
                        : focusedCam.id,
                    );
                  }}
                  title="Copy camera / NVR channel reference"
                  aria-label="Copy camera reference"
                >
                  <Icon name="content_copy" size={15} />
                </Button>
              </div>
            </div>
          </div>
        ) : (
          /* Multi-tile video matrix */
          <div
            className="grid gap-2 h-full min-h-0"
            style={{
              gridTemplateColumns: `repeat(${grid.cols}, minmax(0, 1fr))`,
              gridTemplateRows: `repeat(${grid.rows}, minmax(0, 1fr))`,
            }}
          >
            {displayedCameras.map((cam) => {
              const stream = liveStreams[cam.id];
              const health = streamHealth[cam.id];
              const alerting = alertingCameraIds.includes(cam.id);
              return (
                <div
                  key={cam.id}
                  data-testid="wall-tile"
                  data-alerting={alerting || undefined}
                  className={cx(
                    "glass-viewport rounded-xl relative overflow-hidden transition min-h-0 min-w-0",
                    alerting
                      ? "!border-warn/50 ring-1 ring-warn/20 bg-warn/5"
                      : "hover:!border-accent/40"
                  )}
                >
                  <TacticalVideoFeed
                    camera={cam}
                    liveMjpegUrl={stream?.mjpegUrl}
                    pipeline={pipelines[cam.id]}
                    stream={stream}
                    health={health}
                    feedLink={feedLink}
                    focused={false}
                    glass
                    showAiBoxes={showAiBoxes}
                    isBreached={alerting}
                    onClick={() => setInternalFocusId(cam.id)}
                  />
                </div>
              );
            })}
            {Array.from({ length: blankSlots }, (_, i) => (
              <div key={`blank-${i}`} className="rounded-xl bg-white/[0.02] border border-dashed border-white/[0.08]" />
            ))}
          </div>
        )}
      </div>
      {zoneEditorOpen && focusedCam && (
        <RestrictedZoneEditor
          cameraId={focusedCam.id}
          kind={pipelines[focusedCam.id]?.mode === "intrusion" ? "zone" : "line"}
          onClose={() => setZoneEditorOpen(false)}
        />
      )}
    </GlassPanel>
  );
}
