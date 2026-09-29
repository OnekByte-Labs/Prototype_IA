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
  seedAlerts,
  secondsOfDay,
  type Alert,
  type AnalyticsConfig,
  type Camera,
  type Zone,
  ZONES,
} from "@/lib/gotham/model";
import { useToast } from "./Toast";
import useSWR, { useSWRConfig } from "swr";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

type ConsoleState = {
  alerts: Alert[];
  unacked: number;
  ack: (id: string) => void;
  ackMany: (ids: string[]) => void;
  dispatch: (id: string) => void;
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
  /** Currently focused camera ID on Camera Wall, or null for default grid */
  focusedCameraId: string | null;
  /** Focus a specific camera full-panel on the Camera Wall, or null to return to grid */
  focusCamera: (id: string | null) => void;
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

export function ConsoleProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  // Seeded backlog: identical on the server and on the client.
  const [alerts, setAlerts] = useState<Alert[]>(() => seedAlerts());
  const [muted, setMuted] = useState(false);
  const [liveOn, setLiveOn] = useState(true);
  const [degraded] = useState<string[]>([]);
  // The generator effect must not restart when the operator toggles mute, so the
  // current value is mirrored into a ref from an effect and read at fire time.
  const mutedRef = useRef(muted);
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  /* ---- live alert feed: disabled fake generation, now relies on addAlert ---- */
  const addAlert = useCallback((a: Alert) => {
    setAlerts((prev) => {
      // Prevent duplicates if the video scrubs backwards
      if (prev.some(p => p.id === a.id)) return prev;
      if (a.severity === "high" && !mutedRef.current) beep();
      return [a, ...prev];
    });
  }, []);

  /* ---- health simulation removed ---- */

type ApiCamera = Camera;

  // Fetch live camera statuses from our API proxy
  const { data: apiCameras } = useSWR<ApiCamera[]>('/api/cameras', fetcher, {
    refreshInterval: 10000,
    fallbackData: [],
  });

  const ack = useCallback(
    (id: string) => {
      setAlerts((prev) =>
        prev.map((a) =>
          a.id === id && a.status === "new"
            ? { ...a, status: "ack", ackBy: "A. VERMA", ackAt: secondsOfDay(new Date()) }
            : a,
        ),
      );
      toast(`${id} acknowledged`, "ok");
    },
    [toast],
  );

  const ackMany = useCallback(
    (ids: string[]) => {
      const set = new Set(ids);
      let n = 0;
      setAlerts((prev) =>
        prev.map((a) => {
          if (!set.has(a.id) || a.status !== "new") return a;
          n++;
          return { ...a, status: "ack", ackBy: "A. VERMA", ackAt: secondsOfDay(new Date()) };
        }),
      );
      toast(`${ids.length} alerts acknowledged`, "ok");
      return n;
    },
    [toast],
  );

  const dispatch = useCallback(
    (id: string) => {
      setAlerts((prev) =>
        prev.map((a) =>
          a.id === id
            ? { ...a, status: "dispatched", ackBy: "A. VERMA", ackAt: secondsOfDay(new Date()) }
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

  const { mutate } = useSWRConfig();

  const [aiOverrides, setAiOverrides] = useState<Record<string, boolean>>({});
  const [analyticsOverrides, setAnalyticsOverrides] = useState<Record<string, AnalyticsConfig | null>>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("gotham_analytics_overrides");
        if (saved) return JSON.parse(saved);
      } catch {}
    }
    return {};
  });

  const toggleAi = useCallback(async (id: string, enabled: boolean) => {
    setAiOverrides((prev) => ({ ...prev, [id]: enabled }));
    try {
      const res = await fetch(`/api/cameras/${id}/ai`, {
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
    } catch {
      setAiOverrides((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      toast(`Failed to toggle AI for ${id}`, "err");
    }
  }, [toast, mutate]);

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
      const res = await fetch(`/api/cameras/${id}/zone`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        toast(`Boundary updated live for ${id}`, "ok");
        mutate('/api/cameras');
        return true;
      } else {
        toast(`Failed to update boundary for ${id}`, "err");
        return false;
      }
    } catch {
      toast(`Failed to update boundary for ${id}`, "err");
      return false;
    }
  }, [toast, mutate]);

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

  const [focusedCameraId, setFocusedCameraId] = useState<string | null>(null);

  const focusCamera = useCallback((id: string | null) => {
    setFocusedCameraId(id);
  }, []);

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
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem("gotham_analytics_overrides", JSON.stringify(analyticsOverrides));
      } catch {}
    }
  }, [analyticsOverrides]);

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
      const payload: Record<string, unknown> = { type };
      if (type === 'traffic_count') {
        payload.line = defaultLine;
      } else if (type === 'intrusion_zone') {
        payload.zone = defaultZone;
        payload.buffer_px = 15;
        payload.required_consecutive_frames = 8;
      }
      const res = await fetch(`/api/cameras/${id}/zone`, {
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
  }, [toast, mutate, analyticsOverrides]);

  const cameras = useMemo(() => {
    return CAMERAS.map((c) => {
      // Find the corresponding camera from the API to get live 'online' state and 'hlsUrl'
      const liveData = apiCameras?.find((apiCam) => apiCam.id === c.id);
      
      const isDegraded = degraded.includes(c.id);
      const isUserDisabled = disabledCameraIds.includes(c.id);

      const aiEnabled = aiOverrides[c.id] !== undefined
        ? aiOverrides[c.id]
        : (liveData?.aiEnabled ?? c.aiEnabled ?? true);

      const analyticsOverride = analyticsOverrides[c.id];
      const analytics = analyticsOverride !== undefined
        ? (analyticsOverride ?? undefined)
        : (liveData?.analytics ?? c.analytics);
      
      return { 
        ...c, 
        name: liveData?.name || c.name,
        zone: ((ZONES as readonly string[]).includes(liveData?.zone || "") ? liveData?.zone : c.zone) as Zone,
        sector: liveData?.sector || c.sector,
        ip: liveData?.ip || c.ip,
        model: liveData?.model || c.model,
        firmware: liveData?.firmware || c.firmware,
        resolution: liveData?.resolution || c.resolution,
        fps: liveData?.fps || c.fps,
        uptime: liveData?.uptime ?? c.uptime,
        sensitivity: liveData?.sensitivity ?? c.sensitivity,
        mgrs: liveData?.mgrs || c.mgrs,
        elevationM: liveData?.elevationM ?? c.elevationM,
        dataset: liveData?.dataset || c.dataset,
        aiWorkload: liveData?.aiWorkload || c.aiWorkload,
        online: (isDegraded || isUserDisabled) ? false : (liveData ? liveData.online : c.online), 
        recording: (isDegraded || isUserDisabled) ? false : (liveData?.recording ?? c.recording),
        hlsUrl: liveData?.hlsUrl,
        rtspUrl: liveData?.rtspUrl,
        webrtcUrl: liveData?.webrtcUrl,
        videoUrl: liveData?.videoUrl || c.videoUrl || `/api/videos/${c.id}`,
        mjpegUrl: isUserDisabled ? undefined : liveData?.mjpegUrl,
        metadataUrl: isUserDisabled ? undefined : (liveData?.metadataUrl || c.metadataUrl),
        precomputedUrl: liveData?.precomputedUrl || c.precomputedUrl || `/api/precomputed/${c.id}`,
        aiEnabled,
        analytics,
      };
    });
  }, [degraded, apiCameras, disabledCameraIds, aiOverrides, analyticsOverrides]);

  const unacked = useMemo(() => alerts.filter((a) => a.status === "new").length, [alerts]);

  const value = useMemo<ConsoleState>(
    () => ({
      alerts,
      unacked,
      ack,
      ackMany,
      dispatch,
      muted,
      toggleMute,
      liveOn,
      toggleLive,
      cameras,
      degraded,
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
      focusedCameraId,
      focusCamera,
    }),
    [
      alerts,
      unacked,
      ack,
      ackMany,
      dispatch,
      muted,
      toggleMute,
      liveOn,
      toggleLive,
      cameras,
      degraded,
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
      focusedCameraId,
      focusCamera,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export { OPERATOR };
