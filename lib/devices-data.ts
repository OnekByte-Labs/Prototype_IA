// Mock data copied verbatim from the Stitch screen "ISCC Device Health & Hardware Diagnostics".

export const devicesHeader = {
  title: "ISCC // SYS-DIAGNOSTICS",
  secure: "SIPRNET SECURE",
  clockDate: "18 SEP 2026",
  links: [
    { label: "CAMERAS", active: true },
    { label: "NVRS" },
    { label: "TERMINALS" },
    { label: "TELEMETRY" },
    { label: "TOPOLOGY" },
  ],
  unacknowledged: "3 UNACKNOWLEDGED",
  operator: "CAPT. A. VERMA",
  operatorClearance: "IC-78492X · TS-SCI",
  faultReport: "FAULT REPORT",
};

export const railTop = { defcon: "2", state: "NOMINAL" };

export const railTabs = [
  { label: "Feeds", icon: "videocam" },
  { label: "Diag", icon: "memory", active: true },
  { label: "Devices", icon: "router" },
  { label: "Topology", icon: "hub" },
  { label: "Audit", icon: "verified_user" },
];

export const tabs = {
  cameras: { label: "CAMERAS (48)", badge: "ACTIVE" },
  nvrs: { label: "NVRS & RECORDERS (8)", badge: "1 FAULT" },
  terminals: { label: "TERMINALS & WORKSTATIONS (12)", badge: "NOMINAL" },
  searchPlaceholder: "Filter by IP / ID / MAC / Zone...",
  zones: [
    "ALL ZONES (4)",
    "HQ SECURE CORE",
    "PERIMETER EAST",
    "PERIMETER WEST",
    "VEHICLE DEPOT & AMMO",
  ],
  repoll: "RE-POLL ALL INTERFACES",
  export: "EXPORT CSV",
};

export const kpis = {
  total: { label: "TOTAL SENSORS REGISTERED", value: "48", note: "Edge Nodes / Optical / IR Arrays" },
  online: { label: "ONLINE / NOMINAL", value: "45", of: "/ 48", note: "93.75% AVAILABILITY (30D)" },
  offline: {
    label: "CRITICAL OFFLINE",
    value: "2",
    note: "CAM-15 Perim W · CAM-28 Depot N",
    title: "CAM-15 Perimeter W, CAM-28 Depot North",
  },
  degraded: { label: "DEGRADED / FAULT", value: "1", note: "CAM-09 Stream OK / No Rec" },
};

export const matrix = {
  title: "TACTICAL EDGE SENSOR MATRIX",
  showing: "SHOWING 11 PRIORITIZED TELEMETRY CHANNELS",
  legend: [
    { label: "45 OK", tone: "ok" },
    { label: "1 DEG", tone: "warn" },
    { label: "2 ERR", tone: "err" },
  ] as { label: string; tone: Tone }[],
};

export type Tone = "ok" | "warn" | "err";

export type CameraRow = {
  state: Tone;
  id: string;
  name: string;
  tag?: { label: string; pulse?: boolean };
  zone: string;
  ip: string;
  model: string;
  firmware: { text: string; note?: string; tone: Tone };
  stream: { label: string; tone: Tone };
  recording: { label: string; tone: Tone };
  /** `pct` draws the bar; without it only the label is shown (e.g. "0% [N/A]"). */
  storage: { label: string; pct?: number; tone: Tone };
  uptime: { label: string; tone: Tone; strong?: boolean };
  fault: { label: string; tone: Tone };
  actions: { label: string; tone: "default" | "warn" | "err" }[];
};

import useSWR from 'swr';
import { Camera } from './dashboard-data';

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export function useDeviceCameras() {
  const { data, error, isLoading } = useSWR<Camera[]>('/api/cameras', fetcher, {
    refreshInterval: 10000,
    fallbackData: [],
  });

  const std = [{ label: "PING", tone: "default" as const }, { label: "DIAG", tone: "default" as const }];

  const mappedCameras: CameraRow[] = (data || []).map((cam) => {
    return {
      state: cam.online ? "ok" : "err",
      id: cam.id,
      name: cam.label.split(' · ')[1] || cam.label,
      zone: "Unknown", // Would come from real API
      ip: "0.0.0.0", // Would come from real API
      model: "Unknown", // Would come from real API
      firmware: { text: "v1.0", tone: cam.online ? "ok" : "err" },
      stream: { label: cam.online ? "1080P30 HLS" : "NO SIGNAL", tone: cam.online ? "ok" : "err" },
      recording: { label: cam.online ? "ACTIVE" : "OFFLINE", tone: cam.online ? "ok" : "err" },
      storage: { label: "N/A", tone: "ok" },
      uptime: { label: cam.online ? "99.9%" : "0%", tone: cam.online ? "ok" : "err" },
      fault: { label: cam.online ? "None" : "Offline", tone: cam.online ? "ok" : "err" },
      actions: std,
    };
  });

  return {
    cameras: mappedCameras,
    isLoading,
    isError: error,
  };
}

export const nvrPanel = {
  title: "NVR STORAGE & CLUSTER TOPOLOGY",
  preview: "(PREVIEW - 4 OF 8)",
  viewAll: "VIEW ALL RECORDERS",
  nodes: [
    { name: "NVR-01 HQ", badge: "16 CAMS OK", storage: "Storage: 34.2 / 48 TB", pct: 71, pctLabel: "71%", temp: "42°C", raidLabel: "RAID-6:", raid: "OK (8/8)", tone: "ok" },
    { name: "NVR-02 PERIMETER E", badge: "12 CAMS OK", storage: "Storage: 21.8 / 32 TB", pct: 68, pctLabel: "68%", temp: "44°C", raidLabel: "RAID-6:", raid: "OK (6/6)", tone: "ok" },
    { name: "NVR-03 PERIMETER W", badge: "CAM-15 DOWN", storage: "Storage: 29.4 / 32 TB", pct: 92, pctLabel: "92% [CRIT]", temp: "49°C", raidLabel: "FAULT:", raid: "HIGH USAGE", tone: "warn" },
    { name: "NVR-04 DEPOT", badge: "8 CAMS", storage: "Storage: 17.2 / 32 TB", pct: 54, pctLabel: "54%", temp: "40°C", raidLabel: "RAID-6:", raid: "OK (4/4)", tone: "ok" },
  ] as {
    name: string; badge: string; storage: string; pct: number; pctLabel: string;
    temp: string; raidLabel: string; raid: string; tone: "ok" | "warn";
  }[],
};

export const terminalPanel = {
  title: "OPERATOR TERMINALS & WORKSTATIONS",
  preview: "(PREVIEW - 4 OF 12)",
  viewAll: "VIEW ALL WORKSTATIONS",
  columns: ["STATION", "DUTY OPERATOR", "IP", "HEARTBEAT", "STATUS"],
  rows: [
    { station: "TERM-01 [MASTER]", operator: "Capt. A. Verma", ip: "10.142.1.11", heartbeat: "JUST NOW (0.4s)", status: "CONNECTED [TS-SCI]", master: true },
    { station: "TERM-02 [TACTICAL]", operator: "Hav. R. Singh", ip: "10.142.1.12", heartbeat: "1.2s ago", status: "CONNECTED" },
    { station: "TERM-03 [RADAR/OPTIC]", operator: "Sub. M. Kumar", ip: "10.142.1.13", heartbeat: "0.8s ago", status: "CONNECTED" },
    { station: "TERM-04 [QRF DISPATCH]", operator: "Lt. P. Nair", ip: "10.142.1.14", heartbeat: "2.1s ago", status: "CONNECTED" },
  ] as { station: string; operator: string; ip: string; heartbeat: string; status: string; master?: boolean }[],
};

export const statusStrip = {
  tamper: "TAMPER ENCLAVE: SEALED",
  hash: "HASH: 9E4F-A21C",
  audit: "STIG AUDIT LOGS",
};

export const complianceFooter = {
  left: "US-DOD DISA COMPLIANT // CLASSIFIED RECORDING SYSTEM // ISO-8601 ZULU SYNCHRONIZED",
  right:
    "RESTRICTED DISSEMINATION // US GOV PROPERTY // STRICT AUDIT COMPLIANCE LEVEL 4 ACTIVE // ZERO TRUST TELEMETRY: ISOLATED // NODE ID: TAC-8891-B",
};
