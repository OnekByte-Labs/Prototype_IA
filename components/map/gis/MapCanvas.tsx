"use client";

import { useEffect, useRef, useState } from "react";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import { cameraCounts, destination, distanceBearing, fovWedge, indexConfig } from "@/lib/gis/geo";
import type {
  Basemap,
  CameraEntity,
  CameraRelationship,
  CoverageResult,
  Drill,
  LatLng,
  MapConfig,
  MapHealth,
} from "@/lib/gis/types";
import { alertBadge, cameraMarker, companyMarker, hqMarker, nvrMarker, postMarker } from "./markers";
import { contourInterval, contourLayer, hillshadeLayer, sampleElevation } from "./terrainLayers";

export type Layers = {
  companies: boolean;
  posts: boolean;
  cameras: boolean;
  fov: boolean;
  zones: boolean;
  alerts: boolean;
  health: boolean;
  nvr: boolean;
  coverage: boolean;
  relationships: boolean;
  hillshade: boolean;
  contours: boolean;
  roads: boolean;
};

export type Selectable = { type: "battalion" | "company" | "post" | "camera" | "nvr"; id: string };

export interface MapCanvasProps {
  config: MapConfig;
  basemap: Basemap | null;
  drill: Drill;
  layers: Layers;
  editing: boolean;
  /** Edit mode: the camera whose aim handle is shown. */
  editSelectedId?: string | null;
  coverage: CoverageResult | null;
  /** Alert → map: the originating camera. */
  alertCameraId?: string | null;
  /** Cameras related (overlap / adjacent) to the focused camera. */
  related?: { id: string; relation: string }[];
  /** All overlap / adjacent relationships (Camera Relationships layer). */
  relationships?: CameraRelationship[] | null;
  health?: MapHealth | null;
  /** Unacknowledged alerts per camera (Alerts layer). */
  alertCounts?: Record<string, number>;
  /** "What could have seen this?" point + the cameras that cover it. */
  probe?: { point: LatLng; cameraIds: string[] } | null;
  probeMode: boolean;
  /** Changing this re-fits the view to the current drill level. */
  fitKey: string;
  onSelect: (s: Selectable) => void;
  onMapClick?: (p: LatLng) => void;
  onMove?: (s: Selectable, p: LatLng) => void;
  onAim?: (cameraId: string, bearing: number, range: number) => void;
  onBoundaryVertex?: (index: number, p: LatLng) => void;
  onCenterChange?: (p: LatLng) => void;
}

// Terrain below overlays: imagery (tilePane 200) → hillshade → contours → roads
const PANES: [string, number][] = [
  ["gis-hillshade", 250],
  ["gis-contours", 260],
  ["gis-roads", 270],
  ["gis-boundary", 405],
  ["gis-coverage", 410],
  ["gis-fov", 420],
  ["gis-zone", 430],
  ["gis-links", 440],
];

// Zoom thresholds for drawing units outside the drilled-into scope
const POSTS_FROM_ZOOM = 14;
const CAMERAS_FROM_ZOOM = 16;

function icon(html: string) {
  return L.divIcon({ className: "gis-icon", html, iconSize: [0, 0] });
}

export default function MapCanvas(props: MapCanvasProps) {
  const el = useRef<HTMLDivElement>(null);
  const readout = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const groupRef = useRef<L.LayerGroup | null>(null);
  const baseRef = useRef<L.Layer[]>([]);
  const [zoomBand, setZoomBand] = useState(13);
  // Bumped after every pan/zoom: markers are only created inside the view
  const [viewKey, setViewKey] = useState(0);
  // Latest props for Leaflet event handlers bound once
  const cb = useRef(props);
  useEffect(() => {
    cb.current = props;
  });

  /* ------------------------------------------------------------ map lifecycle */
  useEffect(() => {
    if (!el.current || mapRef.current) return;
    const map = L.map(el.current, { zoomControl: false, zoomSnap: 0.25, maxZoom: 20, worldCopyJump: false });
    L.control.zoom({ position: "bottomright" }).addTo(map);
    L.control.scale({ position: "bottomleft", imperial: false }).addTo(map);
    for (const [name, z] of PANES) map.createPane(name).style.zIndex = String(z);
    for (const name of ["gis-hillshade", "gis-contours", "gis-roads"]) map.getPane(name)!.style.pointerEvents = "none";
    groupRef.current = L.layerGroup().addTo(map);
    const bn = cb.current.config.battalion;
    map.setView(bn ? [bn.latitude, bn.longitude] : [0, 0], 13);
    map.on("click", (e: L.LeafletMouseEvent) => cb.current.onMapClick?.([e.latlng.lat, e.latlng.lng]));
    map.on("zoomend", () => setZoomBand(Math.floor(map.getZoom())));
    map.on("moveend", () => {
      const c = map.getCenter();
      cb.current.onCenterChange?.([c.lat, c.lng]);
      setViewKey((k) => k + 1);
    });
    // Cursor read-out: position + elevation sampled from the loaded DEM tiles
    map.on("mousemove", (e: L.LeafletMouseEvent) => {
      if (!readout.current) return;
      const dem = cb.current.basemap?.dem;
      const elev = dem ? sampleElevation(dem, e.latlng.lat, e.latlng.lng, map.getZoom()) : null;
      readout.current.textContent =
        `${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}` + (elev != null ? `  ·  elev ${Math.round(elev)} m` : "");
    });
    mapRef.current = map;
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  /* ----------------------------------------------------- basemap + terrain */
  const { basemap, layers } = props;
  const { hillshade, contours, roads } = layers;
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    baseRef.current.forEach((l) => l.remove());
    baseRef.current = [];
    const add = (l: L.Layer) => baseRef.current.push(l.addTo(map));
    if (basemap?.url) {
      add(L.tileLayer(basemap.url, {
        maxZoom: 20, maxNativeZoom: basemap.max_native_zoom ?? 18, attribution: basemap.attribution ?? "",
        className: "gis-imagery",
      }));
    }
    const relief = !basemap?.url;
    el.current?.classList.toggle("gis-relief-mode", relief);
    if (basemap?.dem) {
      if (hillshade || relief) add(hillshadeLayer(basemap.dem, relief, "gis-hillshade"));
      if (contours) add(contourLayer(basemap.dem, "gis-contours"));
    }
    if (roads && basemap?.reference) {
      add(L.tileLayer(basemap.reference.url, {
        pane: "gis-roads", maxZoom: 20, maxNativeZoom: basemap.reference.max_native_zoom ?? 18,
        attribution: basemap.reference.attribution ?? "", className: "gis-roads",
      }));
    }
  }, [basemap, hillshade, contours, roads]);

  useEffect(() => {
    el.current?.classList.toggle("gis-probe-cursor", props.probeMode);
  }, [props.probeMode]);

  /* ---------------------------------------------------------------- overlays */
  const { config, drill, editing, editSelectedId, coverage, alertCameraId, related: relatedList, relationships, health, alertCounts, probe } = props;
  useEffect(() => {
    const map = mapRef.current;
    const g = groupRef.current;
    if (!map || !g) return;
    g.clearLayers();
    const ix = indexConfig(config);
    const bn = config.battalion;
    const z = zoomBand;
    const view = map.getBounds().pad(0.35);
    const inView = (lat: number, lon: number) => editing || view.contains([lat, lon]);

    // ── scope: what the drill level (and zoom) puts on the map ──
    const activeCompany = drill.level === "battalion" ? null : drill.companyId;
    const activePost = drill.level === "post" || drill.level === "camera" ? drill.postId : null;
    const selectedCamera = drill.level === "camera" ? drill.cameraId : null;
    const probeIds = new Set(probe?.cameraIds ?? []);
    const related = new Set((relatedList ?? []).map((r) => r.id));
    const special = (id: string) => id === alertCameraId || id === selectedCamera || probeIds.has(id) || related.has(id) || (editing && id === editSelectedId);

    const postInScope = (postId: string | null) => {
      const p = postId ? ix.postById.get(postId) : undefined;
      if (!p) return false;
      if (activeCompany != null && p.parent_id === activeCompany) return true;
      return z >= POSTS_FROM_ZOOM;
    };
    const cameraShown = (c: CameraEntity) => {
      if (special(c.id)) return true;
      if (c.latitude == null || c.longitude == null || !inView(c.latitude, c.longitude)) return false;
      if (!layers.cameras) return false;
      if (activePost != null && c.parent_id === activePost) return true;
      if (activeCompany != null && ix.companyOfCamera(c)?.id === activeCompany && z >= (editing ? 14 : 15)) return true;
      return z >= CAMERAS_FROM_ZOOM;
    };
    const cameraWedge = (c: CameraEntity): "strong" | "faint" | null => {
      if (special(c.id)) return "strong";
      if (!layers.fov) return null;
      if (activePost != null && c.parent_id === activePost) return "strong";
      if (cameraShown(c)) return "faint";
      if (layers.coverage) return "faint";
      if (activeCompany != null && ix.companyOfCamera(c)?.id === activeCompany) return "faint";
      return null;
    };

    // ── boundary (AOR) ──
    if (bn?.boundary && bn.boundary.length >= 3) {
      const ring = L.polygon(bn.boundary, {
        pane: "gis-boundary", color: "#fffdf9", weight: 2, opacity: 0.95, dashArray: "8 6", fill: false, interactive: false,
      }).addTo(g);
      if (editing) {
        bn.boundary.forEach((v, i) => {
          const m = L.marker(v, { draggable: true, icon: icon(`<div class="gis-vertex" title="Boundary vertex"></div>`) })
            .on("drag", () => {
              const pts = [...(ring.getLatLngs()[0] as L.LatLng[])];
              pts[i] = m.getLatLng();
              ring.setLatLngs(pts);
            })
            .on("dragend", () => cb.current.onBoundaryVertex?.(i, [m.getLatLng().lat, m.getLatLng().lng]));
          m.addTo(g);
        });
      }
    }

    // ── coverage gaps ──
    if (layers.coverage && coverage?.gaps) {
      for (const gap of coverage.gaps) {
        L.polygon([gap.outer, ...gap.holes], {
          pane: "gis-coverage", color: "#ff453a", weight: 1, opacity: 0.7, dashArray: "3 4", fillColor: "#ff453a",
          fillOpacity: 0.13, interactive: false,
        }).addTo(g);
      }
    }

    // ── camera relationships ──
    const drawLink = (a: CameraEntity, b: CameraEntity, relation: string, strong: boolean) => {
      if (a.latitude == null || a.longitude == null || b.latitude == null || b.longitude == null) return;
      L.polyline([[a.latitude, a.longitude], [b.latitude, b.longitude]], {
        pane: "gis-links", color: relation === "overlap" ? "#fffdf9" : "#409cff", weight: strong ? 2 : 1.2,
        opacity: strong ? 0.95 : 0.7, dashArray: relation === "overlap" ? undefined : "5 4", interactive: false,
      }).addTo(g);
    };
    if (layers.relationships && relationships) {
      for (const r of relationships) {
        const a = ix.cameraById.get(r.camera_a);
        const b = ix.cameraById.get(r.camera_b);
        const scoped = (c: CameraEntity) => cameraShown(c) || activeCompany == null || ix.companyOfCamera(c)?.id === activeCompany;
        if (a && b && scoped(a) && scoped(b)) drawLink(a, b, r.relation, false);
      }
    }
    const focusId = alertCameraId ?? selectedCamera;
    const focus = focusId ? ix.cameraById.get(focusId) : undefined;
    if (focus) {
      for (const r of relatedList ?? []) {
        const other = ix.cameraById.get(r.id);
        if (other) drawLink(focus, other, r.relation, true);
      }
    }

    // ── cameras: FOV wedges, zones, markers ──
    for (const c of config.cameras) {
      if (c.latitude == null || c.longitude == null) continue;
      const wedgeMode = cameraWedge(c);
      const isAlert = c.id === alertCameraId;
      const isProbe = probeIds.has(c.id);
      const isSel = c.id === selectedCamera || (editing && c.id === editSelectedId);
      const isRelated = related.has(c.id) && !isSel && !isAlert;
      let wedge: L.Polygon | null = null;
      if (wedgeMode) {
        const color = isAlert ? "#ff453a" : isProbe ? "#ff9f0a" : isRelated ? "#fffdf9" : c.status === "OFFLINE" ? "#6e6e73" : isSel ? "#0a84ff" : "#409cff";
        const strong = wedgeMode === "strong";
        const hot = isSel || isAlert || isProbe;
        wedge = L.polygon(fovWedge(c), {
          pane: "gis-fov", color, weight: hot ? 2 : strong ? 1.2 : 0.6, opacity: strong ? 0.95 : 0.5, fillColor: color,
          fillOpacity: hot ? 0.3 : strong ? 0.17 : 0.08, dashArray: c.status === "OFFLINE" ? "4 4" : undefined,
          interactive: !props.probeMode,
        })
          .on("click", (e) => {
            L.DomEvent.stopPropagation(e);
            cb.current.onSelect({ type: "camera", id: c.id });
          })
          .addTo(g);
      }
      if (!editing && (c.id === selectedCamera || isAlert || (layers.zones && cameraShown(c)))) {
        if (c.zone_geo) {
          L.polygon(c.zone_geo, {
            pane: "gis-zone", color: "#ff453a", weight: 2, fillColor: "#ff453a", fillOpacity: 0.26, interactive: false,
          }).addTo(g);
        }
        if (c.line_geo) L.polyline(c.line_geo, { pane: "gis-zone", color: "#0a84ff", weight: 3, interactive: false }).addTo(g);
      }
      const alerts = alertCounts?.[c.id] ?? 0;
      if (layers.alerts && alerts > 0 && (cameraShown(c) || z >= POSTS_FROM_ZOOM)) {
        L.marker([c.latitude, c.longitude], { icon: icon(alertBadge(alerts)), interactive: true, zIndexOffset: 3000 })
          .on("click", (e) => {
            L.DomEvent.stopPropagation(e);
            cb.current.onSelect({ type: "camera", id: c.id });
          })
          .addTo(g);
      }
      if (!cameraShown(c)) continue;
      const h = layers.health ? health?.cameras[c.id] : undefined;
      const healthText = h ? (h.pipeline ? `${h.fps ?? 0} fps · ${h.frame_age_s ?? "–"}s` : h.source_bound ? "No stream" : "No feed") : undefined;
      const inPost = activePost != null && c.parent_id === activePost;
      const m = L.marker([c.latitude, c.longitude], {
        draggable: editing,
        zIndexOffset: isSel || isAlert ? 1000 : 500,
        icon: icon(cameraMarker(c.id, c.status, c.bearing, {
          sel: isSel, alertFocus: isAlert, probe: isProbe, related: isRelated, noFeed: !c.source_bound,
          label: inPost || special(c.id) || z >= 17, health: healthText,
        })),
      })
        .on("click", (e) => {
          L.DomEvent.stopPropagation(e);
          cb.current.onSelect({ type: "camera", id: c.id });
        })
        .addTo(g);
      if (editing) {
        const handle = c.id === editSelectedId ? aimHandle(g, c, wedge) : null;
        m.on("drag", () => {
          const p = m.getLatLng();
          wedge?.setLatLngs(fovWedge({ ...c, latitude: p.lat, longitude: p.lng }));
          handle?.setLatLng(destination(p.lat, p.lng, c.bearing, c.range));
        }).on("dragend", () => cb.current.onMove?.({ type: "camera", id: c.id }, [m.getLatLng().lat, m.getLatLng().lng]));
      }
    }

    // ── posts ──
    if (layers.posts || editing) {
      for (const p of config.posts) {
        const own = activeCompany != null && p.parent_id === activeCompany;
        if ((!postInScope(p.id) || !inView(p.latitude, p.longitude)) && activePost !== p.id) continue;
        const dim = activePost != null ? p.id !== activePost : !own && activeCompany != null;
        unitMarker(g, p, "post", postMarker(p.name, p.status, cameraCounts(ix.camerasOfPost(p.id)), {
          dim, sel: p.id === activePost, label: own || z >= 15, labelLeft: p.id === activePost,
        }), 200);
      }
    }

    // ── NVRs ──
    if (layers.nvr || editing) {
      for (const n of config.nvrs ?? []) {
        const ing = health?.nvrs[n.id];
        const dim = activeCompany != null && n.parent_id !== activeCompany;
        unitMarker(g, n, "nvr", nvrMarker(n.name, n.status, ing ? `${ing.streaming}/${ing.bound} live · ${ing.assigned} cam` : null, { dim }), 150);
      }
    }

    // ── companies ──
    if (layers.companies || editing) {
      for (const co of config.companies) {
        const own = co.id === activeCompany;
        if (!editing && own && drill.level !== "company") continue; // its posts carry the view
        const counts = cameraCounts(ix.camerasOfCompany(co.id));
        const alerts = ix.camerasOfCompany(co.id).reduce((n, c) => n + (alertCounts?.[c.id] ?? 0), 0);
        unitMarker(g, co, "company", companyMarker(co.name, co.status, counts, {
          dim: activeCompany != null && !own, sel: own, label: activeCompany == null || own || z < 15,
          alerts: layers.alerts ? alerts : 0,
        }), 300);
      }
    }

    // ── battalion HQ ──
    if (bn) unitMarker(g, bn, "battalion", hqMarker(bn.name, bn.status, { dim: drill.level !== "battalion" && !editing }), 400);

    // ── probe point ──
    if (probe) {
      L.circleMarker(probe.point, { radius: 7, color: "#ff9f0a", weight: 2, fillColor: "#ff9f0a", fillOpacity: 0.45, interactive: false }).addTo(g);
      for (const id of probe.cameraIds) {
        const c = ix.cameraById.get(id);
        if (c?.latitude != null && c.longitude != null) {
          L.polyline([[c.latitude, c.longitude], probe.point], { color: "#ff9f0a", weight: 1.5, dashArray: "2 4", interactive: false }).addTo(g);
        }
      }
    }

    function unitMarker(group: L.LayerGroup, u: { id: string; latitude: number; longitude: number }, type: Selectable["type"], html: string, zi: number) {
      const m = L.marker([u.latitude, u.longitude], { draggable: editing, icon: icon(html), zIndexOffset: zi })
        .on("click", (e) => {
          L.DomEvent.stopPropagation(e);
          cb.current.onSelect({ type, id: u.id });
        })
        .on("dragend", () => cb.current.onMove?.({ type, id: u.id }, [m.getLatLng().lat, m.getLatLng().lng]))
        .addTo(group);
    }

    function aimHandle(group: L.LayerGroup, c: CameraEntity, wedge: L.Polygon | null) {
      const origin: LatLng = [c.latitude!, c.longitude!];
      const line = L.polyline([origin, destination(origin[0], origin[1], c.bearing, c.range)], {
        pane: "gis-zone", color: "#0a84ff", weight: 2, dashArray: "4 3", interactive: false,
      }).addTo(group);
      const h = L.marker(destination(origin[0], origin[1], c.bearing, c.range), {
        draggable: true, zIndexOffset: 2000,
        icon: icon(`<div class="gis-aim" title="Drag to set bearing and range"></div>`),
      })
        .on("drag", () => {
          const p = h.getLatLng();
          const { bearing, distance } = distanceBearing(origin, [p.lat, p.lng]);
          wedge?.setLatLngs(fovWedge({ ...c, bearing, range: Math.max(distance, 1) }));
          line.setLatLngs([origin, [p.lat, p.lng]]);
        })
        .on("dragend", () => {
          const p = h.getLatLng();
          const { bearing, distance } = distanceBearing(origin, [p.lat, p.lng]);
          cb.current.onAim?.(c.id, Math.round(bearing * 10) / 10, Math.max(1, Math.round(distance)));
        })
        .addTo(group);
      return h;
    }
  }, [config, drill, layers, editing, editSelectedId, coverage, alertCameraId, relatedList, relationships, health, alertCounts, probe, props.probeMode, zoomBand, viewKey]);

  /* ------------------------------------------------------------- fit to view */
  const { fitKey } = props;
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const { config: cfg, drill: d } = cb.current;
    const ix = indexConfig(cfg);
    const pts: LatLng[] = [];
    const addCam = (c?: CameraEntity) => {
      if (c?.latitude == null || c.longitude == null) return;
      pts.push(...fovWedge(c, 8));
    };
    if (d.level === "battalion") {
      if (cfg.battalion?.boundary) pts.push(...cfg.battalion.boundary);
      if (cfg.battalion) pts.push([cfg.battalion.latitude, cfg.battalion.longitude]);
      cfg.companies.forEach((c) => pts.push([c.latitude, c.longitude]));
    } else if (d.level === "company") {
      const co = ix.companyById.get(d.companyId);
      if (co) pts.push([co.latitude, co.longitude]);
      ix.postsOf(d.companyId).forEach((p) => pts.push([p.latitude, p.longitude]));
      ix.camerasOfCompany(d.companyId).forEach(addCam);
    } else if (d.level === "post") {
      const p = ix.postById.get(d.postId);
      if (p) pts.push([p.latitude, p.longitude]);
      ix.camerasOfPost(d.postId).forEach(addCam);
    } else {
      addCam(ix.cameraById.get(d.cameraId));
    }
    if (pts.length === 0) return;
    // Right padding keeps the fitted area clear of the layers panel
    map.flyToBounds(L.latLngBounds(pts), {
      paddingTopLeft: [56, 56], paddingBottomRight: [270, 56], maxZoom: d.level === "battalion" ? 15 : 17, duration: 0.7,
    });
  }, [fitKey]);

  const dem = props.basemap?.dem;
  return (
    <>
      <div ref={el} className="gis-map absolute inset-0" />
      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-[500] px-2 py-0.5 bg-canvas/80 border border-line rounded-md text-caption font-data text-ink-2 pointer-events-none flex gap-3 shadow-key-sm">
        <div ref={readout}>—</div>
        {dem && contours && <div className="text-ink-3">Contours {contourInterval(Math.min(zoomBand, dem.max_native_zoom ?? 15))} m</div>}
      </div>
    </>
  );
}
