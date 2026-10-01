"use client";

import Link from "next/link";
import useSWR from "swr";
import { useConsole, DETECTION_MODE_LABELS, type DetectionMode } from "@/components/gotham/ConsoleProvider";
import { Badge, Button, ClassTag, SeverityChip, StatusDot, buttonClass } from "@/components/ds";
import { TacticalVideoFeed } from "@/components/gotham/dashboard/TacticalVideoFeed";
import { DetectionModeSelector } from "@/components/gotham/dashboard/DetectionModeSelector";
import { TACTICAL_CAMERAS } from "@/lib/datasets/dataset-definitions";
import { hms, type Alert } from "@/lib/gotham/model";
import { cameraCounts, fmtArea, fmtDist, STATUS_TONE, type ConfigIndex } from "@/lib/gis/geo";
import { fetchJson, relationshipsKey } from "@/lib/gis/use-tactical-map";
import type {
  CameraEntity,
  CameraRelationship,
  CoverageResult,
  Drill,
  MapConfig,
  MapHealth,
  MapEntity,
  MapStatus,
  PointCoverage,
  Relation,
} from "@/lib/gis/types";

const STATUS_BADGE: Record<MapStatus, { tone: "ok" | "crit" | "warn" | "neutral"; label: string }> = {
  ONLINE: { tone: "ok", label: "Online" },
  ALERT: { tone: "crit", label: "Alert" },
  DEGRADED: { tone: "warn", label: "Degraded" },
  OFFLINE: { tone: "neutral", label: "Offline" },
};

export function StatusChip({ status }: { status: MapStatus }) {
  const b = STATUS_BADGE[status];
  return (
    <Badge tone={b.tone} className={status === "ALERT" ? "font-semibold" : undefined}>
      {b.label}
    </Badge>
  );
}

/** Titled block in the side panel. */
function Section({ label, aside, children }: { label: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="border-b border-line">
      <header className="min-h-10 px-4 pt-2 flex items-center justify-between gap-2">
        <h3 className="text-ui font-semibold text-ink">{label}</h3>
        {aside}
      </header>
      <div className="px-4 pb-4 pt-1">{children}</div>
    </section>
  );
}

function Row({ entity, sub, count, onClick }: { entity: MapEntity; sub?: string; count?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left px-3 py-2 flex items-center gap-2.5 border border-line rounded-md bg-raised shadow-key-sm hover:bg-hover active:shadow-inset-sm active:bg-canvas transition-colors"
    >
      <StatusDot tone={STATUS_TONE[entity.status]} pulse={entity.status === "ALERT"} />
      <span className="flex-1 min-w-0">
        <span className="block text-ui text-ink truncate">{entity.name}</span>
        {sub && <span className="block text-caption text-ink-3 truncate">{sub}</span>}
      </span>
      {count && <span className="text-data font-data text-ink-2">{count}</span>}
      <StatusChip status={entity.status} />
    </button>
  );
}

/* ------------------------------------------------------------- hierarchy */

export function HierarchyPanel({
  config,
  ix,
  drill,
  health,
  onCompany,
  onPost,
  onCamera,
}: {
  config: MapConfig;
  ix: ConfigIndex;
  drill: Drill;
  health?: MapHealth | null;
  onCompany: (id: string) => void;
  onPost: (id: string) => void;
  onCamera: (id: string) => void;
}) {
  const { pipelines } = useConsole();
  const modeOf = (c: CameraEntity) => DETECTION_MODE_LABELS[(pipelines[c.id]?.mode ?? c.detection_mode) as DetectionMode] ?? c.detection_mode;

  if (drill.level === "battalion") {
    const unassigned = config.cameras.filter((c) => !c.parent_id);
    const all = cameraCounts(config.cameras.filter((c) => c.parent_id));
    return (
      <>
        {config.battalion && (
          <Section label="Battalion HQ" aside={<StatusChip status={config.battalion.status} />}>
            <div className="text-ui text-ink">{config.battalion.name}</div>
            <div className="mt-1 text-caption text-ink-3 font-data">
              {config.companies.length} companies · {config.posts.length} posts · {all.total} cameras · {all.up} up · {all.feeds} with video
            </div>
            {all.feeds < all.total && (
              <div className="mt-1.5 text-caption text-ink-3">
                {all.total - all.feeds} prototype cameras have no video source bound and report offline.
              </div>
            )}
          </Section>
        )}
        <Section label="Companies">
          <div className="space-y-1">
            {config.companies.map((co) => {
              const n = cameraCounts(ix.camerasOfCompany(co.id));
              return (
                <Row key={co.id} entity={co}
                  sub={`${ix.postsOf(co.id).length} posts · ${n.total} cameras · ${n.feeds} with video${n.alerts ? ` · ${n.alerts} in alert` : ""}`}
                  count={`${n.up}/${n.total} up`} onClick={() => onCompany(co.id)} />
              );
            })}
            {config.companies.length === 0 && <div className="text-caption text-ink-3">No companies configured.</div>}
          </div>
        </Section>
        {unassigned.length > 0 && (
          <Section label={`Unassigned cameras (${unassigned.length})`}>
            <div className="flex flex-wrap gap-1">
              {unassigned.map((c) => (
                <button key={c.id} type="button" onClick={() => onCamera(c.id)}
                  className="px-2 h-6 text-caption font-data border border-line rounded-md bg-raised shadow-key-sm text-ink-2 hover:text-ink">
                  {c.id}
                </button>
              ))}
            </div>
          </Section>
        )}
      </>
    );
  }

  const company = ix.companyById.get(drill.companyId ?? "");
  if (drill.level === "company" && company) {
    const posts = ix.postsOf(company.id);
    const nvr = ix.nvrOfCompany(company.id);
    const n = cameraCounts(ix.camerasOfCompany(company.id));
    return (
      <>
        <Section label="Company" aside={<StatusChip status={company.status} />}>
          <div className="text-ui text-ink">{company.name}</div>
          <div className="mt-1 text-caption text-ink-3 font-data">
            {posts.length} posts · {n.total} cameras · {n.up} up · {n.feeds} with video
          </div>
          {nvr && (
            <div className="mt-1.5 flex items-center gap-2 text-caption font-data text-ink-2">
              <StatusDot tone={STATUS_TONE[nvr.status]} />
              {nvr.name}
              {health?.nvrs[nvr.id]
                ? ` · ingesting ${health.nvrs[nvr.id].streaming}/${health.nvrs[nvr.id].bound} live streams`
                : ` · ${nvr.status}`}
            </div>
          )}
        </Section>
        <Section label="Posts">
          <div className="space-y-1">
            {posts.map((p) => {
              const pn = cameraCounts(ix.camerasOfPost(p.id));
              return <Row key={p.id} entity={p} sub={`${pn.total} cameras · ${pn.feeds} with video`} count={`${pn.up}/${pn.total} up`} onClick={() => onPost(p.id)} />;
            })}
            {posts.length === 0 && <div className="text-caption text-ink-3">No posts in this company.</div>}
          </div>
        </Section>
      </>
    );
  }

  if (drill.level === "post") {
    const post = ix.postById.get(drill.postId);
    if (!post) return null;
    const cams = ix.camerasOfPost(post.id);
    return (
      <>
        <Section label="Post" aside={<StatusChip status={post.status} />}>
          <div className="text-ui text-ink">{post.name}</div>
          <div className="mt-1 text-caption text-ink-3 font-data">{company?.name} · {cams.length} cameras</div>
        </Section>
        <Section label="Cameras">
          <div className="space-y-1">
            {cams.map((c) => (
              <Row key={c.id} entity={{ ...c, name: `${c.id} · ${c.name}` }}
                sub={`${c.source_bound ? modeOf(c) : "No video source"} · brg ${Math.round(c.bearing)}° · FOV ${Math.round(c.fov_angle)}° · ${fmtDist(c.range)}${
                  health?.cameras[c.id]?.pipeline ? ` · ${health.cameras[c.id].fps} fps` : ""}`}
                onClick={() => onCamera(c.id)} />
            ))}
            {cams.length === 0 && <div className="text-caption text-ink-3">No cameras assigned to this post.</div>}
          </div>
        </Section>
      </>
    );
  }
  return null;
}

/* ---------------------------------------------------------------- camera */

const RELATION_LABEL: Record<Relation, string> = {
  overlap: "Overlapping FOV",
  adjacent: "Adjacent",
  same_post: "Same post",
  same_company: "Same company",
};

export function CameraPanel({
  camera,
  ix,
  revision,
  health,
  alert,
  onCamera,
  onPost,
  onCompany,
}: {
  camera: CameraEntity;
  ix: ConfigIndex;
  revision: number;
  health?: MapHealth | null;
  /** Set when the map was focused from an alert. */
  alert?: Alert | null;
  onCamera: (id: string) => void;
  onPost: (id: string) => void;
  onCompany: (id: string) => void;
}) {
  const { liveStreams, pipelines, alerts } = useConsole();
  const post = camera.parent_id ? ix.postById.get(camera.parent_id) : undefined;
  const company = ix.companyOfCamera(camera);
  const feedCam = TACTICAL_CAMERAS.find((c) => c.id === camera.id);
  const camAlerts = alerts.filter((a) => a.cameraId === camera.id).slice(0, 5);
  const { data: rels } = useSWR<CameraRelationship[]>(
    relationshipsKey(camera.id, revision),
    (u: string) => fetchJson<CameraRelationship[]>(u),
  );
  const h = health?.cameras[camera.id];
  const nearby = (rels ?? []).filter((r) => r.relation === "overlap" || r.relation === "adjacent")
    .sort((a, b) => (a.relation === b.relation ? a.distance_m - b.distance_m : a.relation === "overlap" ? -1 : 1));

  return (
    <>
      <Section label="Camera" aside={<StatusChip status={camera.status} />}>
        <div className="text-ui text-ink font-semibold">{camera.id} · {camera.name}</div>
        {/* Post → Company relationship */}
        <div className="mt-1 flex items-center gap-1 text-caption font-data text-ink-2 flex-wrap">
          {company ? <button type="button" className="hover:text-accent-ink" onClick={() => onCompany(company.id)}>{company.name}</button> : <span>—</span>}
          <span className="text-ink-3">›</span>
          {post ? <button type="button" className="hover:text-accent-ink" onClick={() => onPost(post.id)}>{post.name}</button> : <span className="text-warn-ink">Unassigned</span>}
          <span className="text-ink-3">›</span>
          <span className="text-ink">{camera.id}</span>
        </div>
        {alert && (
          <div className="mt-2 p-2 bg-crit-wash rounded-md flex items-center gap-2">
            <ClassTag cls={alert.cls} />
            <SeverityChip severity={alert.severity} />
            <span className="text-data font-data text-ink">{alert.id}</span>
            <span className="ml-auto text-data font-data text-ink-2">{hms(alert.t)}</span>
          </div>
        )}
      </Section>

      <div className="p-4 border-b border-line">
        <div className="aspect-video w-full rounded-md overflow-hidden border border-line-strong shadow-tile relative bg-video">
          {feedCam && camera.has_source ? (
            <TacticalVideoFeed
              camera={feedCam}
              liveMjpegUrl={liveStreams[camera.id]?.mjpegUrl}
              pipeline={pipelines[camera.id]}
              focused
              isBreached={camera.status === "ALERT"}
            />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-4 text-center">
              <span className="text-caption text-video-ink/70">{camera.source_bound ? "Video pipeline not running" : "No video source bound"}</span>
              {!camera.source_bound && (
                <span className="text-caption text-video-ink/50">Prototype estate camera — bind a stream in backend/configs/cameras.yaml to bring it online.</span>
              )}
            </div>
          )}
        </div>
        <div className="mt-2 flex items-center justify-between">
          <span className="text-caption text-ink-3 font-data">
            Brg {Math.round(camera.bearing)}° · FOV {Math.round(camera.fov_angle)}° · range {fmtDist(camera.range)}
            {h?.pipeline ? ` · ${h.fps} fps · ${h.frame_age_s}s` : ""}
          </span>
          <Link href={`/cameras?inspect=${encodeURIComponent(camera.id)}`}
            className={buttonClass("default", "sm")}>
            Open in cameras
          </Link>
        </div>
      </div>

      <div className="p-4 border-b border-line">
        {camera.has_source ? (
          <DetectionModeSelector cameraId={camera.id} />
        ) : (
          <div className="text-caption text-ink-3">Detection mode unavailable — no video pipeline for this camera.</div>
        )}
        {(camera.zone_geo || camera.line_geo) && (
          <div className="mt-1.5 text-caption text-ink-3">
            Map shows the camera&apos;s configured {camera.zone_geo ? "zone" : "counting line"} projected onto the ground (approximate, uncalibrated).
          </div>
        )}
      </div>

      <Section label="Related cameras">
        {nearby.length === 0 ? (
          <div className="text-caption text-ink-3">No overlapping or adjacent cameras.</div>
        ) : (
          <div className="space-y-1">
            {nearby.map((r) => {
              const other = ix.cameraById.get(r.other);
              return (
                <button key={`${r.other}-${r.relation}`} type="button" onClick={() => onCamera(r.other)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 border border-line rounded-md bg-raised shadow-key-sm hover:bg-hover text-left">
                  {other && <StatusDot tone={STATUS_TONE[other.status]} />}
                  <span className="text-data font-data text-ink">{r.other}</span>
                  <span className="text-caption text-ink-2">{RELATION_LABEL[r.relation]}</span>
                  <span className="ml-auto text-caption font-data text-ink-3">
                    {r.relation === "overlap" ? `${Math.round(r.overlap_ratio * 100)}% · ` : ""}{fmtDist(r.distance_m)}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        {rels && (
          <div className="mt-1.5 text-caption text-ink-3">
            {rels.filter((r) => r.relation === "same_post").length} on same post · {rels.filter((r) => r.relation === "same_company").length} in same company
          </div>
        )}
      </Section>

      <Section label="Recent alerts">
        {camAlerts.length === 0 ? (
          <div className="text-caption text-ink-3">No alerts from this camera this session.</div>
        ) : (
          <div className="space-y-1">
            {camAlerts.map((a) => (
              <div key={a.id} className="flex items-center gap-2 text-data font-data">
                <span className="text-ink-2">{hms(a.t)}</span>
                <ClassTag cls={a.cls} />
                <span className="text-ink-2">{a.confidence.toFixed(1)}%</span>
                <span className="ml-auto text-caption text-ink-3">{a.status}</span>
              </div>
            ))}
          </div>
        )}
      </Section>
    </>
  );
}

/* ------------------------------------------------ what could have seen this */

export function ProbePanel({
  probe,
  loading,
  error,
  ix,
  onOpen,
  onClose,
}: {
  probe: PointCoverage | null;
  loading: boolean;
  error?: string | null;
  ix: ConfigIndex;
  onOpen: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <Section label="What could have seen this?" aside={<Button size="sm" variant="ghost" onClick={onClose}>Close</Button>}>
      {!probe && !loading && !error && <div className="text-caption text-ink-3">Click a point on the map.</div>}
      {loading && <div className="text-caption text-ink-3">Querying camera coverage…</div>}
      {error && <div className="text-caption text-crit-ink">{error}</div>}
      {probe && (
        <>
          <div className="text-caption font-data text-ink-2">
            {probe.point[0].toFixed(5)}, {probe.point[1].toFixed(5)} · {probe.cameras.length} camera{probe.cameras.length === 1 ? "" : "s"}
          </div>
          <div className="mt-2 space-y-1">
            {probe.cameras.map((h) => (
              <div key={h.camera_id} className="flex items-center gap-2 px-3 py-2 border border-line rounded-md bg-canvas shadow-inset-sm">
                <StatusDot tone={STATUS_TONE[h.status]} />
                <span className="flex-1 min-w-0">
                  <span className="block text-data font-data text-ink truncate">{h.camera_id} · {h.name}</span>
                  <span className="block text-caption text-ink-3 font-data">
                    {(h.company_id && ix.companyById.get(h.company_id)?.name) ?? "—"} › {(h.post_id && ix.postById.get(h.post_id)?.name) ?? "Unassigned"} · {fmtDist(h.distance_m)} · {h.off_axis_deg}° off-axis
                  </span>
                </span>
                <Button size="sm" onClick={() => onOpen(h.camera_id)}>Open</Button>
              </div>
            ))}
            {probe.cameras.length === 0 && (
              <div className="text-caption text-warn-ink">No camera FOV covers this point — it is in a coverage gap.</div>
            )}
          </div>
        </>
      )}
    </Section>
  );
}

/* --------------------------------------------------------------- coverage */

export function CoverageSummary({
  coverage,
  loading,
  error,
  excludeOffline,
  setExcludeOffline,
  draft,
}: {
  coverage: CoverageResult | null;
  loading: boolean;
  error?: string | null;
  excludeOffline: boolean;
  setExcludeOffline: (v: boolean) => void;
  draft?: boolean;
}) {
  return (
    <Section label={draft ? "Coverage gaps (unsaved draft)" : "Coverage gaps"} aside={loading ? <span className="text-caption text-ink-3">Computing…</span> : undefined}>
      {error && <div className="text-caption text-crit-ink">{error}</div>}
      {coverage?.error && <div className="text-caption text-warn-ink">{coverage.error}</div>}
      {coverage && !coverage.error && (
        <>
          <div className="h-1.5 w-full bg-crit/35 rounded-full overflow-hidden">
            <div className="h-full bg-ok rounded-full" style={{ width: `${Math.min(100, coverage.coverage_pct)}%` }} />
          </div>
          <div className="mt-1.5 grid grid-cols-3 gap-2 text-data font-data">
            <div><div className="text-caption text-ink-2 font-sans">Covered</div><div className="text-ok-ink">{coverage.coverage_pct.toFixed(1)}%</div></div>
            <div><div className="text-caption text-ink-2 font-sans">Gap area</div><div className="text-crit-ink">{fmtArea(coverage.gap_area_m2)}</div></div>
            <div><div className="text-caption text-ink-2 font-sans">AOR</div><div className="text-ink">{fmtArea(coverage.boundary_area_m2)}</div></div>
          </div>
          <div className="mt-1 text-caption text-ink-3">
            {coverage.gaps.length} uncovered region{coverage.gaps.length === 1 ? "" : "s"} · {coverage.cameras_used} camera FOVs
          </div>
        </>
      )}
      <label className="mt-2 flex items-center gap-2 text-caption text-ink-2 cursor-pointer">
        <input type="checkbox" className="ds-check" checked={excludeOffline} onChange={(e) => setExcludeOffline(e.target.checked)} />
        Ignore offline cameras
      </label>
    </Section>
  );
}

/* ----------------------------------------------------------------- alerts */

export function AlertsPanel({ alerts, activeAlertId, onFocus }: { alerts: Alert[]; activeAlertId?: string | null; onFocus: (a: Alert) => void }) {
  const recent = alerts.slice(0, 8);
  return (
    <Section label={`Live alerts (${alerts.filter((a) => a.status === "new").length} unacknowledged)`}>
      {recent.length === 0 ? (
        <div className="text-caption text-ink-3">No alerts from the AI pipeline this session.</div>
      ) : (
        <div className="space-y-1">
          {recent.map((a) => (
            <button key={a.id} type="button" onClick={() => onFocus(a)}
              className={`w-full flex items-center gap-2 px-3 py-1.5 border rounded-md text-left hover:bg-hover ${
                a.id === activeAlertId ? "border-crit/60 bg-crit-wash" : "border-line bg-raised shadow-key-sm"
              }`}>
              <span className="text-data font-data text-ink-2">{hms(a.t)}</span>
              <span className="text-data font-data text-ink">{a.cameraId}</span>
              <ClassTag cls={a.cls} />
              {a.status === "new" && <StatusDot tone="crit" className="ml-auto" />}
            </button>
          ))}
        </div>
      )}
    </Section>
  );
}
