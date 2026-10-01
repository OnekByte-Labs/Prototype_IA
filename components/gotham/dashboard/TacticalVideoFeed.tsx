"use client";

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Icon, VideoChip } from "@/components/ds";
import { profileChain, type PlaybackStats, type WebRtcProfile } from "@/lib/live-video";
import type { CameraPipeline, FeedLink, LiveStream, StreamHealth } from "../ConsoleProvider";
import { MODE_SHORT } from "./DetectionModeSelector";
import { AiOverlay, LiveVideo } from "./LiveVideo";
import { useClock } from "../hooks";
import type { TacticalCamera } from "@/lib/datasets/dataset-definitions";

interface TacticalVideoFeedProps {
  camera: TacticalCamera;
  /** MJPEG of the camera's live frames — used only when WebRTC can't play the stream */
  liveMjpegUrl?: string;
  /** Real detection-pipeline state for this camera (from the backend) */
  pipeline?: CameraPipeline;
  /** Pipeline stream binding (live NVR channel, WebRTC profiles) */
  stream?: LiveStream;
  /** Real stream health (status / fps / reconnects) */
  health?: StreamHealth;
  /** Reachability of the AI backend: decides what a tile without a stream says */
  feedLink?: FeedLink;
  /** Browser playback stats of the WebRTC video (focused view telemetry) */
  onPlayback?: (p: { transport: "WEBRTC" | "MJPEG" | null; profile: WebRtcProfile | null; stats: PlaybackStats | null }) => void;
  focused?: boolean;
  showAiBoxes?: boolean;
  thermalOverride?: boolean;
  isBreached?: boolean;
  /** Liquid-glass dashboard presentation of the same live tile. */
  glass?: boolean;
  onClick?: () => void;
}

/**
 * One live camera tile. Video comes from the camera's NVR channel only:
 * WebRTC straight from the media server when the browser can decode the
 * stream's codec, else MJPEG of the live frames. Detections are drawn by the
 * browser from the pipeline's metadata stream in both cases. Cameras without
 * an NVR channel show NO FEED — there is no recorded fallback.
 */
export const TacticalVideoFeed = memo(function TacticalVideoFeed({
  camera,
  liveMjpegUrl,
  pipeline,
  stream,
  health,
  feedLink = "up",
  onPlayback,
  focused = false,
  isBreached = false,
  glass = false,
  onClick,
}: TacticalVideoFeedProps) {
  const [showHud, setShowHud] = useState(true);
  // Dashboard wall tiles show only the camera number and place name; detection text stays off the picture.
  const minimal = glass && !focused;

  // MJPEG stream state: retry every 5 s after an error (pipeline restarting).
  const [liveFailed, setLiveFailed] = useState(false);
  const [liveRetry, setLiveRetry] = useState(0);
  useEffect(() => {
    if (!liveFailed) return;
    const t = setTimeout(() => {
      setLiveFailed(false);
      setLiveRetry((n) => n + 1);
    }, 5000);
    return () => clearTimeout(t);
  }, [liveFailed]);
  // Live NVR camera: WebRTC when this browser can play the stream (codec
  // passthrough; GPU H.264 only for the focused view), else the pipeline's
  // MJPEG of the same live frames. Never the recorded clip.
  const isLive = stream?.sourceType === "rtsp";
  const profiles = useMemo(
    () => (isLive ? profileChain(stream?.codec, stream?.webrtcProfiles ?? [], focused) : []),
    [isLive, stream?.codec, stream?.webrtcProfiles, focused],
  );
  const [rtcFailed, setRtcFailed] = useState(false);
  const [rtcProfile, setRtcProfile] = useState<WebRtcProfile | null>(null);
  const [playback, setPlayback] = useState<PlaybackStats | null>(null);
  useEffect(() => {
    if (!rtcFailed) return;
    const t = setTimeout(() => setRtcFailed(false), 15000);   // retry WebRTC later
    return () => clearTimeout(t);
  }, [rtcFailed]);
  // Only a permanent ingest error (unsupported codec, NVR refuses the channel)
  // removes the video. A transient RECONNECTING / DISCONNECTED keeps the player
  // mounted — WebRTC renegotiates on its own and the MJPEG connection resumes
  // by itself — so a blip is never a blank tile.
  const streamDead = isLive && health?.status === "ERROR";
  const aiUp = health?.status === "CONNECTED" || health?.status === "DEGRADED";
  const showWebrtc = isLive && profiles.length > 0 && !rtcFailed && !streamDead;
  const showLive = !showWebrtc && (isLive ? !streamDead : camera.online) && !!liveMjpegUrl && !liveFailed;
  const transport = showWebrtc ? (rtcProfile ? "WEBRTC" : null) : showLive ? "MJPEG" : null;
  const onRtcFail = useCallback(() => {
    setRtcFailed(true);
    setRtcProfile(null);
  }, []);
  const onRtcLost = useCallback(() => setRtcProfile(null), []);
  // Signal state over the picture: nothing playing yet, or the feed dropped and is being re-established
  const signal: "connecting" | "lost" | null = showWebrtc
    ? rtcProfile ? null : playback ? "lost" : "connecting"
    : showLive && isLive && health && !aiUp ? "lost" : null;
  useEffect(() => {
    onPlayback?.({ transport, profile: showWebrtc ? rtcProfile : null, stats: showWebrtc ? playback : null });
  }, [onPlayback, transport, rtcProfile, playback, showWebrtc]);
  const liveOnline = isLive ? aiUp || signal !== null : camera.online;

  const connTone = health?.status === "CONNECTED" ? "ok" : health?.status === "DEGRADED" || health?.status === "RECONNECTING" || !health ? "warn" : "crit";
  const dotCls = { ok: "bg-video-ok animate-breathe", warn: "bg-video-warn", crit: "bg-video-crit" }[connTone];

  return (
    <div
      onClick={onClick}
      className={`relative w-full h-full select-none overflow-hidden flex flex-col justify-between ${
        glass ? "" : "bg-video"
      } ${onClick ? "cursor-pointer" : ""}`}
    >
      {/* Live NVR video over WebRTC + AI overlay from the pipeline metadata */}
      {showWebrtc ? (
        <>
          <LiveVideo
            cameraId={camera.id}
            profiles={profiles}
            onPlaying={setRtcProfile}
            onFail={onRtcFail}
            onLost={onRtcLost}
            onStats={setPlayback}
          />
          {pipeline && pipeline.mode !== "none" && (
            <AiOverlay metadataUrl={stream?.metadataUrl} width={stream?.width} height={stream?.height} labels={!minimal} />
          )}
        </>
      ) : /* MJPEG of the live frames (browser can't play the codec over WebRTC) */
      showLive ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- MJPEG stream, not a static image */}
          <img
            key={`${liveMjpegUrl}#${liveRetry}`}
            src={liveRetry ? `${liveMjpegUrl}?r=${liveRetry}` : liveMjpegUrl}
            alt={`${camera.id} live feed`}
            onError={() => setLiveFailed(true)}
            // contain, not cover: never crop the frame, so zones/boxes near the
            // edges stay visible whatever the tile's aspect ratio
            className="absolute inset-0 w-full h-full object-contain bg-black"
          />
          {pipeline && pipeline.mode !== "none" && (
            <AiOverlay metadataUrl={stream?.metadataUrl} width={stream?.width} height={stream?.height} labels={!minimal} />
          )}
        </>
      ) : !isLive && feedLink !== "up" ? (
        /* No stream list yet because the AI backend is starting / unreachable — not "no channel bound" */
        <div className={`absolute inset-0 flex flex-col items-center justify-center text-video-warn z-10 ${glass ? "" : "bg-video"}`}>
          <Icon name="sync" size={focused ? 40 : 22} className="animate-spin" />
          {!minimal && (
            <>
              <span className="text-caption font-medium mt-1">
                {feedLink === "down" ? "Backend unreachable" : "Connecting"}
              </span>
              <span className="text-caption text-video-ink/60 text-center px-2 line-clamp-2">
                {feedLink === "down" ? "Retrying — feeds resume automatically" : "Waiting for the AI backend"}
              </span>
            </>
          )}
        </div>
      ) : (
        <div className={`absolute inset-0 flex flex-col items-center justify-center text-video-crit z-10 ${glass ? "" : "bg-video"}`}>
          {glass ? (
            <span className="w-8 h-8 rounded-full bg-crit/10 border border-crit/25 flex items-center justify-center mb-1.5">
              <Icon name="videocam_off" size={focused ? 24 : 16} />
            </span>
          ) : (
            <Icon name="videocam_off" size={focused ? 40 : 22} />
          )}
          {!minimal && (
            <>
              <span className={glass ? "text-[10px] font-medium text-white/90" : "text-caption font-medium mt-1"}>
                {isLive ? `No carrier · ${health?.status ?? "connecting"}` : "No feed"}
              </span>
              <span className={`text-center px-2 line-clamp-2 ${glass ? "text-[9px] font-data text-ink-3 mt-0.5" : "text-caption text-video-ink/60"}`}>
                {isLive
                  ? `${stream?.nvrId ?? "NVR"} CH${String(stream?.channel ?? "").padStart(2, "0")}${health?.reason ? ` · ${health.reason}` : ""}`
                  : "No NVR channel bound to this camera"}
              </span>
            </>
          )}
        </div>
      )}

      {/* Signal state over the last good frame: never a silent freeze or blank tile */}
      {signal && (
        <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
          {minimal ? (
            <Icon name="sync" size={18} className="animate-spin text-video-warn" />
          ) : (
            <VideoChip tone="warn" className="h-6 px-2">
              <Icon name="sync" size={13} className="animate-spin" />
              {signal === "lost" ? "Signal lost · reconnecting" : "Connecting…"}
            </VideoChip>
          )}
        </div>
      )}

      {/* Top row: camera identity and link status */}
      {showHud && !glass && (
        <div className="relative z-30 flex items-start justify-between gap-1.5 p-1.5">
          <div className="flex items-center gap-1 min-w-0">
            <VideoChip className="min-w-0 max-w-full">
              <span className="truncate">
                {camera.id} · {camera.name}
              </span>
            </VideoChip>
            {camera.isFixed && (
              <VideoChip title="Fixed core surveillance post" className="shrink-0 px-1">
                <Icon name="push_pin" size={13} />
                <span className="sr-only">Pinned</span>
              </VideoChip>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {isLive ? (
              /* Live source: NVR channel + real connection status */
              <VideoChip
                tone={connTone}
                data-testid="card-stream"
                data-status={health?.status ?? "RECONNECTING"}
                title={`${stream?.nvrId} channel ${stream?.channel} · ${health?.status ?? "connecting"}${health?.reason ? ` — ${health.reason}` : ""}${health?.reconnects ? ` · ${health.reconnects} reconnect(s)` : ""}`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${dotCls}`} />
                CH{String(stream?.channel ?? "").padStart(2, "0")}
                {(focused || health?.status !== "CONNECTED") && ` · ${(health?.status ?? "CONNECTING").toLowerCase()}`}
              </VideoChip>
            ) : (
              <VideoChip className="text-video-ink/70">No channel</VideoChip>
            )}
          </div>
        </div>
      )}

      {/* Bottom row: zone, frame rate, detection mode, clock */}
      {showHud && !glass && (
        <div className="relative z-30 flex items-end justify-between gap-1.5 p-1.5">
          <VideoChip className="min-w-0">
            <span className="text-video-ink/80 truncate">{camera.zone}</span>
            <span className="opacity-40">·</span>
            {isLive ? (
              <span
                data-testid="card-fps"
                className="font-data tnum shrink-0"
                title={`Ingest ${health?.fps ?? 0} fps (AI processing rate)${playback?.fps != null ? ` · browser ${playback.fps.toFixed(1)} fps` : ""}${transport ? ` · ${transport}${rtcProfile ? ` ${rtcProfile}` : ""}` : ""}`}
              >
                {(health?.fps ?? 0).toFixed(1)} fps{transport ? ` · ${transport.toLowerCase()}` : ""}
              </span>
            ) : (
              <span className="text-video-ink/60">No feed</span>
            )}
          </VideoChip>

          <div className="flex items-center gap-1 shrink-0">
            {(showLive || showWebrtc) && pipeline ? (
              <VideoChip
                tone={
                  pipeline.state === "running" ? "ok" : pipeline.state === "error" ? "crit" : pipeline.state === "idle" ? "neutral" : "warn"
                }
                data-testid="card-mode"
                data-mode={pipeline.mode}
                data-state={pipeline.state}
                title={`Detection mode: ${pipeline.mode} · pipeline ${pipeline.state}${pipeline.error ? ` — ${pipeline.error}` : ""}`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    pipeline.state === "running"
                      ? "bg-video-ok animate-breathe"
                      : pipeline.state === "error"
                        ? "bg-video-crit"
                        : pipeline.state === "idle"
                          ? "bg-video-ink/50"
                          : "bg-video-warn animate-breathe"
                  }`}
                />
                {pipeline.state === "starting" || pipeline.state === "stopping" || pipeline.pending
                  ? `${MODE_SHORT[pipeline.mode]} ${pipeline.state === "stopping" ? "stopping" : "starting"}…`
                  : pipeline.state === "error"
                    ? `${MODE_SHORT[pipeline.mode]} ✕`
                    : MODE_SHORT[pipeline.mode]}
              </VideoChip>
            ) : showLive || showWebrtc ? (
              <VideoChip tone="ok" title="Live stream from the AI pipeline">
                <span className="w-1.5 h-1.5 rounded-full bg-video-ok animate-breathe" />
                Live
              </VideoChip>
            ) : null}
            <TileClock live={liveOnline} />
          </div>
        </div>
      )}


      {/* Liquid-glass HUD: same real data, Stitch layout */}
      {minimal && <TileLabel camera={camera} />}
      {showHud && glass && !minimal && (
        <GlassHud
          camera={camera}
          isLive={isLive}
          health={health}
          stream={stream}
          pipeline={pipeline}
          hasVideo={showLive || showWebrtc}
          linkLive={liveOnline}
          alerting={isBreached}
          connTone={connTone}
        />
      )}

      {/* HUD toggle for the focused view */}
      {focused && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setShowHud(!showHud);
          }}
          className="absolute top-10 right-2 z-40 h-6 px-2 inline-flex items-center gap-1.5 rounded-sm bg-video/80 text-caption text-video-ink hover:bg-video"
        >
          <Icon name="layers" size={13} />
          {showHud ? "Overlay on" : "Raw feed"}
        </button>
      )}
    </div>
  );
}, sameTile);


/** "CAM-01" → "CAM 01" as the Stitch tiles label it. */
const camLabel = (id: string) => id.replace("-", " ");

/** The only text on a wall tile: camera number and place name, one fixed spot on every tile. */
function TileLabel({ camera }: { camera: TacticalCamera }) {
  return (
    <div className="absolute top-2 left-2 right-2 z-30 pointer-events-none" data-testid="tile-label">
      <span className="inline-flex max-w-full items-center gap-1.5 px-1.5 py-0.5 rounded bg-black/65 border border-white/10 text-[10px] font-data">
        <span className="font-semibold text-accent-ink shrink-0">{camLabel(camera.id)}</span>
        <span className="text-white/25 shrink-0">·</span>
        <span className="font-medium text-white/90 truncate uppercase">{camera.name}</span>
      </span>
    </div>
  );
}

function GlassHud({
  camera, isLive, health, stream, pipeline, hasVideo, linkLive, alerting, connTone,
}: {
  camera: TacticalCamera;
  isLive: boolean;
  health?: StreamHealth;
  stream?: LiveStream;
  pipeline?: CameraPipeline;
  hasVideo: boolean;
  linkLive: boolean;
  alerting: boolean;
  connTone: "ok" | "warn" | "crit";
}) {
  const dot = { ok: "bg-ok", warn: "bg-warn", crit: "bg-crit" }[connTone];
  const status = health?.status ?? "CONNECTING";
  const pipeTone =
    pipeline?.state === "running" ? "ok" : pipeline?.state === "error" ? "crit" : pipeline?.state === "idle" ? "neutral" : "warn";
  return (
    <>
      {!hasVideo && <div className="cctv-grid absolute inset-0 opacity-40 pointer-events-none" />}

      {/* Top row: camera id (left) · alert / link state (right) */}
      <div className="relative z-30 flex items-start justify-between gap-1.5 p-2">
        <VideoChip glass className="font-semibold text-accent-ink border-accent/20">
          {camLabel(camera.id)}
        </VideoChip>
        <div className="flex items-center gap-1 shrink-0">
          {alerting && (
            <VideoChip glass tone="warn" className="bg-warn/20 border-warn/40 text-[9px]" data-testid="card-alert">
              <span className="w-1.5 h-1.5 rounded-full bg-warn glass-pulse" />
              INTRUSION ALERT
            </VideoChip>
          )}
          {isLive ? (
            hasVideo && linkLive && status === "CONNECTED" ? (
              <VideoChip
                glass
                tone="crit"
                data-testid="card-stream"
                data-status={status}
                title={`${stream?.nvrId} channel ${stream?.channel} · ${status.toLowerCase()}`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-crit glass-pulse" />
                LIVE
                <TileClock live glass />
              </VideoChip>
            ) : (
              <VideoChip
                glass
                tone={connTone}
                data-testid="card-stream"
                data-status={status}
                title={`${stream?.nvrId} channel ${stream?.channel} · ${status.toLowerCase()}${health?.reason ? ` — ${health.reason}` : ""}`}
                className={connTone === "crit" ? "bg-crit/20 border-crit/30 text-[9px]" : "text-[9px]"}
              >
                {status === "ERROR" || status === "DISCONNECTED" ? "DISCONNECTED" : status}
              </VideoChip>
            )
          ) : (
            <VideoChip glass className="text-ink-3">NO CHANNEL</VideoChip>
          )}
        </div>
      </div>

      {/* Bottom row: location (left) · pipeline mode and frame rate (right) */}
      <div className="relative z-30 flex items-end justify-between gap-1.5 p-2">
        <VideoChip glass className="min-w-0 text-white/90">
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${alerting ? "bg-warn" : dot}`} />
          <span className="truncate">{camera.name}</span>
        </VideoChip>
        <div className="flex items-center gap-1 shrink-0">
          {isLive && hasVideo && (
            <VideoChip glass className="text-ink-2 hidden sm:inline-flex" data-testid="card-fps">
              <span className="tnum">{(health?.fps ?? 0).toFixed(1)} fps</span>
            </VideoChip>
          )}
          {hasVideo && pipeline ? (
            <VideoChip
              glass
              tone={pipeTone}
              data-testid="card-mode"
              data-mode={pipeline.mode}
              data-state={pipeline.state}
              title={`Detection mode: ${pipeline.mode} · pipeline ${pipeline.state}${pipeline.error ? ` — ${pipeline.error}` : ""}`}
              className="text-[9px]"
            >
              {pipeline.state === "starting" || pipeline.state === "stopping" || pipeline.pending
                ? `${MODE_SHORT[pipeline.mode]} ${pipeline.state === "stopping" ? "stopping" : "starting"}…`
                : pipeline.state === "error"
                  ? `${MODE_SHORT[pipeline.mode]} ✕`
                  : MODE_SHORT[pipeline.mode]}
            </VideoChip>
          ) : isLive && !hasVideo ? (
            <VideoChip glass tone="crit" className="bg-crit/15 border-crit/30 text-[9px]">
              {status === "RECONNECTING" ? "RETRYING" : (health?.reason ?? "OFFLINE").toString().toUpperCase().slice(0, 18)}
            </VideoChip>
          ) : null}
        </div>
      </div>
    </>
  );
}

/** Only this span re-renders every second — not the whole tile. */
function TileClock({ live, glass }: { live: boolean; glass?: boolean }) {
  const clock = useClock();
  if (glass) return <span className="text-ink-3 font-data tnum">{live ? clock : "--:--:--"}</span>;
  return <VideoChip className="font-data tnum">{live ? clock : "--:--:--"}</VideoChip>;
}

/**
 * Tiles re-render only when their data changes. Callback props are compared
 * by presence, not identity: parents pass inline closures (e.g. "focus this
 * camera") whose behaviour does not change between renders.
 */
function sameTile(a: TacticalVideoFeedProps, b: TacticalVideoFeedProps): boolean {
  for (const k of Object.keys({ ...a, ...b }) as (keyof TacticalVideoFeedProps)[]) {
    if (k === "onClick" || k === "onPlayback") {
      if (!a[k] !== !b[k]) return false;
    } else if (a[k] !== b[k]) {
      return false;
    }
  }
  return true;
}
