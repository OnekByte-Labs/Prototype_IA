"use client";

import { useState } from "react";
import { Button, inputClass, selectClass } from "@/components/ds";
import { fmtDist, indexConfig } from "@/lib/gis/geo";
import type { CameraEntity, LatLng, MapConfig, UnitEntity } from "@/lib/gis/types";

type Updater = (fn: (d: MapConfig) => MapConfig) => void;

const input = `${inputClass} w-full`;
const select = `${selectClass} w-full`;
const Label = ({ children }: { children: React.ReactNode }) => <span className="text-caption font-medium text-ink-2">{children}</span>;

function newId(prefix: string, taken: Set<string>) {
  for (;;) {
    const id = `${prefix}-${Math.random().toString(16).slice(2, 6).toUpperCase()}`;
    if (!taken.has(id)) return id;
  }
}

function NumberField({ label, value, min, max, step = 1, unit, onChange }: {
  label: string; value: number; min: number; max: number; step?: number; unit: string; onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="flex justify-between"><Label>{label}</Label><span className="text-caption font-data text-ink-2">{unit}</span></span>
      <div className="flex items-center gap-2">
        <input type="range" min={min} max={max} step={step} value={value} className="flex-1 ds-range"
          onChange={(e) => onChange(Number(e.target.value))} />
        <input type="number" min={min} max={max} step={step} value={Math.round(value * 10) / 10} className={`${input} w-20! font-data`}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)));
          }} />
      </div>
    </label>
  );
}

export function EditPanel({
  draft,
  activeCompanyId,
  update,
  selectedCameraId,
  onSelectCamera,
  center,
  dirty,
  saving,
  error,
  onSave,
  onCancel,
}: {
  draft: MapConfig;
  /** Company drilled into on the map — expanded by default. */
  activeCompanyId?: string | null;
  update: Updater;
  selectedCameraId: string | null;
  onSelectCamera: (id: string | null) => void;
  center: () => LatLng;
  dirty: boolean;
  saving: boolean;
  error: string | null;
  onSave: () => void;
  onCancel: () => void;
}) {
  const ix = indexConfig(draft);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(activeCompanyId ? [activeCompanyId] : []));
  const isOpen = (id: string) => expanded.has(id) || id === activeCompanyId;
  const toggleOpen = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const taken = new Set([...draft.companies, ...draft.posts].map((u) => u.id));
  const cam = selectedCameraId ? ix.cameraById.get(selectedCameraId) : undefined;
  const unplaced = draft.cameras.filter((c) => c.latitude == null || c.longitude == null);
  const unassigned = draft.cameras.filter((c) => !c.parent_id && c.latitude != null);

  const setUnit = (kind: "companies" | "posts", id: string, patch: Partial<UnitEntity>) =>
    update((d) => ({ ...d, [kind]: d[kind].map((u) => (u.id === id ? { ...u, ...patch } : u)) }));
  const setCam = (id: string, patch: Partial<CameraEntity>) =>
    update((d) => ({ ...d, cameras: d.cameras.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));

  const addCompany = () => {
    const [lat, lon] = center();
    const id = newId("COY", taken);
    update((d) => ({
      ...d,
      companies: [...d.companies, { id, parent_id: d.battalion?.id ?? null, name: `NEW COY ${id.slice(4)}`, type: "company", latitude: lat, longitude: lon, status: "OFFLINE" }],
    }));
  };
  const addPost = (companyId: string) => {
    const [lat, lon] = center();
    const id = newId("POST", taken);
    update((d) => ({
      ...d,
      posts: [...d.posts, { id, parent_id: companyId, name: `NEW POST ${id.slice(5)}`, type: "post", latitude: lat, longitude: lon, status: "OFFLINE" }],
    }));
  };
  const removePost = (postId: string) =>
    update((d) => ({
      ...d,
      posts: d.posts.filter((p) => p.id !== postId),
      cameras: d.cameras.map((c) => (c.parent_id === postId ? { ...c, parent_id: null } : c)),
    }));
  const removeCompany = (companyId: string) => {
    const posts = ix.postsOf(companyId);
    const cams = ix.camerasOfCompany(companyId).length;
    if ((posts.length || cams) && !window.confirm(
      `Remove this company, its ${posts.length} post(s)? ${cams} camera(s) will become unassigned (they stay on the map).`,
    )) return;
    const postIds = new Set(posts.map((p) => p.id));
    update((d) => ({
      ...d,
      companies: d.companies.filter((c) => c.id !== companyId),
      posts: d.posts.filter((p) => !postIds.has(p.id)),
      cameras: d.cameras.map((c) => (c.parent_id && postIds.has(c.parent_id) ? { ...c, parent_id: null } : c)),
    }));
  };

  return (
    <div className="flex flex-col min-h-0">
      <div className="p-4 border-b border-line bg-warn-wash">
        <div className="flex items-center justify-between">
          <h3 className="text-section text-warn-ink">Edit map mode</h3>
          <span className={`text-caption ${dirty ? "text-warn-ink font-medium" : "text-ink-2"}`}>{dirty ? "Unsaved changes" : "No changes"}</span>
        </div>
        <div className="mt-1 text-caption text-ink-2">
          Drag HQ, companies, posts, NVRs, cameras and boundary vertices on the map (click a company or post to drill in). Select a camera and drag its blue handle to aim it.
        </div>
        {error && <div className="mt-2 text-caption text-crit-ink">{error}</div>}
        <div className="mt-2 flex gap-2">
          <Button variant="primary" onClick={onSave} disabled={!dirty || saving}>{saving ? "Saving…" : "Save"}</Button>
          <Button onClick={onCancel} disabled={saving}>Cancel</Button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {/* Selected camera */}
        <section className="p-4 border-b border-line space-y-2.5">
          <h4 className="text-ui font-semibold text-ink">Camera</h4>
          <select className={select} value={selectedCameraId ?? ""} onChange={(e) => onSelectCamera(e.target.value || null)}>
            <option value="">— select a camera (or click one on the map) —</option>
            {draft.cameras.map((c) => <option key={c.id} value={c.id}>{c.id} · {c.name}</option>)}
          </select>
          {cam && (
            <>
              <label className="block">
                <Label>Assigned post</Label>
                <select className={select} value={cam.parent_id ?? ""} onChange={(e) => setCam(cam.id, { parent_id: e.target.value || null })}>
                  <option value="">Unassigned</option>
                  {draft.companies.map((co) => (
                    <optgroup key={co.id} label={co.name}>
                      {ix.postsOf(co.id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </optgroup>
                  ))}
                </select>
              </label>
              {cam.latitude == null ? (
                <Button size="sm" onClick={() => { const [lat, lon] = center(); setCam(cam.id, { latitude: lat, longitude: lon }); }}>
                  Place at map centre
                </Button>
              ) : (
                <>
                  <NumberField label="Bearing" unit="° from N" min={0} max={359.9} step={0.5} value={cam.bearing} onChange={(v) => setCam(cam.id, { bearing: v })} />
                  <NumberField label="FOV angle" unit="°" min={1} max={360} value={cam.fov_angle} onChange={(v) => setCam(cam.id, { fov_angle: v })} />
                  <NumberField label="Range" unit={fmtDist(cam.range)} min={10} max={3000} step={5} value={cam.range} onChange={(v) => setCam(cam.id, { range: v })} />
                  <div className="text-caption font-data text-ink-3">{cam.latitude.toFixed(6)}, {cam.longitude!.toFixed(6)}</div>
                </>
              )}
            </>
          )}
          {unplaced.length > 0 && (
            <div className="text-caption text-warn-ink">Not on the map yet: {unplaced.map((c) => c.id).join(", ")}</div>
          )}
          {unassigned.length > 0 && (
            <div className="text-caption text-ink-3">Unassigned: {unassigned.map((c) => c.id).join(", ")}</div>
          )}
        </section>

        {/* Battalion */}
        {draft.battalion && (
          <section className="p-4 border-b border-line space-y-1.5">
            <h4 className="text-ui font-semibold text-ink">Battalion HQ</h4>
            <input className={input} value={draft.battalion.name}
              onChange={(e) => update((d) => ({ ...d, battalion: d.battalion && { ...d.battalion, name: e.target.value } }))} />
          </section>
        )}

        {/* Companies & posts */}
        <section className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-ui font-semibold text-ink">Companies &amp; posts</h4>
            <Button size="sm" onClick={addCompany}>+ Company</Button>
          </div>
          {draft.companies.map((co) => (
            <div key={co.id} className="border border-line rounded-md p-2.5 space-y-2 bg-raised shadow-key-sm">
              <div className="flex gap-1 items-center">
                <button type="button" onClick={() => toggleOpen(co.id)} aria-expanded={isOpen(co.id)}
                  title={isOpen(co.id) ? "Collapse posts" : "Expand posts"}
                  className="w-6 h-8 shrink-0 text-ink-2 hover:text-ink">{isOpen(co.id) ? "▾" : "▸"}</button>
                <input className={input} value={co.name} onChange={(e) => setUnit("companies", co.id, { name: e.target.value })} aria-label={`${co.id} name`} />
                <span className="text-caption font-data text-ink-3 shrink-0 w-12 text-right">{ix.postsOf(co.id).length} posts</span>
                <Button size="sm" variant="danger" title={`Remove ${co.name}`} onClick={() => removeCompany(co.id)}>✕</Button>
              </div>
              {isOpen(co.id) && ix.postsOf(co.id).map((p) => (
                <div key={p.id} className="flex gap-1 pl-3">
                  <input className={input} value={p.name} onChange={(e) => setUnit("posts", p.id, { name: e.target.value })} aria-label={`${p.id} name`} />
                  <select className={`${select} !w-28`} value={p.parent_id ?? ""} title="Company"
                    onChange={(e) => setUnit("posts", p.id, { parent_id: e.target.value })}>
                    {draft.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <Button size="sm" variant="danger" title={`Remove ${p.name} (its cameras become unassigned)`} onClick={() => removePost(p.id)}>✕</Button>
                </div>
              ))}
              {isOpen(co.id) && (
                <div className="pl-3">
                  <Button size="sm" variant="ghost" onClick={() => addPost(co.id)}>+ Post</Button>
                </div>
              )}
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
