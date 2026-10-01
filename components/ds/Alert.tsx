import type { ReactNode } from "react";
import { cx } from "@/lib/design/cx";
import { hms, cameraById, type Alert, type AlertClass, type AlertStatus, type Severity } from "@/lib/gotham/model";
import { Badge, StatusDot } from "./Badge";
import { Button } from "./Button";

/* ---------------------------------------------------------------- ClassTag */

const CLASS_TONE = {
  intrusion: "crit",
  person: "neutral",
  vehicle: "neutral",
  animal: "neutral",
  anomaly: "warn",
} as const;

const CLASS_TEXT: Record<AlertClass, string> = {
  intrusion: "Intrusion",
  person: "Person",
  vehicle: "Vehicle",
  animal: "Animal",
  anomaly: "Anomaly",
};

export function ClassTag({ cls }: { cls: AlertClass }) {
  return <Badge tone={CLASS_TONE[cls]}>{CLASS_TEXT[cls]}</Badge>;
}

/* ------------------------------------------------------------ SeverityChip */

const SEV_TEXT: Record<Severity, string> = { high: "High", med: "Medium", low: "Low" };

/** Only High is a solid fill — it must be the first thing the eye finds in a column. */
export function SeverityChip({ severity }: { severity: Severity }) {
  if (severity === "high") {
    return (
      <span className="inline-flex items-center h-5 px-1.5 rounded-sm text-caption font-semibold bg-crit text-white">
        {SEV_TEXT.high}
      </span>
    );
  }
  return <Badge tone={severity === "med" ? "warn" : "neutral"}>{SEV_TEXT[severity]}</Badge>;
}

/* -------------------------------------------------------------- StatusCell */

export function StatusCell({ status, by }: { status: AlertStatus; by?: string }) {
  if (status === "new") {
    return (
      <span className="inline-flex items-center gap-1.5 text-crit-ink font-medium">
        <StatusDot tone="crit" />
        Unacknowledged
      </span>
    );
  }
  if (status === "dispatched") {
    return (
      <span className="inline-flex items-center gap-1.5 text-warn-ink font-medium">
        <StatusDot tone="warn" />
        Dispatched
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-ink-2">
      <StatusDot tone="idle" />
      Acknowledged{by ? ` · ${by}` : ""}
    </span>
  );
}

/* ---------------------------------------------------------------- AlertRow */

/**
 * Compact alert list row for feeds beside a live wall. Unacknowledged alerts
 * carry a red edge and heavier type; acknowledged ones recede.
 */
export function AlertRow({
  alert: a,
  onAck,
  onSelect,
  trailing,
  showClass = true,
}: {
  alert: Alert;
  onAck?: (id: string) => void;
  onSelect?: (cameraId: string) => void;
  trailing?: ReactNode;
  /** Hide the class badge in feeds that only ever carry one class. */
  showClass?: boolean;
}) {
  const cam = cameraById(a.cameraId);
  const unacked = a.status === "new";
  return (
    <div
      data-testid="feed-row"
      data-status={a.status}
      onClick={() => onSelect?.(a.cameraId)}
      title={`Focus ${a.cameraId}${cam ? ` (${cam.name})` : ""} on the wall`}
      className={cx(
        "group relative min-h-12 pl-4 pr-3 py-2 flex items-center gap-3 cursor-pointer transition-colors hover:bg-hover",
        unacked && "bg-crit-wash/45",
        a.live && "animate-rise",
      )}
    >
      {unacked && <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-crit" />}
      <span className="text-data font-data tnum text-ink-2 w-[58px] shrink-0">{hms(a.t)}</span>
      <div className="min-w-0 flex-1">
        <div className={cx("text-ui truncate", unacked ? "text-ink font-medium" : "text-ink-2")}>
          {a.cameraId} · {cam?.name ?? ""}
        </div>
        <div className="text-caption text-ink-3 truncate">
          {a.zone} · {a.confidence.toFixed(1)}%
        </div>
      </div>
      {showClass && <ClassTag cls={a.cls} />}
      <SeverityChip severity={a.severity} />
      {trailing ??
        (unacked ? (
          <Button
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onAck?.(a.id);
            }}
            className="opacity-0 group-hover:opacity-100 focus:opacity-100"
            title={`Acknowledge ${a.id}`}
          >
            Acknowledge
          </Button>
        ) : (
          <span className="text-caption text-ink-3 w-20 text-right truncate">
            {a.status === "dispatched" ? "QRF sent" : (a.ackBy ?? "Acknowledged")}
          </span>
        ))}
    </div>
  );
}
