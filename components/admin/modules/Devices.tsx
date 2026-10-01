"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ds";
import {
  adminCall, ago, clock, dash, dt, Empty, FormRow, Input, KV, Loading, ModuleHeader, Notice, PermButton, Section, Select,
  Status, Strip, Table, Tabs, Td, Tr, useAction, useAdmin,
} from "../kit";

type Cam = { camera_id: string; name: string; company_id: string | null; company: string | null; post_id: string | null; post: string | null;
  latitude: number | null; longitude: number | null; ip: string | null; model: string | null; firmware: string | null;
  stream_url: string | null; stream_protocol: string | null; nvr_channel: number | null;
  stream: { protocol: string; source: string; path: string | null; resolution: string; fps: number | null; target_fps: number } | null;
  recording: string | null; detection_mode: string | null; pipeline_state: string | null; health: string | null; issue: string | null;
  heartbeat_age_s: number | null; updated_at: number | null; updated_by: string | null };
type Nvr = { nvr_id: string; name: string; company_id: string; latitude: number; longitude: number; channels_configured: number | null;
  channels_assigned: number; streams_bound: number; streams_ingesting: number; recording: number; health: string; issue: string | null;
  affected: string[]; storage: null; integration: { protocol: string; host: string | null; port: number | null; vendor: string | null; last_probe_ok: number | null; last_probe_at: number | null } };
type Devices = { cameras: Cam[]; nvrs: Nvr[]; checked_at: number };

export function DevicesModule() {
  const [tab, setTab] = useState<"cameras" | "nvrs">("cameras");
  const { data, error, mutate } = useAdmin<Devices>("devices", { refresh: 5000, topics: ["devices", "hierarchy", "integrations"] });
  return (
    <>
      <ModuleHeader title="Device registry" sub={data ? `${data.cameras.length} cameras · ${data.nvrs.length} NVRs · health checked ${clock(data.checked_at)}` : undefined} />
      <Tabs tabs={[["cameras", "Cameras"], ["nvrs", "NVRs · failure impact"]]} value={tab} onChange={setTab} />
      <div className="flex-1 min-h-0 overflow-hidden">
        {!data ? <Loading error={error} /> : tab === "cameras" ? <CameraRegistry d={data} reload={() => void mutate()} /> : <NvrRegistry d={data} />}
      </div>
    </>
  );
}

function CameraRegistry({ d, reload }: { d: Devices; reload: () => void }) {
  const [q, setQ] = useState("");
  const [company, setCompany] = useState("all");
  const [health, setHealth] = useState("all");
  const [sel, setSel] = useState<string | null>(null);
  const companies = useMemo(() => [...new Set(d.cameras.map((c) => c.company_id).filter(Boolean))].sort() as string[], [d]);
  const rows = d.cameras.filter((c) =>
    (company === "all" || c.company_id === company) && (health === "all" || c.health === health) &&
    (!q || `${c.camera_id} ${c.name} ${c.ip ?? ""} ${c.model ?? ""} ${c.post ?? ""}`.toLowerCase().includes(q.toLowerCase())));
  const cam = d.cameras.find((c) => c.camera_id === sel);
  return (
    <div className="flex h-full">
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="min-h-12 px-4 py-2 flex flex-wrap items-center gap-2 border-b border-line">
          <Input placeholder="Search ID, name, IP, model, post…" value={q} onChange={(e) => setQ(e.target.value)} className="w-72" />
          <Select value={company} onChange={setCompany} options={[["all", "All companies"], ...companies.map((c) => [c, c] as [string, string])]} />
          <Select value={health} onChange={setHealth} options={[["all", "All health"], ["ONLINE", "Online"], ["DEGRADED", "Degraded"], ["OFFLINE", "Offline"]]} />
          <span className="ml-auto text-data font-data text-ink-3">{rows.length} of {d.cameras.length}</span>
        </div>
        <div className="flex-1 min-h-0 overflow-auto">
          <Table head={["ID", "Name", "Company", "Post", "Location", "IP", "Model", "Firmware", "Stream", "Recording", "Mode", "Health", "Heartbeat"]} testid="device-table" minWidth={1400}>
            {rows.map((c) => (
              <Tr key={c.camera_id} onClick={() => setSel(c.camera_id)} selected={sel === c.camera_id}
                tone={c.stream && c.health === "OFFLINE" ? "red" : c.health === "DEGRADED" ? "amber" : undefined} testid="device-row">
                <Td mono>{c.camera_id}</Td><Td>{c.name}</Td><Td muted>{dash(c.company)}</Td><Td muted>{dash(c.post)}</Td>
                <Td mono muted>{c.latitude != null ? `${c.latitude.toFixed(4)}, ${c.longitude?.toFixed(4)}` : "—"}</Td>
                <Td mono>{dash(c.ip)}</Td><Td>{dash(c.model)}</Td><Td mono>{dash(c.firmware)}</Td>
                <Td mono muted>{c.stream_url ? c.stream_protocol : c.stream ? `${c.stream.protocol} ${c.stream.resolution}` : "none"}</Td>
                <Td muted>{dash(c.recording)}</Td><Td muted>{dash(c.detection_mode)?.replace(/_/g, " ")}</Td>
                <Td><Status value={c.health} /></Td>
                <Td mono muted>{c.heartbeat_age_s != null ? `${ago(c.heartbeat_age_s)} ago` : "never"}</Td>
              </Tr>
            ))}
          </Table>
        </div>
      </div>
      {cam && (
        <div className="w-[380px] shrink-0 border-l border-line bg-surface overflow-auto p-4">
          <DeviceEditor key={cam.camera_id} c={cam} onSaved={reload} onClose={() => setSel(null)} />
        </div>
      )}
    </div>
  );
}

function DeviceEditor({ c, onSaved, onClose }: { c: Cam; onSaved: () => void; onClose: () => void }) {
  const [f, setF] = useState({ name: c.name, ip: c.ip ?? "", model: c.model ?? "", firmware: c.firmware ?? "", stream_url: c.stream_url ?? "", nvr_channel: c.nvr_channel?.toString() ?? "" });
  const act = useAction();
  const [ok, setOk] = useState(false);
  const save = () => act.run(async () => {
    const body: Record<string, unknown> = {};
    if (f.name !== c.name) body.name = f.name;
    if (f.ip !== (c.ip ?? "")) body.ip = f.ip;
    if (f.model !== (c.model ?? "")) body.model = f.model;
    if (f.firmware !== (c.firmware ?? "")) body.firmware = f.firmware;
    if (f.stream_url !== (c.stream_url ?? "")) body.stream_url = f.stream_url;
    if (f.nvr_channel !== (c.nvr_channel?.toString() ?? "")) body.nvr_channel = f.nvr_channel === "" ? null : Number(f.nvr_channel);
    await adminCall("PATCH", `devices/${c.camera_id}`, body);
    setOk(true);
    onSaved();
  });
  return (
    <div className="flex flex-col gap-3" data-testid="device-editor">
      <div className="flex items-center"><span className="text-caption text-ink-2">{c.camera_id}</span>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={onClose}>Close</Button></div>
      <Section title="Registry metadata">
        <FormRow label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className="w-52" /></FormRow>
        <FormRow label="IP address"><Input value={f.ip} placeholder="not recorded" onChange={(e) => setF({ ...f, ip: e.target.value })} className="w-52 font-data" data-testid="device-ip" /></FormRow>
        <FormRow label="Model"><Input value={f.model} placeholder="not recorded" onChange={(e) => setF({ ...f, model: e.target.value })} className="w-52" /></FormRow>
        <FormRow label="Firmware"><Input value={f.firmware} placeholder="not recorded" onChange={(e) => setF({ ...f, firmware: e.target.value })} className="w-52 font-data" /></FormRow>
        <FormRow label="Stream URL"><Input value={f.stream_url} placeholder="rtsp://…" onChange={(e) => setF({ ...f, stream_url: e.target.value })} className="w-52 font-data" /></FormRow>
        <FormRow label="NVR channel"><Input value={f.nvr_channel} onChange={(e) => setF({ ...f, nvr_channel: e.target.value })} className="w-20 font-data" /></FormRow>
        <div className="flex items-center gap-2 pt-1">
          <PermButton perm="devices.manage" size="sm" variant="primary" disabled={act.busy} onClick={() => void save()}>Save</PermButton>
          {ok && !act.error && <span className="text-caption text-ok-ink">saved · audited</span>}
        </div>
        {act.error && <Notice tone="red">{act.error}</Notice>}
      </Section>
      <Section title="Live">
        <KV rows={[["health", <Status key="h" value={c.health} />], ["issue", dash(c.issue)], ["pipeline", `${dash(c.detection_mode)} · ${dash(c.pipeline_state)}`],
          ["ingested source", c.stream ? `${c.stream.source} (${c.stream.protocol})` : "none bound"], ["source file", dash(c.stream?.path)],
          ["resolution", dash(c.stream?.resolution)], ["fps", c.stream ? `${dash(c.stream.fps)} / ${c.stream.target_fps}` : "—"],
          ["last edit", c.updated_at ? `${dt(c.updated_at)} · ${c.updated_by}` : "never"]]} />
      </Section>
      <Notice>Blank fields are not recorded for this camera — nothing is filled in automatically.</Notice>
    </div>
  );
}

/* -------------------------------------------------------- NVR failure impact */

type Impact = {
  nvr: { nvr_id: string; name: string; company_id: string; health: string; issue: string | null };
  cameras: { camera_id: string; name: string; post_name: string | null; source_bound: boolean; mode: string; health: string | null;
    recording: string | null; events_24h: number; alerts_24h: number }[];
  services: { pipelines: { mode: string; label: string; cameras: string[] }[]; models: string[]; recording_streams: number;
    alerting_cameras: string[]; alerts_24h: number; events_24h: number };
  posts: string[]; users: { username: string; display_name: string; role: string; scope_type: string; scope_id: string | null }[];
  summary: { cameras: number; bound: number; affected: string[]; down: boolean };
};

function NvrRegistry({ d }: { d: Devices }) {
  const [sel, setSel] = useState<string | null>(d.nvrs.find((n) => n.health !== "ONLINE")?.nvr_id ?? null);
  const imp = useAdmin<Impact>(sel ? `nvrs/${sel}/impact` : null, { refresh: 10000 });
  return (
    <div className="flex h-full">
      <div className="w-[560px] shrink-0 border-r border-line overflow-auto">
        <Table head={["NVR", "Company", "Channels", "Ingesting", "Recording", "Health", "Storage", "Fault"]} testid="nvr-registry">
          {d.nvrs.map((n) => (
            <Tr key={n.nvr_id} onClick={() => setSel(n.nvr_id)} selected={sel === n.nvr_id}
              tone={n.health === "OFFLINE" ? "red" : n.health === "DEGRADED" ? "amber" : undefined} testid="nvr-row">
              <Td mono>{n.nvr_id}</Td><Td muted>{n.company_id}</Td>
              <Td mono right title="configured / assigned cameras">{n.channels_configured ?? "—"} / {n.channels_assigned}</Td>
              <Td mono right>{n.streams_ingesting}/{n.streams_bound}</Td><Td mono right>{n.recording}</Td>
              <Td><Status value={n.health} /></Td>
              <Td mono muted title="No NVR integration reports disk capacity">n/a</Td>
              <Td muted>{dash(n.issue)}</Td>
            </Tr>
          ))}
        </Table>
      </div>
      <div className="flex-1 min-w-0 overflow-auto p-6 flex flex-col gap-4" data-testid="nvr-impact">
        {!sel ? <Empty>Select an NVR to see everything that depends on it.</Empty> : !imp.data ? <Loading error={imp.error} /> : (
          <>
            <Strip items={[
              { label: "NVR", value: imp.data.nvr.nvr_id, sub: imp.data.nvr.company_id },
              { label: "Status", value: <Status value={imp.data.nvr.health} />, sub: imp.data.nvr.issue ?? "no fault" },
              { label: "Cameras", value: imp.data.summary.cameras, sub: `${imp.data.summary.bound} with video` },
              { label: "Recording streams", value: imp.data.services.recording_streams },
              { label: "Alerts 24 h", value: imp.data.services.alerts_24h, sub: `${imp.data.services.events_24h} events` },
              { label: "Users responsible", value: imp.data.users.length },
            ]} />
            <Notice tone={imp.data.summary.down ? "red" : "muted"}>
              {imp.data.summary.down
                ? `NVR ${imp.data.nvr.nvr_id} is ${imp.data.nvr.health}: the cameras and services below lose recording/ingest.`
                : `If ${imp.data.nvr.nvr_id} fails, the cameras and services below are affected.`}
            </Notice>
            <div className="grid grid-cols-2 gap-4">
              <Section title="AI services on this NVR">
                <KV rows={[...imp.data.services.pipelines.map((p) => [p.label, p.cameras.join(", ")] as [string, string]),
                  ["models in use", imp.data.services.models.join(", ") || "none"],
                  ["alerting cameras", imp.data.services.alerting_cameras.join(", ") || "none"],
                  ["posts", imp.data.posts.join(", ")]]} />
              </Section>
              <Section title="Users responsible (scope)">
                <KV rows={imp.data.users.map((u) => [u.username, `${u.role} · ${u.scope_type}${u.scope_id ? ` ${u.scope_id}` : ""}`])} />
              </Section>
            </div>
            <Section title="Cameras" flush>
              <Table head={["Camera", "Name", "Post", "Video", "Mode", "Health", "Recording", "Events 24 h", "Alerts 24 h"]} testid="impact-cameras">
                {imp.data.cameras.map((c) => (
                  <Tr key={c.camera_id} tone={imp.data!.summary.affected.includes(c.camera_id) ? "red" : undefined}>
                    <Td mono>{c.camera_id}</Td><Td>{c.name}</Td><Td muted>{dash(c.post_name)}</Td><Td muted>{c.source_bound ? "bound" : "none"}</Td>
                    <Td muted>{c.mode?.replace(/_/g, " ")}</Td><Td><Status value={c.health} /></Td><Td muted>{dash(c.recording)}</Td>
                    <Td mono right>{c.events_24h}</Td><Td mono right>{c.alerts_24h}</Td>
                  </Tr>
                ))}
              </Table>
            </Section>
          </>
        )}
      </div>
    </div>
  );
}

/* --------------------------------------------------------- NVR integrations */

type Integ = { nvr_id: string; name: string; company_id: string; protocol: string; vendor: string | null; host: string | null; port: number | null;
  username: string | null; rtsp_path: string | null; channels: number | null; credential_set: boolean; last_probe_at: number | null;
  last_probe_ok: number | null; last_probe_ms: number | null; last_probe: Record<string, unknown> | null; last_sync_at: number | null;
  last_sync: Record<string, unknown> | null; ingest: { status: string; bound: number; streaming: number } | null };
type Integrations = { nvrs: Integ[]; protocols: string[]; sources: { camera_id: string; source_id: string; protocol: string; path: string; resolution: string }[];
  credentials: { path: string; exists: boolean; mode: string | null; entries: number; permissions_ok: boolean; encrypted_at_rest: boolean } };

export function IntegrationsModule() {
  const { data, error, mutate } = useAdmin<Integrations>("integrations", { topics: ["integrations"] });
  const [sel, setSel] = useState<string | null>(null);
  const [disc, setDisc] = useState<{ devices: { ip?: string; xaddrs?: string[]; scopes?: string[]; error?: string }[]; timeout_s: number; at: number } | null>(null);
  const act = useAction();
  if (!data) return <><ModuleHeader title="NVR & integrations" /><Loading error={error} /></>;
  const n = data.nvrs.find((x) => x.nvr_id === sel);
  return (
    <>
      <ModuleHeader title="NVR & integrations" sub={`${data.nvrs.filter((x) => x.protocol !== "none").length}/${data.nvrs.length} NVRs configured · ${data.sources.length} ingested sources`}>
        <PermButton perm="integrations.manage" size="sm" disabled={act.busy}
          onClick={() => void act.run(async () => setDisc(await adminCall("POST", "integrations/discover")))}>
          {act.busy ? "Discovering…" : "ONVIF discovery"}
        </PermButton>
      </ModuleHeader>
      <div className="flex-1 min-h-0 flex">
        <div className="flex-1 min-w-0 overflow-auto p-6 flex flex-col gap-4">
          {act.error && <Notice tone="red">{act.error}</Notice>}
          {disc && (
            <Section title={`WS-Discovery · ${clock(disc.at)} · ${disc.timeout_s}s listen`} aside={<Button size="sm" variant="ghost" onClick={() => setDisc(null)}>Dismiss</Button>}>
              {disc.devices.length === 0 ? <span className="text-ui text-ink-3" data-testid="discovery-empty">No ONVIF devices answered on the local network segment.</span> :
                <KV rows={disc.devices.map((x, i) => [x.ip ?? `#${i}`, x.error ?? (x.xaddrs ?? []).join(" ")])} />}
            </Section>
          )}
          <Section title="NVR connections" flush>
            <Table head={["NVR", "Company", "Protocol", "Endpoint", "Credential", "Connection", "Last probe", "Channel sync", "Ingest"]} testid="integration-table">
              {data.nvrs.map((x) => (
                <Tr key={x.nvr_id} onClick={() => setSel(x.nvr_id)} selected={sel === x.nvr_id}
                  tone={x.last_probe_ok === 0 ? "red" : undefined}>
                  <Td mono>{x.nvr_id}</Td><Td muted>{x.company_id}</Td><Td mono>{x.protocol === "none" ? "not configured" : x.protocol.toUpperCase()}</Td>
                  <Td mono muted>{x.host ? `${x.host}:${x.port}` : "—"}</Td><Td muted>{x.credential_set ? "stored" : "—"}</Td>
                  <Td>{x.last_probe_at ? <Status value={x.last_probe_ok ? "ONLINE" : "OFFLINE"} label={x.last_probe_ok ? `ok ${x.last_probe_ms ?? ""} ms` : "failed"} /> : <span className="text-caption text-ink-3">not probed</span>}</Td>
                  <Td mono muted>{x.last_probe_at ? dt(x.last_probe_at) : "—"}</Td>
                  <Td mono muted>{x.last_sync_at ? dt(x.last_sync_at) : "—"}</Td>
                  <Td>{x.ingest ? <Status value={x.ingest.status} label={`${x.ingest.streaming}/${x.ingest.bound}`} /> : "—"}</Td>
                </Tr>
              ))}
            </Table>
          </Section>
          <Section title="Ingested video sources" flush>
            <Table head={["Camera", "Source", "Protocol", "Resolution", "Path"]}>
              {data.sources.map((s) => (
                <Tr key={s.camera_id}><Td mono>{s.camera_id}</Td><Td mono>{s.source_id}</Td><Td mono muted>{s.protocol}</Td><Td mono muted>{s.resolution}</Td><Td mono muted>{dash(s.path)}</Td></Tr>
              ))}
            </Table>
          </Section>
          <Notice>
            Cameras are NVR channels pulled once by the media server (RTSP). No vendor SDK is installed on the server: vendor-SDK
            connections are checked for TCP reachability only. Credentials are write-only and stored in {data.credentials.path}
            (mode {data.credentials.mode ?? "—"}{data.credentials.encrypted_at_rest ? ", encrypted" : ", not encrypted at rest"}).
          </Notice>
        </div>
        {n && (
          <div className="w-[400px] shrink-0 border-l border-line bg-surface overflow-auto p-4">
            <IntegrationEditor key={n.nvr_id} n={n} protocols={data.protocols} onClose={() => setSel(null)} reload={() => void mutate()} />
          </div>
        )}
      </div>
    </>
  );
}

function IntegrationEditor({ n, protocols, onClose, reload }: { n: Integ; protocols: string[]; onClose: () => void; reload: () => void }) {
  const [f, setF] = useState({ protocol: n.protocol, vendor: n.vendor ?? "", host: n.host ?? "", port: n.port?.toString() ?? "",
    username: n.username ?? "", password: "", rtsp_path: n.rtsp_path ?? "", channels: n.channels?.toString() ?? "" });
  const act = useAction();
  const [probe, setProbe] = useState<Record<string, unknown> | null>(n.last_probe);
  const [sync, setSync] = useState<Record<string, unknown> | null>(null);
  const save = () => act.run(async () => {
    const body: Record<string, unknown> = { ...f, port: f.port ? Number(f.port) : null, channels: f.channels ? Number(f.channels) : null };
    if (!f.password) delete body.password;
    await adminCall("PUT", `integrations/${n.nvr_id}`, body);
    setF({ ...f, password: "" });
    reload();
  });
  return (
    <div className="flex flex-col gap-3" data-testid="integration-editor">
      <div className="flex items-center"><span className="text-caption text-ink-2">{n.nvr_id} · {n.name}</span>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={onClose}>Close</Button></div>
      <Section title="Connection">
        <FormRow label="Protocol"><Select value={f.protocol} onChange={(v) => setF({ ...f, protocol: v })} options={protocols.map((p) => [p, p === "none" ? "not configured" : p.toUpperCase()])} className="w-40" testid="integ-protocol" /></FormRow>
        <FormRow label="Vendor"><Input value={f.vendor} onChange={(e) => setF({ ...f, vendor: e.target.value })} className="w-40" /></FormRow>
        <FormRow label="Host"><Input value={f.host} onChange={(e) => setF({ ...f, host: e.target.value })} className="w-40 font-data" data-testid="integ-host" /></FormRow>
        <FormRow label="Port"><Input value={f.port} onChange={(e) => setF({ ...f, port: e.target.value })} className="w-20 font-data" data-testid="integ-port" /></FormRow>
        {f.protocol === "rtsp" && <FormRow label="RTSP path"><Input value={f.rtsp_path} onChange={(e) => setF({ ...f, rtsp_path: e.target.value })} className="w-40 font-data" /></FormRow>}
        <FormRow label="Username"><Input value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} className="w-40" /></FormRow>
        <FormRow label="Password" hint={n.credential_set ? "stored · leave blank to keep" : "write-only"}><Input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} className="w-40" /></FormRow>
        <FormRow label="Channels"><Input value={f.channels} onChange={(e) => setF({ ...f, channels: e.target.value })} className="w-20 font-data" /></FormRow>
        <div className="flex gap-1.5 pt-1">
          <PermButton perm="integrations.manage" size="sm" variant="primary" disabled={act.busy} onClick={() => void save()}>Save</PermButton>
          <PermButton perm="integrations.manage" size="sm" disabled={act.busy || n.protocol === "none" || !n.host}
            onClick={() => void act.run(async () => { setProbe(await adminCall("POST", `integrations/${n.nvr_id}/probe`)); reload(); })}>Test connection</PermButton>
        </div>
        {act.error && <Notice tone="red">{act.error}</Notice>}
      </Section>
      {probe && (
        <Section title="Last connection test">
          <KV rows={Object.entries(probe).filter(([k]) => k !== "at").map(([k, v]) => [k, typeof v === "object" ? JSON.stringify(v) : String(v)])} />
        </Section>
      )}
      <Section title="Channel synchronization">
        <div className="flex gap-1.5">
          <Button size="sm" disabled={act.busy} onClick={() => void act.run(async () => setSync(await adminCall("POST", `integrations/${n.nvr_id}/sync`, { apply: false })))}>Preview</Button>
          <PermButton perm="integrations.manage" size="sm" disabled={act.busy || !sync}
            onClick={() => void act.run(async () => { setSync(await adminCall("POST", `integrations/${n.nvr_id}/sync`, { apply: true })); reload(); })}>Apply</PermButton>
        </div>
        {sync && (
          <KV rows={[["cameras", String(sync.cameras)], ["channels", dash(sync.channels)], ["kept", JSON.stringify(sync.kept)],
            ["assign", JSON.stringify(sync.assigned)], ["conflicts", JSON.stringify(sync.conflicts)], ["unplaced", JSON.stringify(sync.unplaced)],
            ["applied", String(sync.applied)], ...(sync.note ? [["note", String(sync.note)] as [string, string]] : [])]} />
        )}
      </Section>
    </div>
  );
}
