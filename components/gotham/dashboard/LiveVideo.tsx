"use client";

import { useEffect, useRef } from "react";
import { startWhep, type PlaybackStats, type WebRtcProfile, type WhepSession } from "@/lib/live-video";

/** Reconnect delay (ms): 1 s, 2 s, 4 s … capped at 10 s, with jitter so a wall of tiles doesn't reconnect in lockstep. */
function retryDelay(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, 10000) * (0.75 + Math.random() * 0.5);
}

/**
 * Live WebRTC video for one camera. Tries `profiles` in order; reports the one
 * that plays (`onPlaying`) or `onFail` when none does. Reconnects by itself —
 * with backoff, keeping the last frame on screen — when the peer connection
 * drops, media stops arriving, or the picture freezes; `onLost` tells the
 * parent the signal is gone until the next `onPlaying`.
 */
export function LiveVideo({
  cameraId,
  profiles,
  onPlaying,
  onFail,
  onLost,
  onStats,
  className = "",
}: {
  cameraId: string;
  profiles: WebRtcProfile[];
  onPlaying?: (profile: WebRtcProfile) => void;
  onFail?: (error: string) => void;
  onLost?: () => void;
  onStats?: (s: PlaybackStats) => void;
  className?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const cb = useRef({ onPlaying, onFail, onLost, onStats });
  useEffect(() => {
    cb.current = { onPlaying, onFail, onLost, onStats };
  }, [onPlaying, onFail, onLost, onStats]);
  const key = profiles.join(",");

  useEffect(() => {
    const video = videoRef.current;
    const chain = key ? (key.split(",") as WebRtcProfile[]) : [];
    if (!video || chain.length === 0) return;
    let cancelled = false;
    let sess: WhepSession | null = null;
    let statsTimer: ReturnType<typeof setInterval> | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let downTimer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;                                  // consecutive failed (re)connects
    let playingSince = 0;

    const stop = () => {
      clearInterval(statsTimer);
      clearTimeout(downTimer);
      sess?.close();
      sess = null;
    };
    const restart = () => {
      if (cancelled) return;
      stop();
      // A session that played for a while was healthy: start the backoff over
      if (playingSince && Date.now() - playingSince > 15000) attempt = 0;
      playingSince = 0;
      cb.current.onLost?.();
      clearTimeout(retryTimer);
      retryTimer = setTimeout(() => run(0), retryDelay(attempt++));
    };
    const run = async (i: number, lastError = "") => {
      if (cancelled) return;
      if (i >= chain.length) {
        cb.current.onFail?.(lastError || "no playable WebRTC profile");
        return;
      }
      try {
        const s = await startWhep(cameraId, chain[i], video);
        if (cancelled) {
          s.close();
          return;
        }
        sess = s;
        playingSince = Date.now();
        cb.current.onPlaying?.(chain[i]);
        s.pc.onconnectionstatechange = () => {
          const st = s.pc.connectionState;
          if (st === "failed" || st === "closed") restart();
          // "disconnected" often heals by itself (ICE re-check); renegotiate only if it doesn't
          else if (st === "disconnected") downTimer = setTimeout(() => s.pc.connectionState !== "connected" && restart(), 4000);
          else clearTimeout(downTimer);
        };
        let stalled = 0;
        let frozen = 0;
        let lastBytes = -1;
        statsTimer = setInterval(async () => {
          const st = await s.stats().catch(() => null);
          if (!st || sess !== s) return;
          cb.current.onStats?.(st);
          // No media arriving for ~6 s: the stream is gone — renegotiate. Keyed on
          // received bytes, not decoded fps (hidden tabs may stop decoding).
          const bytes = st.bytesReceived ?? 0;
          stalled = bytes > lastBytes ? 0 : stalled + 1;
          lastBytes = bytes;
          // Bytes arrive but nothing is decoded (broken keyframe / decoder wedged): the
          // picture is frozen. Only judged while the tab is visible — hidden tabs don't decode.
          frozen = document.visibilityState === "visible" && bytes > 0 && st.fps === 0 ? frozen + 1 : 0;
          if (stalled >= 3 || frozen >= 5) restart();
        }, 2000);
      } catch (e) {
        run(i + 1, e instanceof Error ? e.message : String(e));
      }
    };
    // Spread the first connections of a full wall over ~0.6 s
    retryTimer = setTimeout(() => run(0), Math.random() * 600);
    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
      stop();
      video.srcObject = null;
    };
  }, [cameraId, key]);

  return (
    <video
      ref={videoRef}
      muted
      autoPlay
      playsInline
      data-testid="live-webrtc"
      className={`absolute inset-0 w-full h-full object-contain bg-black ${className}`}
    />
  );
}

type OverlayMeta = {
  detections?: { id: number; class: string; confidence: number; x: number; y: number; w: number; h: number; plate?: string }[];
  zone?: number[][] | null;
  zone_active?: boolean;
  line?: number[][] | null;
  alert_ids?: number[];
  analytics?: Record<string, unknown>;
};

const VEHICLES = new Set(["car", "truck", "bus", "motorcycle", "bicycle", "vehicle"]);

/**
 * Detections / zone / counting line of the camera's live pipeline, drawn over
 * the live video (WebRTC or MJPEG) from the metadata stream (coordinates are
 * native pixels of the AI source; `object-contain` letterboxing is reproduced
 * here). Redraws only when new metadata arrives or the tile resizes.
 */
export function AiOverlay({
  metadataUrl,
  width,
  height,
  labels = true,
}: {
  metadataUrl?: string;
  width?: number;
  height?: number;
  /** Draw text (class / id / plate labels, line counters). Off = boxes and zones only. */
  labels?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !metadataUrl || !width || !height) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let latest: OverlayMeta | null = null;
    let dirty = false;
    let raf = 0;
    const draw = () => {
      raf = 0;
      const dpr = window.devicePixelRatio || 1;
      const cw = canvas.clientWidth, ch = canvas.clientHeight;
      if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
        canvas.width = Math.round(cw * dpr);
        canvas.height = Math.round(ch * dpr);
        dirty = true;
      }
      if (!dirty || !latest) return;
      dirty = false;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cw, ch);
      const s = Math.min(cw / width, ch / height);
      const ox = (cw - width * s) / 2, oy = (ch - height * s) / 2;
      const px = (p: number[]) => [ox + p[0] * s, oy + p[1] * s];
      const m = latest;
      ctx.save();
      ctx.beginPath();
      ctx.rect(ox, oy, width * s, height * s);   // never draw onto the letterbox
      ctx.clip();
      if (m.zone && m.zone.length >= 3) {
        ctx.beginPath();
        m.zone.forEach((p, i) => (i ? ctx.lineTo(...(px(p) as [number, number])) : ctx.moveTo(...(px(p) as [number, number]))));
        ctx.closePath();
        ctx.fillStyle = m.zone_active ? "rgba(255,107,100,0.26)" : "rgba(255,107,100,0.10)";
        ctx.fill();
        ctx.strokeStyle = m.zone_active ? "#ff6b64" : "rgba(255,156,151,0.85)";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      if (m.line && m.line.length >= 2) {
        ctx.beginPath();
        m.line.forEach((p, i) => (i ? ctx.lineTo(...(px(p) as [number, number])) : ctx.moveTo(...(px(p) as [number, number]))));
        ctx.strokeStyle = "#f2a65a";
        ctx.lineWidth = 2;
        ctx.stroke();
        const a = m.analytics ?? {};
        if (labels && "total" in a) {
          const [lx, ly] = px(m.line[0]);
          ctx.font = "600 12px ui-monospace, monospace";
          ctx.fillStyle = "#f2a65a";
          ctx.fillText(`IN ${a.in ?? 0}  OUT ${a.out ?? 0}  TOTAL ${a.total ?? 0}`, lx + 4, ly - 6);
        }
      }
      const alerts = new Set(m.alert_ids ?? []);
      ctx.font = "11px ui-monospace, monospace";
      for (const d of m.detections ?? []) {
        const [x, y] = px([d.x, d.y]);
        const color = alerts.has(d.id) ? "#ff6b64" : VEHICLES.has(d.class) ? "#f2a65a" : "#f3efe6";
        ctx.strokeStyle = color;
        ctx.lineWidth = alerts.has(d.id) ? 2.5 : 1.5;
        ctx.strokeRect(x, y, d.w * s, d.h * s);
        if (!labels) continue;
        const label = `${d.class} #${d.id}${d.plate ? ` ${d.plate}` : ""}`;
        const tw = ctx.measureText(label).width + 6;
        ctx.fillStyle = "rgba(20,19,17,0.8)";
        ctx.fillRect(x, Math.max(0, y - 14), tw, 14);
        ctx.fillStyle = d.plate ? "#f3c969" : color;
        ctx.fillText(label, x + 3, Math.max(11, y - 3));
      }
      ctx.restore();
    };
    const schedule = () => {
      dirty = true;
      if (!raf) raf = requestAnimationFrame(draw);
    };
    const es = new EventSource(metadataUrl);
    es.onmessage = (e) => {
      try {
        latest = JSON.parse(e.data);
        schedule();
      } catch {
        /* ignore malformed event */
      }
    };
    const resize = new ResizeObserver(schedule);
    resize.observe(canvas);

    return () => {
      es.close();
      resize.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [metadataUrl, width, height, labels]);

  return <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none z-[5]" />;
}
