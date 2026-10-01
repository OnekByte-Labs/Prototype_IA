"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Badge, Button, Icon, IconButton, Modal, StatusDot, StatusIndicator, textareaClass } from "@/components/ds";
import type { Camera } from "@/lib/gotham/model";

interface ZoneCalibratorProps {
  cam: Camera;
  onClose: () => void;
  onSave: (points: number[][]) => Promise<boolean>;
}

export function ZoneCalibrator({ cam, onClose, onSave }: ZoneCalibratorProps) {
  const isLine = cam.analytics?.type === "traffic_count";

  const resParts = cam.resolution ? cam.resolution.split("×") : ["1920", "1080"];
  const origW = parseInt(resParts[0], 10) || 1920;
  const origH = parseInt(resParts[1], 10) || 1080;

  const hasExistingGeometry = isLine
    ? Boolean(cam.analytics?.line && cam.analytics.line.length >= 2)
    : Boolean(cam.analytics?.zone && cam.analytics.zone.length >= 3);

  const initialPoints: number[][] = hasExistingGeometry
    ? (isLine ? cam.analytics!.line! : cam.analytics!.zone!)
    : [];

  const [points, setPoints] = useState<number[][]>(() => initialPoints.map(p => [...p]));
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [isPlotting, setIsPlotting] = useState<boolean>(() => !hasExistingGeometry);
  const [cursorCoords, setCursorCoords] = useState<[number, number] | null>(null);
  const previousPointsRef = useRef<number[][]>(initialPoints);
  const [showYamlModal, setShowYamlModal] = useState<boolean>(false);
  const [yamlText, setYamlText] = useState<string>("");
  const [saving, setSaving] = useState<boolean>(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const justDraggedRef = useRef<boolean>(false);
  const isDraggingRef = useRef<boolean>(false);
  const dragIdxRef = useRef<number | null>(null);

  const generateYaml = useCallback((pts: number[][]) => {
    const key = isLine ? "line" : "zone";
    const lines = [`  ${cam.id.toLowerCase().replace("-", "_")}:`, `    type: ${isLine ? "traffic_count" : "intrusion_zone"}`, `    ${key}:`];
    pts.forEach(p => {
      lines.push(`      - [${Math.round(p[0])}, ${Math.round(p[1])}]`);
    });
    if (!isLine) {
      lines.push(`    buffer_px: 15`);
      lines.push(`    required_consecutive_frames: 8`);
    }
    return lines.join("\n");
  }, [cam.id, isLine]);

  const clientToNative = useCallback((clientX: number, clientY: number): [number, number] | null => {
    const container = containerRef.current;
    if (!container) return null;
    const rect = container.getBoundingClientRect();
    const containerW = rect.width;
    const containerH = rect.height;
    if (containerW <= 0 || containerH <= 0) return null;

    const contentAspect = origW / origH;
    const containerAspect = containerW / containerH;

    let renderW = containerW;
    let renderH = containerH;
    let offsetX = 0;
    let offsetY = 0;

    if (containerAspect > contentAspect) {
      renderH = containerH;
      renderW = containerH * contentAspect;
      offsetX = (containerW - renderW) / 2;
    } else {
      renderW = containerW;
      renderH = containerW / contentAspect;
      offsetY = (containerH - renderH) / 2;
    }

    const mouseX = clientX - rect.left - offsetX;
    const mouseY = clientY - rect.top - offsetY;

    const nativeX = Math.round(Math.max(0, Math.min(origW, (mouseX / renderW) * origW)));
    const nativeY = Math.round(Math.max(0, Math.min(origH, (mouseY / renderH) * origH)));

    return [nativeX, nativeY];
  }, [origW, origH]);

  // SVG user space matches the stream's aspect ratio (not a fixed 16:9)
  const svgH = (1000 * origH) / origW;
  const toSvgX = (x: number) => (x / origW) * 1000;
  const toSvgY = (y: number) => (y / origH) * svgH;

  // ── Whole-polygon move (drag the shaded area) ──
  const moveRef = useRef<{ start: [number, number]; orig: number[][] } | null>(null);
  const clampPt = useCallback(
    (x: number, y: number): number[] => [
      Math.round(Math.max(0, Math.min(origW, x))),
      Math.round(Math.max(0, Math.min(origH, y))),
    ],
    [origW, origH],
  );

  const handlePolygonPointerDown = (e: React.PointerEvent) => {
    if (isPlotting || isLine || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const start = clientToNative(e.clientX, e.clientY);
    if (!start) return;
    moveRef.current = { start, orig: points.map((p) => [...p]) };
    justDraggedRef.current = false;
    setIsDragging(true);
  };

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const m = moveRef.current;
      if (!m) return;
      const cur = clientToNative(e.clientX, e.clientY);
      if (!cur) return;
      justDraggedRef.current = true;
      // Clamp the translation so the whole polygon stays inside the frame
      const xs = m.orig.map((p) => p[0]);
      const ys = m.orig.map((p) => p[1]);
      const dx = Math.max(-Math.min(...xs), Math.min(origW - Math.max(...xs), cur[0] - m.start[0]));
      const dy = Math.max(-Math.min(...ys), Math.min(origH - Math.max(...ys), cur[1] - m.start[1]));
      setPoints(m.orig.map((p) => clampPt(p[0] + dx, p[1] + dy)));
    };
    const onUp = () => {
      if (!moveRef.current) return;
      moveRef.current = null;
      setIsDragging(false);
      setTimeout(() => {
        justDraggedRef.current = false;
      }, 150);
    };
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onUp, true);
    return () => {
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
    };
  }, [clientToNative, clampPt, origW, origH]);

  // ── Resize: scale the polygon about its centroid ──
  const scalePolygon = useCallback(
    (factor: number) => {
      setPoints((prev) => {
        if (prev.length < 3) return prev;
        const cx = prev.reduce((a, p) => a + p[0], 0) / prev.length;
        const cy = prev.reduce((a, p) => a + p[1], 0) / prev.length;
        return prev.map((p) => clampPt(cx + (p[0] - cx) * factor, cy + (p[1] - cy) * factor));
      });
    },
    [clampPt],
  );

  const handleWheel = (e: React.WheelEvent) => {
    if (isPlotting || isLine || points.length < 3) return;
    scalePolygon(e.deltaY < 0 ? 1.05 : 1 / 1.05);
  };

  const handlePointerDown = (idx: number, e: React.MouseEvent | React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.button !== 0 && e.button !== 2) return;

    setSelectedIdx(idx);
    isDraggingRef.current = true;
    dragIdxRef.current = idx;
    setIsDragging(true);
    setDragIdx(idx);
    justDraggedRef.current = false;
  };

  useEffect(() => {
    const handleMove = (e: MouseEvent | PointerEvent) => {
      if (!isDraggingRef.current || dragIdxRef.current === null) return;
      justDraggedRef.current = true;
      const coords = clientToNative(e.clientX, e.clientY);
      if (!coords) return;

      const activeIdx = dragIdxRef.current;
      setPoints(prev => {
        if (activeIdx >= prev.length) return prev;
        const next = [...prev];
        next[activeIdx] = coords;
        return next;
      });
    };

    const handleUp = () => {
      if (isDraggingRef.current) {
        isDraggingRef.current = false;
        dragIdxRef.current = null;
        setIsDragging(false);
        setDragIdx(null);
        setTimeout(() => {
          justDraggedRef.current = false;
        }, 150);
      }
    };

    window.addEventListener("pointermove", handleMove, true);
    window.addEventListener("pointerup", handleUp, true);
    window.addEventListener("pointercancel", handleUp, true);
    window.addEventListener("mousemove", handleMove, true);
    window.addEventListener("mouseup", handleUp, true);

    return () => {
      window.removeEventListener("pointermove", handleMove, true);
      window.removeEventListener("pointerup", handleUp, true);
      window.removeEventListener("pointercancel", handleUp, true);
      window.removeEventListener("mousemove", handleMove, true);
      window.removeEventListener("mouseup", handleUp, true);
    };
  }, [clientToNative]);

  const startPlotting = () => {
    previousPointsRef.current = points.map(p => [...p]);
    setPoints([]);
    setSelectedIdx(null);
    setCursorCoords(null);
    setIsPlotting(true);
  };

  const cancelPlotting = () => {
    setPoints(previousPointsRef.current.map(p => [...p]));
    setIsPlotting(false);
    setCursorCoords(null);
  };

  const finishPlotting = () => {
    const minPoints = isLine ? 2 : 3;
    if (points.length < minPoints) return;
    setIsPlotting(false);
    setCursorCoords(null);
    setSelectedIdx(0);
  };

  const undoLastPoint = () => {
    setPoints(prev => prev.slice(0, -1));
  };

  const addWaypoint = () => {
    if (points.length < 2) {
      startPlotting();
      return;
    }
    const last = points[points.length - 1];
    const prev = points[points.length - 2];
    const newX = Math.round(Math.min(origW - 40, last[0] + (last[0] - prev[0]) * 0.35));
    const newY = Math.round(Math.min(origH - 40, last[1] + (last[1] - prev[1]) * 0.35));
    setPoints(curr => [...curr, [newX, newY]]);
    setSelectedIdx(points.length);
  };

  const handleSvgClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    if (!isPlotting && (isDraggingRef.current || justDraggedRef.current)) return;
    const coords = clientToNative(e.clientX, e.clientY);
    if (!coords) return;

    if (isPlotting) {
      // The 2nd click of a double-click (which finishes the shape) must not add a duplicate point
      const lastPt = points[points.length - 1];
      if (lastPt && Math.hypot(lastPt[0] - coords[0], lastPt[1] - coords[1]) < origW * 0.01) return;
      if (isLine) {
        const next = [...points, coords];
        setPoints(next);
        if (next.length === 2) {
          // Tripwire complete! 2 points define the line
          setIsPlotting(false);
          setCursorCoords(null);
          setSelectedIdx(1);
        }
        return;
      }

      // If polygon, check if clicking near first node to close
      if (!isLine && points.length >= 3) {
        const first = points[0];
        const dist = Math.hypot(first[0] - coords[0], first[1] - coords[1]);
        if (dist < origW * 0.04) {
          finishPlotting();
          return;
        }
      }
      setPoints(prev => [...prev, coords]);
      return;
    }

    // In normal view/edit mode, clicking background deselects handles
    setSelectedIdx(null);
  };

  const handleSvgDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isPlotting) finishPlotting();
  };

  const handleSvgContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (isPlotting) finishPlotting();
  };

  const handleSvgMouseMove = (e: React.MouseEvent) => {
    if (isPlotting) {
      const coords = clientToNative(e.clientX, e.clientY);
      setCursorCoords(coords);
    }
  };

  const removeSelected = () => {
    const minPoints = isLine ? 2 : 3;
    if (selectedIdx === null || points.length <= minPoints) return;
    setPoints(prev => prev.filter((_, i) => i !== selectedIdx));
    setSelectedIdx(null);
  };

  const resetDefault = () => {
    setPoints(initialPoints.map(p => [...p]));
    setSelectedIdx(null);
    setIsPlotting(false);
    setCursorCoords(null);
  };

  const minPoints = isLine ? 2 : 3;
  const canSave = points.length >= minPoints && !saving;
  // Unsaved edits relative to the zone the pipeline is currently using
  const dirty = JSON.stringify(points) !== JSON.stringify(initialPoints);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const handleSave = async () => {
    if (!canSave) return;
    // Saving while still plotting closes the polygon with the points placed
    if (isPlotting) {
      setIsPlotting(false);
      setCursorCoords(null);
    }
    setSaving(true);
    const ok = await onSave(points.map((p) => [Math.round(p[0]), Math.round(p[1])]));
    setSaving(false);
    // On success return to the camera view; on failure stay so nothing is lost
    if (ok) onClose();
  };

  /** Cancel/Back: leaves the saved zone untouched; asks first if there are edits. */
  const handleCancel = useCallback(() => {
    if (dirty && !confirmDiscard) {
      setConfirmDiscard(true);
      return;
    }
    onClose();
  }, [dirty, confirmDiscard, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isPlotting && (e.key === "Enter" || e.key === "Backspace")) {
        e.preventDefault();
        if (e.key === "Enter") finishPlotting();
        else undoLastPoint();
        return;
      }
      if (e.key !== "Escape") return;
      // Esc belongs to the editor while it is open (don't also exit focus view)
      e.stopImmediatePropagation();
      e.preventDefault();
      if (showYamlModal) setShowYamlModal(false);
      else if (isPlotting) cancelPlotting();
      else if (confirmDiscard) setConfirmDiscard(false);
      else handleCancel();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  const openYamlModal = () => {
    setYamlText(generateYaml(points));
    setShowYamlModal(true);
  };

  const applyYamlText = () => {
    try {
      const extractedPts: number[][] = [];
      const lines = yamlText.split("\n");
      for (const line of lines) {
        const match = line.match(/\[\s*(\d+)\s*,\s*(\d+)\s*\]/);
        if (match) {
          extractedPts.push([parseInt(match[1], 10), parseInt(match[2], 10)]);
        }
      }
      const minRequired = isLine ? 2 : 3;
      if (extractedPts.length >= minRequired) {
        setPoints(extractedPts);
        setShowYamlModal(false);
      }
    } catch (e) {
      console.error("Failed to parse YAML coords:", e);
    }
  };

  const polyPointsString = points.map(p => `${toSvgX(p[0])},${toSvgY(p[1])}`).join(" ");

  const DRAW = isLine ? "#f2a65a" : "#ff6b64";
  const RED_FILL = "rgba(255, 107, 100, 0.26)";
  const INK = "#f3efe6";
  const NODE_BG = "rgba(20, 19, 17, 0.92)";
  const nodeColor = (dragging: boolean, selected: boolean) => (dragging ? "#e67e22" : selected ? INK : DRAW);

  return (
    <div
      onClick={e => e.stopPropagation()}
      onContextMenu={e => e.preventDefault()}
      className="absolute inset-0 z-40 flex flex-col bg-surface select-none pointer-events-auto"
    >
      {/* Toolbar */}
      <header className="h-11 px-4 bg-surface border-b border-line flex items-center justify-between gap-3 shrink-0 z-50">
        <div className="flex items-center gap-3 min-w-0">
          <h2 className="text-section text-ink whitespace-nowrap">{isLine ? "Counting line" : "Restricted zone"}</h2>
          <span className="text-ui text-ink-2 font-data">{cam.id}</span>
          <Badge>
            {points.length} {isLine ? "points" : "vertices"}
          </Badge>
          {dirty && <Badge tone="warn">Unsaved</Badge>}
        </div>

        <div className="flex items-center gap-1.5">
          {!isPlotting ? (
            <>
              <Button
                size="sm"
                variant="primary"
                onClick={startPlotting}
                title={isLine ? "Click 2 points anywhere on the screen to draw a tripwire" : "Click anywhere on screen to plot perimeter boundary"}
              >
                <Icon name="add" size={15} />
                {points.length > 0 ? (isLine ? "Redraw tripwire" : "Redraw perimeter") : (isLine ? "Draw tripwire" : "Draw perimeter")}
              </Button>

              {isLine && points.length >= 2 && (
                <Button size="sm" onClick={addWaypoint} title="Add additional waypoint node to line">
                  + Waypoint
                </Button>
              )}
            </>
          ) : (
            <>
              <StatusIndicator tone="accent" pulse className="mr-1">
                Drawing
              </StatusIndicator>
              {points.length > 0 && (
                <Button size="sm" onClick={undoLastPoint}>
                  Undo
                </Button>
              )}
              {points.length >= (isLine ? 2 : 3) && (
                <Button size="sm" variant="primary" onClick={finishPlotting}>
                  {isLine ? "Finish tripwire" : "Close perimeter"}
                </Button>
              )}
              <Button size="sm" variant="danger" onClick={cancelPlotting}>
                Stop drawing
              </Button>
            </>
          )}

          {selectedIdx !== null && points.length > (isLine ? 2 : 3) && !isPlotting && (
            <Button size="sm" variant="danger" onClick={removeSelected}>
              <Icon name="delete" size={15} />
              Delete P{selectedIdx + 1}
            </Button>
          )}

          <Button size="sm" onClick={openYamlModal} title="Inspect / Edit Raw YAML coordinates">
            <Icon name="code" size={15} className="text-ink-2" />
            YAML
          </Button>

          {!isLine && !isPlotting && points.length >= 3 && (
            <>
              <IconButton
                variant="default"
                size="sm"
                label="Shrink restricted zone (or scroll down over it)"
                onClick={() => scalePolygon(1 / 1.1)}
              >
                <Icon name="remove" size={16} />
              </IconButton>
              <IconButton
                variant="default"
                size="sm"
                label="Enlarge restricted zone (or scroll up over it)"
                onClick={() => scalePolygon(1.1)}
              >
                <Icon name="add" size={16} />
              </IconButton>
            </>
          )}

          <Button size="sm" variant="ghost" onClick={resetDefault} title="Revert to the currently saved zone">
            <Icon name="undo" size={15} />
            Revert
          </Button>

          <span className="w-px h-5 bg-line mx-1" />

          {confirmDiscard ? (
            <div className="flex items-center gap-1.5">
              <span className="text-ui text-warn-ink">Discard unsaved changes?</span>
              <Button size="sm" variant="danger" onClick={onClose}>
                Discard
              </Button>
              <Button size="sm" onClick={() => setConfirmDiscard(false)}>
                Keep editing
              </Button>
            </div>
          ) : (
            <>
              <Button size="sm" onClick={handleCancel} title="Discard unsaved changes and go back (Esc). The saved zone stays active.">
                Cancel
              </Button>
              <Button
                size="sm"
                variant="primary"
                onClick={handleSave}
                disabled={!canSave}
                title={
                  canSave
                    ? "Replace the active zone with this polygon and go back"
                    : `Place at least ${minPoints} points first`
                }
              >
                <Icon name="check" size={15} />
                {saving ? "Saving…" : isLine ? "Save tripwire" : "Save zone"}
              </Button>
            </>
          )}
        </div>
      </header>

      {/* Interactive canvas over the clean live feed */}
      <div
        ref={containerRef}
        className="flex-1 relative overflow-hidden cursor-crosshair bg-video flex items-center justify-center"
      >
        {/* Plotting guide */}
        {isPlotting && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 px-3 py-1.5 rounded-md bg-video/90 flex items-center gap-3 pointer-events-auto">
            <span className="w-2 h-2 rounded-full bg-accent-soft animate-breathe" />
            <span className="text-caption font-medium text-video-ink">
              {points.length === 0
                ? "Step 1: click anywhere on the screen to set point A (start)"
                : points.length === 1
                ? (isLine
                    ? "Step 2: click anywhere else to set point B (end)"
                    : "Step 2: click to place node 02")
                : isLine
                ? `Node ${points.length} placed · click to extend · double-click / Enter / Finish to end`
                : `Node ${points.length} placed · click to extend · click node 01, double-click, right-click or Enter to close`}
            </span>
          </div>
        )}

        {/* Empty state when no geometry is defined */}
        {points.length === 0 && !isPlotting && (
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none select-none z-20">
            <div className="p-5 rounded-lg bg-surface border border-line shadow-pop flex flex-col items-center text-center gap-2 pointer-events-auto">
              <span className="text-section text-ink">
                {isLine ? "No tripwire defined" : "No perimeter defined"}
              </span>
              <span className="text-ui text-ink-2 max-w-[260px]">
                {isLine
                  ? "Place 2 points anywhere on the live video stream."
                  : "Plot the perimeter boundary vertices on the live video stream."}
              </span>
              <Button variant="primary" onClick={startPlotting} className="mt-1">
                {isLine ? "Draw tripwire line" : "Draw perimeter"}
              </Button>
            </div>
          </div>
        )}

        {/* Start-point hint while plotting with 0 points */}
        {isPlotting && points.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none z-10">
            <div className="px-4 py-2 rounded-md bg-video/80 border border-dashed border-accent-soft/60 text-video-ink text-ui flex items-center gap-2">
              <span className="text-accent-soft font-semibold">+</span>
              <span>Click anywhere on the stream to set point A (start)</span>
            </div>
          </div>
        )}

        {/* Background camera feed */}
        {cam.mjpegUrl ? (
          // Clean feed (no burned-in overlays) so only the editable draft shows
          // eslint-disable-next-line @next/next/no-img-element -- MJPEG stream
          <img
            src={`${cam.mjpegUrl}${cam.mjpegUrl.includes("?") ? "&" : "?"}clean=1`}
            alt={cam.name}
            className="absolute inset-0 w-full h-full object-contain pointer-events-none select-none z-0"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-video text-video-ink/70 text-ui pointer-events-none select-none z-0">
            No live feed for {cam.id}
          </div>
        )}

        <svg
          viewBox={`0 0 1000 ${svgH}`}
          preserveAspectRatio="xMidYMid meet"
          onClick={handleSvgClick}
          onDoubleClick={handleSvgDoubleClick}
          onContextMenu={handleSvgContextMenu}
          onWheel={handleWheel}
          onMouseMove={handleSvgMouseMove}
          className="absolute inset-0 w-full h-full pointer-events-auto z-10"
        >
          {/* Polygon fill */}
          {points.length >= 2 && (isLine ? (
            <polyline
              points={polyPointsString}
              fill="none"
              stroke={DRAW}
              strokeWidth="2"
            />
          ) : (
            <polygon
              points={polyPointsString}
              fill={RED_FILL}
              stroke={DRAW}
              strokeWidth="2"
              strokeDasharray={isPlotting ? "6 3" : undefined}
              onPointerDown={handlePolygonPointerDown}
              style={{ cursor: isPlotting ? "crosshair" : isDragging ? "grabbing" : "grab" }}
            >
              <title>Drag to move the restricted zone · scroll to resize · drag a vertex to reshape</title>
            </polygon>
          ))}

          {/* Live rubber-band guideline while plotting */}
          {isPlotting && points.length > 0 && cursorCoords && (
            <g className="pointer-events-none">
              <line
                x1={toSvgX(points[points.length - 1][0])}
                y1={toSvgY(points[points.length - 1][1])}
                x2={toSvgX(cursorCoords[0])}
                y2={toSvgY(cursorCoords[1])}
                stroke={DRAW}
                strokeWidth="1.5"
              />
              {!isLine && points.length >= 2 && (
                <line
                  x1={toSvgX(cursorCoords[0])}
                  y1={toSvgY(cursorCoords[1])}
                  x2={toSvgX(points[0][0])}
                  y2={toSvgY(points[0][1])}
                  stroke="rgba(255, 107, 100, 0.55)"
                  strokeWidth="1.5"
                  strokeDasharray="4 4"
                />
              )}
              <circle
                cx={toSvgX(cursorCoords[0])}
                cy={toSvgY(cursorCoords[1])}
                r="6"
                fill="none"
                stroke={DRAW}
                strokeWidth="1.5"
              />
              <circle
                cx={toSvgX(cursorCoords[0])}
                cy={toSvgY(cursorCoords[1])}
                r="1.5"
                fill={INK}
              />
            </g>
          )}

          {/* Segment connector lines */}
          {points.map((p, i) => {
            const nextP = isLine ? points[i + 1] : points[(i + 1) % points.length];
            if (!nextP) return null;
            return (
              <line
                key={`line-${i}`}
                x1={toSvgX(p[0])}
                y1={toSvgY(p[1])}
                x2={toSvgX(nextP[0])}
                y2={toSvgY(nextP[1])}
                stroke={DRAW}
                strokeWidth="1.5"
              />
            );
          })}

          {/* Closing target: click the first vertex to close the polygon */}
          {isPlotting && !isLine && points.length >= 3 && (
            <circle
              cx={toSvgX(points[0][0])}
              cy={toSvgY(points[0][1])}
              r="16"
              fill="rgba(143, 220, 172, 0.16)"
              stroke="#8fdcac"
              strokeWidth="2"
              strokeDasharray="4 3"
              className="pointer-events-none"
            />
          )}

          {/* Draggable vertex handles */}
          {points.map((p, idx) => {
            const sx = toSvgX(p[0]);
            const sy = toSvgY(p[1]);
            const isSelected = selectedIdx === idx;
            const isThisDragging = dragIdx === idx;
            const isHovered = hoveredIdx === idx;
            const showDetails = isThisDragging || isSelected || isHovered;
            const c = nodeColor(isThisDragging, isSelected);

            return (
              <g
                key={`node-${idx}`}
                transform={`translate(${sx}, ${sy})`}
                onPointerDown={e => !isPlotting && handlePointerDown(idx, e)}
                style={isPlotting ? { pointerEvents: "none" } : undefined}
                onContextMenu={e => e.preventDefault()}
                onMouseEnter={() => setHoveredIdx(idx)}
                onMouseLeave={() => setHoveredIdx(null)}
                className="cursor-move group"
              >
                {/* Handle */}
                <circle
                  r={isThisDragging ? 8 : isSelected ? 7 : 6}
                  fill={isThisDragging ? "#e67e22" : NODE_BG}
                  stroke={c}
                  strokeWidth="2"
                />
                <circle r="2" fill={INK} />

                {/* Node number */}
                <g transform="translate(0, -13)" className="pointer-events-none">
                  <rect x="-10" y="-7" width="20" height="14" rx="3" fill={NODE_BG} />
                  <text x="0" y="3.5" textAnchor="middle" fill={c} fontSize="10" fontFamily="ui-monospace, monospace" fontWeight="600">
                    {String(idx + 1).padStart(2, "0")}
                  </text>
                </g>

                {/* Coordinate readout (hover / drag only) */}
                {showDetails && (
                  <g transform="translate(14, -14)" className="pointer-events-none">
                    <rect x="0" y="0" width={isThisDragging ? 96 : 80} height="18" rx="3" fill={NODE_BG} />
                    <text x="6" y="12.5" fill={isThisDragging ? "#f2a65a" : INK} fontSize="10.5" fontFamily="ui-monospace, monospace" fontWeight="600">
                      {isThisDragging
                        ? `[${Math.round(p[0])}, ${Math.round(p[1])}] ◄`
                        : `[${Math.round(p[0])}, ${Math.round(p[1])}]`}
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {/* Status bar below the video (never overlaps the editable area) */}
      <footer className="h-7 px-4 bg-surface border-t border-line flex items-center justify-between shrink-0 z-30 text-caption text-ink-2">
        <div className="flex items-center gap-2 min-w-0">
          <StatusDot tone="ok" />
          <span className="truncate">
            {isPlotting
              ? "Click to add points · double-click, right-click or Enter to finish · Backspace undoes · Esc cancels"
              : isLine
                ? "Drag a handle to move it · Save to apply · Esc / Cancel to go back"
                : "Drag a vertex to reshape · drag inside the zone to move · scroll or −/+ to resize · Esc / Cancel to go back"}
          </span>
        </div>

        <div className="flex items-center gap-4 shrink-0 pl-3 font-data text-data">
          <span>{origW}×{origH} px</span>
          <span>{points.length} nodes</span>
        </div>
      </footer>

      {/* Raw YAML / coordinates dialog */}
      <Modal
        open={showYamlModal}
        onClose={() => setShowYamlModal(false)}
        title="Coordinate configuration"
        description={<>Inspect or paste coordinates directly into <code className="font-data text-data text-accent-ink">backend/configs/pipeline.yaml</code></>}
        size="md"
        footer={
          <>
            <Button
              onClick={() => {
                navigator.clipboard.writeText(yamlText);
              }}
              className="mr-auto"
            >
              <Icon name="content_copy" size={15} />
              Copy to clipboard
            </Button>
            <Button variant="ghost" onClick={() => setShowYamlModal(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={applyYamlText}>
              Apply coordinates
            </Button>
          </>
        }
      >
        <textarea
          value={yamlText}
          onChange={e => setYamlText(e.target.value)}
          rows={9}
          className={`${textareaClass} w-full font-data text-data`}
        />
      </Modal>
    </div>
  );
}
