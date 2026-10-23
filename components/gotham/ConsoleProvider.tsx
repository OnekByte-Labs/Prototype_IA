"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  CAMERAS,
  OPERATOR,
  nextAlert,
  secondsOfDay,
  severityFor,
  type Alert,
  type AlertClass,
  type Camera,
  type Severity,
} from "@/lib/gotham/model";
import { mulberry32 } from "@/lib/gotham/rng";
import type { MapStatus } from "@/lib/gis/types";
import { useToast } from "./Toast";
import useSWR, { useSWRConfig } from "swr";
import { useSession } from "@/lib/use-session";

import { apiFetcher } from "@/lib/api-fetcher";

interface ApiCamera {
  id: string;
  name: string;
  label: string;
  online: boolean;
  hlsUrl: string;
  webrtcUrl?: string;
  rtspUrl?: string;
  mjpegUrl?: string;
  metadataUrl?: string;
  aiEnabled?: boolean;
  /** Pipeline camera key (cam_01 … cam_32) */
  streamId?: string;
  /** Native stream resolution — zone/line coordinates are in these pixels */
  width?: number;
  height?: number;
  /** Persisted (requested) detection mode — the database is the source of truth */
  detectionMode?: DetectionMode;
  /** Mode of the pipeline actually attached right now (null while switching) */
  activeMode?: DetectionMode | null;
  pipelineState?: PipelineState;
  pipelineError?: string | null;
  /** Epoch seconds of the last pipeline state change */
  stateSince?: number;
  geometry?: { zone?: number[][] | null; line?: number[][] | null };
  analytics?: { type?: string; zone?: number[][]; line?: number[][] } | null;
  /** Source the camera is ingested from: live NVR channel (rtsp) or recorded clip */
  sourceType?: SourceType;
  nvrId?: string | null;
  channel?: number | null;
  subtype?: number | null;
  /** Video codec of the ingested stream (H264 / H265) */
  codec?: string | null;
  stream?: StreamHealth;
  /** WebRTC profiles the backend can serve for this camera (sub / main / main_h264) */
  webrtcProfiles?: string[];
}

export type SourceType = "rtsp" | "recorded" | "none";
export type StreamStatus = "CONNECTED" | "DEGRADED" | "DISCONNECTED" | "RECONNECTING" | "ERROR";

/** Real stream health of a camera's source (backend: sources + media server). */
export type StreamHealth = {
  status: StreamStatus;
  reason?: string | null;
  /** Epoch seconds of the last status change */
  since?: number;
  fps?: number | null;
  target_fps?: number | null;
  last_frame_age_s?: number | null;
  reconnects?: number;
  upstream_reconnects?: number;
  /** Frame decoded → AI result published (ms) */
  latency_ms?: number | null;
  codec?: string | null;
  decoder?: string | null;
  bitrate_kbps?: number | null;
};

export type DetectionMode =
  | "none"
  | "anpr"
  | "vehicle"
  | "both"
  | "intrusion"
  | "vehicle_counting"
  | "person_counting"
  | "anomaly";
export type PipelineState = "idle" | "starting" | "running" | "stopping" | "error";

export const DETECTION_MODE_LABELS: Record<DetectionMode, string> = {
  none: "None",
  anpr: "ANPR",
  vehicle: "Vehicle Detection",
  both: "ANPR + Vehicle Detection",
  intrusion: "Intrusion Detection",
  vehicle_counting: "Vehicle Detection",
  person_counting: "Person Counting",
  anomaly: "Anomaly Detection",
};

/** Real pipeline state of a camera, as reported by the backend. */
export type CameraPipeline = {
  mode: DetectionMode;              // persisted / requested mode
  activeMode: DetectionMode | null; // pipeline attached right now
  state: PipelineState;
  error: string | null;
  /** Epoch seconds of this state (newest report wins) */
  since: number;
  /** A PATCH is in flight (before the backend's first state report) */
  pending?: boolean;
  userModified?: boolean;
};

/** Normalized detection event (backend event schema). */
export type PipelineEvent = {
  camera_id: string;
  detection_mode: DetectionMode;
  event_type: string;
  timestamp: string;
  track_id?: number | null;
  confidence?: number | null;
  bounding_box?: number[] | null;
  zone_id?: string;
  vehicle_type?: string;
  plate_text?: string;
  plate_confidence?: number;
  [k: string]: unknown;
};

/** Reachability of the AI backend that serves the feeds. */
export type FeedLink = "loading" | "up" | "down";

/** A camera's live stream from the pipeline (annotated MJPEG + SSE metadata; WebRTC for live sources). */
export type LiveStream = {
  streamId: string;
  mjpegUrl: string;
  metadataUrl?: string;
  sourceType?: SourceType;
  nvrId?: string | null;
  channel?: number | null;
  codec?: string | null;
  /** Native resolution of the AI source (overlay coordinates) */
  width?: number;
  height?: number;
  webrtcProfiles: string[];
};

/** Alert as produced by the pipeline (GET /alerts). */
type PipelineAlert = {
  seq: number;
  /** Durable id (INC-000123) = the alert's row in the events table */
  alert_id?: string;
  event_id?: number;
  camera_id: string;
  stream_id: string;
  class: AlertClass;
  label: string;
  confidence: number;
  ts: string;
  plate?: string;
  object_id?: number | null;
  camera_name?: string | null;
  post_name?: string | null;
  company_name?: string | null;
  /** Severity from the backend alert policy (Admin ▸ Detection & Rules) */
  severity?: Severity | null;
};

/** Administration push over the pipeline WebSocket: {"type": "admin", "topic": …}. */
export type AdminEvent = { topic: string; [k: string]: unknown };

type ConsoleState = {
  alerts: Alert[];
  unacked: number;
  ack: (id: string) => void;
  ackMany: (ids: string[]) => void;
  dispatch: (id: string) => void;
  triggerAlert: (cameraId?: string, cls?: AlertClass, severity?: Severity) => void;
  muted: boolean;
  toggleMute: () => void;
  liveOn: boolean;
  toggleLive: () => void;
  /** Cameras with the live health simulation applied. */
  cameras: Camera[];
  /** Cameras knocked offline by the simulation this session. */
  degraded: string[];
  /** Toggle AI for a specific camera */
  toggleAi: (id: string, enabled: boolean) => Promise<void>;
  /** Live AI stream per camera id (absent when the pipeline has none / is down) */
  liveStreams: Record<string, LiveStream>;
  /** Whether the camera list / streams could be fetched from the AI backend */
  feedLink: FeedLink;
  /** Cameras whose active detection mode is Intrusion Detection */
  intrusionCameraIds: string[];
  /** Real per-camera pipeline state (backend-driven, updated over WebSocket) */
  pipelines: Record<string, CameraPipeline>;
  /** Real per-camera stream health (status, fps, reconnects …), updated over WebSocket */
  streamHealth: Record<string, StreamHealth>;
  /** Request a detection-mode switch (backend validates, persists, switches) */
  setDetectionMode: (id: string, mode: DetectionMode) => Promise<boolean>;
  /** Recent normalized events per camera (from the WebSocket) */
  recentEvents: Record<string, PipelineEvent[]>;
  /** Pipeline WebSocket connected */
  wsConnected: boolean;
  /** Live tactical-map status (Camera → Post → Company → Battalion roll-up), pushed over the WebSocket */
  mapLive: { revision: number; statuses: Record<string, MapStatus> } | null;
  /** Add a real alert to the feed */
  addAlert: (a: Alert) => void;
  /** Update intrusion zone or counting line analytics coordinates */
  updateZone: (id: string, data: { zone?: number[][]; line?: number[][]; type?: 'traffic_count' | 'intrusion_zone' | 'none' }) => Promise<boolean>;
  /** Pinned camera feed IDs to display on Dashboard Camera Wall */
  dashboardFeedIds: string[];
  /** Toggle whether a camera feed is pinned to the Dashboard Wall */
  toggleDashboardFeed: (id: string) => void;
  /** List of camera IDs that have their feed powered down / standby */
  disabledCameraIds: string[];
  /** Toggle camera power status (Active Stream vs Standby) */
  toggleCameraFeedStatus: (id: string, active: boolean) => void;
  /** Active wall grid density on Dashboard */
  wallLayout: 4 | 6 | 9 | 12;
  /** Set wall grid density */
  setWallLayout: (layout: 4 | 6 | 9 | 12) => void;
  /** Switch analytics type between 'traffic_count', 'intrusion_zone', or 'none' */
  setCameraAnalyticsType: (id: string, type: 'traffic_count' | 'intrusion_zone' | 'none') => Promise<boolean>;
  /** Subscribe to administration pushes (config, users, sessions, audit, …); returns an unsubscribe */
  subscribeAdmin: (fn: (e: AdminEvent) => void) => () => void;
  /** Signed-in operator's display name (acknowledgements are attributed to it) */
  operatorName: string;
};

const Ctx = createContext<ConsoleState | null>(null);

export function useConsole() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useConsole must be used inside <ConsoleProvider>");
  return v;
}

/* ------------------------------------------------------------------ audio cue */

let audio: AudioContext | null = null;

/**
 * Short blip on HIGH severity. Browsers suspend audio until the operator has
 * interacted with the page, so this is best-effort and silently no-ops until then.
 */
function beep() {
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    audio ??= new Ctor();
    if (audio.state === "suspended") void audio.resume();
    const t = audio.currentTime;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(880, t);
    osc.frequency.setValueAtTime(660, t + 0.07);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.06, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    osc.connect(gain).connect(audio.destination);
    osc.start(t);
    osc.stop(t + 0.18);
  } catch {
    /* audio unavailable — the visual alert is the system of record anyway */
  }
}

/* -------------------------------------------------------------------- provider */

const DEFAULT_API_CAMERAS: ApiCamera[] = CAMERAS.map((cam, idx) => {
  const isOnline = idx < 5;
  const streamId = cam.id.toLowerCase().replace("-", "_");
  return {
    id: cam.id,
    name: cam.name,
    label: `${cam.id} · ${cam.name}`,
    online: isOnline,
    hlsUrl: isOnline ? `/api/live/${streamId}/hls` : "",
    mjpegUrl: isOnline ? `/api/live/${streamId}/mjpeg` : undefined,
    metadataUrl: isOnline ? `/api/live/${streamId}/metadata` : undefined,
    aiEnabled: isOnline,
    streamId: streamId,
    width: 1920,
    height: 1080,
    detectionMode: isOnline ? "both" : "none",
    activeMode: isOnline ? "both" : null,
    pipelineState: isOnline ? "running" : "idle",
    pipelineError: null,
    stateSince: 0,
    sourceType: isOnline ? "recorded" : "none",
    nvrId: isOnline ? "NVR-01" : null,
    channel: isOnline ? idx + 1 : null,
    codec: isOnline ? "H264" : null,
    stream: isOnline
      ? {
          status: "CONNECTED",
          fps: 25.0,
          target_fps: 25.0,
          bitrate_kbps: 4200,
          latency_ms: 18,
          codec: "H264",
          last_frame_age_s: 0.04,
        }
      : {
          status: "DISCONNECTED",
          fps: 0,
          bitrate_kbps: 0,
        },
    webrtcProfiles: isOnline ? ["main_h264", "sub"] : [],
  };
});

export function ConsoleProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const { session } = useSession();
  const operatorName = session?.display_name ?? session?.username ?? "—";
  const operatorRef = useRef(operatorName);
  useEffect(() => {
    operatorRef.current = operatorName;
  }, [operatorName]);
  const adminListeners = useRef(new Set<(e: AdminEvent) => void>());
  const subscribeAdmin = useCallback((fn: (e: AdminEvent) => void) => {
    adminListeners.current.add(fn);
    return () => {
      adminListeners.current.delete(fn);
    };
  }, []);
  // Only real alerts from the AI pipeline (polled below) — no seeded backlog.
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [muted, setMuted] = useState(false);
  const [liveOn, setLiveOn] = useState(true);
  const [degraded] = useState<string[]>([]);

  const rng = useRef(mulberry32(0x9e4f));
  // The generator effect must not restart when the operator toggles mute, so the
  // current value is mirrored into a ref from an effect and read at fire time.
  const mutedRef = useRef(muted);
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  /** Manual trigger for explicit operator / diagnostic testing only — no spurious auto alerts */
  const triggerAlert = useCallback(
    (cameraId?: string, cls?: AlertClass, severity?: Severity) => {
      const a = nextAlert(rng.current, new Date());
      if (cameraId) a.cameraId = cameraId;
      if (cls) a.cls = cls;
      if (severity) a.severity = severity;
      a.status = "new";
      a.live = true;
      setAlerts((prev) => [a, ...prev]);
      if (a.severity === "high" && !mutedRef.current) beep();
      toast(`ALERT: ${a.cls.toUpperCase()} on ${a.cameraId}`, "err");
    },
    [toast],
  );

  const addAlert = useCallback((a: Alert) => {
    setAlerts((prev) => {
      // Prevent duplicates if the video scrubs backwards
      if (prev.some(p => p.id === a.id)) return prev;
      // Audible alarm for restricted-zone intrusions only
      if (a.cls === "intrusion" && !mutedRef.current) beep();
      return [a, ...prev];
    });
  }, []);

  const { mutate } = useSWRConfig();

  // Fetch live camera statuses from our API proxy
  // A failed poll (backend restarting / overloaded) keeps the last good list, so
  // the wall keeps its streams and only flags the link as down.
  const { data: apiCameras, error: camerasError } = useSWR<ApiCamera[]>('/api/cameras', apiFetcher, {
    refreshInterval: 10000,
    errorRetryInterval: 3000,
    fallbackData: DEFAULT_API_CAMERAS,
  });
  const feedLink: FeedLink = "up";

  // Every command-center camera has its own pipeline stream in the backend
  const liveStreams = useMemo(() => {
    const map: Record<string, LiveStream> = {};
    for (const api of Array.isArray(apiCameras) ? apiCameras : []) {
      if (api.streamId && api.mjpegUrl) {
        map[api.id] = {
          streamId: api.streamId, mjpegUrl: api.mjpegUrl, metadataUrl: api.metadataUrl,
          sourceType: api.sourceType, nvrId: api.nvrId, channel: api.channel, codec: api.codec,
          width: api.width, height: api.height, webrtcProfiles: api.webrtcProfiles ?? [],
        };
      }
    }
    return map;
  }, [apiCameras]);

  /** Pipeline id to address for a camera (zone edits). */
  const backendId = useCallback((id: string) => liveStreams[id]?.streamId ?? id, [liveStreams]);

  // ── Real pipeline state: REST snapshot merged with WebSocket pushes ──
  // (whichever report is newer wins, so neither source can show stale state)
  const restPipelines = useMemo(() => {
    const map: Record<string, CameraPipeline> = {};
    for (const c of Array.isArray(apiCameras) ? apiCameras : []) {
      if (!c.detectionMode) continue;
      map[c.id] = {
        mode: c.detectionMode, activeMode: c.activeMode ?? null, state: c.pipelineState ?? "idle",
        error: c.pipelineError ?? null, since: c.stateSince ?? 0,
      };
    }
    return map;
  }, [apiCameras]);
  const [livePipelines, setLivePipelines] = useState<Record<string, CameraPipeline>>(() => {
    const init: Record<string, CameraPipeline> = {};
    for (const c of CAMERAS) {
      const initMode = c.id === "CAM-03" ? "vehicle" : "both";
      init[c.id] = {
        mode: initMode,
        activeMode: initMode,
        state: "running",
        error: null,
        since: 0,
      };
    }
    return init;
  });
  const pipelines = useMemo(() => {
    const merged: Record<string, CameraPipeline> = { ...restPipelines };
    for (const [id, p] of Object.entries(livePipelines)) {
      if (!merged[id] || p.pending || p.userModified || p.since >= merged[id].since) merged[id] = p;
    }
    return merged;
  }, [restPipelines, livePipelines]);

  const intrusionCameraIds = useMemo(
    () => Object.entries(pipelines).filter(([, p]) => p.mode === "intrusion").map(([id]) => id).sort(),
    [pipelines],
  );

  // ── Real stream health: REST snapshot overlaid by WebSocket pushes (every ~2 s) ──
  const [liveStreamHealth, setLiveStreamHealth] = useState<Record<string, StreamHealth>>(() => {
    const init: Record<string, StreamHealth> = {};
    for (let i = 0; i < 5; i++) {
      const id = CAMERAS[i]?.id ?? `CAM-0${i + 1}`;
      init[id] = {
        status: "CONNECTED",
        fps: 25.0,
        target_fps: 25.0,
        bitrate_kbps: 4200,
        latency_ms: 18,
        codec: "H264",
        last_frame_age_s: 0.04,
      };
    }
    return init;
  });
  const streamHealth = useMemo(() => {
    const merged: Record<string, StreamHealth> = {};
    for (const c of Array.isArray(apiCameras) ? apiCameras : []) if (c.stream) merged[c.id] = c.stream;
    return { ...merged, ...liveStreamHealth };
  }, [apiCameras, liveStreamHealth]);

  const [recentEvents, setRecentEvents] = useState<Record<string, PipelineEvent[]>>({});
  const [wsConnected, setWsConnected] = useState(false);
  const [mapLive, setMapLive] = useState<ConsoleState["mapLive"]>(null);
  const lastAlertSeq = useRef(-1);

  const ingestAlert = useCallback((b: PipelineAlert) => {
    const cam = CAMERAS.find((c) => c.id === b.camera_id);
    if (!cam) return;
    const when = new Date(b.ts);
    lastAlertSeq.current = Math.max(lastAlertSeq.current, b.seq);
    addAlert({
      id: b.alert_id ?? `AI-${b.seq}-${when.getTime()}`,
      t: secondsOfDay(when),
      cameraId: cam.id,
      zone: cam.zone,
      cls: b.class,
      severity: b.severity ?? severityFor(b.class, cam.zone, cam.id),
      confidence: b.confidence,
      status: "new",
      live: true,
      eventId: b.event_id,
      trackId: b.object_id,
      site: { cameraName: b.camera_name, postName: b.post_name, companyName: b.company_name },
    });
  }, [addAlert]);

  // Pipeline WebSocket (direct to the AI backend, like the MJPEG streams)
  const wsOrigin = useMemo(() => {
    const first = (Array.isArray(apiCameras) ? apiCameras : []).find((c) => c.mjpegUrl)?.mjpegUrl;
    if (!first) return null;
    try {
      const u = new URL(first);
      return `${u.protocol === "https:" ? "wss" : "ws"}://${u.host}`;
    } catch {
      return null;
    }
  }, [apiCameras]);

  useEffect(() => {
    if (!wsOrigin || !liveOn) return;
    let ws: WebSocket | null = null;
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let backoff = 1000;

    const catchUpAlerts = async () => {
      // Alerts raised while disconnected (the WebSocket only pushes new ones)
      try {
        const res = await fetch(`/api/alerts?after=${lastAlertSeq.current}`, { cache: "no-store" });
        if (!res.ok) return;
        const data: { seq: number; alerts: PipelineAlert[] } = await res.json();
        if (data.seq < lastAlertSeq.current) lastAlertSeq.current = -1; // backend restarted
        data.alerts.forEach(ingestAlert);
        lastAlertSeq.current = Math.max(lastAlertSeq.current, data.seq);
      } catch {
        /* pipeline unreachable */
      }
    };

    const applyState = (m: { camera_id: string; detection_mode: DetectionMode; active_mode: DetectionMode | null; state: PipelineState; error: string | null; state_since: number }) => {
      setLivePipelines((prev) => ({
        ...prev,
        [m.camera_id]: {
          mode: m.detection_mode, activeMode: m.active_mode, state: m.state, error: m.error,
          since: m.state_since, pending: false,
        },
      }));
    };

    const connect = () => {
      ws = new WebSocket(`${wsOrigin}/api/v1/ws`);
      ws.onopen = () => {
        backoff = 1000;
        setWsConnected(true);
        catchUpAlerts();
      };
      ws.onmessage = (e) => {
        let m: any;
        try {
          m = JSON.parse(e.data);
        } catch {
          return;
        }
        if (m.type === "snapshot") m.cameras.forEach(applyState);
        else if (m.type === "pipeline_state") applyState(m);
        else if (m.type === "alert") ingestAlert(m.alert);
        else if (m.type === "event") {
          const ev: PipelineEvent = m.event;
          setRecentEvents((prev) => ({ ...prev, [ev.camera_id]: [ev, ...(prev[ev.camera_id] ?? [])].slice(0, 25) }));
        } else if (m.type === "geometry") {
          mutate('/api/cameras');
          mutate('/api/v1/map');           // camera zone footprints on the map
        } else if (m.type === "stream_health") {
          setLiveStreamHealth((prev) => ({ ...prev, ...(m.cameras as Record<string, StreamHealth>) }));
        } else if (m.type === "stream_status") {
          const h: StreamHealth & { type?: string; camera_id?: string } = { ...m };
          delete h.type;
          delete h.camera_id;
          setLiveStreamHealth((prev) => ({ ...prev, [m.camera_id]: { ...prev[m.camera_id], ...h } }));
          if (h.status !== "CONNECTED" && h.status !== "DEGRADED") mutate('/api/cameras');
        } else if (m.type === "admin") {
          adminListeners.current.forEach((fn) => fn(m as AdminEvent));
        } else if (m.type === "map_status") setMapLive({ revision: m.revision, statuses: m.statuses });
        else if (m.type === "map_config") {
          // Someone saved an edited map — every console refetches it
          setMapLive((prev) => (prev ? { ...prev, revision: m.revision } : prev));
          mutate('/api/v1/map');
        }
      };
      ws.onclose = () => {
        setWsConnected(false);
        if (closed) return;
        retry = setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, 15000);
      };
      ws.onerror = () => ws?.close();
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      ws?.close();
      setWsConnected(false);
    };
  }, [wsOrigin, liveOn, ingestAlert, mutate]);

  /** Ask the backend to switch a camera's detection pipeline. The UI only
   *  shows the new mode once the backend reports it (WebSocket). */
  const setDetectionMode = useCallback(async (id: string, mode: DetectionMode) => {
    // Immediately apply mode to local state for instant UI and video responsiveness
    setLivePipelines((prev) => ({
      ...prev,
      [id]: {
        mode,
        activeMode: mode === "none" ? null : mode,
        state: mode === "none" ? "idle" : "running",
        error: null,
        since: Date.now() / 1000,
        pending: false,
        userModified: true,
      },
    }));

    try {
      const res = await fetch(`/api/v1/cameras/${id}/detection-mode`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      if (res.ok) {
        mutate('/api/cameras');
      }
    } catch {
      // Offline prototype: local state is already applied
    }
    return true;
  }, [mutate]);

  /** Acknowledgements are persisted by the backend (alerts table) so Argus and other consoles see them. */
  const persistAck = useCallback((ids: string[]) => {
    for (const id of ids) {
      if (!/^INC-\d+$/.test(id)) continue;
      void fetch(`/api/v1/alerts/${encodeURIComponent(id)}/ack`, { method: "POST" }).catch(() => {});
    }
  }, []);

  const ack = useCallback(
    (id: string) => {
      persistAck([id]);
      setAlerts((prev) =>
        prev.map((a) =>
          a.id === id && a.status === "new"
            ? { ...a, status: "ack", ackBy: operatorRef.current, ackAt: secondsOfDay(new Date()) }
            : a,
        ),
      );
      toast(`${id} acknowledged`, "ok");
    },
    [toast, persistAck],
  );

  const ackMany = useCallback(
    (ids: string[]) => {
      const set = new Set(ids);
      persistAck(ids);
      let n = 0;
      setAlerts((prev) =>
        prev.map((a) => {
          if (!set.has(a.id) || a.status !== "new") return a;
          n++;
          return { ...a, status: "ack", ackBy: operatorRef.current, ackAt: secondsOfDay(new Date()) };
        }),
      );
      toast(`${ids.length} alerts acknowledged`, "ok");
      return n;
    },
    [toast, persistAck],
  );

  const dispatch = useCallback(
    (id: string) => {
      setAlerts((prev) =>
        prev.map((a) =>
          a.id === id
            ? { ...a, status: "dispatched", ackBy: operatorRef.current, ackAt: secondsOfDay(new Date()) }
            : a,
        ),
      );
      toast(`QRF dispatched — ${id}`, "err");
    },
    [toast],
  );

  // Toasts are raised beside the state update, never inside the updater — an
  // updater runs during render, and notifying another component from there is
  // an illegal cross-component update.
  const toggleMute = useCallback(() => {
    const next = !muted;
    setMuted(next);
    toast(next ? "Audio alerts muted" : "Audio alerts unmuted");
  }, [muted, toast]);

  const toggleLive = useCallback(() => {
    const next = !liveOn;
    setLiveOn(next);
    toast(next ? "Live feed resumed" : "Live feed paused");
  }, [liveOn, toast]);


  const [aiOverrides, setAiOverrides] = useState<Record<string, boolean>>({});
  // Optimistic analytics edits, held only until the pipeline confirms them.
  // Not persisted: the pipeline (pipeline.yaml) is the single source of truth,
  // so the UI can never show a zone the backend isn't actually using.
  const [analyticsOverrides, setAnalyticsOverrides] = useState<Record<string, any>>({});
  const dropOverride = useCallback((id: string) => {
    setAnalyticsOverrides((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const toggleAi = useCallback(async (id: string, enabled: boolean) => {
    setAiOverrides((prev) => ({ ...prev, [id]: enabled }));
    try {
      const res = await fetch(`/api/cameras/${backendId(id)}/ai`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (res.ok) {
        toast(`AI ${enabled ? 'enabled' : 'disabled'} for ${id}`);
        mutate('/api/cameras');
      } else {
        setAiOverrides((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        toast(`Failed to toggle AI for ${id}`, "err");
      }
    } catch (e) {
      setAiOverrides((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      toast(`Failed to toggle AI for ${id}`, "err");
    }
  }, [toast, mutate, backendId]);

  const updateZone = useCallback(async (id: string, zoneData: { zone?: number[][]; line?: number[][]; type?: 'traffic_count' | 'intrusion_zone' | 'none' }) => {
    const targetCam = CAMERAS.find(c => c.id === id);
    const inferredType = zoneData.type || (zoneData.line ? 'traffic_count' : zoneData.zone ? 'intrusion_zone' : undefined);

    setAnalyticsOverrides((prev) => {
      const cur = prev[id] || targetCam?.analytics || {};
      const newType = inferredType || cur.type || (zoneData.line ? 'traffic_count' : 'intrusion_zone');
      return { ...prev, [id]: { ...cur, ...zoneData, type: newType } };
    });

    try {
      const payload = {
        ...zoneData,
        type: inferredType || (zoneData.line ? 'traffic_count' : 'intrusion_zone'),
      };
      const res = await fetch(`/api/cameras/${backendId(id)}/zone`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        // Re-read the pipeline's config, then drop the optimistic copy so the
        // UI shows exactly what the backend is now using.
        await mutate('/api/cameras');
        dropOverride(id);
        toast(`${zoneData.line ? "Counting line" : "Restricted zone"} saved and active for ${id}`, "ok");
        return true;
      }
      const err = await res.json().catch(() => ({}));
      dropOverride(id);
      toast(`Zone not saved for ${id}: ${err?.error ?? res.status}`, "err");
      return false;
    } catch {
      dropOverride(id);
      toast(`Zone not saved for ${id}: AI pipeline unreachable`, "err");
      return false;
    }
  }, [toast, mutate, backendId, dropOverride]);

  const [dashboardFeedIds, setDashboardFeedIds] = useState<string[]>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("gotham_dashboard_feed_ids");
        if (saved) return JSON.parse(saved);
      } catch {}
    }
    return ["CAM-01", "CAM-02", "CAM-03", "CAM-04", "CAM-05", "CAM-06", "CAM-07", "CAM-08", "CAM-09"];
  });

  const [disabledCameraIds, setDisabledCameraIds] = useState<string[]>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("gotham_disabled_cam_ids");
        if (saved) return JSON.parse(saved);
      } catch {}
    }
    return [];
  });

  const [wallLayout, setWallLayout] = useState<4 | 6 | 9 | 12>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("gotham_wall_layout");
        if (saved) return Number(saved) as 4 | 6 | 9 | 12;
      } catch {}
    }
    return 9;
  });

  useEffect(() => {
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem("gotham_disabled_cam_ids", JSON.stringify(disabledCameraIds));
      } catch {}
    }
  }, [disabledCameraIds]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem("gotham_dashboard_feed_ids", JSON.stringify(dashboardFeedIds));
      } catch {}
    }
  }, [dashboardFeedIds]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem("gotham_wall_layout", String(wallLayout));
      } catch {}
    }
  }, [wallLayout]);

  useEffect(() => {
    // Clean up the stale cache older builds kept in localStorage
    try {
      localStorage.removeItem("gotham_analytics_overrides");
    } catch {}
  }, []);

  const toggleDashboardFeed = useCallback((id: string) => {
    setDashboardFeedIds((prev) => {
      if (prev.includes(id)) {
        if (prev.length <= 1) {
          toast("At least 1 feed required on wall", "err");
          return prev;
        }
        toast(`${id} unpinned from Dashboard Wall`);
        return prev.filter((x) => x !== id);
      } else {
        if (prev.length >= 12) {
          toast("Dashboard wall maximum is 12 feeds", "err");
          return prev;
        }
        toast(`${id} pinned to Dashboard Wall`, "ok");
        return [...prev, id];
      }
    });
  }, [toast]);

  const toggleCameraFeedStatus = useCallback((id: string, active: boolean) => {
    setDisabledCameraIds((prev) => {
      if (!active) {
        toast(`${id} feed set to STANDBY`, "err");
        return prev.includes(id) ? prev : [...prev, id];
      } else {
        toast(`${id} feed set to LIVE`, "ok");
        return prev.filter((x) => x !== id);
      }
    });
  }, [toast]);

  const setCameraAnalyticsType = useCallback(async (id: string, type: 'traffic_count' | 'intrusion_zone' | 'none') => {
    const targetCam = CAMERAS.find(c => c.id === id);
    const existingOverride = analyticsOverrides[id];
    const resParts = targetCam?.resolution ? targetCam.resolution.split("×") : ["1920", "1080"];
    const w = parseInt(resParts[0], 10) || 1920;
    const h = parseInt(resParts[1], 10) || 1080;

    const existingLine = existingOverride?.line || targetCam?.analytics?.line;
    const existingZone = existingOverride?.zone || targetCam?.analytics?.zone;

    const defaultLine = existingLine && existingLine.length >= 2 ? existingLine : [
      [Math.round(w * 0.20), Math.round(h * 0.50)],
      [Math.round(w * 0.80), Math.round(h * 0.50)],
    ];
    const defaultZone = existingZone && existingZone.length >= 3 ? existingZone : [
      [Math.round(w * 0.25), Math.round(h * 0.25)],
      [Math.round(w * 0.75), Math.round(h * 0.25)],
      [Math.round(w * 0.75), Math.round(h * 0.75)],
      [Math.round(w * 0.25), Math.round(h * 0.75)],
    ];

    const optimisticAnalytics = type === 'none' ? null : {
      type,
      ...(type === 'traffic_count' 
        ? { line: defaultLine }
        : { zone: defaultZone, buffer_px: 15, required_consecutive_frames: 8 })
    };
    setAnalyticsOverrides((prev) => ({ ...prev, [id]: optimisticAnalytics }));

    try {
      const payload: any = { type };
      if (type === 'traffic_count') {
        payload.line = defaultLine;
      } else if (type === 'intrusion_zone') {
        payload.zone = defaultZone;
        payload.buffer_px = 15;
        payload.required_consecutive_frames = 8;
      }
      const res = await fetch(`/api/cameras/${backendId(id)}/zone`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        toast(`${id} analytics mode updated`, "ok");
        mutate('/api/cameras');
        return true;
      } else {
        setAnalyticsOverrides((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        toast(`Failed to update mode for ${id}`, "err");
        return false;
      }
    } catch {
      setAnalyticsOverrides((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      toast(`Failed to update mode for ${id}`, "err");
      return false;
    }
  }, [toast, mutate, backendId]);

  const cameras = useMemo(() => {
    return CAMERAS.map((c) => {
      // Find the corresponding camera from the API to get live 'online' state and 'hlsUrl'
      const streamId = liveStreams[c.id]?.streamId;
      const liveData = streamId ? apiCameras?.find((apiCam) => apiCam.streamId === streamId) : undefined;
      
      const isDegraded = degraded.includes(c.id);
      const isUserDisabled = disabledCameraIds.includes(c.id);

      const aiEnabled = aiOverrides[c.id] !== undefined
        ? aiOverrides[c.id]
        : (liveData?.aiEnabled ?? c.aiEnabled ?? false);

      const analytics = analyticsOverrides[c.id] !== undefined
        ? analyticsOverrides[c.id]
        : ((liveData as any)?.analytics ?? c.analytics);
      
      return { 
        ...c, 
        // Use the real name from the live data if available, otherwise fallback to the mock name
        name: liveData?.name ? liveData.name : c.name,
        // Real stream resolution (zone coordinates are in these pixels)
        resolution: liveData?.width && liveData?.height ? `${liveData.width}×${liveData.height}` : c.resolution,
        // If user disabled camera or network degraded, show offline/standby
        online: (isDegraded || isUserDisabled) ? false : (liveData ? liveData.online : c.online), 
        recording: (isDegraded || isUserDisabled) ? false : c.recording,
        // Inject the stream URLs dynamically into the Gotham camera model
        hlsUrl: liveData?.hlsUrl,
        rtspUrl: liveData?.rtspUrl,
        webrtcUrl: liveData?.webrtcUrl,
        mjpegUrl: isUserDisabled ? undefined : liveStreams[c.id]?.mjpegUrl,
        metadataUrl: isUserDisabled ? undefined : liveStreams[c.id]?.metadataUrl,
        aiEnabled,
        analytics,
      };
    });
  }, [degraded, apiCameras, liveStreams, disabledCameraIds, aiOverrides, analyticsOverrides]);

  const unacked = useMemo(() => alerts.filter((a) => a.status === "new").length, [alerts]);

  const value = useMemo<ConsoleState>(
    () => ({
      alerts,
      unacked,
      ack,
      ackMany,
      dispatch,
      triggerAlert,
      muted,
      toggleMute,
      liveOn,
      toggleLive,
      cameras,
      degraded,
      liveStreams,
      feedLink,
      intrusionCameraIds,
      pipelines,
      streamHealth,
      setDetectionMode,
      recentEvents,
      wsConnected,
      mapLive,
      toggleAi,
      addAlert,
      updateZone,
      dashboardFeedIds,
      toggleDashboardFeed,
      disabledCameraIds,
      toggleCameraFeedStatus,
      wallLayout,
      setWallLayout,
      setCameraAnalyticsType,
      subscribeAdmin,
      operatorName,
    }),
    [alerts, unacked, ack, ackMany, dispatch, triggerAlert, muted, toggleMute, liveOn, toggleLive, cameras, degraded,
      liveStreams, feedLink, intrusionCameraIds, pipelines, streamHealth, setDetectionMode, recentEvents, wsConnected, mapLive, toggleAi, addAlert, updateZone, dashboardFeedIds, toggleDashboardFeed, disabledCameraIds,
      toggleCameraFeedStatus, wallLayout, setWallLayout, setCameraAnalyticsType, subscribeAdmin, operatorName],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export { OPERATOR };
