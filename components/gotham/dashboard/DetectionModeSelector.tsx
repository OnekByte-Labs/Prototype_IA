"use client";

import {
  DETECTION_MODE_LABELS,
  useConsole,
  type DetectionMode,
  type PipelineState,
} from "../ConsoleProvider";
import { Badge, Icon } from "@/components/ds";
import { cx } from "@/lib/design/cx";

const MODES: DetectionMode[] = ["none", "intrusion", "anpr", "vehicle_counting", "person_counting", "anomaly"];

const MODE_MODELS: Record<DetectionMode, string> = {
  none: "No inference",
  intrusion: "YOLO26n → tracker → restricted zone",
  anpr: "TrafficCamNet → tracker → LPDNet → LPRNet",
  vehicle_counting: "TrafficCamNet → tracker → line/zone",
  person_counting: "PeopleNet → tracker → line/zone",
  anomaly: "YOLO26n → tracker → statistical baseline",
};

const STATE_BADGE: Record<PipelineState, { text: string; tone: "neutral" | "warn" | "ok" | "crit" }> = {
  idle: { text: "Idle", tone: "neutral" },
  starting: { text: "Starting…", tone: "warn" },
  running: { text: "Running", tone: "ok" },
  stopping: { text: "Stopping…", tone: "warn" },
  error: { text: "Error", tone: "crit" },
};

/** Short badge text for a mode (camera cards). */
export const MODE_SHORT: Record<DetectionMode, string> = {
  none: "No AI",
  intrusion: "Intrusion",
  anpr: "ANPR",
  vehicle_counting: "Vehicle count",
  person_counting: "Person count",
  anomaly: "Anomaly",
};

/**
 * Detection Mode selector for one camera. Reflects the REAL backend pipeline
 * state: the active mode is shown only once the backend reports it, options
 * are disabled while a switch is in flight, and model failures are shown.
 */
export function DetectionModeSelector({ cameraId }: { cameraId: string }) {
  const { pipelines, setDetectionMode, wsConnected } = useConsole();
  const p = pipelines[cameraId];
  const busy = !p || p.pending || p.state === "starting" || p.state === "stopping";
  const state = p?.state ?? "idle";
  const st = STATE_BADGE[state];

  return (
    <div className="flex flex-col gap-2" data-testid="detection-mode">
      <div className="flex items-center justify-between">
        <h4 className="text-ui font-semibold text-ink">Detection mode</h4>
        <span
          data-testid="pipeline-state"
          title={wsConnected ? "Live pipeline state" : "Pipeline link reconnecting — state may be stale"}
        >
          <Badge tone={p?.pending ? "warn" : st.tone}>{p?.pending ? "Requesting…" : st.text}</Badge>
        </span>
      </div>

      <div className="flex flex-col gap-1" role="radiogroup" aria-label={`Detection mode for ${cameraId}`}>
        {MODES.map((m) => {
          const selected = p?.mode === m;
          const active = selected && (state === "running" || (m === "none" && state === "idle"));
          return (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={busy || (selected && state !== "error")}
              onClick={() => setDetectionMode(cameraId, m)}
              data-mode={m}
              className={cx(
                "text-left px-3 py-1.5 rounded-md border transition-[box-shadow,background-color] duration-100 disabled:cursor-not-allowed",
                selected
                  ? cx(
                      "bg-canvas shadow-inset-sm",
                      active ? "border-ok/40" : state === "error" ? "border-crit/50" : "border-warn/50",
                    )
                  : "bg-raised border-line shadow-key-sm hover:bg-hover disabled:opacity-45 disabled:shadow-none disabled:hover:bg-raised",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-ui font-medium text-ink">{DETECTION_MODE_LABELS[m]}</span>
                {selected && (
                  <span
                    className={cx(
                      "text-caption font-medium inline-flex items-center gap-1",
                      active ? "text-ok-ink" : state === "error" ? "text-crit-ink" : "text-warn-ink",
                    )}
                  >
                    {active ? (
                      <>
                        <Icon name="check_circle" size={13} filled /> Active
                      </>
                    ) : state === "error" ? (
                      <>
                        <Icon name="error" size={13} filled /> Failed
                      </>
                    ) : (
                      "Starting…"
                    )}
                  </span>
                )}
              </div>
              <div className="text-caption text-ink-3">{MODE_MODELS[m]}</div>
            </button>
          );
        })}
      </div>

      {p?.error && (
        <div className="text-caption text-crit-ink bg-crit-wash rounded-md px-3 py-2" data-testid="pipeline-error">
          {p.error}
          {p.state === "error" && <div className="mt-0.5 text-ink-2">Select a mode to retry.</div>}
        </div>
      )}
    </div>
  );
}
