import { intRange, mulberry32, pick, range, type Rng } from "./rng";
import { TACTICAL_CAMERAS } from "@/lib/datasets/dataset-definitions";

export const ZONES = [
  "HQ COMPLEX",
  "PERIMETER EAST",
  "PERIMETER WEST",
  "DEPOT",
  "MOTOR POOL",
] as const;

export type Zone = (typeof ZONES)[number];

export type Camera = {
  id: string;
  name: string;
  zone: Zone;
  online: boolean;
  ip: string;
  model: string;
  firmware: string;
  resolution: string;
  fps: number;
  /** Detection sensitivity, 0–100. */
  sensitivity: number;
  recording: boolean;
  uptime: number;
  hlsUrl?: string;
  rtspUrl?: string;
  webrtcUrl?: string;
  mjpegUrl?: string;
  metadataUrl?: string;
  aiEnabled?: boolean;
  analytics?: Record<string, unknown>;
};

export const CAMERAS: Camera[] = TACTICAL_CAMERAS.map((tc) => ({
  id: tc.id,
  name: tc.name,
  zone: (ZONES.includes(tc.zone as Zone) ? tc.zone : "HQ COMPLEX") as Zone,
  online: tc.online,
  ip: tc.ip,
  model: tc.model,
  firmware: "11.8.42",
  resolution: tc.resolution,
  fps: tc.fps,
  sensitivity: tc.aiEnabled ? 85 : 60,
  recording: tc.recording,
  uptime: tc.uptimePct,
}));

export const cameraById = (id: string) => CAMERAS.find((c) => c.id === id);
export const cameraLabel = (c: Camera) => `${c.id} · ${c.name}`;

export type Nvr = {
  id: string;
  name: string;
  zone: Zone;
  cams: number;
  camsOk: number;
  usedTb: number;
  totalTb: number;
  tempC: number;
  state: "ok" | "warn" | "fault";
};

export const NVRS: Nvr[] = [
  { id: "NVR-01", name: "HQ CORE", zone: "HQ COMPLEX", cams: 16, camsOk: 16, usedTb: 34.2, totalTb: 48, tempC: 42, state: "ok" },
  { id: "NVR-02", name: "PERIMETER E", zone: "PERIMETER EAST", cams: 12, camsOk: 12, usedTb: 21.8, totalTb: 32, tempC: 44, state: "ok" },
  { id: "NVR-03", name: "PERIMETER W", zone: "PERIMETER WEST", cams: 12, camsOk: 11, usedTb: 29.4, totalTb: 32, tempC: 49, state: "fault" },
  { id: "NVR-04", name: "DEPOT & MOTOR POOL", zone: "DEPOT", cams: 8, camsOk: 8, usedTb: 17.2, totalTb: 32, tempC: 40, state: "ok" },
];

export type AlertClass = "intrusion" | "person" | "vehicle" | "animal" | "anomaly";
export type Severity = "high" | "med" | "low";
export type AlertStatus = "new" | "ack" | "dispatched";

export type Alert = {
  id: string;
  /** Seconds since midnight — deterministic across server and client. */
  t: number;
  cameraId: string;
  zone: Zone;
  cls: AlertClass;
  severity: Severity;
  confidence: number;
  status: AlertStatus;
  ackBy?: string;
  ackAt?: number;
  /** Set on alerts pushed by the live generator so the row can animate in. */
  live?: boolean;
  /** Pipeline alerts only: id of the backing row in the backend events table. */
  eventId?: number;
  /** Pipeline alerts only: camera / post / company names from the backend database. */
  site?: { cameraName?: string | null; postName?: string | null; companyName?: string | null };
  trackId?: number | null;
};

export const OPERATOR = "CAPT. A. VERMA";

const pad = (n: number) => String(n).padStart(2, "0");

/** 02:14:07 — always mono, always 24h. */
export function hms(t: number) {
  const s = ((t % 86400) + 86400) % 86400;
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(Math.floor(s % 60))}`;
}

export const hm = (t: number) => hms(t).slice(0, 5);

export const secondsOfDay = (d: Date) =>
  d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();

/** 35% intrusion, 30% person, 25% vehicle, 10% animal. */
function drawClass(rng: Rng): AlertClass {
  const r = rng();
  if (r < 0.35) return "intrusion";
  if (r < 0.65) return "person";
  if (r < 0.90) return "vehicle";
  return "animal";
}

/** Severity is a function of what was seen and where — never random on its own. */
export function severityFor(cls: AlertClass, zone: Zone, cameraId: string): Severity {
  if (cls === "intrusion") return "high";
  if (cls === "anomaly") return "med";
  if (cls === "animal") return "low";
  if (cls === "person") {
    if (cameraId === "CAM-12" || zone === "DEPOT" || zone === "PERIMETER EAST" || zone === "PERIMETER WEST") return "high";
    return "med";
  }
  if (zone === "DEPOT" || zone === "PERIMETER EAST" || zone === "PERIMETER WEST") return "high";
  return zone === "MOTOR POOL" ? "low" : "med";
}

const CONF: Record<AlertClass, [number, number]> = {
  anomaly: [60.0, 95.0],
  intrusion: [92.0, 99.8],
  person: [88.0, 99.6],
  vehicle: [84.0, 98.2],
  animal: [72.0, 94.0],
};

/**
 * Incident numbering. The backlog counts DOWN from SEED_START (newest first) and
 * live alerts count UP from SEED_START, so the two streams can never mint the
 * same id — a collision would give two rows the same React key and silently
 * corrupt filtering, sorting and selection.
 */
const SEED_START = 400;
let liveSeq = SEED_START;

export function alertId(n: number) {
  // ALT-<MMDD of the exercise date>-<sequence>
  return `ALT-0919-${String(n).padStart(4, "0")}`;
}

function makeAlert(rng: Rng, t: number, n: number, live?: boolean): Alert {
  // Only CAM-05 has implemented behavior analytics for now
  const cam = CAMERAS.find((c) => c.id === "CAM-05")!;
  const cls = drawClass(rng);
  const [lo, hi] = CONF[cls];
  return {
    id: alertId(n),
    t,
    cameraId: cam.id,
    zone: cam.zone,
    cls,
    severity: severityFor(cls, cam.zone, cam.id),
    confidence: Math.round(range(rng, lo, hi) * 10) / 10,
    status: "new",
    live,
  };
}

/**
 * Deterministic backlog, newest first. Times run backwards from a fixed
 * exercise clock so server and client agree byte for byte.
 */
export function seedAlerts(count = 48, seed = 0x15cc): Alert[] {
  const rng = mulberry32(seed);
  const out: Alert[] = [];
  let t = 14 * 3600 + 32 * 60 + 8;
  let n = SEED_START;
  liveSeq = SEED_START;
  for (let i = 0; i < count; i++) {
    const a = makeAlert(rng, t, n--);
    // Historical event log: all past events are logged and resolved
    const r = rng();
    if (r < 0.85) {
      a.status = "ack";
      a.ackBy = pick(rng, ["A. VERMA", "R. SINGH", "M. KUMAR", "P. NAIR"]);
      a.ackAt = a.t + intRange(rng, 20, 240);
    } else {
      a.status = "dispatched";
      a.ackBy = "A. VERMA";
      a.ackAt = a.t + intRange(rng, 15, 90);
    }
    out.push(a);
    t -= intRange(rng, 90, 1500);
  }
  return out;
}

/** Next live alert, stamped at the wall clock. */
export function nextAlert(rng: Rng, now: Date): Alert {
  return makeAlert(rng, secondsOfDay(now), ++liveSeq, true);
}

export const CLASS_LABEL: Record<AlertClass, string> = {
  anomaly: "Anomaly",
  intrusion: "Intrusion",
  person: "Person",
  vehicle: "Vehicle",
  animal: "Animal",
};

export const SEVERITY_LABEL: Record<Severity, string> = {
  high: "High",
  med: "Med",
  low: "Low",
};

export const STATUS_LABEL: Record<AlertStatus, string> = {
  new: "Unack",
  ack: "Acknowledged",
  dispatched: "Dispatched",
};
