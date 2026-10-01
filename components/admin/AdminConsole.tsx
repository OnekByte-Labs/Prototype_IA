"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, type ReactNode } from "react";
import { SubNav, SubNavGroup, SubNavItem } from "@/components/ds";
import { useSession } from "@/lib/use-session";
import { useAdmin } from "./kit";
import { DetectionModule, ModelsModule } from "./modules/Detection";
import { DevicesModule, IntegrationsModule } from "./modules/Devices";
import { ComputeModule, NetworkModule, OverviewModule } from "./modules/Operations";
import { HierarchyModule, UsersModule } from "./modules/Organization";
import { AuditModule, BackupsModule, ConfigModule, SecurityModule, StorageModule } from "./modules/Platform";

type ModuleId = "overview" | "hierarchy" | "users" | "devices" | "detection" | "models" | "compute" | "integrations"
  | "network" | "security" | "audit" | "storage" | "backups" | "config";

const GROUPS: { title: string; items: { id: ModuleId; label: string; perm?: string }[] }[] = [
  { title: "Operations", items: [{ id: "overview", label: "Overview" }, { id: "network", label: "Network & system health" }, { id: "compute", label: "GPU / compute capacity" }] },
  { title: "Organization", items: [{ id: "hierarchy", label: "Organization & hierarchy" }, { id: "users", label: "Users & roles" }] },
  { title: "Devices", items: [{ id: "devices", label: "Device registry" }, { id: "integrations", label: "NVR & integrations" }] },
  { title: "Detection & AI", items: [{ id: "detection", label: "Detection & rules" }, { id: "models", label: "AI model management" }] },
  { title: "Governance", items: [{ id: "security", label: "Security" }, { id: "audit", label: "Audit log", perm: "audit.view" }] },
  { title: "Platform", items: [{ id: "storage", label: "Storage & retention" }, { id: "backups", label: "Backup & restore" }, { id: "config", label: "System configuration" }] },
];
const IDS = new Set(GROUPS.flatMap((g) => g.items.map((i) => i.id)));

type Ov = { issues: { area: string; severity: string }[]; cameras: { health: Record<string, number> }; config_version: number;
  users: { sessions: number } };

const AREA: Record<string, ModuleId> = { Camera: "network", Pipeline: "detection", NVR: "integrations", GPU: "compute", Compute: "compute",
  Storage: "storage", "Policy sync": "config", Security: "security", Models: "models" };

/** Persistent administration directory + contextual workspace. Module is kept in the URL (?m=…). */
export function AdminConsole() {
  const router = useRouter();
  const params = useSearchParams();
  const { session, can } = useSession();
  const m = (params.get("m") ?? "overview") as ModuleId;
  const active: ModuleId = IDS.has(m) ? m : "overview";
  const go = useCallback((id: string) => router.replace(`/admin?m=${id}`, { scroll: false }), [router]);
  const ov = useAdmin<Ov>(can("admin.view") ? "overview" : null, { refresh: 10000, topics: ["config"] });

  if (session && !can("admin.view")) {
    return (
      <div className="flex-1 flex items-center justify-center text-ui text-ink-2" data-testid="admin-forbidden">
        Your role ({session.role}) does not include administration access.
      </div>
    );
  }
  const counts: Partial<Record<ModuleId, { n: number; tone: string }>> = {};
  for (const i of ov.data?.issues ?? []) {
    const id = AREA[i.area];
    if (!id) continue;
    const c = counts[id] ?? { n: 0, tone: "text-warn-ink" };
    c.n++;
    if (i.severity === "high") c.tone = "text-crit-ink";
    counts[id] = c;
  }
  if (ov.data?.issues.length) counts.overview = { n: ov.data.issues.length, tone: ov.data.issues.some((i) => i.severity === "high") ? "text-crit-ink" : "text-warn-ink" };

  const body: Record<ModuleId, ReactNode> = {
    overview: <OverviewModule go={go} />, hierarchy: <HierarchyModule />, users: <UsersModule />, devices: <DevicesModule />,
    detection: <DetectionModule go={go} />, models: <ModelsModule />, compute: <ComputeModule />, integrations: <IntegrationsModule />,
    network: <NetworkModule />, security: <SecurityModule />, audit: <AuditModule />, storage: <StorageModule />,
    backups: <BackupsModule />, config: <ConfigModule />,
  };

  return (
    <div className="flex-1 min-h-0 flex" data-testid="admin-console">
      <div className="w-[248px] shrink-0 bg-surface border-r border-line flex flex-col" data-testid="admin-directory">
        <div className="h-14 px-5 flex items-center justify-between border-b border-line">
          <h1 className="text-headline text-ink">Administration</h1>
          {ov.data && <span className="text-caption font-data text-ink-3">cfg v{ov.data.config_version}</span>}
        </div>
        <SubNav label="Administration directory" className="flex-1">
          {GROUPS.map((g) => (
            <SubNavGroup key={g.title} title={g.title}>
              {g.items.map((it) => {
                const c = counts[it.id];
                const allowed = !it.perm || can(it.perm);
                return (
                  <div key={it.id} title={allowed ? undefined : `Requires permission ${it.perm}`} className={allowed ? "" : "opacity-45 pointer-events-none"}>
                    <SubNavItem
                      testId={`dir-${it.id}`}
                      label={it.label}
                      active={it.id === active}
                      onClick={() => allowed && go(it.id)}
                      count={c ? <span className={`font-data font-medium ${c.tone}`}>{c.n}</span> : undefined}
                    />
                  </div>
                );
              })}
            </SubNavGroup>
          ))}
        </SubNav>
        {session && (
          <div className="px-5 py-3 border-t border-line text-caption text-ink-2 flex flex-col gap-0.5">
            <div className="text-ui text-ink font-medium">{session.username} · {session.role}</div>
            <div>Scope · {session.scope_type}{session.scope_id ? ` ${session.scope_id}` : ""}</div>
            <div>{session.permissions.length} permissions</div>
          </div>
        )}
      </div>
      <main className="flex-1 min-w-0 flex flex-col" key={active}>{body[active]}</main>
    </div>
  );
}
