"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Icon } from "@/components/ds";
import { cx } from "@/lib/design/cx";
import { cameraById, hms, type Alert } from "@/lib/gotham/model";
import { GlassPanel, GlassSegment, PanelHeader, Pill, type PillTone } from "./glass";

const camLabel = (id: string) => id.replace("-", " ");

/* --------------------------------------------------------------- KPI cards */

export type KpiTone = "ok" | "neutral" | "crit" | "warn";

const KPI_WELL: Record<KpiTone, string> = {
  ok: "bg-ok/10 border-ok/20 text-ok-ink",
  neutral: "bg-white/10 border-white/15 text-white",
  crit: "bg-crit/10 border-crit/25 text-crit-ink",
  warn: "bg-warn/10 border-warn/20 text-warn-ink",
};

/** One key figure: tinted icon tile, label, number + unit, status chip and a note. */
export function KpiCard({
  icon,
  label,
  value,
  unit,
  chip,
  note,
  tone,
  testId,
}: {
  icon: string;
  label: string;
  value: ReactNode;
  unit?: ReactNode;
  chip: string;
  note?: string;
  tone: KpiTone;
  testId?: string;
}) {
  return (
    <GlassPanel
      variant={tone === "warn" ? "warn" : "kpi"}
      className="rounded-xl px-3.5 py-2.5 flex items-center justify-between gap-3 min-w-0"
    >
      <div data-testid={testId} className="flex items-center gap-3 min-w-0">
        <div className={cx("w-8 h-8 shrink-0 rounded-lg border flex items-center justify-center", KPI_WELL[tone])}>
          <Icon name={icon} size={18} />
        </div>
        <div className="min-w-0">
          <div className="text-[10px] font-medium tracking-wide uppercase text-ink-3 truncate">{label}</div>
          <div className="flex items-baseline gap-1.5 mt-0.5">
            <span className={cx("text-[18px] leading-6 font-semibold tracking-tight tnum", tone === "crit" ? "text-crit-ink" : "text-white")}>
              {value}
            </span>
            {unit && <span className="text-[11px] font-data text-ink-3 truncate">{unit}</span>}
          </div>
        </div>
      </div>
      <div className="text-right shrink-0 min-w-0 max-w-[46%]">
        <Pill tone={tone === "neutral" ? "neutral" : tone} className="max-w-full truncate">
          {chip}
        </Pill>
        {note && <div className="text-[9px] text-ink-3 font-data mt-0.5 truncate uppercase">{note}</div>}
      </div>
    </GlassPanel>
  );
}

/* ------------------------------------------------------------- alert feed */

type AlertTab = "all" | "critical" | "unacked";

const SEV_TONE: Record<Alert["severity"], PillTone> = { high: "crit", med: "warn", low: "neutral" };
const SEV_TEXT: Record<Alert["severity"], string> = { high: "BREACH", med: "INTRUSION", low: "INTRUSION" };

function AlertCard({ alert: a, onAck, onSelect }: { alert: Alert; onAck: (id: string) => void; onSelect: (cameraId: string) => void }) {
  const cam = cameraById(a.cameraId);
  const unacked = a.status === "new";
  const post = a.site?.postName ?? a.site?.cameraName;
  const detail = [
    "Restricted-zone intrusion",
    a.zone,
    post && post !== a.zone ? post : null,
    `${a.confidence.toFixed(1)}% confidence`,
    a.trackId != null ? `track #${a.trackId}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const status =
    a.status === "new" ? "UNACKNOWLEDGED" : a.status === "dispatched" ? "QRF DISPATCHED" : `ACKNOWLEDGED${a.ackBy ? ` · ${a.ackBy}` : ""}`;

  return (
    <div
      data-testid="feed-row"
      data-status={a.status}
      onClick={() => onSelect(a.cameraId)}
      title={`Focus ${a.cameraId}${cam ? ` (${cam.name})` : ""} on the wall`}
      className={cx(
        "rounded-xl p-2.5 flex flex-col gap-1.5 cursor-pointer transition",
        unacked ? "bg-white/[0.04] border border-white/15 hover:bg-white/[0.06]" : "glass-panel-subtle hover:bg-white/[0.05]",
        a.live && "animate-rise",
      )}
    >
      <div className="flex justify-between items-center gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={cx("text-xs font-data truncate", unacked ? "font-semibold text-white" : "font-medium text-white/90")}>
            {camLabel(a.cameraId)}
            {cam ? ` · ${cam.name}` : ""}
          </span>
          <Pill tone={SEV_TONE[a.severity]} round={false} className="px-1.5 py-px text-[9px] font-bold tracking-wider">
            {SEV_TEXT[a.severity]}
          </Pill>
        </div>
        <span className="text-[11px] font-data font-medium text-ink-3 shrink-0 tnum">{hms(a.t)}</span>
      </div>
      <p className="text-[11px] text-ink-2 leading-snug">{detail}</p>
      {unacked ? (
        <div className="flex justify-between items-center pt-1 border-t border-white/10 mt-0.5">
          <span className="text-[9px] font-data text-ink-3">STATUS: {status}</span>
          <button
            type="button"
            title={`Acknowledge ${a.id}`}
            onClick={(e) => {
              e.stopPropagation();
              onAck(a.id);
            }}
            className="glass-button px-3 py-1 rounded-lg text-white text-[10px] font-medium tracking-wide flex items-center gap-1.5"
          >
            <Icon name="check_circle" size={13} />
            Acknowledge
          </button>
        </div>
      ) : (
        <span className="text-[9px] font-data text-ink-3">STATUS: {status}</span>
      )}
    </div>
  );
}

/** Real-time intrusion alerts from the pipeline, newest first, with the live/pause switch. */
export function AlertFeedPanel({
  alerts,
  unacked,
  liveOn,
  onToggleLive,
  onAck,
  onSelect,
}: {
  alerts: Alert[];
  unacked: number;
  liveOn: boolean;
  onToggleLive: () => void;
  onAck: (id: string) => void;
  onSelect: (cameraId: string) => void;
}) {
  const [tab, setTab] = useState<AlertTab>("all");
  const rows = useMemo(
    () =>
      alerts
        .filter((a) => (tab === "critical" ? a.severity === "high" : tab === "unacked" ? a.status === "new" : true))
        .slice(0, 30),
    [alerts, tab],
  );

  return (
    <GlassPanel className="rounded-2xl p-3 flex flex-col flex-1 min-h-0 overflow-hidden">
      <PanelHeader
        title="Real-Time Alerts"
        left={
          <>
            <Pill tone={unacked ? "crit" : "neutral"}>{unacked} Active</Pill>
            <button
              type="button"
              data-testid="live-toggle"
              onClick={onToggleLive}
              title={liveOn ? "Pause live feed" : "Resume live feed"}
              className="flex items-center gap-1.5 text-[10px] font-data text-ink-2 hover:text-white"
            >
              <span className={cx("w-1.5 h-1.5 rounded-full", liveOn ? "bg-ok-ink glass-pulse" : "bg-ink-3")} />
              {liveOn ? "LIVE" : "PAUSED"}
            </button>
          </>
        }
        right={
          <GlassSegment<AlertTab>
            label="Alert filter"
            value={tab}
            onChange={setTab}
            className="rounded-lg"
            items={[
              { id: "all", label: "All" },
              { id: "critical", label: "Critical", title: "High-severity intrusions" },
              { id: "unacked", label: "Unacked", title: "Awaiting operator action" },
            ]}
          />
        }
      />
      <div className="overflow-y-auto flex-1 min-h-0 pr-1 space-y-2">
        {rows.length === 0 && (
          <div className="h-full min-h-24 flex flex-col items-center justify-center gap-1 text-center text-ink-3">
            <Icon name="shield" size={20} />
            <span className="text-[11px]">
              {alerts.length === 0 ? "No intrusions — restricted zones clear" : "No alerts match this filter"}
            </span>
          </div>
        )}
        {rows.map((a) => (
          <AlertCard key={a.id} alert={a} onAck={onAck} onSelect={onSelect} />
        ))}
      </div>
      <div className="pt-2 mt-2 border-t border-white/[0.06] shrink-0 flex justify-end">
        <Link href="/alerts" className="text-[10px] font-data text-accent-ink hover:underline">
          ALL ALERTS →
        </Link>
      </div>
    </GlassPanel>
  );
}

/* ------------------------------------------------------ device telemetry */

/** Live ingest of one real NVR (from the backend's per-camera stream health). */
export type LiveNvr = { id: string; bound: number; up: number; kbps: number; down: string[] };

/** One row per live NVR: channels streaming, ingest bitrate and state; link-lost cameras on top. */
export function DeviceTelemetryPanel({ nvrs, degraded }: { nvrs: LiveNvr[]; degraded: string[] }) {
  const router = useRouter();
  const up = nvrs.reduce((a, n) => a + n.up, 0);
  const bound = nvrs.reduce((a, n) => a + n.bound, 0);
  const mbps = nvrs.reduce((a, n) => a + n.kbps, 0) / 1000;

  return (
    <GlassPanel className="rounded-2xl p-3 shrink-0 flex flex-col">
      <PanelHeader
        icon="dns"
        title="Device & NVR Telemetry"
        right={
          <span title="Channels streaming / bound, combined ingest bitrate">
            {bound ? `${up}/${bound} CH · ${mbps.toFixed(1)} MBIT/S` : "NO LIVE INGEST"}
          </span>
        }
        className="mb-1.5"
      />
      <div className="space-y-1.5 text-xs font-data max-h-40 overflow-y-auto">
        {degraded.map((id) => (
          <div
            key={id}
            data-testid="degraded-row"
            className="bg-crit/10 border border-crit/25 rounded-xl px-2.5 py-1.5 flex items-center justify-between animate-rise"
          >
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-crit-ink glass-pulse" />
              <span className="font-medium text-white text-[11px]">{camLabel(id)}</span>
              <span className="text-[10px] text-ink-3">LINK LOST</span>
            </div>
            <Pill tone="crit" round={false} className="px-1.5 py-px text-[9px] font-semibold">
              RECOVERING
            </Pill>
          </div>
        ))}

        {nvrs.map((n) => {
          const state = n.up === n.bound ? "OK" : n.up === 0 ? "OFFLINE" : "DEGRADED";
          const tone = state === "OK" ? "ok" : state === "OFFLINE" ? "crit" : "warn";
          const pct = n.bound ? Math.round((n.up / n.bound) * 100) : 0;
          return (
            <button
              key={n.id}
              type="button"
              data-testid="nvr-row"
              onClick={() => router.push("/devices")}
              title={n.down.length ? `Not streaming: ${n.down.join(", ")}` : "All bound channels streaming"}
              className={cx(
                "w-full text-left bg-white/[0.03] border rounded-xl px-2.5 py-1.5 flex items-center justify-between gap-3 hover:bg-white/[0.05] transition",
                state === "OK" ? "border-white/5" : "border-white/10",
              )}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={cx(
                    "w-1.5 h-1.5 rounded-full shrink-0",
                    tone === "ok" ? "bg-ok-ink" : tone === "warn" ? "bg-warn-ink glass-pulse" : "bg-crit-ink glass-pulse",
                  )}
                />
                <span className="font-medium text-white text-[11px] truncate">{n.id}</span>
                <span className="text-[10px] text-ink-3 shrink-0">{n.bound} CH</span>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <div className="w-24 h-1.5 rounded-full bg-white/10 overflow-hidden">
                  <div
                    className={cx("h-full rounded-full", tone === "ok" ? "bg-white/60" : tone === "warn" ? "bg-warn" : "bg-crit")}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="text-[10px] text-ink-2 w-10 text-right tnum">
                  {n.up}/{n.bound}
                </span>
                {state === "OK" ? (
                  <span className="text-[10px] text-ok-ink font-medium w-16 text-right tnum">{(n.kbps / 1000).toFixed(1)} Mb/s</span>
                ) : (
                  <Pill tone={tone} round={false} className="px-1.5 py-px text-[9px] font-semibold w-16 justify-center">
                    {state}
                  </Pill>
                )}
              </div>
            </button>
          );
        })}

        {nvrs.length === 0 && degraded.length === 0 && (
          <div className="text-center text-[11px] text-ink-3 py-3 font-sans">
            No live NVR channels reported — the AI pipeline is offline or no channels are bound.
          </div>
        )}
      </div>
    </GlassPanel>
  );
}

/* -------------------------------------------------------------- histogram */

const HOURS = 12;

/** Real alerts bucketed into the last 12 clock hours (alert `t` is seconds since midnight, local). */
export function AlertHistogramPanel({ alerts }: { alerts: Pick<Alert, "t">[] }) {
  // Hour is read after mount (and refreshed each minute) so server and client markup agree.
  const [nowHour, setNowHour] = useState<number | null>(null);
  useEffect(() => {
    const read = () => setNowHour(new Date().getHours());
    read();
    const t = setInterval(read, 60_000);
    return () => clearInterval(t);
  }, []);

  const buckets = useMemo(() => {
    const hours = Array.from({ length: HOURS }, (_, i) => (((nowHour ?? 0) - (HOURS - 1) + i) % 24 + 24) % 24);
    return hours.map((h) => ({ h, n: nowHour === null ? 0 : alerts.filter((a) => Math.floor(a.t / 3600) === h).length }));
  }, [alerts, nowHour]);

  const max = Math.max(1, ...buckets.map((b) => b.n));
  const total = buckets.reduce((a, b) => a + b.n, 0);
  const peak = buckets.reduce((m, b) => (b.n > m.n ? b : m), buckets[0]);
  const fmt = (h: number) => `${String(h).padStart(2, "0")}:00`;

  return (
    <GlassPanel className="rounded-2xl p-3 h-32 flex flex-col shrink-0 justify-between">
      <PanelHeader
        icon="bar_chart"
        title="Alert Frequency Histogram"
        className="pb-1.5 mb-0"
        left={<span className="text-[10px] font-data text-ink-3">Past 12 Hours</span>}
        right={
          <>
            <span className="px-2 py-0.5 rounded-md bg-white/10 text-white/90 border border-white/15 font-medium">
              {total ? `PEAK: ${peak.n} @ ${fmt(peak.h)}` : "NO ALERTS"}
            </span>
            <span>AVG {(total / HOURS).toFixed(1)} / HR</span>
          </>
        }
      />
      <div className="bg-black/30 border border-white/[0.04] rounded-xl p-2 mt-1.5 flex items-end justify-between flex-1 min-h-0 gap-1.5" role="img" aria-label="Intrusion alerts per hour, last 12 hours">
        {buckets.map((b, i) => {
          const isPeak = total > 0 && b.n === peak.n && b.h === peak.h;
          const isNow = i === HOURS - 1;
          return (
            <div key={b.h} className="flex flex-col items-center flex-1 min-w-0 h-full justify-end group" title={`${fmt(b.h)} — ${b.n} alert${b.n === 1 ? "" : "s"}`}>
              <span className={cx("text-[8px] font-data mb-0.5", isPeak ? "text-white/90 font-bold" : "text-ink-3")}>{b.n}</span>
              <div
                className={cx(
                  "w-full rounded-sm transition",
                  isPeak ? "bg-white/60" : isNow && b.n ? "bg-white/30" : "bg-white/10 group-hover:bg-white/20",
                )}
                style={{ height: `${b.n === 0 ? 4 : Math.max(10, (b.n / max) * 70)}%` }}
              />
              <span className={cx("text-[9px] font-data mt-1", isNow ? "text-ink-2 font-semibold" : "text-ink-3")}>{fmt(b.h)}</span>
            </div>
          );
        })}
      </div>
    </GlassPanel>
  );
}
