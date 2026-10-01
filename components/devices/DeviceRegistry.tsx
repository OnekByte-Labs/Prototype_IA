"use client";

import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import {
  Button,
  Icon,
  Input,
  PageHeader,
  Select,
  Stat,
  StatusIndicator,
  Table,
  Tabs,
  Td,
  Th,
  Tr,
} from "@/components/ds";
import { cx } from "@/lib/design/cx";
import { useConsole } from "@/components/gotham/ConsoleProvider";
import { fetchJson, useTacticalMap } from "@/lib/gis/use-tactical-map";
import type { DeviceHealth, MapHealth, RecordingState } from "@/lib/gis/types";

/*
 * Device registry: every camera and NVR in the command-center database, with
 * live health from the pipeline (GET /api/v1/map/health — frame heartbeat,
 * pipeline state) re-checked every few seconds and immediately on every
 * `map_status` WebSocket push.
 */

const HEALTH_KEY = "/api/v1/map/health";

type Health = DeviceHealth | "UNKNOWN";

const HEALTH_TONE: Record<Health, string> = { ONLINE: "ok", DEGRADED: "warn", OFFLINE: "crit", UNKNOWN: "idle" };
const HEALTH_RANK: Record<Health, number> = { OFFLINE: 0, DEGRADED: 1, UNKNOWN: 2, ONLINE: 3 };
const REC_TEXT: Record<RecordingState, string> = {
  EVENTS: "Events",
  OFF: "Off",
  STOPPED: "Stopped",
  "N/A": "—",
};

const MODE_TEXT: Record<string, string> = {
  none: "None",
  intrusion: "Intrusion",
  anpr: "ANPR",
  vehicle_counting: "Vehicle count",
  person_counting: "Person count",
  anomaly: "Anomaly",
};

/* ------------------------------------------------------------------ helpers */

const pad = (n: number) => String(n).padStart(2, "0");
function clock(epoch?: number | null) {
  if (!epoch) return "—";
  const d = new Date(epoch * 1000);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function ago(seconds: number | null | undefined) {
  if (seconds == null) return "never";
  if (seconds < 1) return "<1s ago";
  if (seconds < 90) return `${Math.round(seconds)}s ago`;
  if (seconds < 5400) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3600)}h ago`;
}
function bytes(n?: number | null) {
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
const camNum = (id: string) => Number(id.replace(/\D/g, "")) || 0;

/* ------------------------------------------------------------------- pieces */

/** Health at a glance: dot + word. Healthy rows stay quiet; degraded and offline speak up. */
function HealthCell({ health }: { health: Health }) {
  const text = health === "UNKNOWN" ? "No data" : health === "ONLINE" ? "Online" : health === "DEGRADED" ? "Degraded" : "Offline";
  return (
    <StatusIndicator tone={HEALTH_TONE[health]} dim={health === "ONLINE" || health === "UNKNOWN"} className={health === "OFFLINE" || health === "DEGRADED" ? "font-medium" : ""}>
      {text}
    </StatusIndicator>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="px-4 pt-2.5 text-ui font-semibold text-ink">{title}</div>
      <div className="grid grid-cols-3">{children}</div>
    </div>
  );
}

type Col<K extends string> = { key: K; label: string; w?: number; align?: "right" };

function SortHead<K extends string>({
  cols,
  sort,
  onSort,
}: {
  cols: Col<K>[];
  sort: { key: K; dir: 1 | -1 };
  onSort: (k: K) => void;
}) {
  return (
    <thead>
      <tr>
        <Th width={6} className="p-0" />
        {cols.map((c) => (
          <Th
            key={c.key}
            width={c.w}
            align={c.align}
            sortKey={c.key}
            activeSortKey={sort.key}
            sortDir={sort.dir === 1 ? "asc" : "desc"}
            onSort={() => onSort(c.key)}
          >
            {c.label}
          </Th>
        ))}
      </tr>
    </thead>
  );
}

function useSort<K extends string>(initial: K, dir: 1 | -1 = 1) {
  const [sort, setSort] = useState<{ key: K; dir: 1 | -1 }>({ key: initial, dir });
  const onSort = (key: K) => setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }));
  return { sort, onSort };
}

/* ------------------------------------------------------------------- console */

type CamRow = {
  id: string;
  name: string;
  companyId: string | null;
  company: string;
  postId: string | null;
  post: string;
  lat: number | null;
  lon: number | null;
  health: Health;
  issue: string | null;
  recording: RecordingState;
  mode: string;
  heartbeatAge: number | null;
  sourceBound: boolean;
  fps: number | null;
};

type CamKey = "id" | "name" | "company" | "post" | "location" | "health" | "recording" | "mode" | "heartbeat" | "issue";
const CAM_COLS: Col<CamKey>[] = [
  { key: "id", label: "Camera ID", w: 84 },
  { key: "name", label: "Camera name" },
  { key: "company", label: "Company", w: 112 },
  { key: "post", label: "Post", w: 84 },
  { key: "location", label: "Location", w: 150 },
  { key: "health", label: "Status", w: 92 },
  { key: "recording", label: "Recording", w: 84 },
  { key: "mode", label: "Detection mode", w: 112 },
  { key: "heartbeat", label: "Last health check", w: 128 },
  { key: "issue", label: "Issue / fault", w: 220 },
];

type NvrKey = "id" | "name" | "company" | "channels" | "health" | "recording" | "total" | "used" | "free" | "checked" | "fault";
const NVR_COLS: Col<NvrKey>[] = [
  { key: "id", label: "NVR ID", w: 76 },
  { key: "name", label: "Name", w: 92 },
  { key: "company", label: "Company / location" },
  { key: "channels", label: "Channels", w: 120, align: "right" },
  { key: "health", label: "Status", w: 92 },
  { key: "recording", label: "Recording", w: 104 },
  { key: "total", label: "Storage total", w: 96, align: "right" },
  { key: "used", label: "Used", w: 64, align: "right" },
  { key: "free", label: "Available", w: 76, align: "right" },
  { key: "checked", label: "Last health check", w: 120 },
  { key: "fault", label: "Fault", w: 260 },
];

/** `initialNvr` opens the NVR tab on that recorder; `initialQuery` pre-fills the search (Argus Agent links). */
export function DeviceRegistry({ initialNvr, initialQuery }: { initialNvr?: string; initialQuery?: string } = {}) {
  const router = useRouter();
  const { mapLive, wsConnected } = useConsole();
  const { config, error: mapError, isLoading: mapLoading } = useTacticalMap();
  const { data: health, error: healthError, mutate: refreshHealth } = useSWR<MapHealth>(
    HEALTH_KEY,
    (u: string) => fetchJson<MapHealth>(u),
    { refreshInterval: 3000, revalidateOnFocus: false },
  );
  // Re-check health as soon as the backend pushes a status change
  const statuses = mapLive?.statuses;
  useEffect(() => {
    if (statuses) void refreshHealth();
  }, [statuses, refreshHealth]);

  const [tab, setTab] = useState<"cameras" | "nvrs">(initialNvr ? "nvrs" : "cameras");
  const [q, setQ] = useState(initialQuery ?? "");
  const [company, setCompany] = useState("all");
  const [post, setPost] = useState("all");
  const [placement, setPlacement] = useState("all");
  const [status, setStatus] = useState("all");
  const [openNvr, setOpenNvr] = useState<string | null>(initialNvr ?? null);
  const camSort = useSort<CamKey>("id");
  const nvrSort = useSort<NvrKey>("id");

  const checkedAt = health?.checked_at ?? null;

  /* ---------------------------------------------------------- derived rows */
  const idx = useMemo(() => {
    const companies = new Map((config?.companies ?? []).map((c) => [c.id, c]));
    const posts = new Map((config?.posts ?? []).map((p) => [p.id, p]));
    return { companies, posts };
  }, [config]);

  const cams: CamRow[] = useMemo(() => {
    if (!config) return [];
    return config.cameras.map((c) => {
      const h = health?.cameras[c.id];
      const p = c.parent_id ? idx.posts.get(c.parent_id) : undefined;
      const co = p?.parent_id ? idx.companies.get(p.parent_id) : undefined;
      return {
        id: c.id,
        name: c.name,
        companyId: co?.id ?? null,
        company: co?.name ?? "Unassigned",
        postId: p?.id ?? null,
        post: p?.name ?? "Unassigned",
        lat: c.latitude,
        lon: c.longitude,
        health: (h?.health as Health) ?? "UNKNOWN",
        issue: h?.issue ?? (h ? null : "No health data"),
        recording: h?.recording ?? "N/A",
        mode: h?.detection_mode ?? c.detection_mode,
        heartbeatAge: h?.last_frame_at != null && checkedAt ? Math.max(0, checkedAt - h.last_frame_at) : null,
        sourceBound: h?.source_bound ?? c.source_bound,
        fps: h?.fps ?? null,
      };
    });
  }, [config, health, idx, checkedAt]);

  const nvrs = useMemo(() => {
    if (!config) return [];
    return config.nvrs.map((n) => {
      const h = health?.nvrs[n.id];
      const co = idx.companies.get(n.parent_id);
      const hl: Health = !h ? "UNKNOWN" : h.status === "ONLINE" ? "ONLINE" : h.status === "DEGRADED" ? "DEGRADED" : "OFFLINE";
      return {
        id: n.id,
        name: h?.name ?? n.name,
        companyId: n.parent_id,
        company: co?.name ?? n.parent_id,
        lat: n.latitude,
        lon: n.longitude,
        health: hl,
        assigned: h?.assigned ?? 0,
        bound: h?.bound ?? 0,
        streaming: h?.streaming ?? 0,
        capturing: h?.capturing ?? 0,
        affected: h?.affected ?? [],
        members: h?.cameras ?? [],
        fault: h?.issue ?? (h ? null : "No health data"),
      };
    });
  }, [config, health, idx]);

  /* --------------------------------------------------------------- summary */
  const camCount = (hl: Health) => cams.filter((c) => c.health === hl).length;
  const offline = camCount("OFFLINE");
  const offlineUnbound = cams.filter((c) => c.health === "OFFLINE" && !c.sourceBound).length;
  const degraded = camCount("DEGRADED");
  const online = camCount("ONLINE");
  const capturing = cams.filter((c) => c.recording === "EVENTS").length;
  const liveHeartbeats = cams.filter((c) => c.heartbeatAge != null).map((c) => c.heartbeatAge as number);
  const freshest = liveHeartbeats.length ? Math.min(...liveHeartbeats) : null;
  const nvrHealthy = nvrs.filter((n) => n.health === "ONLINE").length;
  const nvrFaulty = nvrs.filter((n) => n.health === "OFFLINE" || n.health === "DEGRADED");
  const storage = health?.storage ?? null;
  const usedPct = storage ? (storage.used_bytes / storage.total_bytes) * 100 : null;
  // Faults on cameras that do have a video source: the actionable ones
  const faults = cams.filter((c) => c.sourceBound && (c.health === "OFFLINE" || c.health === "DEGRADED"));

  /* --------------------------------------------------------------- filters */
  const postOptions = useMemo(
    () =>
      (config?.posts ?? [])
        .filter((p) => company === "all" || p.parent_id === company)
        .sort((a, b) => (a.parent_id ?? "").localeCompare(b.parent_id ?? "") || a.name.localeCompare(b.name)),
    [config, company],
  );
  const matchStatus = (hl: Health) =>
    status === "all" ||
    (status === "unhealthy" ? hl === "OFFLINE" || hl === "DEGRADED" : hl === status);
  const needle = q.trim().toLowerCase();

  const camRows = useMemo(() => {
    const rows = cams.filter((c) => {
      if (company !== "all" && c.companyId !== company) return false;
      if (post !== "all" && c.postId !== post) return false;
      if (placement === "placed" && c.lat == null) return false;
      if (placement === "unplaced" && c.lat != null) return false;
      if (placement === "source" && !c.sourceBound) return false;
      if (placement === "nosource" && c.sourceBound) return false;
      if (!matchStatus(c.health)) return false;
      if (needle) {
        const hay = `${c.id} ${c.name} ${c.company} ${c.post} ${c.lat ?? ""} ${c.lon ?? ""} ${c.issue ?? ""} ${c.mode}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    const { key, dir } = camSort.sort;
    const val = (c: CamRow): string | number => {
      switch (key) {
        case "id": return camNum(c.id);
        case "health": return HEALTH_RANK[c.health];
        case "heartbeat": return c.heartbeatAge ?? Number.MAX_SAFE_INTEGER;
        case "location": return c.lat ?? 999;
        case "issue": return c.issue ?? "";
        default: return String(c[key] ?? "");
      }
    };
    return rows.sort((a, b) => {
      const av = val(a), bv = val(b);
      const r = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
      return (r || camNum(a.id) - camNum(b.id)) * dir;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cams, company, post, placement, status, needle, camSort.sort]);

  const nvrRows = useMemo(() => {
    const rows = nvrs.filter((n) => {
      if (company !== "all" && n.companyId !== company) return false;
      if (!matchStatus(n.health)) return false;
      if (needle && !`${n.id} ${n.name} ${n.company} ${n.fault ?? ""} ${n.affected.join(" ")}`.toLowerCase().includes(needle))
        return false;
      return true;
    });
    const { key, dir } = nvrSort.sort;
    const val = (n: (typeof nvrs)[number]): string | number => {
      switch (key) {
        case "health": return HEALTH_RANK[n.health];
        case "channels": return n.assigned;
        case "recording": return n.capturing;
        case "fault": return n.fault ?? "";
        case "company": return n.company;
        case "name": return n.name;
        default: return n.id;
      }
    };
    return rows.sort((a, b) => {
      const av = val(a), bv = val(b);
      const r = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
      return (r || a.id.localeCompare(b.id)) * dir;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nvrs, company, status, needle, nvrSort.sort]);

  const dirty = q !== "" || company !== "all" || post !== "all" || placement !== "all" || status !== "all";
  const clear = () => {
    setQ("");
    setCompany("all");
    setPost("all");
    setPlacement("all");
    setStatus("all");
  };

  const openCamera = (c: CamRow) =>
    router.push(
      c.sourceBound ? `/cameras?inspect=${encodeURIComponent(c.id)}` : `/map?camera=${encodeURIComponent(c.id)}`,
    );

  const cameraById = useMemo(() => new Map(cams.map((c) => [c.id, c])), [cams]);

  /* ---------------------------------------------------------------- render */
  if (mapError && !config) {
    return (
      <div className="flex-1 flex items-center justify-center text-ui text-ink-2">
        <Icon name="error" size={18} className="text-crit-ink mr-2" />
        Device registry unavailable — {mapError.message}
      </div>
    );
  }

  const faultTone = (h: Health) => (h === "OFFLINE" ? "bg-crit" : h === "DEGRADED" ? "bg-warn" : "");
  const faultText = (h: Health) => (h === "OFFLINE" ? "text-crit-ink" : h === "DEGRADED" ? "text-warn-ink" : "text-ink-3");

  return (
    <div className="flex-1 min-h-0 flex flex-col" data-testid="device-registry">
      <PageHeader
        title="Device registry"
        description="Every camera and NVR in the command-centre database, with live pipeline health"
        meta={
          <StatusIndicator tone={healthError ? "warn" : wsConnected ? "ok" : "idle"} dim>
            {healthError ? "Health check failing" : `Checked ${clock(checkedAt)}`} · {wsConnected ? "live" : "polling"}
          </StatusIndicator>
        }
      />

      <div className="flex-1 min-h-0 flex flex-col gap-3 px-5 pb-4">
        {/* ── summary ─────────────────────────────────────────────── */}
        <div className="shrink-0 bg-surface border border-line rounded-lg shadow-card grid grid-cols-3 divide-x divide-line">
          <Group title="Cameras">
            <Stat label="Registered" value={config ? cams.length : "—"} note={`${cams.filter((c) => c.sourceBound).length} with video source`} />
            <Stat
              label="Offline"
              value={config ? offline : "—"}
              tone={offline ? "crit" : "default"}
              note={offlineUnbound ? `${offlineUnbound} no video source` : undefined}
            />
            <Stat label="Degraded / fault" value={config ? degraded : "—"} tone={degraded ? "warn" : "default"} />
          </Group>
          <Group title="NVRs">
            <Stat label="Registered" value={config ? nvrs.length : "—"} />
            <Stat label="Healthy" value={health ? nvrHealthy : "—"} tone={health ? "ok" : "default"} />
            <Stat
              label="Fault / offline"
              value={health ? nvrFaulty.length : "—"}
              tone={nvrFaulty.length ? "crit" : "default"}
              note={nvrFaulty.length ? nvrFaulty.map((n) => n.id).join(" ") : undefined}
            />
          </Group>
          <Group title="Storage · host recording volume">
            <Stat label="Total" value={bytes(storage?.total_bytes)} />
            <Stat
              label="Used"
              value={bytes(storage?.used_bytes)}
              note={usedPct != null ? `${usedPct.toFixed(1)}%` : undefined}
              tone={usedPct != null && usedPct > 90 ? "crit" : usedPct != null && usedPct > 80 ? "warn" : "default"}
            />
            <Stat
              label="Available"
              value={bytes(storage?.free_bytes)}
              note={storage ? `system data ${bytes(storage.system_bytes.evidence + storage.system_bytes.event_log + storage.system_bytes.database)}` : undefined}
            />
          </Group>
        </div>

        {/* ── devices ─────────────────────────────────────────────── */}
        <section className="flex-1 min-h-0 bg-surface border border-line rounded-lg flex flex-col overflow-hidden">
          {/* health lines */}
          <div className="shrink-0 px-4 py-2 border-b border-line flex flex-col gap-1 text-ui">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-0.5" data-testid="camera-health-line">
              <span className="w-28 shrink-0 font-medium text-ink whitespace-nowrap">Camera health</span>
              <StatusIndicator tone="ok" dim>{online} online</StatusIndicator>
              <StatusIndicator tone={degraded ? "warn" : "idle"} dim={!degraded}>{degraded} degraded</StatusIndicator>
              <StatusIndicator tone={offline ? "crit" : "idle"} dim={!offline}>{offline} offline</StatusIndicator>
              <span className="text-ink-2">Recording events {capturing}/{cams.length}</span>
              <span className="text-ink-2">Last heartbeat {freshest != null ? ago(freshest) : "none"}</span>
              {faults.length > 0 && (
                <span className="min-w-0 truncate text-crit-ink" title={faults.map((f) => `${f.id}: ${f.issue}`).join("\n")}>
                  Faults: {faults.map((f) => `${f.id} (${f.issue})`).join(" · ")}
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-0.5" data-testid="nvr-health-line">
              <span className="w-28 shrink-0 font-medium text-ink whitespace-nowrap">NVR health</span>
              <StatusIndicator tone="ok" dim>{nvrHealthy} healthy</StatusIndicator>
              <StatusIndicator tone={nvrFaulty.length ? "crit" : "idle"} dim={!nvrFaulty.length}>
                {nvrFaulty.length} fault / offline
              </StatusIndicator>
              <span className="text-ink-2">
                Recording {nvrs.reduce((s, n) => s + n.capturing, 0)} of {nvrs.reduce((s, n) => s + n.bound, 0)} streams
              </span>
              <span className="text-ink-2">Storage {usedPct != null ? `${usedPct.toFixed(0)}% used` : "—"}</span>
              {nvrFaulty.length > 0 && (
                <span className="min-w-0 truncate text-crit-ink">
                  Affected: {nvrFaulty.map((n) => `${n.id} ${n.company} (${n.fault})`).join(" · ")}
                </span>
              )}
            </div>
          </div>

          {/* tabs + filters */}
          <div className="shrink-0 px-4 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line">
            <Tabs
              label="Device type"
              value={tab}
              onChange={setTab}
              className="border-b-0 mr-2"
              items={[
                { id: "cameras", label: "Cameras", count: cams.length },
                { id: "nvrs", label: "NVRs", count: nvrs.length },
              ]}
            />
            <div className="relative">
              <Icon name="search" size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={tab === "cameras" ? "Search ID, name, post, fault…" : "Search NVR, company, fault…"}
                aria-label="Search devices"
                data-testid="device-search"
                className="w-60 pl-8"
              />
            </div>
            <Select aria-label="Company" data-testid="filter-company" value={company} onChange={(e) => { setCompany(e.target.value); setPost("all"); }} className="max-w-[190px]">
              <option value="all">All companies</option>
              {(config?.companies ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
            {tab === "cameras" && (
              <>
                <Select aria-label="Post" data-testid="filter-post" value={post} onChange={(e) => setPost(e.target.value)} className="max-w-[190px]">
                  <option value="all">All posts</option>
                  {postOptions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {company === "all" ? `${idx.companies.get(p.parent_id ?? "")?.name ?? ""} · ` : ""}{p.name}
                    </option>
                  ))}
                </Select>
                <Select aria-label="Location" data-testid="filter-location" value={placement} onChange={(e) => setPlacement(e.target.value)} className="max-w-[190px]">
                  <option value="all">All locations</option>
                  <option value="placed">Placed on map</option>
                  <option value="unplaced">Not placed</option>
                  <option value="source">Video source bound</option>
                  <option value="nosource">No video source</option>
                </Select>
              </>
            )}
            <Select aria-label="Status" data-testid="filter-status" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="all">All statuses</option>
              <option value="unhealthy">Unhealthy</option>
              <option value="ONLINE">Online</option>
              <option value="DEGRADED">Degraded</option>
              <option value="OFFLINE">Offline</option>
            </Select>
            {dirty && (
              <Button variant="ghost" size="sm" onClick={clear}>
                Clear
              </Button>
            )}
            <span className="ml-auto text-ui text-ink-2 tnum" data-testid="device-count">
              {tab === "cameras" ? `${camRows.length} of ${cams.length}` : `${nvrRows.length} of ${nvrs.length}`}
            </span>
          </div>

          {/* tables */}
          <div className="flex-1 min-h-0 overflow-auto">
            {!config ? (
              <div className="p-8 text-center text-ui text-ink-2">{mapLoading ? "Loading device registry…" : "No registry data."}</div>
            ) : tab === "cameras" ? (
              <Table data-testid="camera-table">
                <SortHead cols={CAM_COLS} sort={camSort.sort} onSort={camSort.onSort} />
                <tbody>
                  {camRows.length === 0 ? (
                    <tr><td colSpan={CAM_COLS.length + 1} className="p-8 text-center text-ui text-ink-2">No cameras match the current filters.</td></tr>
                  ) : (
                    camRows.map((c) => {
                      const fault = c.sourceBound && (c.health === "OFFLINE" || c.health === "DEGRADED");
                      return (
                        <Tr
                          key={c.id}
                          data-testid="camera-row"
                          data-health={c.health}
                          onClick={() => openCamera(c)}
                          title={c.sourceBound ? `Open ${c.id} in the camera console` : `${c.id} has no video source — open on the tactical map`}
                          className={fault && c.health === "OFFLINE" ? "bg-crit-wash/30" : undefined}
                        >
                          <td className={cx("p-0 w-1.5 border-b border-line", fault && faultTone(c.health))} />
                          <Td mono className="text-ink">{c.id}</Td>
                          <Td className="max-w-0 truncate text-ink" title={c.name}>{c.name}</Td>
                          <Td className="text-ink-2 truncate">{c.company}</Td>
                          <Td className="text-ink-2 truncate">{c.post}</Td>
                          <Td mono className="text-ink-3 whitespace-nowrap">
                            {c.lat != null && c.lon != null ? `${c.lat.toFixed(4)}, ${c.lon.toFixed(4)}` : "Not placed"}
                          </Td>
                          <Td><HealthCell health={c.health} /></Td>
                          <Td className={c.recording === "EVENTS" ? "text-ink" : c.recording === "STOPPED" ? "text-warn-ink" : "text-ink-3"}>
                            {REC_TEXT[c.recording]}
                          </Td>
                          <Td className="text-ink-2">{MODE_TEXT[c.mode] ?? c.mode}</Td>
                          <Td mono className="text-ink-2 whitespace-nowrap">
                            {c.heartbeatAge != null ? ago(c.heartbeatAge) : "never"}
                            {c.fps ? <span className="text-ink-3"> · {c.fps} fps</span> : null}
                          </Td>
                          <Td className={cx("max-w-0 truncate", fault ? faultText(c.health) : "text-ink-3")} title={c.issue ?? ""}>
                            {c.issue ?? "—"}
                          </Td>
                        </Tr>
                      );
                    })
                  )}
                </tbody>
              </Table>
            ) : (
              <Table data-testid="nvr-table">
                <SortHead cols={NVR_COLS} sort={nvrSort.sort} onSort={nvrSort.onSort} />
                <tbody>
                  {nvrRows.map((n) => {
                    const open = openNvr === n.id;
                    const fault = n.health === "OFFLINE" || n.health === "DEGRADED";
                    return (
                      <Fragment key={n.id}>
                        <Tr
                          data-testid="nvr-row"
                          data-health={n.health}
                          aria-expanded={open}
                          selected={open}
                          onClick={() => setOpenNvr(open ? null : n.id)}
                          className={fault && n.health === "OFFLINE" && !open ? "bg-crit-wash/30" : undefined}
                        >
                          <td className={cx("p-0 w-1.5 border-b border-line", fault && faultTone(n.health))} />
                          <Td mono className="text-ink">{n.id}</Td>
                          <Td className="text-ink">{n.name}</Td>
                          <Td className="max-w-0 truncate text-ink-2">
                            {n.company}
                            <span className="text-data font-data text-ink-3"> · {n.lat.toFixed(4)}, {n.lon.toFixed(4)}</span>
                          </Td>
                          <Td align="right" mono className="text-ink-2 whitespace-nowrap" title="cameras assigned · video streams bound">
                            {n.assigned} cams · {n.bound} live
                          </Td>
                          <Td><HealthCell health={n.health} /></Td>
                          <Td className="text-ink-2 whitespace-nowrap">
                            {n.bound ? `Events ${n.capturing}/${n.bound}` : "—"}
                          </Td>
                          <Td align="right" mono className="text-ink-3" title="The NVR does not report storage telemetry">n/a</Td>
                          <Td align="right" mono className="text-ink-3">n/a</Td>
                          <Td align="right" mono className="text-ink-3">n/a</Td>
                          <Td mono className="text-ink-2">{clock(checkedAt)}</Td>
                          <Td className={cx("max-w-0 truncate", fault ? faultText(n.health) : "text-ink-3")} title={n.fault ?? ""}>
                            {n.fault ?? "—"}
                            {n.affected.length > 0 && <span className="font-data"> · {n.affected.join(" ")}</span>}
                          </Td>
                        </Tr>
                        {open && (
                          <tr data-testid="nvr-detail">
                            <td colSpan={NVR_COLS.length + 1} className="p-0 border-b border-line">
                              <div className="bg-raised relative pl-5 pr-4 py-3">
                                <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-accent" />
                                <div className="flex flex-wrap items-center gap-x-5 gap-y-1 mb-2 text-ui text-ink-2">
                                  <span className="text-ink font-semibold">{n.id} · {n.name}</span>
                                  <span>{n.company}</span>
                                  <span>Ingesting {n.streaming}/{n.bound} bound streams</span>
                                  <span>{n.assigned - n.bound} cameras without a video source</span>
                                  <span className="text-ink-3">Storage: no telemetry from this NVR</span>
                                  <span className="ml-auto flex items-center gap-1.5">
                                    <Button
                                      size="sm"
                                      onClick={(e) => { e.stopPropagation(); router.push(`/map?company=${encodeURIComponent(n.companyId)}`); }}
                                    >
                                      <Icon name="map" size={15} className="text-ink-2" />
                                      Open on tactical map
                                    </Button>
                                    <Button size="sm" variant="ghost" onClick={() => setOpenNvr(null)}>
                                      Close
                                    </Button>
                                  </span>
                                </div>
                                <table className="w-full border-collapse">
                                  <thead>
                                    <tr className="h-8 text-left">
                                      {["Channel / camera", "Name", "Post", "Status", "Recording", "Last health check", "Issue"].map((h) => (
                                        <th key={h} className="px-3 text-caption font-medium text-ink-2">{h}</th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {n.members
                                      .map((id) => cameraById.get(id))
                                      .filter((c): c is CamRow => !!c)
                                      .sort((a, b) => Number(b.sourceBound) - Number(a.sourceBound) || camNum(a.id) - camNum(b.id))
                                      .map((c) => (
                                        <tr key={c.id} onClick={() => openCamera(c)} className="h-9 border-t border-line cursor-pointer hover:bg-hover">
                                          <td className="px-3 text-data font-data text-ink">{c.id}</td>
                                          <td className="px-3 text-ui text-ink-2">{c.name}</td>
                                          <td className="px-3 text-ui text-ink-2">{c.post}</td>
                                          <td className="px-3"><HealthCell health={c.health} /></td>
                                          <td className="px-3 text-ui text-ink-2">{REC_TEXT[c.recording]}</td>
                                          <td className="px-3 text-data font-data text-ink-2">{c.heartbeatAge != null ? ago(c.heartbeatAge) : "never"}</td>
                                          <td className="px-3 text-ui text-ink-3">{c.issue ?? "—"}</td>
                                        </tr>
                                      ))}
                                  </tbody>
                                </table>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </div>

          <div className="shrink-0 px-4 py-2 flex flex-wrap items-center gap-x-5 gap-y-0.5 border-t border-line text-caption text-ink-3">
            <span>
              Offline: no frame for {health?.rules?.frame_stale_s ?? "—"}s · Degraded: frame delay &gt; {health?.rules?.frame_degraded_s ?? "—"}s or pipeline error
            </span>
            <span>Recording = detection events + alert evidence persisted (continuous video recording not deployed)</span>
          </div>
        </section>
      </div>
    </div>
  );
}
