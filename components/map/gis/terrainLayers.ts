import * as L from "leaflet";
import type { DemSource } from "@/lib/gis/types";

/**
 * Terrain rendered from real elevation data (Terrarium-encoded DEM tiles):
 * hillshade (Lambert, sun from the NW) and contour lines with index contours.
 * Nothing here is decorative — every shaded slope and contour comes from the
 * DEM. The DEM source is a map.yaml setting (AWS Terrain Tiles in
 * development, a local tile cache for air-gapped deployment).
 */

const SIZE = 256;
const MAX_CACHE = 400;

/* ------------------------------------------------------------- DEM tiles */

const pending = new Map<string, Promise<Float32Array | null>>();
const decoded = new Map<string, Float32Array>(); // insertion-ordered → LRU

const keyOf = (url: string, z: number, x: number, y: number) => `${url}|${z}/${x}/${y}`;

function loadDem(url: string, z: number, x: number, y: number): Promise<Float32Array | null> {
  const key = keyOf(url, z, x, y);
  const hit = decoded.get(key);
  if (hit) {
    decoded.delete(key);
    decoded.set(key, hit);
    return Promise.resolve(hit);
  }
  let p = pending.get(key);
  if (!p) {
    p = new Promise<Float32Array | null>((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = c.height = SIZE;
        const ctx = c.getContext("2d", { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0, SIZE, SIZE);
        const px = ctx.getImageData(0, 0, SIZE, SIZE).data;
        const e = new Float32Array(SIZE * SIZE);
        for (let i = 0; i < e.length; i++) e[i] = px[i * 4] * 256 + px[i * 4 + 1] + px[i * 4 + 2] / 256 - 32768;
        decoded.set(key, e);
        if (decoded.size > MAX_CACHE) decoded.delete(decoded.keys().next().value!);
        pending.delete(key);
        resolve(e);
      };
      img.onerror = () => {
        pending.delete(key);
        resolve(null);
      };
      img.src = url.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
    });
    pending.set(key, p);
  }
  return p;
}

/** Elevation (m) at a point from already-loaded DEM tiles, finest zoom first. */
export function sampleElevation(dem: DemSource, lat: number, lon: number, zoom: number): number | null {
  const max = Math.min(Math.floor(zoom), dem.max_native_zoom ?? 15);
  for (let z = max; z >= Math.max(0, max - 4); z--) {
    const n = 2 ** z;
    const fx = ((lon + 180) / 360) * n;
    const lr = (lat * Math.PI) / 180;
    const fy = ((1 - Math.log(Math.tan(lr) + 1 / Math.cos(lr)) / Math.PI) / 2) * n;
    const tx = Math.floor(fx);
    const ty = Math.floor(fy);
    const e = decoded.get(keyOf(dem.url, z, tx, ty));
    if (e) {
      const px = Math.min(SIZE - 1, Math.floor((fx - tx) * SIZE));
      const py = Math.min(SIZE - 1, Math.floor((fy - ty) * SIZE));
      return e[py * SIZE + px];
    }
  }
  return null;
}

/* --------------------------------------------------------------- shading */

const metresPerPixel = (z: number, y: number) => {
  const lat = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / 2 ** z)));
  return (40075016.686 * Math.cos(lat)) / (SIZE * 2 ** z);
};

const ZENITH = (45 * Math.PI) / 180; // sun 45° above the horizon
const AZIMUTH = ((360 - 315 + 90) * Math.PI) / 180; // from the north-west

/** Hypsometric tint for relief-only mode (dark tactical palette). */
function tint(e: number): [number, number, number] {
  const stops: [number, [number, number, number]][] = [
    [0, [34, 52, 38]],
    [400, [46, 70, 44]],
    [800, [70, 84, 52]],
    [1200, [96, 92, 64]],
    [1600, [120, 110, 88]],
    [2200, [150, 146, 138]],
  ];
  if (e <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (e <= stops[i][0]) {
      const [e0, c0] = stops[i - 1];
      const [e1, c1] = stops[i];
      const t = (e - e0) / (e1 - e0);
      return [c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t, c0[2] + (c1[2] - c0[2]) * t];
    }
  }
  return stops[stops.length - 1][1];
}

function drawHillshade(canvas: HTMLCanvasElement, e: Float32Array, z: number, y: number, relief: boolean) {
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(SIZE, SIZE);
  const out = img.data;
  const mpp = metresPerPixel(z, y);
  // Zoomed out, real slopes average away — mild exaggeration keeps relief legible
  const exag = 1.4 + Math.max(0, 13 - z) * 0.35;
  const cz = Math.cos(ZENITH);
  const sz = Math.sin(ZENITH);
  for (let row = 0; row < SIZE; row++) {
    const up = row > 0 ? row - 1 : row;
    const dn = row < SIZE - 1 ? row + 1 : row;
    for (let col = 0; col < SIZE; col++) {
      const l = col > 0 ? col - 1 : col;
      const r = col < SIZE - 1 ? col + 1 : col;
      const dzdx = ((e[row * SIZE + r] - e[row * SIZE + l]) / ((r - l) * mpp)) * exag;
      const dzdy = ((e[dn * SIZE + col] - e[up * SIZE + col]) / ((dn - up) * mpp)) * exag;
      const slope = Math.atan(Math.hypot(dzdx, dzdy));
      const aspect = Math.atan2(dzdy, -dzdx);
      const hs = Math.max(0, cz * Math.cos(slope) + sz * Math.sin(slope) * Math.cos(AZIMUTH - aspect));
      const i = (row * SIZE + col) * 4;
      if (relief) {
        const [tr, tg, tb] = tint(e[row * SIZE + col]);
        const k = 0.35 + 0.95 * hs;
        out[i] = Math.min(255, tr * k);
        out[i + 1] = Math.min(255, tg * k);
        out[i + 2] = Math.min(255, tb * k);
        out[i + 3] = 255;
      } else {
        // Transparent overlay on the imagery: slopes facing away from the sun
        // get a dark wash, sun-facing slopes a faint highlight; flat ground is
        // untouched. (Alpha, not a CSS blend, so loading tiles stay dark.)
        const shade = hs / cz;
        if (shade < 1) {
          out[i] = 4;
          out[i + 1] = 8;
          out[i + 2] = 6;
          out[i + 3] = Math.min(235, (1 - shade) * 250);
        } else {
          out[i] = 255;
          out[i + 1] = 246;
          out[i + 2] = 224;
          out[i + 3] = Math.min(70, (shade - 1) * 160);
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Contour interval (m) for a render zoom; every 5th line is an index contour. */
export const contourInterval = (z: number) => (z <= 12 ? 200 : z === 13 ? 100 : z === 14 ? 50 : z <= 16 ? 20 : 10);

function drawContours(canvas: HTMLCanvasElement, e: Float32Array, z: number) {
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(SIZE, SIZE);
  const out = new Uint32Array(img.data.buffer);
  const iv = contourInterval(z);
  // ABGR (little-endian): pale sand lines, index contours brighter
  const minor = (0x3a << 24) | (0xb4 << 16) | (0xdc << 8) | 0xec;
  const major = (0x9c << 24) | (0xa8 << 16) | (0xd8 << 8) | 0xf2;
  const band = (v: number) => Math.floor(v / iv);
  for (let row = 0; row < SIZE - 1; row++) {
    for (let col = 0; col < SIZE - 1; col++) {
      const i = row * SIZE + col;
      const b = band(e[i]);
      const br = band(e[i + 1]);
      const bd = band(e[i + SIZE]);
      if (b === br && b === bd) continue;
      const crossing = Math.max(b, br === b ? bd : br);
      const isIndex = crossing % 5 === 0;
      out[i] = isIndex ? major : minor;
      if (isIndex) out[i + 1] = major;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/* ---------------------------------------------------------------- layers */

type Draw = (canvas: HTMLCanvasElement, e: Float32Array, coords: L.Coords) => void;

/** DEM for a tile; beyond the source's native zoom, bilinearly resampled from
 *  the ancestor tile so shading and contours stay smooth when zoomed in. */
async function demFor(url: string, maxNative: number, z: number, x: number, y: number): Promise<Float32Array | null> {
  if (z <= maxNative) return loadDem(url, z, x, y);
  const k = 2 ** (z - maxNative);
  const parent = await loadDem(url, maxNative, Math.floor(x / k), Math.floor(y / k));
  if (!parent) return null;
  const ox = (x % k) * (SIZE / k);
  const oy = (y % k) * (SIZE / k);
  const out = new Float32Array(SIZE * SIZE);
  for (let row = 0; row < SIZE; row++) {
    const v = Math.min(SIZE - 1.001, Math.max(0, oy + (row + 0.5) / k - 0.5));
    const y0 = Math.floor(v);
    const fy = v - y0;
    for (let col = 0; col < SIZE; col++) {
      const u = Math.min(SIZE - 1.001, Math.max(0, ox + (col + 0.5) / k - 0.5));
      const x0 = Math.floor(u);
      const fx = u - x0;
      const a = parent[y0 * SIZE + x0];
      const b = parent[y0 * SIZE + x0 + 1];
      const c = parent[(y0 + 1) * SIZE + x0];
      const d = parent[(y0 + 1) * SIZE + x0 + 1];
      out[row * SIZE + col] = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
    }
  }
  return out;
}

const DemGridLayer = L.GridLayer.extend({
  createTile(this: L.GridLayer & { options: { demUrl: string; demMax: number; draw: Draw } }, coords: L.Coords, done: L.DoneCallback) {
    const tile = document.createElement("canvas");
    tile.width = tile.height = SIZE;
    demFor(this.options.demUrl, this.options.demMax, coords.z, coords.x, coords.y).then((e) => {
      if (e) this.options.draw(tile, e, coords);
      done(undefined, tile);
    });
    return tile;
  },
}) as unknown as new (options: L.GridLayerOptions & { demUrl: string; demMax: number; draw: Draw }) => L.GridLayer;

export function hillshadeLayer(dem: DemSource, relief: boolean, pane: string) {
  return new DemGridLayer({
    pane,
    demUrl: dem.url,
    demMax: dem.max_native_zoom ?? 15,
    maxZoom: 21,
    maxNativeZoom: 18,
    attribution: dem.attribution,
    className: relief ? "gis-relief" : "gis-hillshade",
    draw: (c, e, { z, y }) => drawHillshade(c, e, z, y, relief),
  });
}

export function contourLayer(dem: DemSource, pane: string) {
  return new DemGridLayer({
    pane,
    demUrl: dem.url,
    demMax: dem.max_native_zoom ?? 15,
    maxZoom: 21,
    maxNativeZoom: 18,
    draw: (c, e, { z }) => drawContours(c, e, z),
  });
}
