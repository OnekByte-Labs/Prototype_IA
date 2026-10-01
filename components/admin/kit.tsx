"use client";

import { useEffect, useState, type ReactNode } from "react";
import useSWR, { type KeyedMutator } from "swr";
import { useConsole } from "@/components/gotham/ConsoleProvider";
import { Button, StatusDot, inputClass, selectClass, toTone } from "@/components/ds";
import { cx } from "@/lib/design/cx";
import { useSession } from "@/lib/use-session";

/* ------------------------------------------------------------------- data */

export class AdminError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) {
    window.location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
  }
  if (!res.ok) throw new AdminError(res.status, body.error ?? `HTTP ${res.status}`);
  return body as T;
}

/**
 * Admin API resource. Revalidates on the given admin WebSocket topics
 * (config, users, sessions, audit, …) and optionally on an interval for
 * live telemetry.
 */
export function useAdmin<T>(path: string | null, opts: { topics?: string[]; refresh?: number } = {}) {
  const { subscribeAdmin } = useConsole();
  const key = path ? `/api/v1/admin/${path}` : null;
  const swr = useSWR<T>(key, getJson, { refreshInterval: opts.refresh ?? 0, revalidateOnFocus: false });
  const topics = (opts.topics ?? []).join(",");
  const { mutate } = swr;
  useEffect(() => {
    if (!topics) return;
    const set = new Set(topics.split(","));
    return subscribeAdmin((e) => {
      if (set.has(e.topic)) void mutate();
    });
  }, [topics, subscribeAdmin, mutate]);
  return swr as { data: T | undefined; error: AdminError | undefined; isLoading: boolean; mutate: KeyedMutator<T> };
}

export async function adminCall<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path.startsWith("/") ? path : `/api/v1/admin/${path}`, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new AdminError(res.status, data.error ?? `HTTP ${res.status}`);
  return data as T;
}

/** Run an admin action with busy / error state. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError((e as Error).message);
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, run };
}

/* ---------------------------------------------------------------- formats */

const pad = (n: number) => String(n).padStart(2, "0");
export function dt(epoch?: number | null) {
  if (!epoch) return "—";
  const d = new Date(epoch * 1000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
export function clock(epoch?: number | null) {
  if (!epoch) return "—";
  const d = new Date(epoch * 1000);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
export function ago(seconds?: number | null) {
  if (seconds == null) return "never";
  if (seconds < 1) return "<1s";
  if (seconds < 90) return `${Math.round(seconds)}s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)}m`;
  if (seconds < 172800) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}
export function bytes(n?: number | null) {
  if (n == null) return "—";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${u[i]}`;
}
export const pct = (a?: number | null, b?: number | null) => (a != null && b ? `${((a / b) * 100).toFixed(1)}%` : "—");
export const dash = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));
export const val = (v: unknown) =>
  v === null || v === undefined ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v);

/* ----------------------------------------------------------------- layout */

/** Title row of an administration module: name, one line of context, contextual actions. */
export function ModuleHeader({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="min-h-16 shrink-0 px-6 py-3 flex items-center gap-4 border-b border-line bg-surface">
      <div className="min-w-0">
        <h1 className="text-title text-ink truncate">{title}</h1>
        {sub && <p className="text-ui text-ink-2 truncate">{sub}</p>}
      </div>
      <div className="ml-auto flex items-center gap-2">{children}</div>
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: [T, string][]; value: T; onChange: (t: T) => void }) {
  return (
    <div role="tablist" className="shrink-0 px-6 flex items-end gap-5 border-b border-line bg-surface">
      {tabs.map(([k, label]) => {
        const on = value === k;
        return (
          <button
            key={k}
            role="tab"
            type="button"
            aria-selected={on}
            data-testid={`tab-${k}`}
            onClick={() => onChange(k)}
            className={cx("relative h-10 text-ui font-medium transition-colors", on ? "text-ink" : "text-ink-2 hover:text-ink")}
          >
            {label}
            <span className={cx("absolute left-0 right-0 -bottom-px h-0.5 rounded-full", on ? "bg-accent" : "bg-transparent")} />
          </button>
        );
      })}
    </div>
  );
}

export function Section({ title, aside, children, className = "", flush }: {
  title: string; aside?: ReactNode; children: ReactNode; className?: string; flush?: boolean;
}) {
  return (
    <section className={cx("border border-line rounded-lg bg-surface shadow-card min-w-0 overflow-hidden", className)}>
      <header className="min-h-10 px-4 py-1.5 flex items-center gap-2 border-b border-line">
        <h2 className="text-section text-ink">{title}</h2>
        <div className="ml-auto flex items-center gap-2">{aside}</div>
      </header>
      <div className={flush ? "" : "p-4"}>{children}</div>
    </section>
  );
}

export function KV({ rows, cols = 1 }: { rows: [string, ReactNode][]; cols?: number }) {
  return (
    <dl className="grid gap-x-8" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {rows.map(([k, v], i) => (
        <div key={`${i}:${k}`} className="min-w-0 flex items-baseline gap-3 py-1.5 border-b border-line">
          <dt className="w-[140px] shrink-0 text-caption text-ink-2">{k}</dt>
          <dd className="min-w-0 break-words text-data font-data text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Compact metric strip: label / value pairs separated by hairlines. */
export function Strip({ items }: { items: { label: string; value: ReactNode; tone?: string; sub?: ReactNode }[] }) {
  return (
    <div className="shrink-0 flex border border-line rounded-lg bg-surface shadow-card divide-x divide-line overflow-x-auto">
      {items.map((it) => (
        <div key={it.label} className="px-4 py-2.5 min-w-[120px]">
          <div className="text-caption text-ink-2 whitespace-nowrap">{it.label}</div>
          <div className={cx("text-stat tnum", it.tone ?? "text-ink")}>{it.value}</div>
          {it.sub != null && <div className="text-caption text-ink-3 whitespace-nowrap">{it.sub}</div>}
        </div>
      ))}
    </div>
  );
}

/** Raw status keys → design-system tone. Colour only where the status means something. */
const TONE: Record<string, string> = {
  ONLINE: "ok", SYNCED: "ok", ok: "ok", active: "ok", running: "ok", loaded: "ok", accepted: "ok", success: "ok",
  DEGRADED: "warn", PENDING: "warn", starting: "warn", stopping: "warn", pending: "warn", med: "warn", locked: "warn", denied: "warn",
  OFFLINE: "crit", OUT_OF_SYNC: "crit", error: "crit", failed: "crit", high: "crit", missing: "crit", rejected: "crit",
};

const STATUS_TEXT: Record<string, string> = { ok: "text-ok-ink", warn: "text-warn-ink", crit: "text-crit-ink", idle: "text-ink-2" };

/** Dot + word. Healthy states stay quiet; warnings and faults speak up. */
export function Status({ value, label }: { value?: string | null; label?: string }) {
  const tone = TONE[value ?? ""] ?? "idle";
  const text = label ?? (value ? value.replace(/_/g, " ") : "—");
  return (
    <span className={cx("inline-flex items-center gap-1.5 text-ui font-sans whitespace-nowrap", tone === "ok" ? "text-ink-2" : STATUS_TEXT[tone], tone === "crit" && "font-medium")}>
      <StatusDot tone={toTone(tone)} />
      {text.charAt(0).toUpperCase() + text.slice(1).toLowerCase()}
    </span>
  );
}

export function Table({ head, children, testid, minWidth }: { head: ReactNode[]; children: ReactNode; testid?: string; minWidth?: number }) {
  return (
    <div className="overflow-auto">
      <table className="w-full border-separate border-spacing-0" data-testid={testid} style={minWidth ? { minWidth } : undefined}>
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i} className="sticky top-0 z-10 h-9 px-3 bg-surface border-b border-line text-left text-caption font-medium text-ink-2 whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Tr({ children, onClick, selected, tone, testid }: {
  children: ReactNode; onClick?: () => void; selected?: boolean; tone?: "red" | "amber"; testid?: string;
}) {
  return (
    <tr
      data-testid={testid}
      onClick={onClick}
      className={cx(
        "group transition-colors",
        onClick && "cursor-pointer",
        selected ? "bg-accent-wash/70" : onClick && "hover:bg-hover",
        tone === "red" && "shadow-[inset_3px_0_0_var(--ds-crit)]",
        tone === "amber" && "shadow-[inset_3px_0_0_var(--ds-warn)]",
      )}
    >
      {children}
    </tr>
  );
}

export function Td({ children, mono, muted, right, className = "", title }: {
  children?: ReactNode; mono?: boolean; muted?: boolean; right?: boolean; className?: string; title?: string;
}) {
  return (
    <td
      title={title}
      className={cx(
        "h-10 px-3 border-b border-line whitespace-nowrap",
        mono ? "text-data font-data tnum" : "text-ui",
        muted ? "text-ink-2" : "text-ink",
        right && "text-right",
        className,
      )}
    >
      {children}
    </td>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="px-4 py-8 text-center text-ui text-ink-2">{children}</div>;
}

export function Loading({ error }: { error?: Error }) {
  return error ? (
    <div className="px-4 py-8 text-center text-ui text-crit-ink" data-testid="admin-error">{error.message}</div>
  ) : (
    <div className="px-4 py-8 text-center text-ui text-ink-2">Loading…</div>
  );
}

export function Notice({ tone = "muted", children }: { tone?: "muted" | "amber" | "red"; children: ReactNode }) {
  const c = tone === "red" ? "bg-crit-wash text-crit-ink" : tone === "amber" ? "bg-warn-wash text-warn-ink" : "bg-sunken text-ink-2";
  return <div className={cx("px-3 py-2 rounded-md text-ui", c)}>{children}</div>;
}

/* ----------------------------------------------------------------- inputs */

export const inputCls = inputClass;

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(inputClass, props.className)} />;
}

export function Select({ value, onChange, options, disabled, className = "", testid }: {
  value: string; onChange: (v: string) => void; options: [string, string][]; disabled?: boolean; className?: string; testid?: string;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      data-testid={testid}
      onChange={(e) => onChange(e.target.value)}
      className={cx(selectClass, className)}
    >
      {options.map(([v, l]) => (
        <option key={v} value={v}>{l}</option>
      ))}
    </select>
  );
}

export function FormRow({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 min-w-0">
      <span className="w-[150px] shrink-0 text-ui text-ink-2 first-letter:uppercase">{label}</span>
      <span className="min-w-0 flex items-center gap-2">{children}</span>
      {hint && <span className="text-caption text-ink-3">{hint}</span>}
    </label>
  );
}

/** Permission-gated button: disabled with the reason when the user lacks it. */
export function PermButton({ perm, children, ...rest }: { perm: string } & React.ComponentProps<typeof Button>) {
  const { can } = useSession();
  const ok = can(perm);
  return (
    <Button {...rest} disabled={rest.disabled || !ok} title={ok ? rest.title : `Requires permission ${perm}`}>
      {children}
    </Button>
  );
}

/* --------------------------------------------------------- impact preview */

export type Impact = {
  changes: { path: string; old: unknown; new: unknown; change: string }[];
  required_permissions?: string[];
  cameras: { camera_id: string; name: string; company_name?: string | null; post_name?: string | null; mode?: string; effect?: string }[];
  nvrs: { nvr_id: string; name: string; company_id: string }[];
  pipelines: { mode: string; label: string; cameras: number; effect: string }[];
  gpu: Record<string, unknown> | null;
  storage: Record<string, unknown>;
  sessions: { active: number; would_end: { id: string; username: string }[]; password_policy_tightened: boolean } | null;
  users: { username: string; display_name?: string; role: string; scope_type: string; scope_id: string | null }[];
  notes: string[];
};

export function DiffTable({ changes }: { changes: Impact["changes"] }) {
  return changes.length === 0 ? (
    <Empty>No differences.</Empty>
  ) : (
    <Table head={["Setting", "Current", "New"]} testid="diff-table">
      {changes.map((c) => (
        <Tr key={c.path}>
          <Td mono>{c.path}</Td>
          <Td mono muted>{val(c.old)}</Td>
          <Td mono className="text-warn-ink">{val(c.new)}</Td>
        </Tr>
      ))}
    </Table>
  );
}

/**
 * Configuration Impact Preview: exactly what an apply will touch, computed by
 * the backend from live state — shown before anything is changed.
 */
export function ImpactPreview({ impact, onApply, onCancel, applyLabel = "Apply", busy, error, perm, comment, setComment }: {
  impact: Impact; onApply: () => void; onCancel: () => void; applyLabel?: string; busy?: boolean; error?: string | null;
  perm?: string; comment?: string; setComment?: (s: string) => void;
}) {
  const st = impact.storage ?? {};
  const replay = (st.alert_replay as { camera_id: string; event_type: string; events: number; alerts_before: number; alerts_after: number }[]) ?? [];
  return (
    <div className="border border-accent/60 rounded-lg bg-raised shadow-card" data-testid="impact-preview">
      <div className="min-h-11 px-4 py-2 flex items-center gap-3 border-b border-line">
        <h3 className="text-section text-accent-ink">Impact preview</h3>
        <span className="text-caption text-ink-2">
          {impact.changes.length} change(s) · {impact.cameras.length} camera(s) · {impact.nvrs.length} NVR(s) ·{" "}
          {impact.pipelines.length} pipeline type(s) · {impact.users.length} user(s)
        </span>
      </div>
      <div className="p-4 grid grid-cols-2 gap-4">
        <Section title="Changes" flush className="col-span-2">
          <DiffTable changes={impact.changes} />
        </Section>
        <Section title={`Cameras affected (${impact.cameras.length})`} flush>
          {impact.cameras.length ? (
            <div className="max-h-48 overflow-auto">
              <Table head={["Camera", "Site", "Effect"]}>
                {impact.cameras.map((c) => (
                  <Tr key={c.camera_id}>
                    <Td mono>{c.camera_id}</Td>
                    <Td muted>{[c.company_name, c.post_name].filter(Boolean).join(" / ") || "—"}</Td>
                    <Td className="text-warn-ink">{c.effect}</Td>
                  </Tr>
                ))}
              </Table>
            </div>
          ) : (
            <Empty>No camera is affected.</Empty>
          )}
        </Section>
        <Section title="Pipelines · GPU · NVRs">
          <KV rows={[
            ["Pipelines", impact.pipelines.length ? impact.pipelines.map((p) => `${p.label} ×${p.cameras} (${p.effect})`).join("; ") : "none"],
            ["GPU", impact.gpu ? `pipeline time ${val(impact.gpu.current_pipeline_ms_per_s)} → ${val(impact.gpu.projected_pipeline_ms_per_s)} ms/s (${val(impact.gpu.note)})` : "no change"],
            ["NVRs", impact.nvrs.length ? impact.nvrs.map((n) => `${n.nvr_id} (${n.company_id})`).join(", ") : "none"],
            ["Storage", Object.keys(st).filter((k) => k !== "alert_replay").length
              ? Object.entries(st).filter(([k]) => k !== "alert_replay").map(([k, v]) => `${k.replace(/_/g, " ")}: ${val(v)}`).join("; ")
              : "no deletion"],
            ["Sessions", impact.sessions ? `${impact.sessions.would_end.length} of ${impact.sessions.active} would end` : "unaffected"],
            ["Users", impact.users.length ? impact.users.map((u) => u.username).join(", ") : "none"],
          ]} />
        </Section>
        {replay.length > 0 && (
          <Section title="Alert volume · replay of the last 24 h" flush className="col-span-2">
            <Table head={["Camera", "Event type", "Events", "Alerts now", "Alerts with change"]}>
              {replay.map((r) => (
                <Tr key={r.camera_id + r.event_type}>
                  <Td mono>{r.camera_id}</Td>
                  <Td mono muted>{r.event_type}</Td>
                  <Td mono right>{r.events}</Td>
                  <Td mono right>{r.alerts_before}</Td>
                  <Td mono right className="text-warn-ink">{r.alerts_after}</Td>
                </Tr>
              ))}
            </Table>
          </Section>
        )}
        {impact.notes.length > 0 && (
          <div className="col-span-2 flex flex-col gap-1">
            {impact.notes.map((n) => (
              <Notice key={n}>{n}</Notice>
            ))}
          </div>
        )}
      </div>
      <div className="min-h-12 px-4 py-2 flex items-center gap-3 border-t border-line">
        {setComment && (
          <Input placeholder="Change reason (recorded in the audit log)" value={comment ?? ""} data-testid="change-comment"
            onChange={(e) => setComment(e.target.value)} className="w-96" />
        )}
        {impact.required_permissions && (
          <span className="text-caption text-ink-3">Requires {impact.required_permissions.join(", ")}</span>
        )}
        {error && <span className="text-ui text-crit-ink" data-testid="apply-error">{error}</span>}
        <div className="ml-auto flex items-center gap-1.5">
          <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
          {perm ? (
            <PermButton perm={perm} size="sm" variant="primary" onClick={onApply} disabled={busy || impact.changes.length === 0}>
              {busy ? "Applying…" : applyLabel}
            </PermButton>
          ) : (
            <Button size="sm" variant="primary" onClick={onApply} disabled={busy}>{busy ? "Applying…" : applyLabel}</Button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Config section editor flow shared by every module that edits the versioned
 * configuration: edit a draft → preview impact → apply as a new version.
 */
export type ConfigDoc = Record<string, Record<string, unknown>> & {
  alerts: { policies: Record<string, { enabled: boolean; severity: string; cooldown_s: number }> };
  schedules: Record<string, { days: number[]; start: string; end: string }[]>;
};

export function useConfigDraft() {
  const cfg = useAdmin<{ active: { version: number; doc: ConfigDoc; author: string; created_at: number }; schema: Schema }>(
    "config", { topics: ["config"] });
  const [draft, setDraft] = useState<ConfigDoc | null>(null);
  const [impact, setImpact] = useState<Impact | null>(null);
  const [comment, setComment] = useState("");
  const act = useAction();
  const doc = draft ?? cfg.data?.active.doc ?? null;
  const dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(cfg.data?.active.doc);
  const set = (path: string, value: unknown) => {
    const base: ConfigDoc = JSON.parse(JSON.stringify(doc));
    const keys = path.split(".");
    let cur: Record<string, unknown> = base as unknown as Record<string, unknown>;
    for (const k of keys.slice(0, -1)) cur = (cur[k] ??= {}) as Record<string, unknown>;
    cur[keys[keys.length - 1]] = value;
    setDraft(base);
    setImpact(null);
  };
  const replace = (next: ConfigDoc) => {
    setDraft(next);
    setImpact(null);
  };
  const preview = () => act.run(async () => setImpact(await adminCall<Impact>("POST", "config/preview", { doc })));
  const apply = () =>
    act.run(async () => {
      await adminCall("POST", "config/apply", { doc, comment });
      setDraft(null);
      setImpact(null);
      setComment("");
      await cfg.mutate();
    });
  const reset = () => {
    setDraft(null);
    setImpact(null);
    act.setError(null);
  };
  return { cfg, doc, draft, dirty, set, replace, impact, preview, apply, reset, comment, setComment, act };
}

export type Schema = {
  fields: Record<string, { type: string; min: number; max: number; description: string; permission: string }>;
  strings: Record<string, { description: string; permission: string }>;
  severities: string[];
  alert_event_types: string[];
};

export function getPath(doc: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), doc);
}

/** Numeric / string settings editor bound to a config draft. */
export function ConfigFields({ paths, draft }: { paths: string[]; draft: ReturnType<typeof useConfigDraft> }) {
  const schema = draft.cfg.data?.schema;
  const { can } = useSession();
  if (!schema || !draft.doc) return <Loading />;
  return (
    <div>
      {paths.map((p) => {
        const f = schema.fields[p];
        const s = schema.strings[p];
        const perm = (f ?? s)?.permission ?? "config.manage";
        const v = getPath(draft.doc, p);
        const cur = getPath(draft.cfg.data?.active.doc, p);
        return (
          <FormRow key={p} label={p.split(".").pop()!.replace(/_/g, " ")}
            hint={<>{(f ?? s)?.description}{f ? ` · ${f.min}–${f.max}` : ""}{v !== cur ? <span className="text-warn-ink"> · was {val(cur)}</span> : null}</>}>
            <Input
              data-testid={`cfg-${p}`}
              disabled={!can(perm)}
              title={can(perm) ? undefined : `Requires permission ${perm}`}
              type={f ? "number" : "text"}
              step={f?.type === "float" ? "0.05" : "1"}
              value={String(v ?? "")}
              onChange={(e) => draft.set(p, f ? (e.target.value === "" ? "" : Number(e.target.value)) : e.target.value)}
              className={f ? "w-28 font-data" : "w-72"}
            />
          </FormRow>
        );
      })}
    </div>
  );
}

/** Review bar under an edited config section. */
export function ConfigApplyBar({ draft, perm = "config.manage" }: { draft: ReturnType<typeof useConfigDraft>; perm?: string }) {
  if (draft.impact) {
    return (
      <ImpactPreview impact={draft.impact} onApply={() => void draft.apply()} onCancel={draft.reset} busy={draft.act.busy}
        error={draft.act.error} perm={perm} comment={draft.comment} setComment={draft.setComment}
        applyLabel={`Apply as v${(draft.cfg.data?.active.version ?? 0) + 1}`} />
    );
  }
  return (
    <div className="min-h-10 flex items-center gap-3">
      <span className="text-caption text-ink-3">
        active v{draft.cfg.data?.active.version} · {draft.cfg.data?.active.author} · {dt(draft.cfg.data?.active.created_at)}
      </span>
      {draft.act.error && <span className="text-ui text-crit-ink" data-testid="preview-error">{draft.act.error}</span>}
      <div className="ml-auto flex items-center gap-1.5">
        {draft.dirty && <Button size="sm" variant="ghost" onClick={draft.reset}>Discard</Button>}
        <Button size="sm" variant="primary" disabled={!draft.dirty || draft.act.busy} onClick={() => void draft.preview()}>
          Review impact
        </Button>
      </div>
    </div>
  );
}
