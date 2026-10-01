"use client";

import { useConsole, type DetectionMode, type PipelineEvent } from "../ConsoleProvider";

type Analytics = Record<string, unknown>;

function Row({ k, v, tone = "text-ink" }: { k: string; v: React.ReactNode; tone?: string }) {
  return (
    <div className="flex justify-between gap-3 text-ui">
      <span className="text-ink-2">{k}</span>
      <span className={`${tone} font-medium text-right font-data text-data tnum`}>{v}</span>
    </div>
  );
}

function eventLine(e: PipelineEvent): string {
  switch (e.event_type) {
    case "PLATE_READ":
      return `PLATE ${e.plate_text} (${Math.round((e.plate_confidence ?? 0) * 100)}%)`;
    case "VEHICLE_OBSERVED":
      return `${String(e.vehicle_type ?? "vehicle").toUpperCase()} #${e.track_id}`;
    case "VEHICLE_COUNT":
    case "PERSON_COUNT":
      return `#${e.track_id} ${String(e.direction ?? "").toUpperCase()} · TOTAL ${e.total_count}`;
    case "PERIMETER_BREACH":
      return `PERSON #${e.track_id} ENTERED ZONE`;
    case "ANOMALY":
      return `${String(e.anomaly_type ?? "").replace(/_/g, " ")}${e.track_id != null ? ` #${e.track_id}` : ""}`;
    default:
      return e.event_type;
  }
}

/** Live, mode-specific analytics for the camera's ACTIVE pipeline + its latest events. */
export function ModeAnalyticsPanel({
  cameraId,
  mode,
  analytics,
}: {
  cameraId: string;
  mode: DetectionMode | null;
  analytics: Analytics;
}) {
  const { recentEvents } = useConsole();
  const events = (recentEvents[cameraId] ?? []).filter((e) => e.detection_mode === mode).slice(0, 6);
  const a = analytics;
  const n = (k: string) => (typeof a[k] === "number" ? (a[k] as number) : 0);

  if (!mode || mode === "none") return null;

  return (
    <div className="flex flex-col gap-1.5" data-testid="mode-analytics">
      <h4 className="text-ui font-semibold text-ink pb-1.5 border-b border-line">Live analytics</h4>
      {mode === "intrusion" && (
        <>
          <Row k="Zone" v={a.zone_configured ? "Armed" : "Not configured"} tone={a.zone_configured ? "text-crit-ink" : "text-warn-ink"} />
          <Row k="Persons in view" v={n("persons")} />
          <Row k="Inside zone" v={n("intruders")} tone={n("intruders") ? "text-crit-ink" : "text-ink"} />
        </>
      )}
      {mode === "anpr" && (
        <>
          <Row k="Vehicles tracked" v={n("vehicles")} />
          <Row k="Plates read (in view)" v={Array.isArray(a.plates) ? a.plates.length : 0} tone="text-accent-ink" />
        </>
      )}
      {(mode === "vehicle_counting" || mode === "person_counting") && (
        <>
          <Row k="In view" v={n("in_view")} />
          {a.geometry === "line" && (
            <>
              <Row k="Count in" v={n("in")} tone="text-ink" />
              <Row k="Count out" v={n("out")} tone="text-ink" />
              <Row k="Total crossings" v={n("total")} tone="text-ok-ink" />
            </>
          )}
          {a.geometry === "zone" && (
            <>
              <Row k="Zone occupancy" v={n("occupancy")} />
              <Row k="Zone entries" v={n("entries")} tone="text-ok-ink" />
            </>
          )}
          {a.geometry === "none" && <Row k="COUNTING LINE" v="Not configured" tone="text-warn-ink" />}
          <Row k="Unique tracks" v={n("unique")} />
        </>
      )}
      {mode === "anomaly" && (
        <>
          <Row
            k="Baseline"
            v={a.learning ? `LEARNING (${n("learning_remaining_s")}s)` : "Armed"}
            tone={a.learning ? "text-warn-ink" : "text-ok-ink"}
          />
          <Row k="Objects / persons" v={`${n("objects")} / ${n("persons")}`} />
          <Row k="Crowd baseline" v={String(a.crowd_baseline ?? "--")} />
          <Row k="Anomalies" v={n("anomalies")} tone={n("anomalies") ? "text-warn-ink" : "text-ink"} />
        </>
      )}
      {events.length > 0 && (
        <div className="pt-1.5 mt-1 border-t border-line space-y-1" data-testid="mode-events">
          {events.map((e, i) => (
            <div key={`${e.timestamp}-${i}`} className="flex justify-between text-caption">
              <span className="text-ink-2 truncate">{eventLine(e)}</span>
              <span className="text-ink-3 font-data shrink-0 pl-2">{e.timestamp.slice(11, 19)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
