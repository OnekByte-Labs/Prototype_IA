"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import type { Camera } from "@/lib/gotham/model";

interface ZoneCalibratorProps {
  cam: Camera;
  onClose: () => void;
  onSave: (points: number[][]) => Promise<boolean>;
}

export function ZoneCalibrator({ cam, onClose, onSave }: ZoneCalibratorProps) {
  const isLine = cam.analytics?.type === "traffic_count";
  const initialPoints: number[][] = isLine
    ? cam.analytics?.line || [[20, 1700], [1920, 1200], [3820, 1400]]
    : cam.analytics?.zone || [[0, 80], [780, 80], [670, 650], [380, 830], [0, 750]];

  const [points, setPoints] = useState<number[][]>(() => initialPoints.map(p => [...p]));
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [showYamlModal, setShowYamlModal] = useState<boolean>(false);
  const [yamlText, setYamlText] = useState<string>("");
  const [saving, setSaving] = useState<boolean>(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const justDraggedRef = useRef<boolean>(false);
  const isDraggingRef = useRef<boolean>(false);
  const dragIdxRef = useRef<number | null>(null);

  const resParts = cam.resolution ? cam.resolution.split("×") : ["1920", "1080"];
  const origW = parseInt(resParts[0], 10) || 1920;
  const origH = parseInt(resParts[1], 10) || 1080;

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

  const toSvgX = (x: number) => (x / origW) * 1000;
  const toSvgY = (y: number) => (y / origH) * 562.5;

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

  const handleSvgClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    if (isDraggingRef.current || justDraggedRef.current) return;
    const coords = clientToNative(e.clientX, e.clientY);
    if (!coords) return;

    setPoints(prev => [...prev, coords]);
    setSelectedIdx(points.length);
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
  };

  const handleSave = async () => {
    setSaving(true);
    const ok = await onSave(points);
    setSaving(false);
    if (ok) {
      onClose();
    }
  };

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

  return (
    <div
      onClick={e => e.stopPropagation()}
      onContextMenu={e => e.preventDefault()}
      className="absolute inset-0 z-40 flex flex-col bg-black/40 select-none pointer-events-auto font-sans"
    >
      {/* Sleek Tactical Header Toolbar */}
      <header className="h-9 px-3 bg-g-bg/95 border-b border-g-border flex items-center justify-between shrink-0 z-50 backdrop-blur-md">
        <div className="flex items-center gap-2.5">
          <div className="flex items-center justify-center w-5 h-5 rounded-[2px] bg-g-blue/15 text-g-blue border border-g-blue/30">
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="22" y1="12" x2="18" y2="12" />
              <line x1="6" y1="12" x2="2" y2="12" />
              <line x1="12" y1="6" x2="12" y2="2" />
              <line x1="12" y1="22" x2="12" y2="18" />
            </svg>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-g-text">
              {isLine ? "TRAFFIC LINE" : "INTRUSION PERIMETER"}
            </span>
            <span className="text-[10px] font-mono text-g-blue font-bold">
              {cam.id}
            </span>
          </div>

          <span className="text-[9px] px-1.5 py-0.5 rounded-[2px] bg-g-panel border border-g-border text-g-muted font-mono tracking-wider">
            {points.length} {isLine ? "POINTS" : "VERTICES"}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {selectedIdx !== null && points.length > (isLine ? 2 : 3) && (
            <button
              type="button"
              onClick={removeSelected}
              className="h-6 px-2 rounded-[2px] bg-red-950/40 border border-red-500/40 text-red-400 hover:bg-red-900/40 flex items-center gap-1 text-[10px] font-mono transition-colors"
            >
              <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
              DEL P{selectedIdx + 1}
            </button>
          )}

          <button
            type="button"
            onClick={openYamlModal}
            title="Inspect / Edit Raw YAML coordinates"
            className="h-6 px-2 rounded-[2px] bg-g-panel border border-g-border text-g-text-2 hover:text-g-text hover:border-g-blue/50 flex items-center gap-1 text-[10px] font-mono tracking-wider transition-colors"
          >
            <svg className="w-2.5 h-2.5 text-g-blue" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="16 18 22 12 16 6" />
              <polyline points="8 6 2 12 8 18" />
            </svg>
            YAML
          </button>

          <button
            type="button"
            onClick={resetDefault}
            title="Reset to default perimeter"
            className="h-6 px-2 rounded-[2px] bg-g-panel border border-g-border text-g-muted hover:text-g-text hover:border-g-border-strong flex items-center gap-1 text-[10px] font-mono tracking-wider transition-colors"
          >
            <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
            </svg>
            RESET
          </button>

          <div className="w-[1px] h-3.5 bg-g-border mx-1" />

          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="h-6 px-2.5 rounded-[2px] bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/50 text-emerald-400 font-mono text-[10px] font-bold tracking-wider flex items-center gap-1 transition-colors"
          >
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            {saving ? "SAVING..." : "SAVE PERIMETER"}
          </button>

          <button
            type="button"
            onClick={onClose}
            className="h-6 w-6 rounded-[2px] bg-g-panel border border-g-border text-g-muted hover:text-g-text hover:border-g-border-strong flex items-center justify-center transition-colors"
            title="Exit Calibrator"
          >
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </header>

      {/* Main Interactive Canvas Area */}
      <div
        ref={containerRef}
        className="flex-1 relative overflow-hidden cursor-crosshair"
      >
        <svg
          viewBox="0 0 1000 562.5"
          preserveAspectRatio="xMidYMid meet"
          onClick={handleSvgClick}
          className="absolute inset-0 w-full h-full pointer-events-auto"
        >
          <defs>
            <radialGradient id="tacticalActiveGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.7" />
              <stop offset="100%" stopColor="#f59e0b" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="tacticalSelectGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.6" />
              <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* Polygon Fill */}
          {isLine ? (
            <polyline
              points={polyPointsString}
              fill="none"
              stroke="#00c8ff"
              strokeWidth="2.5"
              strokeDasharray="8 5"
            />
          ) : (
            <polygon
              points={polyPointsString}
              fill="rgba(34, 197, 94, 0.12)"
              stroke="rgba(34, 197, 94, 0.85)"
              strokeWidth="2"
              strokeDasharray="6 3"
            />
          )}

          {/* Segment Connector Lines */}
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
                stroke={isLine ? "#00c8ff" : "rgba(34, 197, 94, 0.9)"}
                strokeWidth="1.5"
              />
            );
          })}

          {/* Draggable Vertex Handles */}
          {points.map((p, idx) => {
            const sx = toSvgX(p[0]);
            const sy = toSvgY(p[1]);
            const isSelected = selectedIdx === idx;
            const isThisDragging = dragIdx === idx;
            const isHovered = hoveredIdx === idx;
            const showDetails = isThisDragging || isSelected || isHovered;

            return (
              <g
                key={`node-${idx}`}
                transform={`translate(${sx}, ${sy})`}
                onPointerDown={e => handlePointerDown(idx, e)}
                onMouseDown={e => handlePointerDown(idx, e)}
                onContextMenu={e => e.preventDefault()}
                onMouseEnter={() => setHoveredIdx(idx)}
                onMouseLeave={() => setHoveredIdx(null)}
                className="cursor-move group"
              >
                {/* Glow ring when active */}
                {showDetails && (
                  <circle
                    r={isThisDragging ? 18 : 14}
                    fill={isThisDragging ? "url(#tacticalActiveGlow)" : "url(#tacticalSelectGlow)"}
                  />
                )}

                {/* Outer Reticle Ring */}
                <circle
                  r={isThisDragging ? 7 : isSelected ? 6 : 5}
                  fill={isThisDragging ? "#f59e0b" : isSelected ? "#38bdf8" : "rgba(10, 15, 25, 0.9)"}
                  stroke={isThisDragging ? "#fbbf24" : isSelected ? "#38bdf8" : "#22c55e"}
                  strokeWidth="1.5"
                />

                {/* Center target pip */}
                <circle
                  r="2"
                  fill="#ffffff"
                />

                {/* Tactical Node Badge (e.g. 01, 02) */}
                <g transform="translate(0, -11)" className="pointer-events-none">
                  <rect
                    x="-9"
                    y="-6"
                    width="18"
                    height="12"
                    rx="1.5"
                    fill="rgba(5, 10, 18, 0.92)"
                    stroke={isThisDragging ? "#f59e0b" : isSelected ? "#38bdf8" : "rgba(34, 197, 94, 0.7)"}
                    strokeWidth="0.75"
                  />
                  <text
                    x="0"
                    y="3"
                    textAnchor="middle"
                    fill={isThisDragging ? "#f59e0b" : isSelected ? "#38bdf8" : "#22c55e"}
                    fontSize="8.5"
                    fontFamily="monospace"
                    fontWeight="bold"
                  >
                    {String(idx + 1).padStart(2, "0")}
                  </text>
                </g>

                {/* Floating Precision Coordinate Pill (Only on Hover or Drag) */}
                {showDetails && (
                  <g transform="translate(14, -14)" className="pointer-events-none">
                    <rect
                      x="0"
                      y="0"
                      width={isThisDragging ? 90 : 75}
                      height="16"
                      rx="2"
                      fill="rgba(5, 10, 18, 0.95)"
                      stroke={isThisDragging ? "#f59e0b" : "#38bdf8"}
                      strokeWidth="1"
                    />
                    <text
                      x="5"
                      y="11.5"
                      fill={isThisDragging ? "#f59e0b" : "#38bdf8"}
                      fontSize="9"
                      fontFamily="monospace"
                      fontWeight="bold"
                      letterSpacing="0.5"
                    >
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

        {/* Integrated Tactical Status Bar at Bottom */}
        <footer className="h-6 px-3 bg-g-bg/95 border-t border-g-border flex items-center justify-between shrink-0 absolute bottom-0 left-0 right-0 z-30 font-mono text-[9.5px] text-g-muted">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span className="text-g-text-2">
              HOLD RIGHT-CLICK OR LEFT-CLICK ON ANY HANDLE TO REPOSITION · RELEASE TO SET
            </span>
          </div>

          <div className="flex items-center gap-3">
            <span>RES: {origW}×{origH} PX</span>
            <span>TOTAL: {points.length} NODES</span>
          </div>
        </footer>
      </div>

      {/* Raw YAML / Coords Modal */}
      {showYamlModal && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg bg-g-panel border border-g-border rounded-[4px] shadow-2xl flex flex-col p-4 gap-3">
            <div className="flex items-center justify-between border-b border-g-border pb-2">
              <span className="text-[11px] font-bold uppercase text-g-text flex items-center gap-2 tracking-wider">
                <svg className="w-3.5 h-3.5 text-g-blue" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="16 18 22 12 16 6" />
                  <polyline points="8 6 2 12 8 18" />
                </svg>
                pipeline.yaml Coordinate Configuration
              </span>
              <button
                type="button"
                onClick={() => setShowYamlModal(false)}
                className="text-g-muted hover:text-g-text"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <p className="text-[11px] text-g-muted">
              Inspect or paste coordinates directly into{" "}
              <code className="text-g-blue">backend/configs/pipeline.yaml</code>:
            </p>

            <textarea
              value={yamlText}
              onChange={e => setYamlText(e.target.value)}
              rows={8}
              className="w-full bg-black/90 border border-g-border rounded-[2px] p-2 text-xs font-mono text-emerald-400 focus:outline-hidden focus:border-g-blue"
            />

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(yamlText);
                }}
                className="text-[10px] font-mono px-2.5 py-1 rounded-[2px] bg-g-bg border border-g-border text-g-text hover:border-g-blue flex items-center gap-1 transition-colors"
              >
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
                COPY TO CLIPBOARD
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowYamlModal(false)}
                  className="text-[10px] font-mono px-3 py-1 rounded-[2px] bg-g-bg border border-g-border text-g-muted hover:text-g-text transition-colors"
                >
                  CANCEL
                </button>
                <button
                  type="button"
                  onClick={applyYamlText}
                  className="text-[10px] font-mono px-3 py-1 rounded-[2px] bg-g-blue hover:bg-g-blue/90 text-white font-bold transition-colors"
                >
                  APPLY COORDS
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
