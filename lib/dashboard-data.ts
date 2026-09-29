
import type { AnalyticsConfig } from "./gotham/model";

// Mock data copied verbatim from the Stitch screen "ISCC Main Command Dashboard - 3-Zone Redesign".

export type Kpi = {
  label: string;
  value: string;
  tone: "default" | "red" | "amber";
};

export const kpis: Kpi[] = [
  { label: "CAMERAS ONLINE", value: "46/48", tone: "default" },
  { label: "NVRS ONLINE", value: "8/8", tone: "default" },
  { label: "ACTIVE ALERTS", value: "3", tone: "red" },
  { label: "DEVICE FAULTS", value: "3", tone: "amber" },
];

export type Camera = {
  id: string;
  name?: string;
  label: string;
  zone?: string;
  sector?: string;
  online: boolean;
  ip?: string;
  model?: string;
  firmware?: string;
  resolution?: string;
  fps?: number;
  sensitivity?: number;
  recording?: boolean;
  uptime?: number;
  mgrs?: string;
  elevationM?: number;
  dataset?: string;
  aiWorkload?: string;
  aiEnabled?: boolean;
  videoUrl?: string;
  mjpegUrl?: string;
  metadataUrl?: string;
  precomputedUrl?: string;
  analytics?: AnalyticsConfig;
};


export type HourBar = {
  hour: string;
  /** Bar height as a percentage of the chart area. */
  height: number;
  peak?: boolean;
};

export const alertsByHour: HourBar[] = [
  { hour: "03:00", height: 95, peak: true },
  { hour: "04:00", height: 25 },
  { hour: "05:00", height: 15 },
  { hour: "06:00", height: 10 },
  { hour: "07:00", height: 30 },
  { hour: "08:00", height: 45 },
  { hour: "09:00", height: 50 },
  { hour: "10:00", height: 35 },
  { hour: "11:00", height: 20 },
  { hour: "12:00", height: 60 },
  { hour: "13:00", height: 30 },
  { hour: "14:00", height: 30 },
];

export const alertsByHourPeak = "PEAK: 14 EVENTS @ 03:00";

export type AlertType = "PERSON" | "VEHICLE" | "ANIMAL";
export type Severity = "HIGH" | "MED" | "LOW";

export type Alert = {
  id: string;
  type: AlertType;
  camera: string;
  time: string;
  severity: Severity;
  /** Unacknowledged alerts get the red left border and tinted row. */
  unacknowledged?: boolean;
};

export const alerts: Alert[] = [
  {
    id: "a1",
    type: "PERSON",
    camera: "CAM-12 · ARMOURY SECTOR 4",
    time: "14:31:48",
    severity: "HIGH",
    unacknowledged: true,
  },
  {
    id: "a2",
    type: "VEHICLE",
    camera: "CAM-01 · MAIN GATE",
    time: "14:28:10",
    severity: "MED",
  },
  {
    id: "a3",
    type: "ANIMAL",
    camera: "CAM-07 · PERIMETER E",
    time: "14:15:22",
    severity: "LOW",
  },
  {
    id: "a4",
    type: "PERSON",
    camera: "CAM-03 · CHECKPOINT ALPHA",
    time: "13:58:04",
    severity: "LOW",
  },
  {
    id: "a5",
    type: "VEHICLE",
    camera: "CAM-14 · VEHICLE DEPOT",
    time: "13:42:19",
    severity: "MED",
  },
];

export const alertsSummary = "5 ACTIVE INCIDENTS";

export type Nvr = {
  id: string;
  name: string;
  detail: string;
  status: "ONLINE" | "FAULT";
};

export const nvrs: Nvr[] = [
  {
    id: "nvr-01",
    name: "NVR-01 HQ CORE",
    detail: "16 cams · storage 71%",
    status: "ONLINE",
  },
  {
    id: "nvr-02",
    name: "NVR-02 PERIMETER E",
    detail: "12 cams · storage 68%",
    status: "ONLINE",
  },
  {
    id: "nvr-03",
    name: "NVR-03 PERIMETER W",
    detail: "11/12 cams (CAM-15 DOWN) · storage 92%",
    status: "FAULT",
  },
  {
    id: "nvr-04",
    name: "NVR-04 DEPOT & MOTOR POOL",
    detail: "8 cams · storage 54%",
    status: "ONLINE",
  },
];

export const operator = {
  name: "CAPT. A. VERMA",
  serviceId: "IC-78492X",
  unacknowledged: 3,
};
