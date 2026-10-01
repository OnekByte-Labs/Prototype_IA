"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { useConsole } from "@/components/gotham/ConsoleProvider";
import { Button, Icon, Input, Modal } from "@/components/ds";
import { cx } from "@/lib/design/cx";
import { useToast } from "@/components/gotham/Toast";
import type { Alert } from "@/lib/gotham/model";
import { indexConfig, STATUS_COLOR } from "@/lib/gis/geo";
import { fetchJson, MAP_KEY, relationshipsKey, useTacticalMap, withStatuses } from "@/lib/gis/use-tactical-map";
import type { CameraRelationship, CoverageResult, Drill, LatLng, MapConfig, MapHealth, MapStatus, PointCoverage } from "@/lib/gis/types";
import type { Layers, Selectable } from "./MapCanvas";
import { DEFAULT_LAYERS, LayersControl, Legend } from "./LayersControl";
import { AlertsPanel, CameraPanel, CoverageSummary, HierarchyPanel, ProbePanel } from "./panels";
import { EditPanel } from "./EditPanel";

const MapCanvas = dynamic(() => import("./MapCanvas"), {
  ssr: false,
  loading: () => <div className="absolute inset-0 flex items-center justify-center text-ui text-ink-2">Loading map…</div>,
});

const BASEMAP_KEY = "gis_basemap";
const LAYERS_KEY = "gis_layers";

/** PUT /api/v1/map payload from an (edited) config. */
function saveBody(d: MapConfig) {
  return {
    revision: d.revision,
    battalion: d.battalion && {
      name: d.battalion.name, latitude: d.battalion.latitude, longitude: d.battalion.longitude, boundary: d.battalion.boundary,
    },
    companies: d.companies.map(({ id, name, latitude, longitude }) => ({ id, name, latitude, longitude })),
    posts: d.posts.map(({ id, parent_id, name, latitude, longitude }) => ({ id, parent_id, name, latitude, longitude })),
    cameras: d.cameras
      .filter((c) => c.latitude != null && c.longitude != null)
      .map(({ id, parent_id, latitude, longitude, bearing, fov_angle, range }) => ({ id, parent_id, latitude, longitude, bearing, fov_angle, range })),
    nvrs: (d.nvrs ?? []).map(({ id, parent_id, name, latitude, longitude }) => ({ id, parent_id, name, latitude, longitude })),
  };
}

type EditState = { token: string; base: MapConfig; draft: MapConfig; selected: string | null };
type ProbeState = { point: LatLng; result: PointCoverage | null; loading: boolean; error: string | null };

export function TacticalMapConsole({
  initialCameraId,
  initialAlertId,
  initialCompanyId,
}: {
  initialCameraId?: string;
  initialAlertId?: string;
  initialCompanyId?: string;
}) {
  const toast = useToast();
  const { alerts, wsConnected } = useConsole();
  const { config, saved, statuses, error, isLoading, mutate } = useTacticalMap();

  const [drill, setDrill] = useState<Drill>({ level: "battalion" });
  const [fitN, setFitN] = useState(0);
  const [layers, setLayers] = useState<Layers>(() => {
    try {
      const saved = typeof window !== "undefined" ? localStorage.getItem(LAYERS_KEY) : null;
      return saved ? { ...DEFAULT_LAYERS, ...JSON.parse(saved) } : DEFAULT_LAYERS;
    } catch {
      return DEFAULT_LAYERS;
    }
  });
  const [probeMode, setProbeMode] = useState(false);
  const [probe, setProbe] = useState<ProbeState | null>(null);
  const [excludeOffline, setExcludeOffline] = useState(false);
  const [alertFocus, setAlertFocus] = useState<{ alertId: string | null; cameraId: string } | null>(null);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [passOpen, setPassOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [basemapId, setBasemapId] = useState<string | null>(() => {
    try {
      return typeof window !== "undefined" ? localStorage.getItem(BASEMAP_KEY) : null;
    } catch {
      return null;
    }
  });
  const centerRef = useRef<LatLng>([0, 0]);

  const shown = useMemo(() => (edit ? withStatuses(edit.draft, statuses) : config), [edit, statuses, config]);
  const ix = useMemo(() => (shown ? indexConfig(shown) : null), [shown]);
  const basemap = useMemo(() => {
    if (!shown) return null;
    return shown.basemaps.find((b) => b.id === basemapId) ?? shown.basemaps.find((b) => b.id === shown.default_basemap) ?? null;
  }, [shown, basemapId]);

  /* --------------------------------------------------------- live feeds */
  // Camera / NVR ingest health (frame age, measured fps) — only while shown
  const { data: health } = useSWR<MapHealth>(
    layers.health || layers.nvr ? "/api/v1/map/health" : null,
    (u: string) => fetchJson<MapHealth>(u),
    { refreshInterval: 3000 },
  );
  const revision = saved?.revision ?? 0;
  const { data: allRelationships } = useSWR<CameraRelationship[]>(
    layers.relationships ? `/api/v1/map/relationships?rev=${revision}` : null,
    (u: string) => fetchJson<CameraRelationship[]>(u),
  );
  const alertCounts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const a of alerts) if (a.status === "new") out[a.cameraId] = (out[a.cameraId] ?? 0) + 1;
    return out;
  }, [alerts]);

  /* ------------------------------------------------------------ navigation */
  const go = useCallback((d: Drill) => {
    setDrill(d);
    setFitN((n) => n + 1);
  }, []);
  const openCompany = useCallback((id: string) => go({ level: "company", companyId: id }), [go]);
  const openPost = useCallback(
    (id: string) => go({ level: "post", postId: id, companyId: ix?.postById.get(id)?.parent_id ?? "" }),
    [go, ix],
  );
  const openCamera = useCallback(
    (id: string) => {
      const cam = ix?.cameraById.get(id);
      const post = cam?.parent_id ? ix?.postById.get(cam.parent_id) : undefined;
      go({ level: "camera", cameraId: id, postId: post?.id ?? null, companyId: post?.parent_id ?? null });
    },
    [go, ix],
  );
  const up = useCallback(() => {
    if (drill.level === "camera") {
      if (drill.postId && drill.companyId) go({ level: "post", postId: drill.postId, companyId: drill.companyId });
      else if (drill.companyId) go({ level: "company", companyId: drill.companyId });
      else go({ level: "battalion" });
    } else if (drill.level === "post") go({ level: "company", companyId: drill.companyId });
    else go({ level: "battalion" });
  }, [drill, go]);

  const focusAlert = useCallback(
    (a: Pick<Alert, "id" | "cameraId">) => {
      setAlertFocus({ alertId: a.id, cameraId: a.cameraId });
      setProbe(null);
      setProbeMode(false);
      openCamera(a.cameraId);
    },
    [openCamera],
  );

  // Deep link: /map?alert=<id>&camera=<id> (Alert console "Map" action) or
  // /map?camera=<id> or /map?company=<id> (Devices NVR row) — applied once, as soon as the map config has loaded.
  const [linkApplied, setLinkApplied] = useState(false);
  if (!linkApplied && ix) {
    setLinkApplied(true);
    const alert = initialAlertId ? alerts.find((a) => a.id === initialAlertId) : undefined;
    const camId = alert?.cameraId ?? initialCameraId;
    if (camId && ix.cameraById.has(camId)) {
      if (initialAlertId) focusAlert({ id: initialAlertId, cameraId: camId });
      else openCamera(camId);
    } else if (initialCompanyId && ix.companyById.has(initialCompanyId)) {
      openCompany(initialCompanyId);
    } else {
      setFitN((n) => n + 1);
    }
  }

  // Nearby related cameras of the focused (selected / alert) camera
  const focusCameraId = alertFocus?.cameraId ?? (drill.level === "camera" ? drill.cameraId : null);
  const { data: focusRels } = useSWR<CameraRelationship[]>(
    focusCameraId && !edit ? relationshipsKey(focusCameraId, revision) : null,
    (u: string) => fetchJson<CameraRelationship[]>(u),
  );
  const related = useMemo(
    () => (focusRels ?? []).filter((r) => r.relation === "overlap" || r.relation === "adjacent").map((r) => ({ id: r.other, relation: r.relation })),
    [focusRels],
  );
  const linkRelationships = useMemo(
    () => (allRelationships ?? []).filter((r) => r.relation === "overlap" || r.relation === "adjacent"),
    [allRelationships],
  );

  /* --------------------------------------------------------------- probe */
  const runProbe = useCallback(async (p: LatLng) => {
    setProbe({ point: p, result: null, loading: true, error: null });
    try {
      const result = await fetchJson<PointCoverage>(`/api/v1/map/cameras-at?lat=${p[0]}&lon=${p[1]}`);
      setProbe({ point: p, result, loading: false, error: null });
    } catch (e) {
      setProbe({ point: p, result: null, loading: false, error: (e as Error).message });
    }
  }, []);

  /* ------------------------------------------------------------ coverage */
  const [coverage, setCoverage] = useState<CoverageResult | null>(null);
  const [coverageLoading, setCoverageLoading] = useState(false);
  const [coverageError, setCoverageError] = useState<string | null>(null);
  const offlineKey = useMemo(
    () => (excludeOffline && shown ? shown.cameras.filter((c) => c.status === "OFFLINE").map((c) => c.id).join(",") : ""),
    [excludeOffline, shown],
  );
  const draftBody = useMemo(() => (edit ? JSON.stringify(saveBody(edit.draft)) : null), [edit]);
  useEffect(() => {
    if (!layers.coverage) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setCoverageLoading(true);
      try {
        const url = `/api/v1/map/coverage?exclude_offline=${excludeOffline}`;
        const res = await fetchJson<CoverageResult>(url, draftBody
          ? { method: "POST", headers: { "Content-Type": "application/json" }, body: draftBody, signal: ctrl.signal }
          : { signal: ctrl.signal });
        setCoverage(res);
        setCoverageError(null);
      } catch (e) {
        if (!ctrl.signal.aborted) setCoverageError((e as Error).message);
      } finally {
        if (!ctrl.signal.aborted) setCoverageLoading(false);
      }
    }, draftBody ? 400 : 0);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [layers.coverage, excludeOffline, draftBody, saved?.revision, offlineKey]);

  /* ---------------------------------------------------------------- edit */
  const dirty = useMemo(
    () => !!edit && JSON.stringify(saveBody(edit.draft)) !== JSON.stringify(saveBody(edit.base)),
    [edit],
  );
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const update = useCallback((fn: (d: MapConfig) => MapConfig) => {
    setEdit((e) => (e ? { ...e, draft: fn(e.draft) } : e));
  }, []);

  const startEdit = useCallback(
    (token: string) => {
      setPassOpen(false);
      setEditError(null);
      if (edit) {
        setEdit({ ...edit, token }); // re-authorized mid-edit: keep the draft
        return;
      }
      if (!saved) return;
      setEdit({ token, base: saved, draft: saved, selected: drill.level === "camera" ? drill.cameraId : null });
      setProbe(null);
      setProbeMode(false);
      setAlertFocus(null);
    },
    [edit, saved, drill],
  );

  const endSession = useCallback((token: string) => {
    void fetch("/api/v1/map/edit-session", { method: "DELETE", headers: { "X-Map-Edit-Token": token } }).catch(() => {});
  }, []);

  const cancelEdit = useCallback(() => {
    if (!edit) return;
    if (dirty && !window.confirm("Discard unsaved map changes?")) return;
    endSession(edit.token);
    setEdit(null);
    setEditError(null);
    void mutate(); // restore the last saved configuration
    toast("Map edits discarded");
  }, [edit, dirty, endSession, mutate, toast]);

  const saveEdit = useCallback(async () => {
    if (!edit) return;
    setSaving(true);
    setEditError(null);
    try {
      const res = await fetch(MAP_KEY, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-Map-Edit-Token": edit.token },
        body: JSON.stringify(saveBody(edit.draft)),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 401) {
        setEditError(`${body.error ?? "Edit session expired"} — your changes are kept.`);
        setPassOpen(true);
        return;
      }
      if (!res.ok) {
        setEditError(
          res.status === 409
            ? `${body.error}. Cancel to load the latest map, then re-apply your edits.`
            : (body.error ?? `Save failed (${res.status})`),
        );
        return;
      }
      await mutate(body as MapConfig, { revalidate: false });
      endSession(edit.token);
      setEdit(null);
      toast(`Map saved · revision ${(body as MapConfig).revision}`, "ok");
    } catch {
      setEditError("AI pipeline unreachable — nothing was saved.");
    } finally {
      setSaving(false);
    }
  }, [edit, mutate, endSession, toast]);

  /* ------------------------------------------------------- map callbacks */
  const onSelect = useCallback(
    (s: Selectable) => {
      if (edit && s.type === "camera") {
        setEdit((e) => (e ? { ...e, selected: s.id } : e));
        return;
      }
      if (probeMode) setProbeMode(false);
      if (s.type === "company") openCompany(s.id);
      else if (s.type === "post") openPost(s.id);
      else if (s.type === "camera") openCamera(s.id);
      else if (s.type === "nvr") {
        const n = shown?.nvrs.find((x) => x.id === s.id);
        if (n) openCompany(n.parent_id);
      } else go({ level: "battalion" });
    },
    [edit, probeMode, openCompany, openPost, openCamera, go, shown],
  );

  const onMapClick = useCallback(
    (p: LatLng) => {
      if (probeMode && !edit) void runProbe(p);
    },
    [probeMode, edit, runProbe],
  );

  const onMove = useCallback(
    (s: Selectable, [lat, lon]: LatLng) =>
      update((d) => {
        if (s.type === "battalion") return { ...d, battalion: d.battalion && { ...d.battalion, latitude: lat, longitude: lon } };
        if (s.type === "company") return { ...d, companies: d.companies.map((u) => (u.id === s.id ? { ...u, latitude: lat, longitude: lon } : u)) };
        if (s.type === "post") return { ...d, posts: d.posts.map((u) => (u.id === s.id ? { ...u, latitude: lat, longitude: lon } : u)) };
        if (s.type === "nvr") return { ...d, nvrs: d.nvrs.map((u) => (u.id === s.id ? { ...u, latitude: lat, longitude: lon } : u)) };
        return { ...d, cameras: d.cameras.map((c) => (c.id === s.id ? { ...c, latitude: lat, longitude: lon } : c)) };
      }),
    [update],
  );
  const onAim = useCallback(
    (id: string, bearing: number, range: number) =>
      update((d) => ({ ...d, cameras: d.cameras.map((c) => (c.id === id ? { ...c, bearing, range } : c)) })),
    [update],
  );
  const onBoundaryVertex = useCallback(
    (i: number, p: LatLng) =>
      update((d) => d.battalion?.boundary
        ? { ...d, battalion: { ...d.battalion, boundary: d.battalion.boundary.map((v, j) => (j === i ? p : v)) } }
        : d),
    [update],
  );
  const onCenterChange = useCallback((p: LatLng) => {
    centerRef.current = p;
  }, []);

  const probeHighlight = useMemo(
    () => (probe?.result ? { point: probe.point, cameraIds: probe.result.cameras.map((c) => c.camera_id) } : probe ? { point: probe.point, cameraIds: [] } : null),
    [probe],
  );

  /* ------------------------------------------------------------- render */
  if (!shown || !ix) {
    return (
      <div className="flex-1 flex items-center justify-center bg-canvas">
        <div className="text-center space-y-3">
          <div className="text-body text-ink">{isLoading ? "Loading tactical map…" : "Tactical map unavailable"}</div>
          {error && <div className="text-caption text-crit-ink">{error.message}</div>}
          {!isLoading && <Button onClick={() => mutate()}>Retry</Button>}
        </div>
      </div>
    );
  }

  const selectedCamera = drill.level === "camera" ? ix.cameraById.get(drill.cameraId) : undefined;
  const focusedAlert = alertFocus?.alertId ? alerts.find((a) => a.id === alertFocus.alertId) ?? null : null;
  const crumbs: { label: string; status?: MapStatus; onClick?: () => void }[] = [
    { label: shown.battalion?.name ?? "Battalion", status: shown.battalion?.status, onClick: () => go({ level: "battalion" }) },
  ];
  if (drill.level !== "battalion") {
    const co = drill.companyId ? ix.companyById.get(drill.companyId) : undefined;
    if (co) crumbs.push({ label: co.name, status: co.status, onClick: () => openCompany(co.id) });
    if ((drill.level === "post" || drill.level === "camera") && drill.postId) {
      const p = ix.postById.get(drill.postId);
      if (p) crumbs.push({ label: p.name, status: p.status, onClick: () => openPost(p.id) });
    }
    if (selectedCamera) crumbs.push({ label: selectedCamera.id, status: selectedCamera.status });
  }

  const toggle = (k: keyof Layers) =>
    setLayers((l) => {
      const next = { ...l, [k]: !l[k] };
      try {
        localStorage.setItem(LAYERS_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  return (
    <div className="flex-1 min-h-0 flex overflow-hidden">
      <section className="flex-1 min-w-0 flex flex-col">
        {/* Toolbar: hierarchy breadcrumb + edit controls */}
        <div className="min-h-12 shrink-0 px-5 py-2 flex items-center gap-3 bg-surface border-b border-line">
          <h1 className="text-headline text-ink shrink-0 pr-3 mr-1 border-r border-line">Tactical map</h1>
          <Button size="sm" onClick={up} disabled={drill.level === "battalion"} title="Up one level">
            <Icon name="arrow_upward" size={15} className="text-ink-2" /> Up
          </Button>
          <nav className="flex-1 flex items-center gap-1.5 min-w-0 text-ui" aria-label="Map hierarchy">
            {crumbs.map((c, i) => (
              <span key={i} className="flex items-center gap-1.5 min-w-0">
                {i > 0 && <Icon name="chevron_right" size={16} className="text-ink-3" />}
                <button type="button" onClick={c.onClick} disabled={!c.onClick}
                  className={cx(
                    "flex items-center gap-1.5 truncate rounded-md px-1.5 h-7 transition-colors",
                    i === crumbs.length - 1 ? "text-ink font-semibold" : "text-ink-2 hover:text-ink hover:bg-hover",
                  )}>
                  {c.status && <span className="w-2 h-2 shrink-0 rounded-full" style={{ background: STATUS_COLOR[c.status] }} />}
                  {c.label}
                </button>
              </span>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2 shrink-0">
            {edit ? (
              <>
                <span className="text-ui font-medium text-warn-ink mr-1">Editing map</span>
                <Button size="sm" variant="primary" onClick={saveEdit} disabled={!dirty || saving}>{saving ? "Saving…" : "Save"}</Button>
                <Button size="sm" onClick={cancelEdit} disabled={saving}>Cancel</Button>
              </>
            ) : (
              <Button size="sm" onClick={() => setPassOpen(true)} disabled={!saved} title="Authorized operators only">
                <Icon name="edit_location_alt" size={15} className="text-ink-2" /> Edit map
              </Button>
            )}
          </div>
        </div>

        <div className="relative flex-1 min-h-0">
          <MapCanvas
            config={shown}
            basemap={basemap}
            drill={drill}
            layers={layers}
            editing={!!edit}
            editSelectedId={edit?.selected ?? null}
            coverage={layers.coverage ? coverage : null}
            alertCameraId={alertFocus?.cameraId ?? null}
            related={related}
            relationships={layers.relationships ? linkRelationships : null}
            health={health ?? null}
            alertCounts={alertCounts}
            probe={probeHighlight}
            probeMode={probeMode && !edit}
            fitKey={String(fitN)}
            onSelect={onSelect}
            onMapClick={onMapClick}
            onMove={onMove}
            onAim={onAim}
            onBoundaryVertex={onBoundaryVertex}
            onCenterChange={onCenterChange}
          />
          <div className="absolute top-3 right-3 z-[500] flex flex-col items-end gap-2">
            <Button
              size="sm"
              pressed={probeMode}
              disabled={!!edit}
              className="shadow-key"
              onClick={() => { setProbeMode((m) => !m); if (probeMode) setProbe(null); }}
              title="Click a point on the map to find every camera whose FOV contains it">
              <Icon name="my_location" size={15} className="text-ink-2" /> What could have seen this?
            </Button>
            <LayersControl
              layers={layers}
              toggle={toggle}
              basemaps={shown.basemaps}
              basemap={basemap}
              setBasemap={(id) => { setBasemapId(id); try { localStorage.setItem(BASEMAP_KEY, id); } catch {} }}
            />
          </div>
          {shown.synthetic_positions && (
            <div className="absolute top-3 left-3 z-[500] px-3 py-1.5 bg-warn-wash border border-warn/40 rounded-md text-ui text-warn-ink shadow-key-sm pointer-events-none">
              Synthetic placeholder positions · development only
            </div>
          )}
          <Legend wsConnected={wsConnected} />
          {probeMode && !edit && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[500] px-3 py-1.5 bg-surface border border-warn/50 rounded-md text-ui text-warn-ink shadow-key pointer-events-none">
              Click a point on the map
            </div>
          )}
          <PassphraseDialog
            open={passOpen}
            reauth={!!edit}
            onCancel={() => setPassOpen(false)}
            onToken={startEdit}
          />
        </div>
      </section>

      <aside className="w-[392px] shrink-0 border-l border-line bg-surface flex flex-col min-h-0">
        {edit ? (
          <>
            <EditPanel
              draft={edit.draft}
              activeCompanyId={drill.level === "battalion" ? null : drill.companyId}
              update={update}
              selectedCameraId={edit.selected}
              onSelectCamera={(id) => setEdit((e) => (e ? { ...e, selected: id } : e))}
              center={() => centerRef.current}
              dirty={dirty}
              saving={saving}
              error={editError}
              onSave={saveEdit}
              onCancel={cancelEdit}
            />
            {layers.coverage && (
              <CoverageSummary coverage={coverage} loading={coverageLoading} error={coverageError}
                excludeOffline={excludeOffline} setExcludeOffline={setExcludeOffline} draft />
            )}
          </>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto">
            {probe && (
              <ProbePanel probe={probe.result} loading={probe.loading} error={probe.error} ix={ix}
                onOpen={(id) => { setProbeMode(false); openCamera(id); }}
                onClose={() => { setProbe(null); setProbeMode(false); }} />
            )}
            {layers.coverage && (
              <CoverageSummary coverage={coverage} loading={coverageLoading} error={coverageError}
                excludeOffline={excludeOffline} setExcludeOffline={setExcludeOffline} />
            )}
            {selectedCamera ? (
              <CameraPanel
                camera={selectedCamera}
                ix={ix}
                revision={revision}
                health={health}
                alert={alertFocus?.cameraId === selectedCamera.id ? focusedAlert : null}
                onCamera={openCamera}
                onPost={openPost}
                onCompany={openCompany}
              />
            ) : (
              <HierarchyPanel config={shown} ix={ix} drill={drill} health={health} onCompany={openCompany} onPost={openPost} onCamera={openCamera} />
            )}
            {alertFocus && (
              <div className="px-4 py-2 border-b border-line flex items-center justify-between">
                <span className="text-ui font-medium text-ink">Alert focus: <span className="font-data text-data">{alertFocus.cameraId}</span></span>
                <Button size="sm" variant="ghost" onClick={() => setAlertFocus(null)}>Clear</Button>
              </div>
            )}
            <AlertsPanel alerts={alerts} activeAlertId={alertFocus?.alertId} onFocus={focusAlert} />
          </div>
        )}
      </aside>
    </div>
  );
}

function PassphraseDialog({ open, reauth, onCancel, onToken }: { open: boolean; reauth: boolean; onCancel: () => void; onToken: (t: string) => void }) {
  const [pass, setPass] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await fetchJson<{ token: string }>("/api/v1/map/edit-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passphrase: pass }),
      });
      onToken(res.token);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onCancel}
      size="sm"
      title={reauth ? "Re-authorize map editing" : "Edit map — authorization"}
      description="Enter the map edit passphrase configured on the command-center backend."
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" disabled={!pass || busy} onClick={(e) => void submit(e as unknown as React.FormEvent)}>
            {busy ? "Checking…" : "Unlock"}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-2">
        <Input type="password" autoFocus value={pass} onChange={(e) => setPass(e.target.value)} aria-label="Edit passphrase" className="w-full" />
        {err && <div className="text-caption text-crit-ink">{err}</div>}
      </form>
    </Modal>
  );
}
