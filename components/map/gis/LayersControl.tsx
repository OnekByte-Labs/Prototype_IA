"use client";

import { useState } from "react";
import { Checkbox, Icon, Select, StatusDot } from "@/components/ds";
import { STATUS_COLOR } from "@/lib/gis/geo";
import type { Basemap, MapStatus } from "@/lib/gis/types";
import type { Layers } from "./MapCanvas";

export const DEFAULT_LAYERS: Layers = {
  companies: true,
  posts: true,
  cameras: true,
  fov: true,
  zones: true,
  alerts: true,
  health: false,
  nvr: false,
  coverage: false,
  relationships: false,
  hillshade: true,
  contours: true,
  roads: true,
};

const GROUPS: { label: string; items: [keyof Layers, string, string?][] }[] = [
  { label: "Units", items: [["companies", "Companies"], ["posts", "Posts"], ["cameras", "Cameras"]] },
  {
    label: "Sensors",
    items: [
      ["fov", "Camera FOV"],
      ["zones", "Restricted zones", "Camera zone / counting line projected onto the ground (approximate)"],
      ["relationships", "Camera relationships", "Overlapping (solid) and adjacent (dashed) cameras"],
      ["coverage", "Coverage gaps", "AOR area outside every camera FOV"],
    ],
  },
  {
    label: "Status",
    items: [
      ["alerts", "Alerts", "Unacknowledged pipeline alerts"],
      ["health", "Camera health", "Live frame rate and frame age per camera"],
      ["nvr", "NVR health", "Live ingest of each company's cameras"],
    ],
  },
  {
    label: "Terrain",
    items: [
      ["hillshade", "Hillshade", "Shaded relief computed from the elevation model"],
      ["contours", "Contours", "Contour lines from the elevation model (index every 5th)"],
      ["roads", "Roads"],
    ],
  },
];

export function LayersControl({
  layers,
  toggle,
  basemaps,
  basemap,
  setBasemap,
}: {
  layers: Layers;
  toggle: (k: keyof Layers) => void;
  basemaps: Basemap[];
  basemap: Basemap | null;
  setBasemap: (id: string) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="w-[232px] bg-surface border border-line rounded-lg shadow-card overflow-hidden">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="w-full h-9 px-3 flex items-center justify-between text-ui font-medium text-ink hover:bg-hover transition-colors">
        <span className="flex items-center gap-2"><Icon name="layers" size={16} className="text-ink-2" /> Map layers</span>
        <Icon name={open ? "expand_less" : "expand_more"} size={18} className="text-ink-3" />
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-3 border-t border-line pt-2.5 max-h-[calc(100vh-220px)] overflow-y-auto">
          {GROUPS.map((g) => (
            <div key={g.label}>
              <div className="text-caption font-medium text-ink-3 mb-1">{g.label}</div>
              <div className="grid grid-cols-1 gap-1">
                {g.items.map(([k, label, title]) => {
                  const disabled = g.label === "Terrain" && (k === "roads" ? !basemap?.reference : !basemap?.dem);
                  return (
                    <label key={k} title={title}
                      className={`flex items-center gap-2 text-ui leading-6 cursor-pointer ${disabled ? "opacity-45 cursor-not-allowed" : "text-ink"}`}>
                      <Checkbox checked={layers[k]} disabled={disabled} onChange={() => toggle(k)} />
                      {label}
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
          <div>
            <div className="text-caption font-medium text-ink-3 mb-1">Basemap</div>
            <Select value={basemap?.id ?? ""} aria-label="Basemap" onChange={(e) => setBasemap(e.target.value)} className="w-full">
              {basemaps.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
            </Select>
          </div>
        </div>
      )}
    </div>
  );
}

const F = "#17181d";
const K = "#a1a1a6";
const SYMBOLS: [string, string][] = [
  ["Battalion HQ", `<svg width="22" height="18" viewBox="0 0 46 38"><rect x="5" y="9" width="36" height="23" fill="${F}" stroke="${K}" stroke-width="3"/><text x="23" y="26" fill="#f5f5f7" font-size="12" text-anchor="middle" font-weight="700">HQ</text></svg>`],
  ["Company", `<svg width="20" height="16" viewBox="0 0 40 34"><rect x="2" y="6" width="36" height="22" fill="${F}" stroke="${K}" stroke-width="3"/></svg>`],
  ["Post", `<svg width="14" height="13" viewBox="0 0 22 20"><path d="M11 1.5 L20.5 18.5 H1.5 Z" fill="${F}" stroke="${K}" stroke-width="2.4"/></svg>`],
  ["Camera", `<svg width="18" height="13" viewBox="0 0 22 16"><rect x="1" y="3" width="13" height="10" rx="1.5" fill="${F}" stroke="${K}" stroke-width="2"/><path d="M14 6 L21 2.5 V13.5 L14 10 Z" fill="${K}"/></svg>`],
  ["NVR", `<svg width="13" height="13" viewBox="0 0 20 20"><rect x="2" y="2" width="16" height="16" fill="${F}" stroke="${K}" stroke-width="2"/><path d="M5 7 H15 M5 10.5 H15 M5 14 H15" stroke="${K}" stroke-width="1.6"/></svg>`],
];

const STATUS_LABEL: Record<MapStatus, string> = { ONLINE: "Online", ALERT: "Alert", DEGRADED: "Degraded", OFFLINE: "Offline" };

export function Legend({ wsConnected }: { wsConnected: boolean }) {
  return (
    <div className="absolute bottom-9 left-3 z-[500] px-3 py-2 bg-surface border border-line rounded-lg shadow-card pointer-events-none space-y-1.5">
      <div className="flex items-center gap-4">
        {SYMBOLS.map(([label, svg]) => (
          <span key={label} className="flex items-center gap-1.5 text-caption text-ink-2">
            <span dangerouslySetInnerHTML={{ __html: svg }} />
            {label}
          </span>
        ))}
      </div>
      <div className="flex items-center gap-4">
        {(["ONLINE", "ALERT", "DEGRADED", "OFFLINE"] as MapStatus[]).map((s) => (
          <span key={s} className="flex items-center gap-1.5 text-caption text-ink-2">
            <span className="w-2 h-2 rounded-full" style={{ background: STATUS_COLOR[s] }} />{STATUS_LABEL[s]}
          </span>
        ))}
        <span className="flex items-center gap-1.5 text-caption text-ink-2">
          <StatusDot tone={wsConnected ? "ok" : "warn"} />{wsConnected ? "Live" : "Status link down"}
        </span>
      </div>
    </div>
  );
}
