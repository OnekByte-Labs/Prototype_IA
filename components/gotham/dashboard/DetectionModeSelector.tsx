"use client";

import { useConsole, type DetectionMode } from "../ConsoleProvider";
import { Badge, Icon } from "@/components/ds";
import { cx } from "@/lib/design/cx";

/** Short badge text for a mode (camera cards). */
export const MODE_SHORT: Record<string, string> = {
  none: "No AI",
  anpr: "ANPR",
  vehicle: "Vehicle",
  both: "ANPR + Vehicle",
  intrusion: "Intrusion",
  vehicle_counting: "Vehicle",
  person_counting: "Person",
  anomaly: "Anomaly",
};

/**
 * Detection Mode selector for one camera.
 * Supports None, ANPR, and Vehicle Detection, with multi-select support (ANPR + Vehicle).
 */
export function DetectionModeSelector({ cameraId }: { cameraId: string }) {
  const { pipelines, setDetectionMode } = useConsole();
  const p = pipelines[cameraId];
  const mode = p?.mode ?? "both";

  const isAnpr = mode === "anpr" || mode === "both";
  const isVehicle = mode === "vehicle" || mode === "both" || mode === "vehicle_counting";
  const isNone = mode === "none" || (!isAnpr && !isVehicle);

  const handleSelectNone = () => {
    setDetectionMode(cameraId, "none");
  };

  const handleToggleAnpr = () => {
    if (isAnpr) {
      setDetectionMode(cameraId, isVehicle ? "vehicle" : "none");
    } else {
      setDetectionMode(cameraId, isVehicle ? "both" : "anpr");
    }
  };

  const handleToggleVehicle = () => {
    if (isVehicle) {
      setDetectionMode(cameraId, isAnpr ? "anpr" : "none");
    } else {
      setDetectionMode(cameraId, isAnpr ? "both" : "vehicle");
    }
  };

  const activeBadgeText = isNone
    ? "Idle"
    : isAnpr && isVehicle
      ? "ANPR + Vehicle"
      : isAnpr
        ? "ANPR"
        : "Vehicle";

  const sections = [
    {
      id: "none",
      title: "None",
      description: "No AI inference or annotations",
      selected: isNone,
      onClick: handleSelectNone,
    },
    {
      id: "anpr",
      title: "ANPR",
      description: "Automatic Number Plate Recognition",
      selected: isAnpr,
      onClick: handleToggleAnpr,
    },
    {
      id: "vehicle",
      title: "Vehicle Detection",
      description: "Vehicle type & model tracking",
      selected: isVehicle,
      onClick: handleToggleVehicle,
    },
  ];

  return (
    <div className="flex flex-col gap-2" data-testid="detection-mode">
      <div className="flex items-center justify-between">
        <h4 className="text-ui font-semibold text-ink">Detection mode</h4>
        <span data-testid="pipeline-state">
          <Badge tone={isNone ? "neutral" : "ok"}>{activeBadgeText}</Badge>
        </span>
      </div>

      <div className="flex flex-col gap-1.5" role="group" aria-label={`Detection mode for ${cameraId}`}>
        {sections.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={s.onClick}
            data-mode={s.id}
            className={cx(
              "text-left px-3 py-2 rounded-md border transition-[box-shadow,background-color] duration-100 cursor-pointer",
              s.selected
                ? "bg-canvas shadow-inset-sm border-ok/40"
                : "bg-raised border-line shadow-key-sm hover:bg-hover"
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-ui font-medium text-ink">{s.title}</span>
              {s.selected && (
                <span className="text-caption font-medium inline-flex items-center gap-1 text-ok-ink">
                  <Icon name="check_circle" size={13} filled /> Active
                </span>
              )}
            </div>
            <div className="text-caption text-ink-3 mt-0.5">{s.description}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
