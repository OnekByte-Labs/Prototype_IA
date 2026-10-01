import type { MapStatus } from "@/lib/gis/types";

/**
 * Tactical marker symbology (APP-6-inspired): unit frames with echelon marks
 * for Battalion HQ (II + HQ staff) and Companies (I), an observation-post
 * triangle for Posts, a camera glyph rotated to its bearing, an NVR rack.
 * Status colour (--st) comes from the gis-s-<STATUS> class.
 */

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** "ONLINE" → "Online": status words are sentence case in the UI. */
const statusText = (s: MapStatus) => s.charAt(0) + s.slice(1).toLowerCase();

const cls = (base: string, status: MapStatus, flags: Record<string, boolean | undefined>) =>
  [base, `gis-s-${status}`, ...Object.entries(flags).filter(([, v]) => v).map(([k]) => `gis-${k}`)].join(" ");

export function hqMarker(name: string, status: MapStatus, o: { dim?: boolean; label?: boolean }) {
  return `<div class="${cls("gis-hq", status, { dim: o.dim })}">
    <svg class="gis-sym" width="46" height="46" viewBox="0 0 46 46" aria-hidden="true">
      <text x="23" y="8" class="gis-ech">II</text>
      <rect x="5" y="11" width="36" height="23" class="gis-frame"/>
      <text x="23" y="27" class="gis-in">HQ</text>
      <rect x="5" y="34" width="36" height="3" class="gis-stbar"/>
      <path d="M5 37 V46" class="gis-staff"/>
    </svg>
    ${o.label === false ? "" : `<div class="gis-lbl"><b>${esc(name)}</b><span>${statusText(status)}</span></div>`}
  </div>`;
}

export function companyMarker(
  name: string,
  status: MapStatus,
  counts: { total: number; up: number; feeds: number; alerts: number },
  o: { dim?: boolean; sel?: boolean; label?: boolean; alerts?: number },
) {
  const num = name.match(/\d+/)?.[0] ?? name.slice(0, 3);
  return `<div class="${cls("gis-company", status, { dim: o.dim, sel: o.sel })}">
    <svg class="gis-sym" width="40" height="36" viewBox="0 0 40 36" aria-hidden="true">
      <text x="20" y="7" class="gis-ech">I</text>
      <rect x="2" y="10" width="36" height="21" class="gis-frame"/>
      <text x="20" y="25" class="gis-in">${esc(num)}</text>
      <rect x="2" y="31" width="36" height="3" class="gis-stbar"/>
    </svg>
    ${o.alerts ? `<span class="gis-count-badge">${o.alerts}</span>` : ""}
    ${o.label === false ? "" : `<div class="gis-lbl"><b>${esc(name)}</b><span>${counts.total} cams · ${counts.up} up · ${statusText(status)}</span></div>`}
  </div>`;
}

export function postMarker(
  name: string,
  status: MapStatus,
  counts: { total: number; up: number },
  o: { dim?: boolean; sel?: boolean; label?: boolean; labelLeft?: boolean },
) {
  return `<div class="${cls("gis-post", status, { dim: o.dim, sel: o.sel, "lbl-left": o.labelLeft })}">
    <svg class="gis-sym" width="22" height="20" viewBox="0 0 22 20" aria-hidden="true">
      <path d="M11 1.5 L20.5 18.5 H1.5 Z" class="gis-frame"/>
      <circle cx="11" cy="13" r="3" class="gis-stdot"/>
    </svg>
    ${o.label === false ? "" : `<div class="gis-lbl"><b>${esc(name)}</b><span>${counts.up}/${counts.total}</span></div>`}
  </div>`;
}

export function cameraMarker(
  id: string,
  status: MapStatus,
  bearing: number,
  o: { sel?: boolean; alertFocus?: boolean; probe?: boolean; related?: boolean; dim?: boolean; label?: boolean; health?: string; noFeed?: boolean },
) {
  // Glyph drawn facing east; rotate so the lens points along the bearing
  return `<div class="${cls("gis-cam", status, { sel: o.sel, "alert-focus": o.alertFocus, "probe-hit": o.probe, related: o.related, dim: o.dim, "no-feed": o.noFeed })}">
    <span class="gis-sym gis-cam-rot" style="transform:rotate(${bearing - 90}deg)">
      <svg width="22" height="16" viewBox="0 0 22 16" aria-hidden="true">
        <rect x="1" y="3" width="13" height="10" rx="1.5" class="gis-frame"/>
        <path d="M14 6 L21 2.5 V13.5 L14 10 Z" class="gis-lens"/>
      </svg>
    </span>
    <span class="gis-stdot-abs"></span>
    ${o.label === false ? "" : `<div class="gis-lbl"><b>${esc(id)}</b>${o.health ? `<span>${esc(o.health)}</span>` : ""}</div>`}
  </div>`;
}

export function nvrMarker(name: string, status: MapStatus, ingest: string | null, o: { dim?: boolean }) {
  return `<div class="${cls("gis-nvr", status, { dim: o.dim, "lbl-left": true })}">
    <svg class="gis-sym" width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      <rect x="2" y="2" width="16" height="16" rx="1" class="gis-frame"/>
      <path d="M5 7 H15 M5 10.5 H15 M5 14 H15" class="gis-rack"/>
    </svg>
    <div class="gis-lbl"><b>${esc(name)}</b>${ingest ? `<span>${esc(ingest)}</span>` : ""}</div>
  </div>`;
}

export function alertBadge(count: number) {
  return `<div class="gis-alert-badge" title="${count} unacknowledged alert${count === 1 ? "" : "s"}">
    <svg width="20" height="18" viewBox="0 0 20 18" aria-hidden="true"><path d="M10 1 L19 17 H1 Z"/><text x="10" y="15">!</text></svg>
    ${count > 1 ? `<span>${count}</span>` : ""}
  </div>`;
}
