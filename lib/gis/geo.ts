import type { CameraEntity, LatLng, MapConfig, MapStatus } from "./types";

/** Local geometry for rendering/editing — the backend (shapely) does the analysis. */

const R = 6371008.8;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Point `dist` metres from (lat, lon) along `bearing` (degrees from north). */
export function destination(lat: number, lon: number, bearing: number, dist: number): LatLng {
  const b = rad(bearing);
  return [lat + deg((dist * Math.cos(b)) / R), lon + deg((dist * Math.sin(b)) / (R * Math.cos(rad(lat))))];
}

/** Distance (m) and bearing (deg) from a to b — equirectangular, fine at battalion scale. */
export function distanceBearing(a: LatLng, b: LatLng) {
  const x = rad(b[1] - a[1]) * R * Math.cos(rad(a[0]));
  const y = rad(b[0] - a[0]) * R;
  return { distance: Math.hypot(x, y), bearing: (deg(Math.atan2(x, y)) + 360) % 360 };
}

/** Directional FOV wedge as a lat/lon ring (same construction as the backend). */
export function fovWedge(cam: Pick<CameraEntity, "latitude" | "longitude" | "bearing" | "fov_angle" | "range">, steps = 32): LatLng[] {
  const { latitude: lat, longitude: lon, bearing, fov_angle: fov, range } = cam;
  if (lat == null || lon == null) return [];
  if (fov >= 359.9) {
    return Array.from({ length: steps }, (_, i) => destination(lat, lon, (360 * i) / steps, range));
  }
  const start = bearing - fov / 2;
  const ring: LatLng[] = [[lat, lon]];
  for (let i = 0; i <= steps; i++) ring.push(destination(lat, lon, start + (fov * i) / steps, range));
  return ring;
}

export const STATUS_COLOR: Record<MapStatus, string> = {
  ONLINE: "#2e8b57",
  ALERT: "#c94c4c",
  DEGRADED: "#c88920",
  OFFLINE: "#8a847a",
};

export const STATUS_TONE: Record<MapStatus, "ok" | "err" | "warn" | "idle"> = {
  ONLINE: "ok",
  ALERT: "err",
  DEGRADED: "warn",
  OFFLINE: "idle",
};

/** Hierarchy lookups over a map config. */
export function indexConfig(cfg: MapConfig) {
  const postById = new Map(cfg.posts.map((p) => [p.id, p]));
  const companyById = new Map(cfg.companies.map((c) => [c.id, c]));
  const cameraById = new Map(cfg.cameras.map((c) => [c.id, c]));
  const companyOfCamera = (cam: CameraEntity) => {
    const post = cam.parent_id ? postById.get(cam.parent_id) : undefined;
    return post?.parent_id ? companyById.get(post.parent_id) : undefined;
  };
  const postsOf = (companyId: string) => cfg.posts.filter((p) => p.parent_id === companyId);
  const camerasOfPost = (postId: string) => cfg.cameras.filter((c) => c.parent_id === postId);
  const camerasOfCompany = (companyId: string) => {
    const posts = new Set(postsOf(companyId).map((p) => p.id));
    return cfg.cameras.filter((c) => c.parent_id != null && posts.has(c.parent_id));
  };
  const nvrOfCompany = (companyId: string) => (cfg.nvrs ?? []).find((n) => n.parent_id === companyId);
  return { postById, companyById, cameraById, companyOfCamera, postsOf, camerasOfPost, camerasOfCompany, nvrOfCompany };
}

export type ConfigIndex = ReturnType<typeof indexConfig>;

/** Camera totals: `up` = not OFFLINE, `feeds` = cameras with a video source configured. */
export function cameraCounts(cams: CameraEntity[]) {
  return {
    total: cams.length,
    up: cams.filter((c) => c.status !== "OFFLINE").length,
    feeds: cams.filter((c) => c.source_bound).length,
    alerts: cams.filter((c) => c.status === "ALERT").length,
  };
}

export const fmtArea = (m2: number) => (m2 >= 1e5 ? `${(m2 / 1e6).toFixed(2)} km²` : `${Math.round(m2).toLocaleString()} m²`);
export const fmtDist = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`);
