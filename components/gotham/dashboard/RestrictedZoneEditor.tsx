"use client";

import { useConsole } from "../ConsoleProvider";
import { ZoneCalibrator } from "./ZoneCalibrator";

// ZoneCalibrator chrome around the video: header (h-11) + footer (h-7), in px
const EDITOR_CHROME_PX = 44 + 28;

/**
 * Full-screen editor for a camera's restricted (intrusion) zone, drawn over the
 * camera's live feed (or its counting line, ``kind="line"``). Saving pushes it
 * to the backend, which persists it in the database and swaps it into the
 * camera's running pipeline immediately (the previous geometry is discarded).
 *
 * The editor is sized to fit the viewport in BOTH dimensions at the stream's
 * native aspect ratio, so controls stay reachable at any display resolution.
 * It only closes via Save / Cancel / Esc — never on a stray backdrop click —
 * so unsaved edits can't be lost by accident.
 */
export function RestrictedZoneEditor({
  cameraId,
  onClose,
  kind = "zone",
}: {
  cameraId: string;
  onClose: () => void;
  /** "zone" = restricted polygon (intrusion) · "line" = counting line (counting modes) */
  kind?: "zone" | "line";
}) {
  const { cameras, updateZone } = useConsole();
  const cam = cameras.find((c) => c.id === cameraId);
  if (!cam) return null;

  const [w, h] = (cam.resolution || "1920×1080").split("×").map((v) => parseInt(v, 10) || 1);
  const aspect = w / h;
  // The calibrator edits a polygon for "intrusion_zone" and a polyline for "traffic_count"
  const zoneCam = {
    ...cam,
    analytics: { ...(cam.analytics ?? {}), type: kind === "zone" ? "intrusion_zone" : "traffic_count" },
  };

  // Largest video box that fits 96vw × (94vh − editor chrome), capped at 1600px wide
  const videoW = `min(96vw, calc((94vh - ${EDITOR_CHROME_PX}px) * ${aspect}), 1600px)`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Edit ${kind === "zone" ? "restricted zone" : "counting line"} for ${cam.id}`}
      className="fixed inset-0 z-[150] bg-ink/55 flex items-center justify-center"
    >
      <div
        className="relative bg-surface border border-line rounded-lg overflow-hidden shadow-pop"
        style={{ width: videoW, height: `calc(${videoW} / ${aspect} + ${EDITOR_CHROME_PX}px)` }}
      >
        <ZoneCalibrator
          key={cam.id}
          cam={zoneCam}
          onClose={onClose}
          onSave={(points) =>
            kind === "zone"
              ? updateZone(cam.id, { zone: points, type: "intrusion_zone" })
              : updateZone(cam.id, { line: points, type: "traffic_count" })
          }
        />
      </div>
    </div>
  );
}
