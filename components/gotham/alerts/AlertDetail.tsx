"use client";

import { useEffect, useState, type ReactNode } from "react";
import useSWR from "swr";
import { Button, ClassTag, Icon, SeverityChip, StatusCell } from "@/components/ds";
import { cx } from "@/lib/design/cx";
import { hms, type Alert } from "@/lib/gotham/model";

/** GET /api/v1/alerts/{id} — the stored alert as the backend knows it. */
export type AlertDetailData = {
  alert_id: string;
  /** From the persisted alert record (absent for alerts that predate it). */
  severity?: string | null;
  acknowledged_by?: string | null;
  incident_id?: string | null;
  event_id: number;
  class: string;
  event_type: string;
  event_label: string;
  anomaly_type?: string | null;
  object_class?: string | null;
  confidence: number | null;
  detection_mode: string;
  detection_mode_label: string;
  timestamp: string;
  track_id?: number | null;
  bounding_box?: number[] | null;
  foot_point?: number[] | null;
  frame_id?: number | null;
  pipeline_generation?: number | null;
  camera: {
    camera_id: string;
    name?: string | null;
    source_id?: string | null;
    width?: number | null;
    height?: number | null;
    current_mode?: string | null;
    pipeline_state?: string | null;
  };
  site: {
    post_id?: string | null;
    post_name?: string | null;
    company_id?: string | null;
    company_name?: string | null;
    battalion_id?: string | null;
    battalion_name?: string | null;
    latitude?: number | null;
    longitude?: number | null;
  };
  restricted_zone: {
    zone_id?: string | null;
    polygon?: number[][] | null;
    buffer_px?: number | null;
    is_current_config?: boolean;
  } | null;
  snapshot: { available: boolean; url: string | null; width?: number | null; height?: number | null };
};

async function fetchDetail(url: string): Promise<AlertDetailData> {
  const res = await fetch(url, { cache: "no-store" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return body as AlertDetailData;
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** 2026-09-30 03:33:31.655 (local) + 22:03:31Z */
function stamp(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { local: iso, zulu: "" };
  const local = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
  const zulu = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}Z`;
  return { local, zulu };
}

const dash = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));

/* ------------------------------------------------------------------ evidence */

function Evidence({ data, alertId }: { data: AlertDetailData | undefined; alertId: string }) {
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const url = data?.snapshot.available ? data.snapshot.url : null;
  const aspect =
    data?.snapshot.width && data.snapshot.height ? `${data.snapshot.width} / ${data.snapshot.height}` : "16 / 9";

  let overlay: ReactNode = null;
  if (!data || (url && state === "loading")) {
    overlay = (
      <div className="absolute inset-0 flex items-center justify-center gap-2 bg-sunken animate-skeleton">
        <span className="text-ui text-ink-2">Loading evidence…</span>
      </div>
    );
  } else if (!url || state === "error") {
    overlay = (
      <div
        data-testid="evidence-unavailable"
        className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-sunken border border-dashed border-line-strong rounded-md"
      >
        <Icon name="videocam_off" size={26} className="text-ink-3" />
        <span className="text-ui font-medium text-ink-2">Evidence unavailable</span>
        <span className="text-caption text-ink-3">
          {state === "error" ? "Snapshot could not be loaded" : "No snapshot stored for this alert"}
        </span>
      </div>
    );
  }

  return (
    <div className="relative w-full bg-video rounded-md overflow-hidden border border-line-strong shadow-tile" style={{ aspectRatio: aspect }}>
      {url && (
        // Evidence frames are backend-stored JPEGs served as-is; next/image
        // optimisation would re-encode the evidential image.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={url}
          src={url}
          alt={`Evidence frame for ${alertId}`}
          loading="lazy"
          decoding="async"
          data-testid="evidence-image"
          onLoad={() => setState("ok")}
          onError={() => setState("error")}
          className={`absolute inset-0 w-full h-full object-contain ${state === "ok" ? "" : "invisible"}`}
        />
      )}
      {overlay}
      {state === "ok" && (
        <span className="absolute left-2 top-2 px-1.5 h-5 leading-5 rounded-sm bg-video/80 text-caption font-medium text-video-crit">
          Evidence · alert frame
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------- fields */

function Field({ label, children, mono = true }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0 flex items-baseline gap-3 py-1.5 border-b border-line last:border-b-0">
      <span className="w-[112px] shrink-0 text-caption text-ink-2">{label}</span>
      <span className={cx("min-w-0 break-words text-ink", mono ? "text-data font-data" : "text-ui")}>{children}</span>
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <h4 className="pb-1.5 text-ui font-semibold text-ink border-b border-line-strong">{title}</h4>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------ model feedback */

type Feedback = { verdict?: "confirmed" | "false_alarm"; status?: string; submitted_by?: string; reviewed_by?: string | null };

/** Operator verdict → Admin ▸ AI models ▸ improvement queue (reviewed before any training use). */
function FeedbackField({ alertId }: { alertId: string }) {
  const key = `/api/v1/alerts/${encodeURIComponent(alertId)}/feedback`;
  const { data, mutate } = useSWR<Feedback>(key, (u: string) => fetch(u).then((r) => (r.ok ? r.json() : {})), {
    revalidateOnFocus: false,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const send = async (verdict: "confirmed" | "false_alarm") => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(key, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verdict }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      await mutate(body, { revalidate: false });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const v = data?.verdict;
  return (
    <Field label="Model feedback" mono={false}>
      <span className="inline-flex items-center gap-2 flex-wrap">
        <Button size="sm" disabled={busy} onClick={() => void send("confirmed")} pressed={v === "confirmed"}>
          Confirmed
        </Button>
        <Button size="sm" disabled={busy} onClick={() => void send("false_alarm")} pressed={v === "false_alarm"}>
          False alarm
        </Button>
        {v && (
          <span className="text-caption text-ink-2" data-testid="feedback-state">
            {v.replace("_", " ")} by {data?.submitted_by} · {data?.status}
            {data?.reviewed_by ? ` (${data.reviewed_by})` : ""}
          </span>
        )}
        {err && <span className="text-caption text-crit-ink">{err}</span>}
      </span>
    </Field>
  );
}

/* --------------------------------------------------------------- detail row */

/**
 * Inline expansion under an intrusion alert row. Details and the evidence
 * frame are fetched only once the row is opened.
 */
export function AlertDetailRow({
  alert,
  colSpan,
  closing,
  onCollapse,
  onClosed,
  onAck,
  onDispatch,
}: {
  alert: Alert;
  colSpan: number;
  /** Parent asked to collapse: animate shut, then call onClosed. */
  closing: boolean;
  onCollapse: () => void;
  onClosed: () => void;
  onAck: () => void;
  onDispatch: () => void;
}) {
  const key = alert.eventId ? `/api/v1/alerts/${encodeURIComponent(alert.id)}` : null;
  const { data, error, isLoading, mutate } = useSWR(key, fetchDetail, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });

  // Open on the frame after mount so the height transition runs.
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const r = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(r);
  }, []);
  useEffect(() => {
    if (!closing) return;
    const t = setTimeout(onClosed, 200);
    return () => clearTimeout(t);
  }, [closing, onClosed]);
  const open = shown && !closing;

  const created = data ? stamp(data.timestamp) : null;
  const bbox = data?.bounding_box;
  const zone = data?.restricted_zone;
  const site = data?.site;

  return (
    <tr data-testid="alert-detail-row" data-alert-id={alert.id}>
      <td colSpan={colSpan} className="p-0 border-b border-line">
        <div
          className="grid transition-[grid-template-rows] duration-200 ease-out"
          style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="bg-raised relative">
              <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-crit" />
              {/* header */}
              <div className="min-h-11 pl-5 pr-4 py-2 flex items-center gap-3 border-b border-line">
                <Icon name="crisis_alert" size={18} className="text-crit-ink" />
                <span className="text-ui font-data text-ink">{alert.id}</span>
                <span className="text-ui font-semibold text-crit-ink">
                  {data?.event_label ?? "Perimeter breach / intrusion"}
                </span>
                <span className="text-ui text-ink-2">
                  {alert.cameraId} · <span className="font-data text-data">{hms(alert.t)}</span>
                </span>
                <div className="ml-auto flex items-center gap-1.5">
                  {alert.status === "new" && (
                    <Button size="sm" onClick={onAck} title={`Acknowledge ${alert.id}`}>
                      Ack
                    </Button>
                  )}
                  {alert.status !== "dispatched" && (
                    <Button size="sm" variant="danger" onClick={onDispatch} title={`Dispatch QRF for ${alert.id}`}>
                      QRF
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={onCollapse} title="Collapse · Esc">
                    <Icon name="expand_less" size={15} />
                    Collapse
                  </Button>
                </div>
              </div>

              {error ? (
                <div
                  data-testid="alert-detail-error"
                  className="px-5 py-8 flex items-center justify-center gap-3 text-ui text-ink-2"
                >
                  <Icon name="error" size={18} className="text-crit-ink" />
                  Alert details could not be loaded — {error.message}
                  <Button size="sm" onClick={() => mutate()}>
                    Retry
                  </Button>
                </div>
              ) : !key ? (
                <div className="px-5 py-8 text-center text-ui text-ink-2">
                  This alert has no stored record in the backend.
                </div>
              ) : (
                <div className="pl-5 pr-4 py-4 grid grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] gap-6">
                  {/* LEFT — evidence */}
                  <div className="min-w-0 flex flex-col gap-3">
                    <Evidence data={data} alertId={alert.id} />
                    <div className="grid grid-cols-2 gap-x-6">
                      <Field label="Camera">{alert.cameraId}</Field>
                      <Field label="Frame">{isLoading ? "…" : dash(data?.frame_id)}</Field>
                      <Field label="Timestamp">{created ? `${created.local} · ${created.zulu}` : "…"}</Field>
                      <Field label="Track ID">{isLoading ? "…" : dash(data?.track_id)}</Field>
                      <Field label="Bounding box">
                        {bbox ? `[${bbox.join(", ")}] · ${bbox[2] - bbox[0]}×${bbox[3] - bbox[1]} px` : dash(null)}
                      </Field>
                      <Field label="Foot point">
                        {data?.foot_point ? `(${data.foot_point.map((v) => Math.round(v)).join(", ")})` : dash(null)}
                      </Field>
                    </div>
                    <span className="text-caption text-ink-3">
                      Coordinates in native stream pixels
                      {data?.camera.width && data.camera.height ? ` (${data.camera.width}×${data.camera.height})` : ""}
                    </span>
                  </div>

                  {/* RIGHT — alert record */}
                  <div className="min-w-0 grid grid-cols-2 gap-x-6 gap-y-4 content-start">
                    <Group title="Incident">
                      <Field label="Alert ID">{alert.id}</Field>
                      {data?.incident_id && <Field label="Incident">{data.incident_id}</Field>}
                      <Field label="Event type" mono={false}>
                        <span className="text-crit-ink font-medium">{data?.event_label ?? "…"}</span>
                      </Field>
                      <Field label="Class" mono={false}>
                        <ClassTag cls={alert.cls} />
                      </Field>
                      <Field label="Detection class" mono={false}>{data ? dash(data.object_class) : "…"}</Field>
                      <Field label="Confidence">
                        {data?.confidence != null ? `${data.confidence.toFixed(1)}%` : `${alert.confidence.toFixed(1)}%`}
                      </Field>
                      <Field label="Severity" mono={false}>
                        <SeverityChip severity={alert.severity} />
                      </Field>
                      <Field label="Created">{created ? created.local : "…"}</Field>
                    </Group>

                    <Group title="Location">
                      <Field label="Camera ID">{alert.cameraId}</Field>
                      <Field label="Camera" mono={false}>
                        {data ? dash(data.camera.name) : "…"}
                      </Field>
                      <Field label="Post" mono={false}>
                        {site ? (site.post_name ? `${site.post_name} (${site.post_id})` : "Unassigned") : "…"}
                      </Field>
                      <Field label="Company" mono={false}>
                        {site ? (site.company_name ? `${site.company_name} (${site.company_id})` : "Unassigned") : "…"}
                      </Field>
                      <Field label="Battalion" mono={false}>
                        {site ? dash(site.battalion_name) : "…"}
                      </Field>
                      <Field label="Grid">
                        {site?.latitude != null && site.longitude != null
                          ? `${site.latitude.toFixed(5)}, ${site.longitude.toFixed(5)}`
                          : dash(null)}
                      </Field>
                    </Group>

                    <Group title="Detection">
                      <Field label="Detection mode" mono={false}>
                        {data ? data.detection_mode_label : "…"}
                      </Field>
                      <Field label="Pipeline gen.">{isLoading ? "…" : dash(data?.pipeline_generation)}</Field>
                      <Field label="Source">{data ? dash(data.camera.source_id) : "…"}</Field>
                      <Field label="Camera now" mono={false}>
                        {data ? `${dash(data.camera.current_mode)} · ${dash(data.camera.pipeline_state)}` : "…"}
                      </Field>
                    </Group>

                    <Group title="Restricted zone">
                      <Field label="Zone ID">{zone ? dash(zone.zone_id) : isLoading ? "…" : dash(null)}</Field>
                      <Field label="Polygon" mono={false}>
                        {zone?.polygon
                          ? `${zone.polygon.length} vertices${zone.is_current_config ? " (current config)" : ""}`
                          : dash(null)}
                      </Field>
                      <Field label="Edge buffer">{zone?.buffer_px != null ? `${zone.buffer_px} px` : dash(null)}</Field>
                    </Group>

                    <div className="col-span-2">
                      <Group title="Operator action">
                        <Field label="Status" mono={false}>
                          <StatusCell status={alert.status} by={alert.ackBy} />
                        </Field>
                        <Field label="Action by" mono={false}>
                          {alert.ackBy ? `${alert.ackBy} at ${hms(alert.ackAt ?? alert.t)}` : "No operator action recorded"}
                        </Field>
                        <FeedbackField alertId={alert.id} />
                      </Group>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </td>
    </tr>
  );
}
