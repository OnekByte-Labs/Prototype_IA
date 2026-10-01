/** Tactical GIS model — mirrors GET /api/v1/map (backend/src/gis.py). */

export type MapStatus = "ONLINE" | "ALERT" | "DEGRADED" | "OFFLINE";
export type UnitType = "battalion" | "company" | "post" | "camera" | "nvr";
export type LatLng = [number, number];

export interface MapEntity {
  id: string;
  parent_id: string | null;
  name: string;
  type: UnitType;
  latitude: number | null;
  longitude: number | null;
  status: MapStatus;
}

export interface BattalionEntity extends MapEntity {
  type: "battalion";
  latitude: number;
  longitude: number;
  /** Area-of-responsibility boundary; coverage gaps are computed inside it. */
  boundary: LatLng[] | null;
}

export interface UnitEntity extends MapEntity {
  type: "company" | "post";
  latitude: number;
  longitude: number;
}

export interface CameraEntity extends MapEntity {
  type: "camera";
  /** Degrees clockwise from north. */
  bearing: number;
  fov_angle: number;
  /** Metres. */
  range: number;
  detection_mode: string;
  pipeline_state: string | null;
  /** A live video pipeline is running for this camera right now. */
  has_source: boolean;
  /** A video source is configured for this camera (cameras.yaml). The
   *  synthetic estate registers most cameras without one — they stay OFFLINE. */
  source_bound: boolean;
  /** Approximate ground footprint of the camera's image-space zone / line. */
  zone_geo: LatLng[] | null;
  line_geo: LatLng[] | null;
}

export interface NvrEntity extends MapEntity {
  type: "nvr";
  /** Company whose cameras it records. */
  parent_id: string;
  latitude: number;
  longitude: number;
}

export interface TileSource {
  url: string;
  attribution?: string;
  max_native_zoom?: number;
}

/** Elevation tiles (Terrarium PNG encoding) — hillshade/contours are computed from them. */
export interface DemSource extends TileSource {
  encoding: "terrarium";
}

export interface Basemap {
  id: string;
  label: string;
  /** Imagery XYZ template; null = terrain relief only. */
  url: string | null;
  attribution?: string;
  max_native_zoom?: number;
  dem?: DemSource | null;
  /** Roads / reference overlay. */
  reference?: TileSource | null;
}

export interface MapConfig {
  revision: number;
  synthetic_positions: boolean;
  basemaps: Basemap[];
  default_basemap: string | null;
  status_rules: { alert_hold_s: number; frame_stale_s: number; frame_degraded_s: number };
  battalion: BattalionEntity | null;
  companies: UnitEntity[];
  posts: UnitEntity[];
  cameras: CameraEntity[];
  nvrs: NvrEntity[];
}

/** GET /api/v1/map/health — live ingest per camera / NVR. */
export type DeviceHealth = "ONLINE" | "DEGRADED" | "OFFLINE";
/** What a camera persists: EVENTS (running pipeline → event DB + alert evidence) · OFF (mode none) · STOPPED · N/A (no source). */
export type RecordingState = "EVENTS" | "OFF" | "STOPPED" | "N/A";

export interface MapHealth {
  /** Epoch seconds of this health check */
  checked_at?: number;
  rules?: { frame_stale_s: number; frame_degraded_s: number };
  cameras: Record<string, {
    status: MapStatus;
    source_bound: boolean;
    pipeline: boolean;
    pipeline_state: string | null;
    frame_age_s: number | null;
    fps: number | null;
    health?: DeviceHealth;
    issue?: string | null;
    /** Epoch seconds of the last frame (heartbeat) */
    last_frame_at?: number | null;
    detection_mode?: string;
    pipeline_error?: string | null;
    recording?: RecordingState;
  }>;
  nvrs: Record<string, {
    status: MapStatus; company_id: string; assigned: number; bound: number; streaming: number;
    name?: string; cameras?: string[]; affected?: string[]; capturing?: number; issue?: string | null;
  }>;
  /** Host volume the system records to */
  storage?: {
    total_bytes: number; used_bytes: number; free_bytes: number;
    system_bytes: { evidence: number; event_log: number; database: number };
  } | null;
}

export interface CoverageGap {
  outer: LatLng[];
  holes: LatLng[][];
  area_m2: number;
}

export interface CoverageResult {
  boundary_area_m2: number;
  covered_area_m2: number;
  gap_area_m2: number;
  coverage_pct: number;
  cameras_used: number;
  exclude_offline: boolean;
  gaps: CoverageGap[];
  error?: string;
}

export interface PointCoverageHit {
  camera_id: string;
  name: string;
  post_id: string | null;
  company_id: string | null;
  status: MapStatus;
  detection_mode: string;
  distance_m: number;
  bearing_to_point: number;
  off_axis_deg: number;
}

export interface PointCoverage {
  point: LatLng;
  cameras: PointCoverageHit[];
}

export type Relation = "overlap" | "adjacent" | "same_post" | "same_company";

export interface CameraRelationship {
  camera_a: string;
  camera_b: string;
  other: string;
  relation: Relation;
  distance_m: number;
  overlap_m2: number;
  overlap_ratio: number;
  bearing_delta: number;
}

/** Drill-down position: Battalion → Company → Post → Camera. */
export type Drill =
  | { level: "battalion" }
  | { level: "company"; companyId: string }
  | { level: "post"; companyId: string; postId: string }
  | { level: "camera"; companyId: string | null; postId: string | null; cameraId: string };

export const STATUS_ORDER: MapStatus[] = ["ALERT", "DEGRADED", "OFFLINE", "ONLINE"];
