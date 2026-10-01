"use client";

import { useState } from "react";
import { Button } from "@/components/ds";
import {
  adminCall, ago, dash, dt, Empty, FormRow, Input, KV, Loading, ModuleHeader, Notice, PermButton, Section, Select,
  Status, Table, Tabs, Td, Tr, useAction, useAdmin,
} from "../kit";

/* ----------------------------------------------------------------- hierarchy */

type HCam = { camera_id: string; name: string; source_bound: boolean; mode: string; health: string | null; post_id: string | null; nvr_channel: number | null };
type HUser = { username: string; display_name: string; role: string; scope_type: string; scope_id: string };
type HPost = { id: string; name: string; latitude: number; longitude: number; cameras: HCam[]; users: HUser[] };
type HCompany = { id: string; name: string; latitude: number; longitude: number; posts: HPost[];
  nvr: { nvr_id: string; name: string } | null; users: HUser[] };
type Hierarchy = { revision: number; battalion: { unit_id: string; name: string }; companies: HCompany[]; unassigned: HCam[] };
type HPreview = { summary: string; cameras: { camera_id: string; effect: string }[]; users: HUser[]; warnings: string[]; revision: number };

export function HierarchyModule() {
  const { data, error, mutate } = useAdmin<Hierarchy>("hierarchy", { topics: ["hierarchy"] });
  const [sel, setSel] = useState<{ kind: "company" | "post"; id: string } | null>(null);
  const [op, setOp] = useState<Record<string, unknown> | null>(null);
  const [preview, setPreview] = useState<HPreview | null>(null);
  const act = useAction();
  if (!data) return <><ModuleHeader title="Organization & hierarchy" /><Loading error={error} /></>;

  const company = sel ? data.companies.find((c) => c.id === sel.id || c.posts.some((p) => p.id === sel.id)) : undefined;
  const post = sel?.kind === "post" ? company?.posts.find((p) => p.id === sel.id) : undefined;
  const allPosts = data.companies.flatMap((c) => c.posts.map((p) => [p.id, `${c.name} · ${p.name}`] as [string, string]));
  const posts = data.companies.reduce((s, c) => s + c.posts.length, 0);
  const cams = data.companies.reduce((s, c) => s + c.posts.reduce((t, p) => t + p.cameras.length, 0), 0);

  const review = (o: Record<string, unknown>) =>
    act.run(async () => {
      setOp(o);
      setPreview(await adminCall<HPreview>("POST", "hierarchy/preview", o));
    });
  const apply = () =>
    act.run(async () => {
      await adminCall("POST", "hierarchy/apply", { ...op, force: preview?.warnings.length ? true : undefined });
      setOp(null);
      setPreview(null);
      await mutate();
    });

  return (
    <>
      <ModuleHeader title="Organization & hierarchy"
        sub={`${data.battalion.name} → ${data.companies.length} companies → ${posts} posts → ${cams} cameras · map revision ${data.revision}`}>
        <PermButton perm="hierarchy.manage" size="sm" onClick={() => void review({ op: "add_company" })}>Add company</PermButton>
      </ModuleHeader>
      <div className="flex-1 min-h-0 flex">
        <div className="w-[320px] shrink-0 border-r border-line bg-surface overflow-auto py-2 px-2" data-testid="hierarchy-tree">
          <div className="h-8 px-3 flex items-center text-caption font-medium text-ink-3">{data.battalion.name}</div>
          {data.companies.map((c) => (
            <div key={c.id}>
              <button type="button" onClick={() => setSel({ kind: "company", id: c.id })}
                className={`w-full h-9 px-3 rounded-md flex items-center gap-2 text-left text-ui transition-colors ${sel?.id === c.id ? "bg-canvas shadow-inset-sm text-ink" : "text-ink hover:bg-hover"}`}>
                <span className="font-medium">{c.name}</span>
                <span className="text-data font-data text-ink-3">{c.id}</span>
                <span className="ml-auto text-data font-data text-ink-3">{c.posts.length}p · {c.posts.reduce((s, p) => s + p.cameras.length, 0)}c</span>
              </button>
              {(sel?.id === c.id || c.posts.some((p) => p.id === sel?.id)) && c.posts.map((p) => (
                <button key={p.id} type="button" onClick={() => setSel({ kind: "post", id: p.id })}
                  className={`w-full h-8 pl-8 pr-3 rounded-md flex items-center gap-2 text-left text-ui transition-colors ${sel?.id === p.id ? "bg-canvas shadow-inset-sm text-ink" : "text-ink-2 hover:bg-hover"}`}>
                  {p.name}<span className="text-data font-data text-ink-3">{p.id}</span>
                  <span className="ml-auto text-data font-data text-ink-3">{p.cameras.length}c</span>
                </button>
              ))}
            </div>
          ))}
          {data.unassigned.length > 0 && (
            <div className="px-3 py-2 text-ui text-warn-ink">{data.unassigned.length} unassigned camera(s)</div>
          )}
        </div>
        <div className="flex-1 min-w-0 overflow-auto p-6 flex flex-col gap-4">
          {preview && (
            <div className="border border-accent/60 rounded-lg bg-raised shadow-card p-4 flex flex-col gap-3" data-testid="hierarchy-preview">
              <div className="text-section text-accent-ink">Impact preview · {preview.summary}</div>
              {preview.cameras.length > 0 && <KV rows={preview.cameras.map((c) => [c.camera_id, c.effect])} />}
              <KV rows={[["users affected", preview.users.length ? preview.users.map((u) => `${u.username} (${u.scope_type} ${u.scope_id ?? ""})`).join(", ") : "none"],
                ["map revision", `${preview.revision} → ${preview.revision + 1} (all consoles refresh the map)`]]} />
              {preview.warnings.map((w) => <Notice key={w} tone="amber">{w}</Notice>)}
              {act.error && <Notice tone="red">{act.error}</Notice>}
              <div className="flex justify-end gap-1.5">
                <Button size="sm" variant="ghost" onClick={() => { setOp(null); setPreview(null); act.setError(null); }}>Cancel</Button>
                <PermButton perm="hierarchy.manage" size="sm" variant="primary" disabled={act.busy} onClick={() => void apply()}>
                  {preview.warnings.length ? "Apply anyway" : "Apply"}
                </PermButton>
              </div>
            </div>
          )}
          {!preview && act.error && <Notice tone="red">{act.error}</Notice>}
          {!sel && <Empty>Select a company or post. Changes are validated by the map service and pushed to every console.</Empty>}
          {company && !post && <CompanyPanel c={company} onOp={review} />}
          {post && company && <PostPanel p={post} c={company} allPosts={allPosts} onOp={review} />}
        </div>
      </div>
    </>
  );
}

function RenameRow({ id, name, onOp }: { id: string; name: string; onOp: (o: Record<string, unknown>) => void }) {
  const [v, setV] = useState(name);
  return (
    <FormRow label="Name">
      <Input value={v} onChange={(e) => setV(e.target.value)} className="w-56" data-testid="rename-input" />
      <PermButton perm="hierarchy.manage" size="sm" disabled={!v.trim() || v === name} onClick={() => onOp({ op: "rename", id, name: v.trim() })}>
        Rename
      </PermButton>
    </FormRow>
  );
}

function CompanyPanel({ c, onOp }: { c: HCompany; onOp: (o: Record<string, unknown>) => void }) {
  return (
    <>
      <Section title={`${c.name} · ${c.id}`}
        aside={<>
          <PermButton perm="hierarchy.manage" size="sm" onClick={() => onOp({ op: "add_post", company_id: c.id })}>Add post</PermButton>
          <PermButton perm="hierarchy.manage" size="sm" variant="danger" disabled={c.posts.length > 0}
            title={c.posts.length ? "Delete or move its posts first" : undefined} onClick={() => onOp({ op: "delete_company", id: c.id })}>Delete</PermButton>
        </>}>
        <RenameRow key={c.id} id={c.id} name={c.name} onOp={onOp} />
        <KV cols={2} rows={[["position", `${c.latitude.toFixed(5)}, ${c.longitude.toFixed(5)}`],
          ["NVR", c.nvr ? `${c.nvr.nvr_id} · ${c.nvr.name}` : "none"],
          ["posts", c.posts.length], ["cameras", c.posts.reduce((s, p) => s + p.cameras.length, 0)],
          ["scoped users", c.users.map((u) => u.username).join(", ") || "none"]]} />
      </Section>
      <Section title="Posts" flush>
        <Table head={["Post", "ID", "Cameras", "With video", "Scoped users"]}>
          {c.posts.map((p) => (
            <Tr key={p.id}><Td>{p.name}</Td><Td mono muted>{p.id}</Td><Td mono right>{p.cameras.length}</Td>
              <Td mono right>{p.cameras.filter((x) => x.source_bound).length}</Td><Td muted>{p.users.map((u) => u.username).join(", ") || "—"}</Td></Tr>
          ))}
        </Table>
      </Section>
    </>
  );
}

function PostPanel({ p, c, allPosts, onOp }: { p: HPost; c: HCompany; allPosts: [string, string][]; onOp: (o: Record<string, unknown>) => void }) {
  const [target, setTarget] = useState<Record<string, string>>({});
  return (
    <>
      <Section title={`${c.name} / ${p.name} · ${p.id}`}
        aside={<PermButton perm="hierarchy.manage" size="sm" variant="danger" disabled={p.cameras.length > 0}
          title={p.cameras.length ? "Reassign its cameras first" : undefined} onClick={() => onOp({ op: "delete_post", id: p.id })}>Delete post</PermButton>}>
        <RenameRow key={p.id} id={p.id} name={p.name} onOp={onOp} />
        <KV cols={2} rows={[["position", `${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)}`], ["scoped users", p.users.map((u) => u.username).join(", ") || "none"]]} />
      </Section>
      <Section title="Camera assignment" flush>
        <Table head={["Camera", "Name", "Video", "Mode", "Health", "NVR ch.", "Reassign to post", ""]} testid="post-cameras">
          {p.cameras.map((cam) => (
            <Tr key={cam.camera_id}>
              <Td mono>{cam.camera_id}</Td><Td>{cam.name}</Td><Td muted>{cam.source_bound ? "bound" : "none"}</Td>
              <Td muted>{cam.mode.replace(/_/g, " ")}</Td><Td><Status value={cam.health} /></Td><Td mono muted>{dash(cam.nvr_channel)}</Td>
              <Td>
                <Select value={target[cam.camera_id] ?? p.id} onChange={(v) => setTarget({ ...target, [cam.camera_id]: v })}
                  options={allPosts} className="w-56" testid={`move-${cam.camera_id}`} />
              </Td>
              <Td>
                <PermButton perm="hierarchy.manage" size="sm" disabled={(target[cam.camera_id] ?? p.id) === p.id}
                  onClick={() => onOp({ op: "move_camera", camera_id: cam.camera_id, post_id: target[cam.camera_id] })}>Move</PermButton>
              </Td>
            </Tr>
          ))}
        </Table>
      </Section>
    </>
  );
}

/* ------------------------------------------------------------ users & roles */

type User = { id: number; username: string; display_name: string; service_no: string; role: string; scope_type: string;
  scope_id: string | null; status: string; must_change_password: number; locked: boolean; last_login_at: number | null;
  last_login_ip: string | null; active_sessions: number; created_at: number };
type Role = { name: string; label: string; description: string; permissions: string[]; builtin: number; users: number };
type UsersData = { users: User[]; roles: Role[]; permissions: Record<string, string>; units: { id: string; type: string; name: string; parent_id: string }[] };
type Sess = { id: string; user_id: number; username: string; display_name: string; role: string; created_at: number; last_seen: number; expires_at: number; ip: string; user_agent: string };

export function UsersModule() {
  const [tab, setTab] = useState<"users" | "roles" | "sessions">("users");
  const users = useAdmin<UsersData>("users", { topics: ["users"] });
  const sessions = useAdmin<{ sessions: Sess[]; current: string; now: number }>("sessions", { topics: ["sessions"], refresh: 15000 });
  return (
    <>
      <ModuleHeader title="Users & roles" sub={users.data ? `${users.data.users.length} users · ${users.data.roles.length} roles · ${sessions.data?.sessions.length ?? "—"} active sessions` : undefined} />
      <Tabs tabs={[["users", "Users"], ["roles", "Roles & permissions"], ["sessions", "Active sessions"]]} value={tab} onChange={setTab} />
      <div className="flex-1 min-h-0 overflow-auto">
        {!users.data ? <Loading error={users.error} /> : tab === "users" ? <UserTable d={users.data} reload={() => void users.mutate()} />
          : tab === "roles" ? <RoleMatrix d={users.data} /> : <SessionTable s={sessions.data} />}
      </div>
    </>
  );
}

function scopeOptions(d: UsersData, type: string): [string, string][] {
  return d.units.filter((u) => u.type === type).map((u) => [u.id, `${u.id} · ${u.name}`]);
}

function UserTable({ d, reload }: { d: UsersData; reload: () => void }) {
  const [sel, setSel] = useState<number | "new" | null>(null);
  const user = typeof sel === "number" ? d.users.find((u) => u.id === sel) : undefined;
  return (
    <div className="flex h-full">
      <div className="flex-1 min-w-0 overflow-auto">
        <div className="min-h-11 px-4 flex items-center border-b border-line">
          <PermButton perm="users.manage" size="sm" onClick={() => setSel("new")}>Add user</PermButton>
        </div>
        <Table head={["Username", "Name", "Service no.", "Role", "Scope", "Status", "Sessions", "Last sign-in"]} testid="users-table">
          {d.users.map((u) => (
            <Tr key={u.id} onClick={() => setSel(u.id)} selected={sel === u.id} tone={u.locked ? "amber" : undefined} testid="user-row">
              <Td mono>{u.username}</Td><Td>{u.display_name}</Td><Td mono muted>{dash(u.service_no)}</Td><Td>{u.role}</Td>
              <Td mono muted>{u.scope_type}{u.scope_id ? ` · ${u.scope_id}` : ""}</Td>
              <Td><Status value={u.locked ? "locked" : u.status} label={u.locked ? "locked" : u.must_change_password ? `${u.status} · temp pw` : u.status} /></Td>
              <Td mono right>{u.active_sessions}</Td>
              <Td mono muted>{u.last_login_at ? `${dt(u.last_login_at)} · ${dash(u.last_login_ip)}` : "never"}</Td>
            </Tr>
          ))}
        </Table>
      </div>
      {sel !== null && (
        <div className="w-[400px] shrink-0 border-l border-line bg-surface overflow-auto p-4">
          <UserEditor key={String(sel)} d={d} user={user} onDone={() => { reload(); }} onClose={() => setSel(null)} />
        </div>
      )}
    </div>
  );
}

function UserEditor({ d, user, onDone, onClose }: { d: UsersData; user?: User; onDone: () => void; onClose: () => void }) {
  const [f, setF] = useState({
    username: "", display_name: user?.display_name ?? "", service_no: user?.service_no ?? "", role: user?.role ?? "operator",
    scope_type: user?.scope_type ?? "battalion", scope_id: user?.scope_id ?? "", status: user?.status ?? "active", password: "",
  });
  const act = useAction();
  const [msg, setMsg] = useState<string | null>(null);
  const roles: [string, string][] = d.roles.map((r) => [r.name, r.label]);
  const save = () => act.run(async () => {
    if (user) {
      const body: Record<string, unknown> = {};
      if (f.display_name !== user.display_name) body.display_name = f.display_name;
      if (f.service_no !== user.service_no) body.service_no = f.service_no;
      if (f.role !== user.role) body.role = f.role;
      if (f.scope_type !== user.scope_type || (f.scope_id || null) !== user.scope_id) {
        body.scope_type = f.scope_type;
        body.scope_id = f.scope_id || null;
      }
      if (f.status !== user.status) body.status = f.status;
      await adminCall("PATCH", `users/${user.id}`, body);
      setMsg("Saved. The user's sessions were ended if role, scope or status changed.");
    } else {
      await adminCall("POST", "users", { ...f, scope_id: f.scope_type === "battalion" ? null : f.scope_id });
      setMsg(`User ${f.username} created with a temporary password (must change at first sign-in).`);
    }
    onDone();
  });
  return (
    <div className="flex flex-col gap-3" data-testid="user-editor">
      <div className="flex items-center">
        <span className="text-caption text-ink-2">{user ? `Edit ${user.username}` : "New user"}</span>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={onClose}>Close</Button>
      </div>
      {!user && <FormRow label="Username"><Input value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} className="w-48" data-testid="new-username" /></FormRow>}
      <FormRow label="Display name"><Input value={f.display_name} onChange={(e) => setF({ ...f, display_name: e.target.value })} className="w-48" /></FormRow>
      <FormRow label="Service no."><Input value={f.service_no} onChange={(e) => setF({ ...f, service_no: e.target.value })} className="w-48" /></FormRow>
      <FormRow label="Role"><Select value={f.role} onChange={(v) => setF({ ...f, role: v })} options={roles} className="w-48" testid="user-role" /></FormRow>
      <FormRow label="Scope">
        <Select value={f.scope_type} onChange={(v) => setF({ ...f, scope_type: v, scope_id: "" })} testid="user-scope"
          options={[["battalion", "Battalion (all)"], ["company", "Company"], ["post", "Post"]]} className="w-28" />
        {f.scope_type !== "battalion" && (
          <Select value={f.scope_id} onChange={(v) => setF({ ...f, scope_id: v })} className="w-44" testid="user-scope-id"
            options={[["", "select…"], ...scopeOptions(d, f.scope_type)]} />
        )}
      </FormRow>
      {user && <FormRow label="Status"><Select value={f.status} onChange={(v) => setF({ ...f, status: v })} options={[["active", "active"], ["disabled", "disabled"]]} className="w-48" /></FormRow>}
      {!user && <FormRow label="Temporary password"><Input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} className="w-48" data-testid="new-password" /></FormRow>}
      <div className="flex gap-1.5">
        <PermButton perm="users.manage" size="sm" variant="primary" disabled={act.busy} onClick={() => void save()}>{user ? "Save changes" : "Create user"}</PermButton>
      </div>
      {act.error && <Notice tone="red">{act.error}</Notice>}
      {msg && <Notice>{msg}</Notice>}
      {user && <UserAdminActions user={user} onDone={onDone} />}
      {user && (
        <KV rows={[["created", dt(user.created_at)], ["last sign-in", user.last_login_at ? dt(user.last_login_at) : "never"],
          ["from", dash(user.last_login_ip)], ["password", user.must_change_password ? "temporary (must change)" : "set by user"],
          ["permissions", d.roles.find((r) => r.name === user.role)?.permissions.join(", ") ?? "—"]]} />
      )}
    </div>
  );
}

function UserAdminActions({ user, onDone }: { user: User; onDone: () => void }) {
  const [pw, setPw] = useState("");
  const act = useAction();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <Section title="Account actions">
      <FormRow label="Reset password">
        <Input type="password" placeholder="temporary password" value={pw} onChange={(e) => setPw(e.target.value)} className="w-40" />
        <PermButton perm="users.manage" size="sm" disabled={!pw || act.busy}
          onClick={() => void act.run(async () => { await adminCall("POST", `users/${user.id}/password`, { password: pw }); setPw(""); setMsg("Password reset; sessions ended; change required at next sign-in."); onDone(); })}>
          Reset
        </PermButton>
      </FormRow>
      {user.locked && (
        <PermButton perm="users.manage" size="sm" onClick={() => void act.run(async () => { await adminCall("PATCH", `users/${user.id}`, { unlock: true }); setMsg("Account unlocked."); onDone(); })}>
          Unlock account
        </PermButton>
      )}
      {act.error && <Notice tone="red">{act.error}</Notice>}
      {msg && <Notice>{msg}</Notice>}
    </Section>
  );
}

function RoleMatrix({ d }: { d: UsersData }) {
  const perms = Object.keys(d.permissions);
  const [edit, setEdit] = useState<{ name: string; label: string; permissions: string[] } | null>(null);
  const act = useAction();
  return (
    <div className="p-3 flex flex-col gap-3">
      <Section title="Access control matrix" flush aside={<PermButton perm="roles.manage" size="sm" onClick={() => setEdit({ name: "", label: "", permissions: ["admin.view"] })}>New custom role</PermButton>}>
        <Table head={["Permission", ...d.roles.map((r) => `${r.label}${r.builtin ? "" : " *"} (${r.users})`)]} testid="rbac-matrix">
          {perms.map((p) => (
            <Tr key={p}>
              <Td mono title={d.permissions[p]}>{p}<span className="text-ink-3 font-sans"> · {d.permissions[p]}</span></Td>
              {d.roles.map((r) => (
                <Td key={r.name} mono className={r.permissions.includes(p) ? "text-ok-ink" : "text-ink-3"}>{r.permissions.includes(p) ? "✓" : "·"}</Td>
              ))}
            </Tr>
          ))}
        </Table>
      </Section>
      <Section title="Custom roles">
        {d.roles.filter((r) => !r.builtin).length === 0 ? <span className="text-ui text-ink-3">None. Built-in roles cannot be modified.</span> :
          d.roles.filter((r) => !r.builtin).map((r) => (
            <div key={r.name} className="flex items-center gap-2 py-1">
              <span className="text-ui">{r.label}</span><span className="text-data font-data text-ink-3">{r.name} · {r.users} users</span>
              <PermButton perm="roles.manage" size="sm" className="ml-auto" onClick={() => setEdit({ name: r.name, label: r.label, permissions: r.permissions })}>Edit</PermButton>
              <PermButton perm="roles.manage" size="sm" variant="danger" disabled={r.users > 0} onClick={() => void act.run(() => adminCall("DELETE", `roles/${r.name}`))}>Delete</PermButton>
            </div>
          ))}
      </Section>
      {edit && (
        <Section title={edit.name ? `Role ${edit.name}` : "New role"}>
          <FormRow label="Name (id)"><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} className="w-48" /></FormRow>
          <FormRow label="Label"><Input value={edit.label} onChange={(e) => setEdit({ ...edit, label: e.target.value })} className="w-48" /></FormRow>
          <div className="grid grid-cols-2 gap-x-4 py-1">
            {perms.map((p) => (
              <label key={p} className="flex items-center gap-2 py-0.5 text-ui">
                <input type="checkbox" className="ds-check" checked={edit.permissions.includes(p)}
                  onChange={() => setEdit({ ...edit, permissions: edit.permissions.includes(p) ? edit.permissions.filter((x) => x !== p) : [...edit.permissions, p] })} />
                <span className="font-data text-data">{p}</span>
              </label>
            ))}
          </div>
          <div className="flex gap-1.5">
            <PermButton perm="roles.manage" size="sm" variant="primary" disabled={!edit.name || act.busy}
              onClick={() => void act.run(async () => { await adminCall("PUT", `roles/${edit.name}`, edit); setEdit(null); })}>Save role</PermButton>
            <Button size="sm" variant="ghost" onClick={() => setEdit(null)}>Cancel</Button>
          </div>
        </Section>
      )}
      {act.error && <Notice tone="red">{act.error}</Notice>}
    </div>
  );
}

function SessionTable({ s }: { s?: { sessions: Sess[]; current: string; now: number } }) {
  const act = useAction();
  // Backend only lists other users' sessions to holders of sessions.manage
  const now = s?.now ?? 0;
  if (!s) return <Loading />;
  return (
    <div className="p-3 flex flex-col gap-2">
      {act.error && <Notice tone="red">{act.error}</Notice>}
      <Table head={["Session", "User", "Role", "Signed in", "Last activity", "Expires", "Address", "Client", ""]} testid="sessions-table">
        {s.sessions.map((x) => (
          <Tr key={x.id}>
            <Td mono>{x.id}{x.id === s.current ? <span className="text-accent-ink"> (this)</span> : null}</Td>
            <Td>{x.display_name} <span className="text-ink-3 font-data text-data">{x.username}</span></Td>
            <Td muted>{x.role}</Td><Td mono muted>{dt(x.created_at)}</Td><Td mono>{ago(now - x.last_seen)} ago</Td>
            <Td mono muted>{dt(x.expires_at)}</Td><Td mono muted>{dash(x.ip)}</Td>
            <Td muted className="max-w-[220px] truncate" title={x.user_agent}>{dash(x.user_agent)}</Td>
            <Td>{x.id !== s.current && (
              <Button size="sm" variant="danger" disabled={act.busy} onClick={() => void act.run(() => adminCall("DELETE", `sessions/${x.id}`))}>Revoke</Button>
            )}</Td>
          </Tr>
        ))}
      </Table>
    </div>
  );
}
