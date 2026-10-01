"use client";

import { ago, bytes, clock, dash, KV, Loading, ModuleHeader, Notice, pct, Section, Status, Strip, Table, Td, Tr, useAdmin } from "../kit";

/* ------------------------------------------------------------------ overview */

type Issue = { severity: "high" | "med" | "low"; area: string; resource: string; issue: string; where: string };
type Overview = {
  site: { site_name: string; classification: string };
  config_version: number; config_applied_at: number; config_author: string;
  cameras: { registered: number; source_bound: number; health: Record<string, number> };
  nvrs: { registered: number; status: Record<string, number> };
  pipelines: { states: Record<string, number>; modes: Record<string, number> };
  gpu: { name: string; util_pct: number; mem_used_mib: number; mem_total_mib: number; temp_c: number; power_w: number } | null;
  gpu_warnings: string[];
  workers: { worker: number; alive: boolean; cameras: number; vram_mib: number | null }[];
  storage: { total_bytes: number; used_bytes: number; free_bytes: number };
  network: { interfaces_up: number; physical: number; ws_clients: number };
  users: { total: number; sessions: number };
  alerts_suppressed: Record<string, number>;
  issues: Issue[];
  uptime_s: number;
};

export function OverviewModule({ go }: { go: (m: string) => void }) {
  const { data, error } = useAdmin<Overview>("overview", { refresh: 5000, topics: ["config", "users", "sessions", "sync"] });
  if (!data) return <><ModuleHeader title="Overview" /><Loading error={error} /></>;
  const h = data.cameras.health;
  const g = data.gpu;
  const areaModule: Record<string, string> = {
    Camera: "network", Pipeline: "detection", NVR: "integrations", GPU: "compute", Compute: "compute",
    Storage: "storage", "Policy sync": "config", Security: "security", Models: "models",
  };
  return (
    <>
      <ModuleHeader title="Overview" sub={`${data.site.site_name} · config v${data.config_version} (${data.config_author}, ${clock(data.config_applied_at)}) · backend up ${ago(data.uptime_s)}`} />
      <div className="flex-1 min-h-0 overflow-auto p-6 flex flex-col gap-4">
        <Strip items={[
          { label: "Cameras", value: data.cameras.registered, sub: `${data.cameras.source_bound} with video` },
          { label: "Online", value: h.ONLINE ?? 0, tone: "text-ok-ink" },
          { label: "Degraded", value: h.DEGRADED ?? 0, tone: h.DEGRADED ? "text-warn-ink" : undefined },
          { label: "Offline", value: h.OFFLINE ?? 0, tone: h.OFFLINE ? "text-crit-ink" : undefined, sub: "incl. no video source" },
          { label: "NVRs", value: data.nvrs.registered, sub: Object.entries(data.nvrs.status).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(" · ") },
          { label: "Pipelines running", value: data.pipelines.states.running ?? 0,
            sub: data.pipelines.states.error ? `${data.pipelines.states.error} in error` : `${data.pipelines.states.idle ?? 0} idle` },
          { label: "GPU", value: g ? `${g.util_pct.toFixed(0)}%` : "—", sub: g ? `${g.mem_used_mib.toFixed(0)}/${g.mem_total_mib.toFixed(0)} MiB · ${g.temp_c.toFixed(0)}°C` : "no telemetry",
            tone: data.gpu_warnings.length ? "text-warn-ink" : undefined },
          { label: "Storage free", value: bytes(data.storage.free_bytes), sub: `${pct(data.storage.used_bytes, data.storage.total_bytes)} used` },
          { label: "Network", value: `${data.network.interfaces_up} up`, sub: `${data.network.ws_clients} consoles connected` },
          { label: "Users", value: data.users.total, sub: `${data.users.sessions} active sessions` },
        ]} />

        <Section title={`Issues requiring attention (${data.issues.length})`} flush>
          {data.issues.length === 0 ? (
            <div className="px-3 py-3 text-ui text-ok-ink" data-testid="no-issues">No open issues. All bound cameras, NVRs, workers and policies are healthy.</div>
          ) : (
            <Table head={["Severity", "Area", "Resource", "Issue", "Where", ""]} testid="issues-table">
              {data.issues.map((i, n) => (
                <Tr key={n} tone={i.severity === "high" ? "red" : i.severity === "med" ? "amber" : undefined}
                  onClick={areaModule[i.area] ? () => go(areaModule[i.area]) : undefined}>
                  <Td><Status value={i.severity} label={i.severity === "med" ? "medium" : i.severity} /></Td>
                  <Td>{i.area}</Td>
                  <Td mono>{i.resource}</Td>
                  <Td className="whitespace-normal">{i.issue}</Td>
                  <Td muted>{i.where}</Td>
                  <Td muted className="text-caption ">{areaModule[i.area] ? "open ›" : ""}</Td>
                </Tr>
              ))}
            </Table>
          )}
        </Section>

        <div className="grid grid-cols-3 gap-4">
          <Section title="AI pipelines by detection mode">
            <KV rows={Object.entries(data.pipelines.modes).sort().map(([m, n]) => [m.replace(/_/g, " "), n])} />
          </Section>
          <Section title="Inference workers">
            <KV rows={data.workers.map((w) => [`worker ${w.worker}`,
              <span key={w.worker} className="inline-flex gap-3"><Status value={w.alive ? "ONLINE" : "OFFLINE"} />{w.cameras} cams · {w.vram_mib ?? "—"} MiB</span>])} />
          </Section>
          <Section title="Alert policy (since backend start)">
            <KV rows={[["suppressed · cooldown", data.alerts_suppressed.cooldown ?? 0],
              ["suppressed · schedule", data.alerts_suppressed.schedule ?? 0],
              ["suppressed · disabled", data.alerts_suppressed.disabled ?? 0]]} />
          </Section>
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ network */

type Iface = { name: string; operstate: string; speed_mbps: number | null; mtu: number; mac: string; virtual: boolean;
  rx_bps?: number; tx_bps?: number; loss_pct_window?: number; loss_pct_total: number; rx_errors: number; tx_errors: number;
  rx_dropped: number; tx_dropped: number };
type Network = {
  interfaces: Iface[];
  streams: { camera_id: string; name: string; company: string; protocol: string; health: string; heartbeat_age_s: number | null;
    decoding: boolean; fps: number | null; target_fps: number; frame_delivery_pct: number | null; bitrate_kbps: number | null;
    rtp_lost: number | null; viewers: number | null; stream_status: string | null; recording: string; issue: string | null }[];
  nvrs: Record<string, { status: string; bound: number; streaming: number; issue: string | null; company_id: string }>;
  host: { hostname: string; kernel: string; cpus: number; load: number[] | null; mem_total: number; mem_available: number; uptime_s: number };
  infrastructure: { component: string; status: string; detail: string }[];
  checked_at: number; notes: string[];
};

const bps = (v?: number) => (v == null ? "—" : v > 1e6 ? `${(v / 1e6).toFixed(1)} Mb/s` : `${(v / 1e3).toFixed(0)} kb/s`);

export function NetworkModule() {
  const { data, error } = useAdmin<Network>("network", { refresh: 3000 });
  if (!data) return <><ModuleHeader title="Network & system health" /><Loading error={error} /></>;
  const ifs = data.interfaces.filter((i) => !i.virtual || i.operstate === "up");
  return (
    <>
      <ModuleHeader title="Network & system health" sub={`${data.host.hostname} · checked ${clock(data.checked_at)} · 3 s refresh`} />
      <div className="flex-1 min-h-0 overflow-auto p-6 flex flex-col gap-4">
        <div className="grid grid-cols-[2fr_1fr] gap-4">
          <Section title="Infrastructure" flush>
            <Table head={["Component", "Status", "Detail"]} testid="infra-table">
              {data.infrastructure.map((c) => (
                <Tr key={c.component} tone={c.status === "OFFLINE" ? "red" : c.status === "DEGRADED" ? "amber" : undefined}>
                  <Td>{c.component}</Td><Td><Status value={c.status} /></Td><Td mono muted>{c.detail}</Td>
                </Tr>
              ))}
            </Table>
          </Section>
          <Section title="Host">
            <KV rows={[["kernel", data.host.kernel], ["cpus", data.host.cpus],
              ["load 1/5/15", data.host.load?.join(" / ") ?? "—"],
              ["memory", `${bytes(data.host.mem_total - data.host.mem_available)} / ${bytes(data.host.mem_total)}`],
              ["uptime", ago(data.host.uptime_s)]]} />
          </Section>
        </div>
        <Section title="Network links" flush>
          <Table head={["Interface", "Link", "Speed", "MTU", "RX", "TX", "Loss (window)", "Loss (total)", "Errors", "Drops", "MAC"]} testid="iface-table">
            {ifs.map((i) => (
              <Tr key={i.name} tone={i.operstate !== "up" && !i.virtual ? "red" : (i.loss_pct_window ?? 0) > 1 ? "amber" : undefined}>
                <Td mono>{i.name}{i.virtual ? <span className="text-ink-3"> (virtual)</span> : null}</Td>
                <Td><Status value={i.operstate === "up" ? "ONLINE" : i.operstate === "unknown" ? undefined : "OFFLINE"} label={i.operstate} /></Td>
                <Td mono>{i.speed_mbps ? `${i.speed_mbps} Mb/s` : "—"}</Td>
                <Td mono muted>{i.mtu}</Td>
                <Td mono right>{bps(i.rx_bps)}</Td>
                <Td mono right>{bps(i.tx_bps)}</Td>
                <Td mono right>{i.loss_pct_window != null ? `${i.loss_pct_window}%` : "—"}</Td>
                <Td mono right muted>{i.loss_pct_total}%</Td>
                <Td mono right muted>{i.rx_errors + i.tx_errors}</Td>
                <Td mono right muted>{i.rx_dropped + i.tx_dropped}</Td>
                <Td mono muted>{dash(i.mac)}</Td>
              </Tr>
            ))}
          </Table>
        </Section>
        <Section title={`Camera streams (${data.streams.length} bound)`} flush>
          <Table head={["Camera", "Name", "Company", "Protocol", "Health", "Stream", "Decoded", "Bitrate", "RTP lost", "Readers", "FPS", "Frame delivery", "Recording", "Issue"]} testid="stream-table">
            {data.streams.map((s) => (
              <Tr key={s.camera_id} tone={s.health === "OFFLINE" ? "red" : s.health === "DEGRADED" ? "amber" : undefined}>
                <Td mono>{s.camera_id}</Td><Td>{s.name}</Td><Td muted>{dash(s.company)}</Td><Td mono muted>{s.protocol}</Td>
                <Td><Status value={s.health} /></Td>
                <Td mono muted>{dash(s.stream_status)}</Td>
                <Td mono muted title="Decoded only while an AI pipeline or MJPEG viewer needs frames">{s.decoding ? "yes" : "on demand"}</Td>
                <Td mono right>{s.bitrate_kbps != null ? `${(s.bitrate_kbps / 1000).toFixed(2)} Mb/s` : "—"}</Td>
                <Td mono right className={s.rtp_lost ? "text-warn-ink" : "text-ink-3"}>{s.rtp_lost ?? 0}</Td>
                <Td mono right muted>{dash(s.viewers)}</Td>
                <Td mono right>{s.fps != null ? `${s.fps.toFixed(1)} / ${s.target_fps}` : "—"}</Td>
                <Td mono right className={s.frame_delivery_pct != null && s.frame_delivery_pct < 50 ? "text-warn-ink" : ""}>
                  {s.frame_delivery_pct != null ? `${s.frame_delivery_pct}%` : "—"}
                </Td>
                <Td muted>{s.recording}</Td>
                <Td muted>{dash(s.issue)}</Td>
              </Tr>
            ))}
          </Table>
        </Section>
        <Section title="NVR ingest" flush>
          <Table head={["NVR", "Company", "Status", "Streams ingesting", "Issue"]}>
            {Object.entries(data.nvrs).map(([id, n]) => (
              <Tr key={id} tone={n.status === "OFFLINE" ? "red" : n.status === "DEGRADED" ? "amber" : undefined}>
                <Td mono>{id}</Td><Td muted>{n.company_id}</Td><Td><Status value={n.status} /></Td>
                <Td mono>{n.streaming}/{n.bound}</Td><Td muted>{dash(n.issue)}</Td>
              </Tr>
            ))}
          </Table>
        </Section>
        {data.notes.map((n) => <Notice key={n}>{n}</Notice>)}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ compute */

type Compute = {
  primary: { name: string; util_pct: number; mem_util_pct: number; mem_used_mib: number; mem_total_mib: number; temp_c: number;
    power_w: number; power_limit_w: number; sm_clock_mhz: number; sm_clock_max_mhz: number; driver: string; pstate: string } | null;
  gpu: { available: boolean; error?: string; processes: { pid: number; used_mib: number; name: string }[] };
  workers: { worker: number; pid: number; alive: boolean; vram_mib: number | null; models_loaded: string[];
    providers: Record<string, string[]>; cameras: number; pipeline_ms_per_s: number }[];
  cameras: { camera_id: string; mode: string; worker: number; state: string; fps: number; avg_ms: number; gpu_ms_per_s: number; models: string[] }[];
  modes: Record<string, { cameras: number; avg_ms: number; avg_ms_per_s: number }>;
  pipeline_states: Record<string, number>;
  thresholds: { gpu_util_warn_pct: number; vram_warn_pct: number };
  warnings: string[];
};

export function ComputeModule() {
  const { data, error } = useAdmin<Compute>("compute", { refresh: 3000 });
  if (!data) return <><ModuleHeader title="GPU / compute capacity" /><Loading error={error} /></>;
  const g = data.primary;
  const total = data.cameras.reduce((s, c) => s + c.gpu_ms_per_s, 0);
  const vramPct = g ? (g.mem_used_mib / g.mem_total_mib) * 100 : 0;
  return (
    <>
      <ModuleHeader title="GPU / compute capacity" sub={g ? `${g.name} · driver ${g.driver} · ${g.pstate}` : data.gpu.error} />
      <div className="flex-1 min-h-0 overflow-auto p-6 flex flex-col gap-4">
        {g && (
          <Strip items={[
            { label: "GPU utilization", value: `${g.util_pct.toFixed(0)}%`, tone: g.util_pct >= data.thresholds.gpu_util_warn_pct ? "text-warn-ink" : undefined,
              sub: `warn ≥ ${data.thresholds.gpu_util_warn_pct}%` },
            { label: "VRAM", value: `${g.mem_used_mib.toFixed(0)} / ${g.mem_total_mib.toFixed(0)} MiB`, tone: vramPct >= data.thresholds.vram_warn_pct ? "text-warn-ink" : undefined,
              sub: `${vramPct.toFixed(0)}% · warn ≥ ${data.thresholds.vram_warn_pct}%` },
            { label: "Available", value: `${(100 - g.util_pct).toFixed(0)}% · ${(g.mem_total_mib - g.mem_used_mib).toFixed(0)} MiB`, sub: "compute · memory" },
            { label: "Temperature", value: `${g.temp_c.toFixed(0)}°C`, tone: g.temp_c >= 85 ? "text-crit-ink" : g.temp_c >= 75 ? "text-warn-ink" : undefined },
            { label: "Power", value: `${g.power_w?.toFixed(0) ?? "—"} W`, sub: g.power_limit_w ? `limit ${g.power_limit_w.toFixed(0)} W` : undefined },
            { label: "SM clock", value: `${g.sm_clock_mhz} MHz`, sub: `max ${g.sm_clock_max_mhz}` },
            { label: "Active pipelines", value: data.pipeline_states.running ?? 0, sub: `${data.cameras.length} with measured load` },
            { label: "Pipeline busy time", value: `${(total / 1000).toFixed(1)} s/s`, sub: `Σ over ${data.cameras.length} camera threads` },
          ]} />
        )}
        {data.warnings.map((w) => <Notice key={w} tone="amber">{w}</Notice>)}
        <Section title="Inference workers" flush>
          <Table head={["Worker", "PID", "Process", "VRAM", "Cameras", "Pipeline ms/s", "Models loaded (execution provider)"]} testid="worker-table">
            {data.workers.map((w) => (
              <Tr key={w.worker} tone={w.alive ? undefined : "red"}>
                <Td mono>{w.worker}</Td><Td mono muted>{w.pid}</Td><Td><Status value={w.alive ? "ONLINE" : "OFFLINE"} /></Td>
                <Td mono right>{w.vram_mib != null ? `${w.vram_mib.toFixed(0)} MiB` : "—"}</Td>
                <Td mono right>{w.cameras}</Td><Td mono right>{w.pipeline_ms_per_s}</Td>
                <Td mono muted className="whitespace-normal">
                  {w.models_loaded.map((m) => `${m} (${(w.providers[m] ?? []).map((p) => p.replace("ExecutionProvider", "")).join("/") || "?"})`).join(", ") || "none"}
                </Td>
              </Tr>
            ))}
          </Table>
        </Section>
        <div className="grid grid-cols-[1fr_2fr] gap-4">
          <Section title="Measured load per detection mode" flush>
            <Table head={["Mode", "Cameras", "Mean ms/frame", "ms/s per camera"]}>
              {Object.entries(data.modes).map(([m, v]) => (
                <Tr key={m}><Td>{m.replace(/_/g, " ")}</Td><Td mono right>{v.cameras}</Td><Td mono right>{v.avg_ms}</Td><Td mono right>{v.avg_ms_per_s}</Td></Tr>
              ))}
            </Table>
          </Section>
          <Section title="Per-camera workload" flush>
            <div className="max-h-[420px] overflow-auto">
              <Table head={["Camera", "Mode", "Worker", "State", "FPS", "ms/frame", "ms/s", "Share"]} testid="workload-table">
                {data.cameras.map((c) => (
                  <Tr key={c.camera_id}>
                    <Td mono>{c.camera_id}</Td><Td>{c.mode.replace(/_/g, " ")}</Td><Td mono muted>{c.worker}</Td>
                    <Td><Status value={c.state} /></Td><Td mono right>{c.fps}</Td><Td mono right>{c.avg_ms}</Td>
                    <Td mono right>{c.gpu_ms_per_s}</Td>
                    <Td mono right muted>{total ? `${((c.gpu_ms_per_s / total) * 100).toFixed(1)}%` : "—"}</Td>
                  </Tr>
                ))}
              </Table>
            </div>
          </Section>
        </div>
        <Notice>
          Pipeline time is measured around each camera&apos;s full per-frame processing (detector, tracker, analytics) — an upper
          bound on its GPU time. Capacity is checked before every model assignment (AI models ▸ Assignment).
        </Notice>
      </div>
    </>
  );
}
