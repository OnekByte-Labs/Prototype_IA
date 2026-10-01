"use client";

import { Fragment, useState } from "react";
import { Button, buttonClass } from "@/components/ds";
import {
  adminCall, ago, bytes, ConfigApplyBar, ConfigFields, dash, DiffTable, dt, Empty, ImpactPreview, Input, KV,
  Loading, ModuleHeader, Notice, pct, PermButton, Section, Select, Status, Strip, Table, Tabs, Td, Tr, useAction, useAdmin,
  useConfigDraft, val, type Impact,
} from "../kit";

/* ------------------------------------------------------------------ security */

type Security = {
  policy: Record<string, number>;
  sessions: { id: string; username: string; role: string; created_at: number; last_seen: number; ip: string }[];
  failed_24h: number;
  attempts: { ts: number; username: string; ip: string; success: number; reason: string | null }[];
  locked: { username: string; locked_until: number }[];
  must_change: { username: string }[];
  credentials: { path: string; exists: boolean; mode: string | null; entries: number; permissions_ok: boolean; encrypted_at_rest: boolean };
  audit_chain: { ok: boolean; entries: number; broken_at?: number };
  integrity: { ok: boolean; files: { file: string; sha256: string; baseline: string | null; ok: boolean }[]; baseline_at: number | null; baseline_by: string | null };
  transport: { tls: boolean; note: string };
  bootstrap_file_present: boolean;
  protected: { path: string; permission: string }[];
  now: number;
};

export function SecurityModule() {
  const { data, error, mutate } = useAdmin<Security>("security", { topics: ["sessions", "users", "config", "audit"], refresh: 15000 });
  const draft = useConfigDraft();
  const act = useAction();
  if (!data) return <><ModuleHeader title="Security" /><Loading error={error} /></>;
  const now = data.now;
  return (
    <>
      <ModuleHeader title="Security" sub="authentication, sessions, credentials, protected configuration" />
      <div className="flex-1 min-h-0 overflow-auto p-6 flex flex-col gap-4">
        <Strip items={[
          { label: "Audit chain", value: <Status value={data.audit_chain.ok ? "ok" : "failed"} label={data.audit_chain.ok ? "verified" : `broken at #${data.audit_chain.broken_at}`} />, sub: `${data.audit_chain.entries} entries` },
          { label: "Config integrity", value: <Status value={data.integrity.ok ? "ok" : "failed"} label={data.integrity.ok ? "matches baseline" : "changed"} />, sub: data.integrity.baseline_by ? `baseline ${data.integrity.baseline_by}` : undefined },
          { label: "Active sessions", value: data.sessions.length },
          { label: "Failed logins 24 h", value: data.failed_24h, tone: data.failed_24h ? "text-warn-ink" : undefined },
          { label: "Locked accounts", value: data.locked.length, tone: data.locked.length ? "text-warn-ink" : undefined },
          { label: "Temporary passwords", value: data.must_change.length },
          { label: "Transport", value: data.transport.tls ? "TLS" : "HTTP", tone: data.transport.tls ? undefined : "text-warn-ink" },
        ]} />
        {!data.transport.tls && <Notice tone="amber">{data.transport.note}.</Notice>}
        {data.bootstrap_file_present && <Notice tone="amber">The bootstrap administrator credential file still exists in backend/data — delete it.</Notice>}
        <div className="grid grid-cols-2 gap-4">
          <Section title="Authentication & access policy (security.manage)">
            <ConfigFields draft={draft} paths={["security.password_min_length", "security.lockout_threshold", "security.lockout_minutes", "security.session_ttl_hours", "security.idle_timeout_minutes"]} />
            <ConfigApplyBar draft={draft} perm="security.manage" />
          </Section>
          <div className="flex flex-col gap-3">
            <Section title="Protected configuration files"
              aside={<PermButton perm="security.manage" size="sm" disabled={act.busy} onClick={() => void act.run(async () => { await adminCall("POST", "security/integrity/baseline"); await mutate(); })}>Approve current as baseline</PermButton>}>
              <Table head={["File", "SHA-256", "Status"]} testid="integrity-table">
                {data.integrity.files.map((f) => (
                  <Tr key={f.file} tone={f.ok ? undefined : "red"}><Td mono>{f.file}</Td><Td mono muted>{f.sha256.slice(0, 16)}…</Td>
                    <Td><Status value={f.ok ? "ok" : "failed"} label={f.ok ? "unchanged" : f.baseline ? "modified since baseline" : "no baseline"} /></Td></Tr>
                ))}
              </Table>
              <div className="pt-1 text-caption text-ink-3">baseline {dt(data.integrity.baseline_at)} by {dash(data.integrity.baseline_by)} · recorded in the audit chain</div>
              {act.error && <Notice tone="red">{act.error}</Notice>}
            </Section>
            <Section title="Credentials">
              <KV rows={[["store", data.credentials.path], ["entries", data.credentials.entries], ["file mode", data.credentials.exists ? <Status key="m" value={data.credentials.permissions_ok ? "ok" : "failed"} label={dash(data.credentials.mode)} /> : "not created (no credential stored yet)"],
                ["encryption at rest", data.credentials.encrypted_at_rest ? "yes" : "no — file permission protected (0600), never returned by the API"],
                ["passwords", "scrypt (n=16384, r=8, p=1), per-user salt"], ["session tokens", "random 256-bit, stored as SHA-256 only"]]} />
            </Section>
            <Section title="Settings that require security.manage">
              <ul className="text-data font-data text-ink-2 leading-6">
                {data.protected.map((p) => <li key={p.path}>{p.path}</li>)}
              </ul>
            </Section>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Section title="Sign-in attempts (latest 100)" flush>
            <div className="max-h-80 overflow-auto">
              <Table head={["Time", "User", "Address", "Result", "Reason"]} testid="attempts-table">
                {data.attempts.map((a, i) => (
                  <Tr key={i} tone={a.success ? undefined : "amber"}><Td mono muted>{dt(a.ts)}</Td><Td mono>{a.username}</Td><Td mono muted>{dash(a.ip)}</Td>
                    <Td><Status value={a.success ? "success" : "failed"} /></Td><Td muted>{dash(a.reason)}</Td></Tr>
                ))}
              </Table>
            </div>
          </Section>
          <Section title="Locked / pending accounts">
            <KV rows={[...data.locked.map((l) => [l.username, `locked · ${ago(l.locked_until - now)} remaining`] as [string, string]),
              ...data.must_change.map((m) => [m.username, "temporary password not yet changed"] as [string, string])]} />
            {data.locked.length + data.must_change.length === 0 && <span className="text-ui text-ink-3">None.</span>}
            <div className="pt-2 text-caption text-ink-3">Active sessions</div>
            <KV rows={data.sessions.map((s) => [s.username, `${s.role} · ${dash(s.ip)} · idle ${ago(now - s.last_seen)}`])} />
          </Section>
        </div>
      </div>
    </>
  );
}

/* --------------------------------------------------------------------- audit */

type AuditRow = { id: number; ts: number; user: string; action: string; resource: string; prev: string | null; new: string | null;
  result: string; detail: string | null; ip: string | null; hash: string };

export function AuditModule() {
  const [f, setF] = useState({ user: "", action: "", result: "", q: "" });
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
  const { data, error } = useAdmin<{ entries: AuditRow[]; actions: string[]; users: string[]; total: number }>(`audit?limit=300${qs ? `&${qs}` : ""}`, { topics: ["audit"] });
  const verify = useAdmin<{ ok: boolean; entries: number; broken_at?: number }>("audit/verify", { topics: ["audit"] });
  const [open, setOpen] = useState<number | null>(null);
  const prefixes = [...new Set((data?.actions ?? []).map((a) => a.split(".")[0]))];
  return (
    <>
      <ModuleHeader title="Audit log" sub={data ? `${data.total} entries · append-only, SHA-256 hash-chained` : undefined}>
        {verify.data && <Status value={verify.data.ok ? "ok" : "failed"} label={verify.data.ok ? `chain verified · ${verify.data.entries}` : `chain broken at #${verify.data.broken_at}`} />}
        <a href="/api/v1/admin/audit/export" download className={buttonClass("default", "sm")}>Export JSONL</a>
      </ModuleHeader>
      <div className="min-h-12 shrink-0 px-4 py-2 flex flex-wrap items-center gap-2 border-b border-line">
        <Input placeholder="Search resource / values / detail" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} className="w-64" data-testid="audit-search" />
        <Select value={f.user} onChange={(v) => setF({ ...f, user: v })} options={[["", "All users"], ...(data?.users ?? []).map((u) => [u, u] as [string, string])]} />
        <Select value={f.action} onChange={(v) => setF({ ...f, action: v })} options={[["", "All actions"], ...prefixes.map((p) => [p, `${p}.*`] as [string, string]), ...(data?.actions ?? []).map((a) => [a, a] as [string, string])]} testid="audit-action" />
        <Select value={f.result} onChange={(v) => setF({ ...f, result: v })} options={[["", "All results"], ["success", "success"], ["failed", "failed"], ["denied", "denied"]]} />
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        {!data ? <Loading error={error} /> : (
          <Table head={["#", "Time", "User", "Action", "Resource", "Previous", "New", "Result", "Address"]} testid="audit-table">
            {data.entries.map((e) => (
              <Fragment key={e.id}>
                <Tr onClick={() => setOpen(open === e.id ? null : e.id)} selected={open === e.id}
                  tone={e.result === "failed" ? "red" : e.result === "denied" ? "amber" : undefined} testid="audit-row">
                  <Td mono muted>{e.id}</Td><Td mono muted>{dt(e.ts)}</Td><Td mono>{e.user}</Td><Td mono>{e.action}</Td>
                  <Td mono>{e.resource}</Td>
                  <Td mono muted className="max-w-[220px] truncate" title={e.prev ?? ""}>{dash(e.prev)}</Td>
                  <Td mono className="max-w-[260px] truncate" title={e.new ?? ""}>{dash(e.new)}</Td>
                  <Td><Status value={e.result} /></Td><Td mono muted>{dash(e.ip)}</Td>
                </Tr>
                {open === e.id && (
                  <tr className="border-b border-line bg-canvas"><td colSpan={9} className="p-4">
                    <KV rows={[["previous", <pre key="p" className="whitespace-pre-wrap">{e.prev ? JSON.stringify(JSON.parse(e.prev), null, 1) : "—"}</pre>],
                      ["new", <pre key="n" className="whitespace-pre-wrap">{e.new ? JSON.stringify(JSON.parse(e.new), null, 1) : "—"}</pre>],
                      ["detail", dash(e.detail)], ["entry hash", e.hash]]} />
                  </td></tr>
                )}
              </Fragment>
            ))}
          </Table>
        )}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------- storage */

type Storage = {
  volume: { path: string; total_bytes: number; used_bytes: number; free_bytes: number };
  components: Record<string, number>;
  events: { count: number; oldest: string | null; newest: string | null };
  evidence_files: number | null;
  retention: { evidence_max_files: number; event_retention_days: number; backup_keep: number };
  nvrs: { nvr_id: string; company_id: string; storage: null; note: string }[];
  training_candidates: number;
};

export function StorageModule() {
  const { data, error } = useAdmin<Storage>("storage", { topics: ["config", "backup"], refresh: 30000 });
  const draft = useConfigDraft();
  const act = useAction();
  const [ran, setRan] = useState<Record<string, unknown> | null>(null);
  if (!data) return <><ModuleHeader title="Storage & retention" /><Loading error={error} /></>;
  const v = data.volume;
  return (
    <>
      <ModuleHeader title="Storage & retention" sub={v.path}>
        <PermButton perm="config.manage" size="sm" disabled={act.busy} onClick={() => void act.run(async () => setRan(await adminCall("POST", "storage/retention/run")))}>Run retention now</PermButton>
      </ModuleHeader>
      <div className="flex-1 min-h-0 overflow-auto p-6 flex flex-col gap-4">
        <Strip items={[
          { label: "Total", value: bytes(v.total_bytes) }, { label: "Used", value: bytes(v.used_bytes), sub: pct(v.used_bytes, v.total_bytes) },
          { label: "Free", value: bytes(v.free_bytes) }, { label: "Evidence", value: bytes(data.components.evidence), sub: `${data.evidence_files ?? "—"} files` },
          { label: "Events", value: data.events.count.toLocaleString(), sub: bytes(data.components.operational_db) },
          { label: "Backups", value: bytes(data.components.backups) },
        ]} />
        {ran && <Notice>Retention run: {Object.entries(ran).map(([k, x]) => `${k.replace(/_/g, " ")} ${val(x)}`).join(" · ")}</Notice>}
        {act.error && <Notice tone="red">{act.error}</Notice>}
        <div className="grid grid-cols-2 gap-4">
          <Section title="Usage by component" flush>
            <Table head={["Component", "Size", "Share of used"]}>
              {Object.entries(data.components).map(([k, n]) => (
                <Tr key={k}><Td>{k.replace(/_/g, " ")}</Td><Td mono right>{bytes(n)}</Td><Td mono right muted>{pct(n, v.used_bytes)}</Td></Tr>
              ))}
            </Table>
            <div className="p-2.5"><KV rows={[["oldest event", dash(data.events.oldest)], ["newest event", dash(data.events.newest)], ["training candidates", data.training_candidates]]} /></div>
          </Section>
          <Section title="Retention policy">
            <ConfigFields draft={draft} paths={["retention.evidence_max_files", "retention.event_retention_days", "retention.backup_keep", "capacity.storage_warn_pct"]} />
            <ConfigApplyBar draft={draft} />
            <Notice>The impact preview counts exactly what a new policy deletes now (evidence files, events, backups). Model-improvement candidates keep their own copy of the evidence frame.</Notice>
          </Section>
        </div>
        <Section title="NVR storage" flush>
          <Table head={["NVR", "Company", "Storage"]}>
            {data.nvrs.map((n) => <Tr key={n.nvr_id}><Td mono>{n.nvr_id}</Td><Td muted>{n.company_id}</Td><Td muted>{n.note}</Td></Tr>)}
          </Table>
        </Section>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------- backups */

type Backup = { id: string; created_at: number; author: string; kind: string; path: string; size_bytes: number; sha256: string | null;
  status: string; detail: string | null; restored_at: number | null; restored_by: string | null; present: boolean };

export function BackupsModule() {
  const { data, error } = useAdmin<{ backups: Backup[]; kinds: string[] }>("backups", { topics: ["backup"] });
  const [kind, setKind] = useState("config");
  const [note, setNote] = useState("");
  const [restore, setRestore] = useState<{ id: string; preview: Record<string, unknown> } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const act = useAction();
  return (
    <>
      <ModuleHeader title="Backup & restore" sub="backend/backups · SHA-256 verified before restore" />
      <div className="flex-1 min-h-0 overflow-auto p-6 flex flex-col gap-4">
        <Section title="Create backup">
          <div className="flex items-center gap-2">
            <Select value={kind} onChange={setKind} testid="backup-kind" options={[["config", "Configuration (versions, roles, device metadata, integrations, YAML)"], ["database", "Operational database (cameras, hierarchy, events, feedback)"], ["audit", "Audit log export (verifiable)"]]} className="w-[440px]" />
            <Input placeholder="Note" value={note} onChange={(e) => setNote(e.target.value)} className="w-64" />
            <PermButton perm="backup.manage" size="sm" variant="primary" disabled={act.busy}
              onClick={() => void act.run(async () => { const b = await adminCall<Backup>("POST", "backups", { kind, note }); setMsg(`Created ${b.id} (${bytes(b.size_bytes)}).`); setNote(""); })}>
              {act.busy ? "Working…" : "Create"}
            </PermButton>
          </div>
        </Section>
        {msg && <Notice>{msg}</Notice>}
        {act.error && <Notice tone="red">{act.error}</Notice>}
        {restore && (
          <div className="border border-accent/60 rounded-lg bg-raised shadow-card p-4 flex flex-col gap-3" data-testid="restore-preview">
            <div className="text-caption text-accent-ink">Restore preview · {restore.id}</div>
            {"changes" in (restore.preview.preview as object ?? {}) ? (
              <DiffTable changes={(restore.preview.preview as Impact).changes} />
            ) : (
              (((restore.preview.preview as { notes?: string[] })?.notes) ?? []).map((n) => <Notice key={n}>{n}</Notice>)
            )}
            {Array.isArray(restore.preview.restores) && <Notice>Restores: {(restore.preview.restores as string[]).join(", ")}. The configuration is applied as a new version (rollback remains possible).</Notice>}
            <div className="flex justify-end gap-1.5">
              <Button size="sm" variant="ghost" onClick={() => setRestore(null)}>Cancel</Button>
              <PermButton perm="backup.manage" size="sm" variant="danger" disabled={act.busy}
                onClick={() => void act.run(async () => { const r = await adminCall<Record<string, unknown>>("POST", `backups/${restore.id}/restore`, { confirm: true }); setMsg(`Restored ${restore.id}: ${JSON.stringify(r).slice(0, 240)}`); setRestore(null); })}>
                Restore now
              </PermButton>
            </div>
          </div>
        )}
        <Section title="Backup history" flush>
          {!data ? <Loading error={error} /> : data.backups.length === 0 ? <Empty>No backups yet.</Empty> : (
            <Table head={["ID", "Kind", "Created", "By", "Size", "SHA-256", "Status", "Restored", "Note", ""]} testid="backup-table">
              {data.backups.map((b) => (
                <Tr key={b.id} tone={b.status === "failed" ? "red" : undefined}>
                  <Td mono>{b.id}</Td><Td>{b.kind}</Td><Td mono muted>{dt(b.created_at)}</Td><Td muted>{b.author}</Td>
                  <Td mono right>{bytes(b.size_bytes)}</Td><Td mono muted>{b.sha256?.slice(0, 12) ?? "—"}</Td>
                  <Td><Status value={b.status === "ok" ? (b.present ? "ok" : "missing") : b.status} label={b.status === "ok" && !b.present ? "files missing" : b.status} /></Td>
                  <Td mono muted>{b.restored_at ? `${dt(b.restored_at)} · ${b.restored_by}` : "—"}</Td>
                  <Td muted className="max-w-[240px] truncate" title={b.detail ?? ""}>{dash(b.detail)}</Td>
                  <Td>
                    {b.status === "ok" && b.present && (
                      <span className="inline-flex gap-1">
                        <PermButton perm="backup.manage" size="sm" disabled={act.busy}
                          onClick={() => void act.run(async () => { const r = await adminCall<Record<string, unknown>>("POST", `backups/${b.id}/verify`); setMsg(`${b.id}: ${JSON.stringify(r)}`); })}>Verify</PermButton>
                        {b.kind !== "audit" && (
                          <PermButton perm="backup.manage" size="sm" disabled={act.busy}
                            onClick={() => void act.run(async () => setRestore({ id: b.id, preview: await adminCall("POST", `backups/${b.id}/restore`, {}) }))}>Restore…</PermButton>
                        )}
                        <PermButton perm="backup.manage" size="sm" variant="ghost" disabled={act.busy} onClick={() => void act.run(() => adminCall("DELETE", `backups/${b.id}`))}>Delete</PermButton>
                      </span>
                    )}
                  </Td>
                </Tr>
              ))}
            </Table>
          )}
        </Section>
        <Notice>The audit trail is append-only and is never restored; an audit backup can be verified against the live hash chain.</Notice>
      </div>
    </>
  );
}

/* ------------------------------------------------------ system configuration */

type Version = { version: number; created_at: number; author: string; kind: string; comment: string; based_on: number | null; changes: number; paths: string[] };
type Readiness = { active_version: number; offline_validity_hours: number; now: number;
  workers: { worker: number; alive: boolean; acked_version: number | null; acked_at: number | null; status: string }[];
  companies: { company_id: string; name: string; status: string; workers: number[]; cameras: number; bound: number; version: number | null;
    last_sync: number | null; valid_until: number | null; valid: boolean | null }[] };

export function ConfigModule() {
  const [tab, setTab] = useState<"settings" | "versions" | "readiness">("settings");
  return (
    <>
      <ModuleHeader title="System configuration" sub="versioned — every apply creates a new version with author, diff and rollback" />
      <Tabs tabs={[["settings", "Settings"], ["versions", "Versions · diff · rollback"], ["readiness", "Offline readiness"]]} value={tab} onChange={setTab} />
      <div className="flex-1 min-h-0 overflow-auto p-6 flex flex-col gap-4">
        {tab === "settings" && <Settings />}
        {tab === "versions" && <Versions />}
        {tab === "readiness" && <ReadinessView />}
      </div>
    </>
  );
}

function Settings() {
  const draft = useConfigDraft();
  return (
    <>
      <div className="grid grid-cols-2 gap-4">
        <Section title="System"><ConfigFields draft={draft} paths={["system.site_name", "system.classification"]} /></Section>
        <Section title="Policy synchronization"><ConfigFields draft={draft} paths={["sync.offline_validity_hours", "sync.ack_timeout_s"]} /></Section>
        <Section title="Capacity policy"><ConfigFields draft={draft} paths={["capacity.gpu_util_warn_pct", "capacity.vram_warn_pct", "capacity.storage_warn_pct"]} /></Section>
        <Section title="Integration settings"><ConfigFields draft={draft} paths={["integrations.probe_timeout_s", "integrations.discovery_timeout_s"]} /></Section>
      </div>
      <Notice>Detection thresholds, alert policies and schedules: Detection & rules. Retention: Storage. Authentication policy: Security. All share this version history.</Notice>
      <ConfigApplyBar draft={draft} />
    </>
  );
}

function Versions() {
  const { data, error } = useAdmin<{ versions: Version[]; active: number }>("config/versions", { topics: ["config"] });
  const [a, setA] = useState<number | null>(null);
  const [b, setB] = useState<number | null>(null);
  const diff = useAdmin<{ changes: Impact["changes"] }>(a && b ? `config/diff?a=${a}&b=${b}` : null);
  const [rb, setRb] = useState<{ version: number; impact: Impact } | null>(null);
  const [comment, setComment] = useState("");
  const act = useAction();
  if (!data) return <Loading error={error} />;
  return (
    <>
      {rb && (
        <ImpactPreview impact={rb.impact} busy={act.busy} error={act.error} perm="config.manage" comment={comment} setComment={setComment}
          applyLabel={`Roll back to v${rb.version}`} onCancel={() => setRb(null)}
          onApply={() => void act.run(async () => { await adminCall("POST", "config/rollback", { version: rb.version, comment }); setRb(null); setComment(""); })} />
      )}
      {!rb && act.error && <Notice tone="red">{act.error}</Notice>}
      <Section title="Version history" flush>
        <Table head={["Version", "Created", "Author", "Kind", "Changes", "Comment", "Compare", ""]} testid="version-table">
          {data.versions.map((v) => (
            <Tr key={v.version} selected={v.version === a || v.version === b}>
              <Td mono>v{v.version}{v.version === data.active ? <span className="text-ok-ink"> active</span> : null}</Td>
              <Td mono muted>{dt(v.created_at)}</Td><Td>{v.author}</Td><Td muted>{v.kind}{v.based_on ? ` of v${v.based_on}` : ""}</Td>
              <Td mono muted title={v.paths.join("\n")}>{v.changes ? `${v.changes} · ${v.paths.slice(0, 2).join(", ")}${v.paths.length > 2 ? "…" : ""}` : "—"}</Td>
              <Td muted className="max-w-[240px] truncate" title={v.comment}>{dash(v.comment)}</Td>
              <Td>
                <span className="inline-flex gap-1">
                  <Button size="sm" variant={a === v.version ? "primary" : "default"} onClick={() => setA(v.version)}>A</Button>
                  <Button size="sm" variant={b === v.version ? "primary" : "default"} onClick={() => setB(v.version)}>B</Button>
                </span>
              </Td>
              <Td>
                {v.version !== data.active && (
                  <PermButton perm="config.manage" size="sm" disabled={act.busy}
                    onClick={() => void act.run(async () => setRb({ version: v.version, impact: await adminCall<Impact>("POST", "config/rollback/preview", { version: v.version }) }))}>
                    Roll back…
                  </PermButton>
                )}
              </Td>
            </Tr>
          ))}
        </Table>
      </Section>
      <Section title={a && b ? `Diff v${a} → v${b}` : "Diff — pick versions A and B"} flush>
        {a && b ? (diff.data ? <DiffTable changes={diff.data.changes} /> : <Loading error={diff.error} />) : <Empty>Select two versions.</Empty>}
      </Section>
    </>
  );
}

function ReadinessView() {
  const { data, error } = useAdmin<Readiness>("readiness", { topics: ["sync", "config"], refresh: 10000 });
  if (!data) return <Loading error={error} />;
  const now = data.now;
  return (
    <>
      <Notice>
        Each company&apos;s cameras are served by inference workers (the edge compute). A site is ready to run offline when every worker serving it has
        acknowledged the active policy version v{data.active_version}; it may keep running on that policy for {data.offline_validity_hours} h after its last sync.
      </Notice>
      <Section title="Sites / companies" flush>
        <Table head={["Company", "Name", "Sync", "Policy", "Workers", "Cameras (video)", "Last sync", "Offline valid until", ""]} testid="readiness-table">
          {data.companies.map((c) => (
            <Tr key={c.company_id} tone={c.status === "OUT_OF_SYNC" || c.status === "OFFLINE" ? "red" : c.status === "PENDING" ? "amber" : undefined}>
              <Td mono>{c.company_id}</Td><Td>{c.name}</Td>
              <Td><Status value={c.status === "NO_EDGE" ? undefined : c.status} label={c.status === "NO_EDGE" ? "no edge compute" : c.status.replace(/_/g, " ")} /></Td>
              <Td mono>{c.version ? `v${c.version}` : "—"}</Td><Td mono muted>{c.workers.join(", ") || "—"}</Td>
              <Td mono right>{c.cameras} ({c.bound})</Td>
              <Td mono muted>{c.last_sync ? `${dt(c.last_sync)} (${ago(now - c.last_sync)} ago)` : "—"}</Td>
              <Td mono muted>{c.valid_until ? dt(c.valid_until) : "—"}</Td>
              <Td>{c.valid === null ? null : <Status value={c.valid ? "ok" : "failed"} label={c.valid ? "valid" : "expired"} />}</Td>
            </Tr>
          ))}
        </Table>
      </Section>
      <Section title="Workers" flush>
        <Table head={["Worker", "Process", "Acknowledged", "At", "Status"]}>
          {data.workers.map((w) => (
            <Tr key={w.worker}><Td mono>{w.worker}</Td><Td><Status value={w.alive ? "ONLINE" : "OFFLINE"} /></Td>
              <Td mono>{w.acked_version ? `v${w.acked_version}` : "—"}</Td><Td mono muted>{dt(w.acked_at)}</Td><Td><Status value={w.status} /></Td></Tr>
          ))}
        </Table>
      </Section>
    </>
  );
}

