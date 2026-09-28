import { intRange, mulberry32, pick, range, type Rng } from "./rng";

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
  analytics?: any;
};

export const CAMERAS: Camera[] = [
  { id: "CAM-01", name: "MAIN GATE", zone: "HQ COMPLEX", online: true, aiEnabled: true, ip: "10.142.12.101", model: "AXIS Q6135-LE", firmware: "11.8.42", resolution: "3840×2160", fps: 60, sensitivity: 72, recording: true, uptime: 99.98, analytics: { type: "traffic_count", line: [[20, 1700], [1920, 1200], [3820, 1400]] } },
  { id: "CAM-02", name: "PERIMETER EAST", zone: "PERIMETER EAST", online: true, aiEnabled: true, ip: "10.142.12.103", model: "AXIS P3245-LV", firmware: "10.2.1", resolution: "1920×1080", fps: 30, sensitivity: 64, recording: true, uptime: 99.91 },
  { id: "CAM-03", name: "CHECKPOINT ALPHA", zone: "HQ COMPLEX", online: true, aiEnabled: true, ip: "10.142.14.107", model: "BOSCH AUTODOME 7000i", firmware: "7.82.01", resolution: "3840×2160", fps: 30, sensitivity: 80, recording: true, uptime: 99.94 },
  { id: "CAM-04", name: "PERIMETER SOUTH", zone: "DEPOT", online: true, aiEnabled: true, ip: "10.142.20.109", model: "FLIR FC-644 ID", firmware: "4.2.1", resolution: "1920×1080", fps: 30, sensitivity: 88, recording: true, uptime: 98.12 },
  { id: "CAM-05", name: "ARMOURY SECTOR 4", zone: "DEPOT", online: true, aiEnabled: true, ip: "10.142.20.112", model: "PELCO SPECTRA PRO", firmware: "3.14.9", resolution: "1920×1080", fps: 60, sensitivity: 91, recording: true, uptime: 99.99, analytics: { type: "intrusion_zone", zone: [[350, 80], [1050, 80], [1050, 620], [350, 620]], buffer_px: 15, required_consecutive_frames: 8 } },
  { id: "CAM-06", name: "VEHICLE DEPOT", zone: "PERIMETER WEST", online: true, aiEnabled: true, ip: "10.142.16.115", model: "BOSCH MIC IP 7100i", firmware: "7.80.00", resolution: "1920×1080", fps: 30, sensitivity: 70, recording: true, uptime: 74.2 },
  { id: "CAM-07", name: "HQ ENTRANCE", zone: "HQ COMPLEX", online: true, aiEnabled: true, ip: "10.142.12.116", model: "AXIS P3245-LV", firmware: "10.2.1", resolution: "1920×1080", fps: 30, sensitivity: 58, recording: true, uptime: 99.91 },
  { id: "CAM-08", name: "MOTOR POOL", zone: "MOTOR POOL", online: true, aiEnabled: true, ip: "10.142.30.122", model: "HANWHA XNV-8080R", firmware: "2.01.0", resolution: "1920×1080", fps: 30, sensitivity: 61, recording: true, uptime: 99.85 },
  { id: "CAM-09", name: "PERIMETER W", zone: "PERIMETER WEST", online: true, aiEnabled: true, ip: "10.142.16.115", model: "BOSCH MIC IP 7100i", firmware: "7.80.00", resolution: "1920×1080", fps: 30, sensitivity: 70, recording: true, uptime: 74.2 },
  { id: "CAM-10", name: "AIRSTRIP ACCESS", zone: "HQ COMPLEX", online: false, ip: "10.142.12.125", model: "AXIS Q6135-LE", firmware: "11.8.42", resolution: "1920×1080", fps: 30, sensitivity: 75, recording: false, uptime: 0 },
  { id: "CAM-11", name: "WATCHTOWER 3", zone: "PERIMETER EAST", online: false, ip: "10.142.14.130", model: "FLIR FC-644 ID", firmware: "4.2.1", resolution: "1920×1080", fps: 30, sensitivity: 82, recording: false, uptime: 0 },
  { id: "CAM-12", name: "AMMUNITION BUNKERS", zone: "DEPOT", online: false, ip: "10.142.20.135", model: "BOSCH MIC IP 7100i", firmware: "7.80.00", resolution: "1920×1080", fps: 30, sensitivity: 90, recording: false, uptime: 0 },
];

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

export type AlertClass = "person" | "vehicle" | "animal";
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

/** 55% animal, 30% person, 15% vehicle — what a rural cantonment perimeter actually sees. */
function drawClass(rng: Rng, cameraId: string): AlertClass {
  if (cameraId === "CAM-05") return "person"; // Only people in Armoury Sector 4
  
  const r = rng();
  if (r < 0.55) return "animal";
  if (r < 0.85) return "person";
  return "vehicle";
}

/** Severity is a function of what was seen and where — never random on its own. */
export function severityFor(cls: AlertClass, zone: Zone, cameraId: string): Severity {
  if (cls === "animal") return "low";
  if (cls === "person") {
    if (cameraId === "CAM-12" || zone === "DEPOT" || cameraId === "CAM-05") return "high";
    if (zone === "PERIMETER EAST" || zone === "PERIMETER WEST") return "med";
    return "med";
  }
  if (zone === "DEPOT") return "high";
  return zone === "MOTOR POOL" ? "low" : "med";
}

const CONF: Record<AlertClass, [number, number]> = {
  person: [88, 99.6],
  vehicle: [84, 98.2],
  animal: [72, 94],
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
  const cls = drawClass(rng, cam.id);
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
    // Older alerts are mostly resolved; the newest few are still open.
    if (i > 2) {
      const r = rng();
      if (r < 0.72) {
        a.status = "ack";
        a.ackBy = pick(rng, ["A. VERMA", "R. SINGH", "M. KUMAR", "P. NAIR"]);
        a.ackAt = a.t + intRange(rng, 20, 240);
      } else if (r < 0.8) {
        a.status = "dispatched";
        a.ackBy = "A. VERMA";
        a.ackAt = a.t + intRange(rng, 15, 90);
      }
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
