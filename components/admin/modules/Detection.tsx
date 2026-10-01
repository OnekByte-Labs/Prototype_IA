"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ds";
import { useSession } from "@/lib/use-session";
import {
  adminCall, ConfigApplyBar, ConfigFields, dash, dt, Empty, Input, KV, Loading, ModuleHeader, Notice, PermButton,
  Section, Select, Status, Table, Tabs, Td, Tr, useAction, useAdmin, useConfigDraft, bytes,
} from "../kit";

type DCam = { camera_id: string; name: string; company_name: string | null; post_name: string | null; source_bound: boolean;
  mode: string; state: string | null; health: string | null; geometry: { zone: number[][] | null; line: number[][] | null; buffer_px: number } };
type Detection = { cameras: DCam[]; suppressed: Record<string, number>; version: number };

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const THRESHOLDS = ["detection.detect_interval", "detection.intrusion_confirm_frames", "detection.anpr_max_per_frame",
  "detection.anpr_min_vehicle_px", "detection.anpr_min_plate_conf", "detection.anomaly_warmup_s", "detection.anomaly_loiter_s",
  "detection.anomaly_speed_k", "detection.anomaly_min_speed"];

export function DetectionModule({ go }: { go: (m: string) => void }) {
  const [tab, setTab] = useState<"cameras" | "thresholds" | "alerts" | "schedules">("cameras");
  const det = useAdmin<Detection>("detection", { topics: ["config"], refresh: 10000 });
  const draft = useConfigDraft();
  return (
    <>
      <ModuleHeader title="Detection & rules" sub={`config v${draft.cfg.data?.active.version ?? "—"} · changes are previewed, versioned and pushed to the inference workers`} />
      <Tabs tabs={[["cameras", "Cameras · modes · zones"], ["thresholds", "Thresholds"], ["alerts", "Alert severity & cooldown"], ["schedules", "Arming schedules"]]}
        value={tab} onChange={(t) => { setTab(t); draft.reset(); }} />
      <div className="flex-1 min-h-0 overflow-auto p-6 flex flex-col gap-4">
        {tab === "cameras" && (!det.data ? <Loading error={det.error} /> : <CameraRules d={det.data} schedules={draft.doc?.schedules ?? {}} go={go} />)}
        {tab === "thresholds" && (
          <Section title="Pipeline thresholds (read by each pipeline at start — affected pipelines restart on apply)">
            <ConfigFields paths={THRESHOLDS} draft={draft} />
            <ConfigApplyBar draft={draft} />
          </Section>
        )}
        {tab === "alerts" && <AlertPolicies draft={draft} suppressed={det.data?.suppressed ?? {}} />}
        {tab === "schedules" && <Schedules draft={draft} cams={det.data?.cameras ?? []} />}
      </div>
    </>
  );
}

function CameraRules({ d, schedules, go }: { d: Detection; schedules: Record<string, unknown[]>; go: (m: string) => void }) {
  return (
    <>
      <Notice>
        Detection mode = the AI pipeline (and models) a camera runs. Change it in AI models ▸ Assignment, which checks GPU
        capacity first. Zones and counting lines are drawn in the existing editor on the Cameras screen (native stream pixels).
        <Button size="sm" className="ml-2" onClick={() => go("models")}>Open assignment</Button>
      </Notice>
      <Section title={`Cameras (${d.cameras.length})`} flush>
        <Table head={["Camera", "Name", "Site", "Mode", "Pipeline", "Restricted zone", "Counting line", "Buffer", "Arming", ""]} testid="rules-table">
          {d.cameras.filter((c) => c.source_bound).map((c) => (
            <Tr key={c.camera_id} tone={c.state === "error" ? "red" : undefined}>
              <Td mono>{c.camera_id}</Td><Td>{c.name}</Td><Td muted>{[c.company_name, c.post_name].filter(Boolean).join(" / ")}</Td>
              <Td>{c.mode.replace(/_/g, " ")}</Td><Td><Status value={c.state} /></Td>
              <Td mono muted>{c.geometry.zone ? `${c.geometry.zone.length} vertices` : "—"}</Td>
              <Td mono muted>{c.geometry.line ? `${c.geometry.line.length} points` : "—"}</Td>
              <Td mono muted>{c.geometry.buffer_px} px</Td>
              <Td muted>{schedules[c.camera_id] ? `${schedules[c.camera_id].length} window(s)` : "always armed"}</Td>
              <Td><Link href={`/cameras?inspect=${c.camera_id}`} className="text-caption text-accent-ink hover:underline">Edit zone ›</Link></Td>
            </Tr>
          ))}
        </Table>
        <div className="px-2.5 py-1.5 text-caption text-ink-3">{d.cameras.filter((c) => !c.source_bound).length} cameras without a video source are not listed.</div>
      </Section>
    </>
  );
}

function AlertPolicies({ draft, suppressed }: { draft: ReturnType<typeof useConfigDraft>; suppressed: Record<string, number> }) {
  const { can } = useSession();
  const doc = draft.doc;
  if (!doc) return <Loading />;
  const sevs = draft.cfg.data?.schema.severities ?? ["high", "med", "low"];
  const pol = doc.alerts.policies;
  const ok = can("config.manage");
  return (
    <Section title="Alert policy per event type (events are always stored; policy decides whether an alert is raised)">
      <Table head={["Event type", "Raise alerts", "Severity", "Cooldown per camera (s)", "Currently"]} testid="alert-policy">
        {Object.entries(pol).map(([et, p]) => {
          const cur = draft.cfg.data?.active.doc.alerts.policies[et];
          return (
            <Tr key={et}>
              <Td mono>{et}</Td>
              <Td><input type="checkbox" className="ds-check" disabled={!ok} checked={p.enabled} data-testid={`pol-enabled-${et}`}
                onChange={() => draft.set(`alerts.policies.${et}.enabled`, !p.enabled)} /></Td>
              <Td><Select value={p.severity} disabled={!ok} onChange={(v) => draft.set(`alerts.policies.${et}.severity`, v)}
                options={sevs.map((s) => [s, s === "med" ? "medium" : s])} className="w-28" testid={`pol-sev-${et}`} /></Td>
              <Td><Input type="number" disabled={!ok} value={p.cooldown_s} className="w-24 font-data" data-testid={`pol-cd-${et}`}
                onChange={(e) => draft.set(`alerts.policies.${et}.cooldown_s`, Number(e.target.value))} /></Td>
              <Td mono muted>{cur ? `${cur.enabled ? "on" : "off"} · ${cur.severity} · ${cur.cooldown_s}s` : "—"}</Td>
            </Tr>
          );
        })}
      </Table>
      <div className="pt-2"><ConfigApplyBar draft={draft} /></div>
      <KV cols={3} rows={[["suppressed · cooldown", suppressed.cooldown ?? 0], ["suppressed · schedule", suppressed.schedule ?? 0], ["suppressed · disabled", suppressed.disabled ?? 0]]} />
    </Section>
  );
}

function Schedules({ draft, cams }: { draft: ReturnType<typeof useConfigDraft>; cams: DCam[] }) {
  const { can } = useSession();
  const [cam, setCam] = useState("");
  const doc = draft.doc;
  if (!doc) return <Loading />;
  const sch = doc.schedules;
  const ok = can("config.manage") && can("detection.manage");
  const alerting = cams.filter((c) => c.source_bound && ["intrusion", "anomaly"].includes(c.mode));
  const setWin = (id: string, i: number, patch: Partial<{ days: number[]; start: string; end: string }>) => {
    const ws = [...(sch[id] ?? [])];
    ws[i] = { ...ws[i], ...patch };
    draft.replace({ ...doc, schedules: { ...sch, [id]: ws } });
  };
  return (
    <Section title="Arming schedules — outside armed windows, alerts are not raised (events are still recorded). Cameras without a schedule are always armed.">
      <div className="flex items-center gap-2 pb-2">
        <Select value={cam} onChange={setCam} testid="sched-camera"
          options={[["", "Add schedule for camera…"], ...cams.filter((c) => c.source_bound && !sch[c.camera_id]).map((c) => [c.camera_id, `${c.camera_id} · ${c.name} (${c.mode.replace(/_/g, " ")})`] as [string, string])]} className="w-80" />
        <Button size="sm" disabled={!cam || !ok} onClick={() => { draft.replace({ ...doc, schedules: { ...sch, [cam]: [{ days: [0, 1, 2, 3, 4, 5, 6], start: "18:00", end: "06:00" }] } }); setCam(""); }}>Add</Button>
        <span className="text-caption text-ink-3">Alert-raising cameras: {alerting.map((c) => c.camera_id).join(", ") || "none"}</span>
      </div>
      {Object.keys(sch).length === 0 ? <Empty>No schedules: every camera is armed 24/7.</Empty> : (
        <Table head={["Camera", "Days", "Start", "End", ""]} testid="schedule-table">
          {Object.entries(sch).flatMap(([id, ws]) => ws.map((w, i) => (
            <Tr key={`${id}-${i}`}>
              <Td mono>{i === 0 ? id : ""}</Td>
              <Td>
                <span className="inline-flex gap-1">
                  {DAYS.map((d, n) => (
                    <button key={d} type="button" disabled={!ok}
                      onClick={() => setWin(id, i, { days: w.days.includes(n) ? w.days.filter((x) => x !== n) : [...w.days, n].sort() })}
                      className={`h-7 min-w-9 px-1.5 rounded-md text-caption font-medium transition-[box-shadow,background-color] disabled:opacity-45 ${w.days.includes(n) ? "bg-canvas shadow-inset-sm text-accent-ink" : "bg-raised border border-line shadow-key-sm text-ink-2 hover:bg-hover"}`}>{d}</button>
                  ))}
                </span>
              </Td>
              <Td><Input value={w.start} disabled={!ok} onChange={(e) => setWin(id, i, { start: e.target.value })} className="w-20 font-data" /></Td>
              <Td><Input value={w.end} disabled={!ok} onChange={(e) => setWin(id, i, { end: e.target.value })} className="w-20 font-data" /></Td>
              <Td>
                <Button size="sm" variant="ghost" disabled={!ok} onClick={() => {
                  const rest = ws.filter((_, j) => j !== i);
                  const next = { ...sch };
                  if (rest.length) next[id] = rest; else delete next[id];
                  draft.replace({ ...doc, schedules: next });
                }}>Remove</Button>
              </Td>
            </Tr>
          )))}
        </Table>
      )}
      <div className="pt-2"><ConfigApplyBar draft={draft} /></div>
    </Section>
  );
}

/* --------------------------------------------------------------- AI models */

type Model = { name: string; task: string; framework: string; files: string[]; pipelines: string[]; files_present: boolean;
  version: string | null; sha256: string | null; size_bytes: number; status: string; runtime: string[];
  versions: { sha256: string; size_bytes: number; first_seen: number; validated_at: number | null; current: boolean; validation: { ok: boolean } | null }[];
  validated: { ok: boolean; checked_at: number; files: { file: string; loads?: boolean; load_ms?: number; inputs?: { name: string; shape: string[] }[]; outputs?: { name: string; shape: string[] }[]; error?: string }[] } | null;
  validated_at: number | null; assigned_cameras: string[]; loaded_in: { worker: number; cameras: string[] }[];
  performance: { mode: string; cameras: number; avg_ms: number; avg_ms_per_s: number }[]; vram_estimate_mib: number | null };
type Models = { models: Model[]; modes: Record<string, { label: string; models: string[] }> };

export function ModelsModule() {
  const [tab, setTab] = useState<"registry" | "assign" | "queue">("registry");
  const m = useAdmin<Models>("models", { topics: ["models", "config"], refresh: 15000 });
  return (
    <>
      <ModuleHeader title="AI model management" sub={m.data ? `${m.data.models.length} models · ${Object.keys(m.data.modes).length - 1} detection pipelines` : undefined} />
      <Tabs tabs={[["registry", "Model registry"], ["assign", "Assignment"], ["queue", "Improvement queue"]]} value={tab} onChange={setTab} />
      <div className="flex-1 min-h-0 overflow-auto p-6 flex flex-col gap-4">
        {tab === "registry" && (!m.data ? <Loading error={m.error} /> : <Registry d={m.data} reload={() => void m.mutate()} />)}
        {tab === "assign" && (!m.data ? <Loading error={m.error} /> : <Assignment d={m.data} />)}
        {tab === "queue" && <Queue />}
      </div>
    </>
  );
}

function Registry({ d, reload }: { d: Models; reload: () => void }) {
  const [sel, setSel] = useState<string | null>(null);
  const act = useAction();
  const model = d.models.find((x) => x.name === sel);
  return (
    <>
      <Section title="Registry" flush>
        <Table head={["Model", "Task", "Version", "Size", "Runtime", "Status", "Pipelines", "Assigned", "Workers", "Mean ms/frame", "Validated"]} testid="model-table">
          {d.models.map((x) => (
            <Tr key={x.name} onClick={() => setSel(x.name)} selected={sel === x.name} tone={x.status === "missing" ? "red" : undefined}>
              <Td mono>{x.name}</Td><Td muted className="max-w-[260px] truncate" title={x.task}>{x.task}</Td>
              <Td mono>{dash(x.version)}</Td><Td mono muted>{bytes(x.size_bytes)}</Td>
              <Td mono muted>{x.runtime.map((r) => r.replace("ExecutionProvider", "")).join(", ") || "—"}</Td>
              <Td><Status value={x.status.startsWith("loaded") ? "loaded" : x.status === "missing" ? "missing" : undefined} label={x.status} /></Td>
              <Td muted>{x.pipelines.join(", ")}</Td><Td mono right>{x.assigned_cameras.length}</Td>
              <Td mono muted>{x.loaded_in.map((w) => w.worker).join(", ") || "—"}</Td>
              <Td mono right>{x.performance.length ? x.performance.map((p) => p.avg_ms).join(" / ") : "—"}</Td>
              <Td>{x.validated ? <Status value={x.validated.ok ? "ok" : "failed"} label={x.validated.ok ? "valid" : "failed"} /> : <span className="text-caption text-ink-3">never</span>}</Td>
            </Tr>
          ))}
        </Table>
      </Section>
      {model && (
        <div className="grid grid-cols-2 gap-4">
          <Section title={`${model.name} · ${model.framework}`}
            aside={<PermButton perm="detection.manage" size="sm" disabled={act.busy} onClick={() => void act.run(async () => { await adminCall("POST", `models/${model.name}/validate`); reload(); })}>
              {act.busy ? "Validating…" : "Validate"}
            </PermButton>}>
            <KV rows={[["files", model.files.join(", ")], ["sha256", dash(model.sha256)], ["assigned cameras", model.assigned_cameras.join(", ") || "none"],
              ["loaded in", model.loaded_in.map((w) => `worker ${w.worker}: ${w.cameras.join(", ")}`).join("; ") || "not loaded"],
              ["VRAM (estimate)", model.vram_estimate_mib ? `~${model.vram_estimate_mib} MiB (file size ×4 + session)` : "—"],
              ["performance", model.performance.map((p) => `${p.mode}: ${p.avg_ms} ms/frame, ${p.avg_ms_per_s} ms/s per camera (${p.cameras} cams)`).join("; ") || "no running pipeline"]]} />
            {act.error && <Notice tone="red">{act.error}</Notice>}
          </Section>
          <Section title="Validation & versions">
            {model.validated ? (
              <KV rows={[["checked", dt(model.validated.checked_at)], ["result", model.validated.ok ? "structure valid, loads in ONNX Runtime" : "FAILED"],
                ...model.validated.files.map((f) => [f.file, f.error ?? (f.inputs ? `in ${f.inputs.map((i) => `${i.name}[${i.shape.join("×")}]`).join(", ")} → out ${f.outputs?.map((o) => `${o.name}[${o.shape.join("×")}]`).join(", ")} · ${f.load_ms} ms load` : "present")] as [string, string])]} />
            ) : <span className="text-ui text-ink-3">Not validated yet.</span>}
            <div className="pt-2 text-caption text-ink-3">Version history (file hash)</div>
            <KV rows={model.versions.map((v) => [v.sha256.slice(0, 12), `${bytes(v.size_bytes)} · first seen ${dt(v.first_seen)}${v.current ? " · current" : ""}${v.validation ? (v.validation.ok ? " · valid" : " · invalid") : ""}`])} />
          </Section>
        </div>
      )}
    </>
  );
}

type Preview = { camera: { camera_id: string; name: string; current_mode: string; state: string; company_name: string | null };
  mode: string; mode_label: string; worker: number; models_needed: string[]; models_to_load: string[]; models_to_unload: string[];
  load: { current_ms_per_s: number; projected_ms_per_s: number | null; measured: boolean };
  gpu: { now: { util_pct: number; mem_used_mib: number; mem_total_mib: number } | null; projected: { gpu_util_pct?: number; vram_mib?: number; vram_total_mib?: number; vram_delta_mib?: number } };
  warnings: string[]; nvr: { nvr_id: string } | null; events_24h: number; users: { username: string }[]; effects: string[] };

function Assignment({ d }: { d: Models }) {
  const det = useAdmin<Detection>("detection", { topics: ["config"], refresh: 5000 });
  const [cam, setCam] = useState("");
  const [mode, setMode] = useState("");
  const [pv, setPv] = useState<Preview | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const act = useAction();
  const cams = (det.data?.cameras ?? []).filter((c) => c.source_bound);
  const preview = (c: string, m: string) => act.run(async () => { setDone(null); setPv(await adminCall<Preview>("POST", "assignments/preview", { camera_id: c, mode: m })); });
  return (
    <>
      <Section title="Assign a detection pipeline (models) to a camera">
        <div className="flex items-center gap-2">
          <Select value={cam} onChange={(v) => { setCam(v); setPv(null); }} testid="assign-camera"
            options={[["", "Camera…"], ...cams.map((c) => [c.camera_id, `${c.camera_id} · ${c.name} (${c.mode.replace(/_/g, " ")})`] as [string, string])]} className="w-80" />
          <Select value={mode} onChange={(v) => { setMode(v); setPv(null); }} testid="assign-mode"
            options={[["", "Pipeline…"], ...Object.entries(d.modes).map(([k, v]) => [k, `${v.label}${v.models.length ? ` — ${v.models.join(" + ")}` : ""}`] as [string, string])]} className="w-96" />
          <Button size="sm" disabled={!cam || !mode || act.busy} onClick={() => void preview(cam, mode)}>Check capacity & impact</Button>
        </div>
      </Section>
      {act.error && <Notice tone="red">{act.error}</Notice>}
      {done && <Notice>{done}</Notice>}
      {pv && (
        <div className="border border-accent/60 rounded-lg bg-raised shadow-card p-4 flex flex-col gap-3" data-testid="assign-preview">
          <div className="text-caption text-accent-ink">Impact preview · {pv.camera.camera_id}: {pv.camera.current_mode} → {pv.mode}</div>
          <div className="grid grid-cols-2 gap-4">
            <KV rows={[["effects", pv.effects.join("; ")], ["models needed", pv.models_needed.join(", ") || "none"],
              ["load into worker", pv.models_to_load.join(", ") || "none (already loaded)"], ["unload", pv.models_to_unload.join(", ") || "none"],
              ["NVR", pv.nvr?.nvr_id ?? "—"], ["events 24 h", pv.events_24h], ["users responsible", pv.users.map((u) => u.username).join(", ") || "none"]]} />
            <KV rows={[["GPU now", pv.gpu.now ? `${pv.gpu.now.util_pct.toFixed(0)}% · ${pv.gpu.now.mem_used_mib.toFixed(0)}/${pv.gpu.now.mem_total_mib.toFixed(0)} MiB` : "—"],
              ["GPU projected", pv.gpu.projected.gpu_util_pct != null ? `${pv.gpu.projected.gpu_util_pct}% · ${pv.gpu.projected.vram_mib?.toFixed(0)}/${pv.gpu.projected.vram_total_mib?.toFixed(0)} MiB (Δ ${pv.gpu.projected.vram_delta_mib} MiB est.)` : "—"],
              ["pipeline load", `${pv.load.current_ms_per_s} → ${pv.load.projected_ms_per_s ?? "?"} ms/s ${pv.load.measured ? "(measured on other cameras)" : "(not measured)"}`]]} />
          </div>
          {pv.warnings.map((w) => <Notice key={w} tone="amber">{w}</Notice>)}
          <div className="flex justify-end gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => setPv(null)}>Cancel</Button>
            <PermButton perm="detection.manage" size="sm" variant="primary" disabled={act.busy || pv.camera.current_mode === pv.mode}
              onClick={() => void act.run(async () => {
                await adminCall("POST", "assignments", { camera_id: pv.camera.camera_id, mode: pv.mode, force: pv.warnings.length > 0 });
                setDone(`${pv.camera.camera_id}: switching to ${pv.mode_label}. The pipeline state updates live below.`);
                setPv(null);
              })}>
              {pv.warnings.length ? "Assign despite warnings" : "Assign"}
            </PermButton>
          </div>
        </div>
      )}
      <Section title="Current assignment (live pipeline state)" flush>
        <Table head={["Camera", "Name", "Site", "Pipeline", "Models", "State", "Health"]} testid="assignment-table">
          {cams.map((c) => (
            <Tr key={c.camera_id} onClick={() => { setCam(c.camera_id); setPv(null); }} selected={cam === c.camera_id} tone={c.state === "error" ? "red" : undefined}>
              <Td mono>{c.camera_id}</Td><Td>{c.name}</Td><Td muted>{c.company_name}</Td><Td>{d.modes[c.mode]?.label ?? c.mode}</Td>
              <Td mono muted>{d.modes[c.mode]?.models.join(" + ") || "—"}</Td><Td><Status value={c.state} /></Td><Td><Status value={c.health} /></Td>
            </Tr>
          ))}
        </Table>
      </Section>
    </>
  );
}

type Fb = { id: number; event_id: number; camera_id: string; event_type: string; detection_mode: string; verdict: string; note: string | null;
  submitted_by: string; submitted_at: number; snapshot: string | null; status: string; reviewed_by: string | null; reviewed_at: number | null;
  event: { confidence: number | null; bounding_box: number[] | null; timestamp: string } };

function Queue() {
  const [status, setStatus] = useState("pending");
  const q = useAdmin<{ items: Fb[]; counts: Record<string, number> }>(`feedback?status=${status}`, { topics: ["feedback"] });
  const act = useAction();
  const [sel, setSel] = useState<number | null>(null);
  const item = q.data?.items.find((f) => f.id === sel);
  return (
    <>
      <Notice>
        Operators mark alerts as confirmed or false alarm from the Alert console. Items are reviewable training
        candidates only — accepted items form a dataset manifest; nothing retrains automatically.
      </Notice>
      <div className="flex items-center gap-2">
        <Select value={status} onChange={setStatus} options={[["pending", `Pending (${q.data?.counts.pending ?? 0})`], ["accepted", `Accepted (${q.data?.counts.accepted ?? 0})`], ["rejected", `Rejected (${q.data?.counts.rejected ?? 0})`], ["", "All"]]} testid="queue-status" />
        <a href="/api/v1/admin/feedback/dataset" target="_blank" rel="noreferrer" className="ml-auto text-caption text-accent-ink hover:underline">Accepted dataset manifest (JSON) ›</a>
      </div>
      {act.error && <Notice tone="red">{act.error}</Notice>}
      <div className="grid grid-cols-[3fr_2fr] gap-4">
        <Section title="Candidates" flush>
          {!q.data ? <Loading error={q.error} /> : q.data.items.length === 0 ? <Empty>No items.</Empty> : (
            <Table head={["Alert", "Camera", "Pipeline", "Verdict", "By", "Submitted", "Status"]} testid="queue-table">
              {q.data.items.map((f) => (
                <Tr key={f.id} onClick={() => setSel(f.id)} selected={sel === f.id}>
                  <Td mono>INC-{String(f.event_id).padStart(6, "0")}</Td><Td mono>{f.camera_id}</Td><Td muted>{f.detection_mode}</Td>
                  <Td className={f.verdict === "false_alarm" ? "text-warn-ink" : "text-ok-ink"}>{f.verdict.replace("_", " ")}</Td>
                  <Td muted>{f.submitted_by}</Td><Td mono muted>{dt(f.submitted_at)}</Td><Td><Status value={f.status} /></Td>
                </Tr>
              ))}
            </Table>
          )}
        </Section>
        {item && (
          <Section title={`INC-${String(item.event_id).padStart(6, "0")}`}>
            {item.snapshot ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/v1/alerts/INC-${String(item.event_id).padStart(6, "0")}/snapshot`} alt="Evidence frame" className="w-full bg-video rounded-md mb-2" />
            ) : <Notice>No evidence frame was stored for this alert.</Notice>}
            <KV rows={[["verdict", item.verdict.replace("_", " ")], ["note", dash(item.note)], ["confidence", item.event.confidence != null ? `${(item.event.confidence * 100).toFixed(1)}%` : "—"],
              ["bounding box", item.event.bounding_box?.join(", ") ?? "—"], ["event time", item.event.timestamp], ["reviewed", item.reviewed_by ? `${item.reviewed_by} · ${dt(item.reviewed_at)}` : "—"]]} />
            <div className="flex gap-1.5 pt-2">
              <PermButton perm="feedback.review" size="sm" variant="primary" disabled={act.busy} onClick={() => void act.run(() => adminCall("POST", `feedback/${item.id}/review`, { status: "accepted" }))}>Accept as training candidate</PermButton>
              <PermButton perm="feedback.review" size="sm" disabled={act.busy} onClick={() => void act.run(() => adminCall("POST", `feedback/${item.id}/review`, { status: "rejected" }))}>Reject</PermButton>
            </div>
          </Section>
        )}
      </div>
    </>
  );
}
