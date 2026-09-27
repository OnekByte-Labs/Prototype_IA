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
  seedAlerts,
  secondsOfDay,
  type Alert,
  type Camera,
} from "@/lib/gotham/model";
import { intRange, mulberry32 } from "@/lib/gotham/rng";
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
  const [degraded, setDegraded] = useState<string[]>([]);

  const rng = useRef(mulberry32(0x9e4f));
  // The generator effect must not restart when the operator toggles mute, so the
  // current value is mirrored into a ref from an effect and read at fire time.
  const mutedRef = useRef(muted);
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  /* ---- live alert feed: one new event every 15–25s ---- */
  useEffect(() => {
    if (!liveOn) return;
    let timer: ReturnType<typeof setTimeout>;

    const schedule = () => {
      timer = setTimeout(
        () => {
          const a = nextAlert(rng.current, new Date());
          setAlerts((prev) => [a, ...prev]);
          if (a.severity === "high" && !mutedRef.current) beep();
          schedule();
        },
        intRange(rng.current, 15, 25) * 1000,
      );
    };

    schedule();
    return () => clearTimeout(timer);
  }, [liveOn]);

  /* ---- health simulation removed ---- */

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
}

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

  const toggleAi = useCallback(async (id: string, enabled: boolean) => {
    try {
      const res = await fetch(`/api/cameras/${id}/ai`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (res.ok) {
        toast(`AI ${enabled ? 'enabled' : 'disabled'} for ${id}`);
        // Optimistically update or trigger re-fetch
        mutate('/api/cameras');
      } else {
        toast(`Failed to toggle AI for ${id}`, "err");
      }
    } catch (e) {
      toast(`Failed to toggle AI for ${id}`, "err");
    }
  }, [toast, mutate]);

  const cameras = useMemo(() => {
    return CAMERAS.map((c) => {
      // Find the corresponding camera from the API to get live 'online' state and 'hlsUrl'
      const liveData = apiCameras?.find((apiCam) => apiCam.id === c.id);
      
      const isDegraded = degraded.includes(c.id);
      
      return { 
        ...c, 
        // Use the real name from the live data if available, otherwise fallback to the mock name
        name: liveData?.name ? liveData.name : c.name,
        // If the API knows about this camera, use its online status, otherwise fallback to mock
        online: isDegraded ? false : (liveData ? liveData.online : c.online), 
        recording: isDegraded ? false : c.recording,
        // Inject the stream URLs dynamically into the Gotham camera model
        hlsUrl: liveData?.hlsUrl,
        rtspUrl: liveData?.rtspUrl,
        webrtcUrl: liveData?.webrtcUrl,
        mjpegUrl: liveData?.mjpegUrl,
        metadataUrl: liveData?.metadataUrl,
        aiEnabled: liveData?.aiEnabled,
        analytics: (liveData as any)?.analytics,
      };
    });
  }, [degraded, apiCameras]);

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
    }),
    [alerts, unacked, ack, ackMany, dispatch, muted, toggleMute, liveOn, toggleLive, cameras, degraded, toggleAi],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export { OPERATOR };
