// Mock data copied verbatim from the Stitch screen "ISCC Alert Console & Investigation Table".

export type Classification = "PERSON" | "VEHICLE" | "ANIMAL";
export type AlertSeverity = "HIGH" | "MED" | "LOW";
export type AlertStatus = "UNACKNOWLEDGED" | "ACKNOWLEDGED" | "DISPATCHED";
export type ConfidenceTone = "error" | "tertiary" | "outline" | "primary" | "secondary";

export type AlertRow = {
  time: string;
  incidentId: string;
  cameraId: string;
  location: string;
  classification: Classification;
  /** Percentage, displayed with one decimal and used as the bar width. */
  confidence: number;
  confidenceTone: ConfidenceTone;
  severity: AlertSeverity;
  status: AlertStatus;
  operator: string;
  /** Emphasised operator label (only on INC-8820). */
  operatorStrong?: boolean;
};

/** The selected incident, rendered with its inline inspection drawer. */
export const activeAlert: AlertRow = {
  time: "14:31:48",
  incidentId: "INC-8821",
  cameraId: "CAM-12",
  location: "ARMOURY SECTOR 4 (HQ ZONE)",
  classification: "PERSON",
  confidence: 98.4,
  confidenceTone: "error",
  severity: "HIGH",
  status: "UNACKNOWLEDGED",
  operator: "-- (Pending)",
};

export const alerts: AlertRow[] = [
  { time: "14:28:10", incidentId: "INC-8820", cameraId: "CAM-01", location: "MAIN GATE PERIMETER", classification: "VEHICLE", confidence: 94.1, confidenceTone: "tertiary", severity: "MED", status: "ACKNOWLEDGED", operator: "AV (Capt. Verma)", operatorStrong: true },
  { time: "14:15:22", incidentId: "INC-8819", cameraId: "CAM-07", location: "PERIMETER E - SECTOR 2", classification: "ANIMAL", confidence: 89.6, confidenceTone: "outline", severity: "LOW", status: "ACKNOWLEDGED", operator: "RS (Havildar Singh)" },
  { time: "13:58:04", incidentId: "INC-8818", cameraId: "CAM-03", location: "GROUND FLOOR", classification: "PERSON", confidence: 99.1, confidenceTone: "primary", severity: "LOW", status: "ACKNOWLEDGED", operator: "AV" },
  { time: "13:42:19", incidentId: "INC-8817", cameraId: "CAM-14", location: "VEHICLE DEPOT NORTH", classification: "VEHICLE", confidence: 92.5, confidenceTone: "tertiary", severity: "MED", status: "DISPATCHED", operator: "AV" },
  { time: "13:21:05", incidentId: "INC-8816", cameraId: "CAM-09", location: "AMMUNITION DUMP B-1", classification: "PERSON", confidence: 97.2, confidenceTone: "error", severity: "HIGH", status: "DISPATCHED", operator: "MK (Subedar Kumar)" },
  { time: "12:45:30", incidentId: "INC-8815", cameraId: "CAM-05", location: "MOTOR POOL BAY 3", classification: "VEHICLE", confidence: 95.8, confidenceTone: "secondary", severity: "LOW", status: "ACKNOWLEDGED", operator: "RS" },
  { time: "11:30:14", incidentId: "INC-8814", cameraId: "CAM-11", location: "PERIMETER W - POST 4", classification: "PERSON", confidence: 91.0, confidenceTone: "tertiary", severity: "HIGH", status: "ACKNOWLEDGED", operator: "MK" },
  { time: "10:18:55", incidentId: "INC-8813", cameraId: "CAM-08", location: "OFFICER QUARTERS NORTH", classification: "ANIMAL", confidence: 86.4, confidenceTone: "outline", severity: "LOW", status: "ACKNOWLEDGED", operator: "AV" },
  { time: "09:05:40", incidentId: "INC-8812", cameraId: "CAM-02", location: "PERIMETER N - FENCE LINE", classification: "PERSON", confidence: 96.7, confidenceTone: "secondary", severity: "MED", status: "ACKNOWLEDGED", operator: "RS" },
  { time: "04:12:08", incidentId: "INC-8811", cameraId: "CAM-16", location: "BARRACKS REAR ACCESS", classification: "PERSON", confidence: 93.3, confidenceTone: "tertiary", severity: "MED", status: "ACKNOWLEDGED", operator: "MK" },
  { time: "02:00:19", incidentId: "INC-8810", cameraId: "CAM-12", location: "ARMOURY SECTOR 4", classification: "PERSON", confidence: 99.8, confidenceTone: "error", severity: "HIGH", status: "ACKNOWLEDGED", operator: "AV" },
];

export const consoleHeader = {
  title: "DEFCON // WATCHFLOOR AUTH GATEWAY",
  subtitle: "TACTICAL ALERT CONSOLE // SEC-LOG-09 · SIPRNET TERMINAL 04",
  clockDate: "18 SEP 2026",
  unacknowledged: 3,
  status: "SYSTEM STATUS: ENCRYPTED",
  operator: "CAPT. A. VERMA [DUTY OPERATOR · IC-78492X]",
};

export const subNav = {
  items: [
    { label: "DASHBOARD", href: "/dashboard" },
    { label: "ALERTS (3)", active: true },
    { label: "TACTICAL MAP" },
    { label: "DEVICES & NODES" },
    { label: "CAMERAS (MATRIX 16)" },
    { label: "REPORTS & AUDIT" },
    { label: "ADMIN & KEYS" },
  ] as { label: string; href?: string; active?: boolean }[],
  sensorSync: "SENSOR SYNC: 100% NOMINAL",
  latency: "BUFFER LATENCY: 42ms",
};

export const filters = {
  range: "2026-09-18 00:00:00 TO 14:35:12 ZULU",
  zones: [
    { value: "ALL", label: "ALL ZONES (HQ, Perimeter E, Perimeter W, Depot, Motor Pool)" },
    { value: "HQ", label: "HQ / COMMAND ENCLAVE" },
    { value: "PERIM-E", label: "PERIMETER EAST" },
    { value: "PERIM-W", label: "PERIMETER WEST" },
    { value: "DEPOT", label: "AMMUNITION & VEHICLE DEPOT" },
    { value: "MOTOR", label: "MOTOR POOL" },
  ],
  classes: [
    { label: "ALL (142)" },
    { label: "PERSON (84)", active: true },
    { label: "VEHICLE (46)" },
    { label: "ANIMAL (12)" },
  ],
  severities: [
    "ALL SEVERITIES (CRITICAL / HIGH / MED / LOW)",
    "CRITICAL / BREACH",
    "HIGH",
    "MEDIUM",
    "LOW",
  ],
  searchPlaceholder: "Search camera, location, ID...",
  shown: 12,
  total: 142,
  liveFeed: "LIVE FEED: ON (1s sync)",
};

export const incidentDetail = {
  frame: {
    src: "/alerts/incident-8821-ir-frame.jpg",
    alt: "Night-vision infrared feed of a lone figure near a chain-link perimeter fence topped with concertina wire, boxed by a green targeting reticle.",
    liveLabel: "LIVE IR OPTICAL BUFFER",
    meta: "CAM-12 · FOV: 78° · 1080P/60",
    rec: "REC [14:31:48.201 Z]",
    fps: "FPS: 59.98 · ENCR: AES-256",
    target: "TARGET #9941",
    conf: "CONF: 98.4% [HUMAN]",
    azEl: "AZ: 184° | EL: -04°",
    ir: "IR: ACTIVE (850nm)",
    ptzLock: "PTZ LOCK: ARMOURY GATE B",
  },
  telemetry: [
    { label: "GEO COORDINATES:", value: "28.6139° N, 77.2090° E", tone: "default", strong: true },
    { label: "TACTICAL SECTOR:", value: "SEC-04 / ARMOURY NORTH", tone: "default" },
    { label: "ESTIMATED SPEED:", value: "1.4 m/s (NW Vector)", tone: "default" },
    { label: "SENSOR TRIGGER:", value: "PERIMETER BEAM #14 + CV", tone: "error", strong: true },
    { label: "PRE-EVENT BUFFER:", value: "15 SEC PRE-ROLL VERIFIED", tone: "default" },
    { label: "CORRELATED SENSORS:", value: "SEISMIC S-08 · IR-44", tone: "secondary" },
    { label: "RFID QUERY:", value: "NO BEACON DETECTED", tone: "error", strong: true },
    { label: "CLASSIFICATION CV:", value: "NEURAL-CV MIL-SPEC [PERSON]", tone: "default" },
  ] as { label: string; value: string; tone: "default" | "error" | "secondary"; strong?: boolean }[],
  confidenceLabel: "BIOMETRIC / SILHOUETTE CONFIDENCE",
  confidenceNote: "CRITICAL THRESHOLD REACHED",
  note: "Suspect observed approaching outer security fence near Ammunition store Sector 4 without clearance RFID. Visible backpack with unidentified thermal mass signature.",
  auditLogged: "AUDIT LOGGED TO CAPT. A. VERMA",
  signature: "SIG: RSA-4096-SHA256",
};

export const metricsBar = {
  left: [
    "VMS DISK IO: 1.2 GB/s [NOMINAL]",
    "OPTICAL INGEST: 16 CHANNELS",
    "EDGE AI ENGINE: ACTIVE (TENSOR-RT 9.2)",
  ],
  frameLoss: "FRAME LOSS: 0.000%",
  encrypted: "ALL SENSORS ENCRYPTED MIL-STD-188",
};

export const complianceFooter = {
  notice:
    "RESTRICTED DISSEMINATION // US GOV PROPERTY // STRICT AUDIT COMPLIANCE LEVEL 4 ACTIVE // UNAUTHORIZED ACCESS SUBJECT TO PROSECUTION UNDER 18 U.S.C. SEC 1030",
  items: [
    "ZERO TRUST TELEMETRY: ISOLATED",
    "NODE ID: TAC-8891-B",
    "SESSION: 0x8F9C4A2",
  ],
};
