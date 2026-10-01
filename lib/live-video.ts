"use client";

/**
 * Live camera playback over WebRTC (WHEP) through the command-center backend.
 *
 * The browser only ever calls /api/live/{cameraId}/whep — the backend maps the
 * camera to its media-server path; NVR addresses and credentials never reach
 * the client. Media then flows browser ↔ media server over ICE (UDP).
 */

export type WebRtcProfile = "sub" | "main" | "main_h264";

export type PlaybackStats = {
  /** Frames per second actually decoded by the browser */
  fps: number | null;
  /** WebRTC jitter-buffer delay (ms) — the playback latency added by the browser */
  jitterMs: number | null;
  packetsLost: number | null;
  framesDropped: number | null;
  /** Media bytes received so far (liveness, independent of rendering) */
  bytesReceived: number | null;
  codec: string | null;
  width: number | null;
  height: number | null;
};

/** Can this browser decode `codec` (H264 / H265) over WebRTC? */
export function browserDecodes(codec?: string | null): boolean {
  if (!codec || typeof RTCRtpReceiver === "undefined" || !RTCRtpReceiver.getCapabilities) return false;
  const want = `video/${codec.toLowerCase()}`;
  return (RTCRtpReceiver.getCapabilities("video")?.codecs ?? []).some((c) => c.mimeType.toLowerCase() === want);
}

/**
 * WebRTC profiles to try, best first. The stream is passed through untouched
 * whenever the browser decodes its codec; `main_h264` (GPU transcode, on
 * demand) only for the focused view of browsers that can't.
 */
export function profileChain(codec: string | null | undefined, available: string[], focused: boolean): WebRtcProfile[] {
  const out: WebRtcProfile[] = [];
  const direct = browserDecodes(codec);
  if (focused) {
    if (direct && available.includes("main")) out.push("main");
    if (available.includes("main_h264") && browserDecodes("H264")) out.push("main_h264");
    if (direct && available.includes("sub")) out.push("sub");
  } else if (direct && available.includes("sub")) {
    out.push("sub");
  }
  return out;
}

function iceGathered(pc: RTCPeerConnection, timeoutMs: number): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(done, timeoutMs);
    function done() {
      clearTimeout(t);
      pc.removeEventListener("icegatheringstatechange", check);
      resolve();
    }
    function check() {
      if (pc.iceGatheringState === "complete") done();
    }
    pc.addEventListener("icegatheringstatechange", check);
  });
}

export type WhepSession = {
  pc: RTCPeerConnection;
  close: () => void;
  stats: () => Promise<PlaybackStats>;
};

export async function startWhep(cameraId: string, profile: WebRtcProfile, video: HTMLVideoElement): Promise<WhepSession> {
  const pc = new RTCPeerConnection({ bundlePolicy: "max-bundle" });
  pc.addTransceiver("video", { direction: "recvonly" });
  pc.ontrack = (e) => {
    video.srcObject = e.streams[0] ?? new MediaStream([e.track]);
    video.play().catch(() => {
      /* autoplay of a muted stream is allowed; ignore transient aborts */
    });
  };
  let session = "";
  const base = `/api/live/${encodeURIComponent(cameraId)}/whep?profile=${profile}`;
  try {
    await pc.setLocalDescription(await pc.createOffer());
    await iceGathered(pc, 1500);                      // non-trickle WHEP: send all candidates at once
    const res = await fetch(base, {
      method: "POST",
      headers: { "Content-Type": "application/sdp" },
      body: pc.localDescription?.sdp ?? "",
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error ?? `WHEP ${res.status}`);
    }
    session = res.headers.get("X-Session-Id") ?? "";
    await pc.setRemoteDescription({ type: "answer", sdp: await res.text() });
  } catch (e) {
    pc.close();
    throw e;
  }

  let prev: { t: number; frames: number } | null = null;
  return {
    pc,
    close: () => {
      pc.close();
      if (session) {
        fetch(`${base}&session=${encodeURIComponent(session)}`, { method: "DELETE", keepalive: true }).catch(() => {});
      }
    },
    stats: async () => {
      const out: PlaybackStats = {
        fps: null, jitterMs: null, packetsLost: null, framesDropped: null, bytesReceived: null,
        codec: null, width: null, height: null,
      };
      const report = await pc.getStats();
      report.forEach((s) => {
        if (s.type === "inbound-rtp" && s.kind === "video") {
          const frames = s.framesDecoded ?? 0;
          const now = s.timestamp ?? performance.now();
          out.fps = s.framesPerSecond ?? (prev && now > prev.t ? ((frames - prev.frames) * 1000) / (now - prev.t) : null);
          prev = { t: now, frames };
          if (s.jitterBufferEmittedCount) out.jitterMs = (s.jitterBufferDelay / s.jitterBufferEmittedCount) * 1000;
          out.packetsLost = s.packetsLost ?? null;
          out.framesDropped = s.framesDropped ?? null;
          out.bytesReceived = s.bytesReceived ?? null;
          out.width = s.frameWidth ?? null;
          out.height = s.frameHeight ?? null;
          const codec = s.codecId ? report.get(s.codecId) : null;
          out.codec = codec?.mimeType?.replace("video/", "") ?? null;
        }
      });
      return out;
    },
  };
}
