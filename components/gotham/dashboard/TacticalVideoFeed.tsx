"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import {
  DATASET_ANNOTATION_PRESETS,
  DATASET_CATALOG,
  type BoundingBox,
  type TacticalCamera,
} from "@/lib/datasets/dataset-definitions";

interface TacticalVideoFeedProps {
  camera: TacticalCamera;
  clock: string;
  focused?: boolean;
  showAiBoxes?: boolean;
  thermalOverride?: boolean;
  isBreached?: boolean;
  onClick?: () => void;
}

export function TacticalVideoFeed({
  camera,
  clock,
  focused = false,
  showAiBoxes = true,
  thermalOverride = false,
  isBreached = false,
  onClick,
}: TacticalVideoFeedProps) {
  const dataset = DATASET_CATALOG[camera.dataset] || DATASET_CATALOG.VIRAT;
  const initialBoxes = DATASET_ANNOTATION_PRESETS[camera.dataset] || [];

  const [boxes, setBoxes] = useState<BoundingBox[]>(initialBoxes);
  const [userThermalToggle, setUserThermalToggle] = useState<boolean | null>(null);
  const [showHud, setShowHud] = useState(true);

  // Derived thermal state: user toggle takes precedence, then global override, then default LLVIP
  const thermalMode = userThermalToggle ?? (thermalOverride || camera.dataset === "LLVIP");
  const isBreachedLocal = isBreached || boxes.some((b) => b.isBreach);

  // Subtle procedural jitter to simulate live tracking vectors
  useEffect(() => {
    if (!camera.online) return;
    const interval = setInterval(() => {
      setBoxes((prev) =>
        prev.map((b) => ({
          ...b,
          x: Math.max(5, Math.min(85, b.x + (Math.random() * 1.2 - 0.6))),
          y: Math.max(10, Math.min(80, b.y + (Math.random() * 1.0 - 0.5))),
          confidence: Math.round((b.confidence + (Math.random() * 0.4 - 0.2)) * 10) / 10,
        })),
      );
    }, 1200);
    return () => clearInterval(interval);
  }, [camera.online]);

  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Canvas visual rendering for realistic tactical sensor noise & crosshairs
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !camera.online) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animFrame: number;
    let t = 0;

    const render = () => {
      t += 0.05;
      const w = canvas.width;
      const h = canvas.height;

      ctx.clearRect(0, 0, w, h);

      if (thermalMode) {
        // Thermal IR palette (Ironbow / Indigo gradient with heat signatures)
        const grad = ctx.createLinearGradient(0, 0, w, h);
        grad.addColorStop(0, "#08041c");
        grad.addColorStop(0.5, "#25093f");
        grad.addColorStop(1, "#0a1b24");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);

        // Heat signatures
        ctx.fillStyle = "rgba(255, 180, 50, 0.45)";
        ctx.beginPath();
        ctx.ellipse(w * 0.45, h * 0.45, 45, 70, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "rgba(255, 60, 20, 0.6)";
        ctx.beginPath();
        ctx.ellipse(w * 0.45, h * 0.42, 25, 40, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "rgba(255, 240, 200, 0.85)";
        ctx.beginPath();
        ctx.ellipse(w * 0.45, h * 0.38, 12, 18, 0, 0, Math.PI * 2);
        ctx.fill();
      } else if (camera.dataset === "VISDRONE") {
        // Drone overhead background (aerial grid)
        ctx.fillStyle = "#0c151c";
        ctx.fillRect(0, 0, w, h);

        ctx.strokeStyle = "rgba(45, 140, 180, 0.15)";
        ctx.lineWidth = 1;
        const step = 40;
        for (let x = 0; x < w; x += step) {
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, h);
          ctx.stroke();
        }
        for (let y = 0; y < h; y += step) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(w, y);
          ctx.stroke();
        }

        // UAV Center Reticle
        ctx.strokeStyle = "rgba(74, 222, 128, 0.6)";
        ctx.lineWidth = 1.5;
        const cx = w / 2;
        const cy = h / 2;
        ctx.strokeRect(cx - 18, cy - 18, 36, 36);
        ctx.beginPath();
        ctx.moveTo(cx - 28, cy);
        ctx.lineTo(cx - 18, cy);
        ctx.moveTo(cx + 18, cy);
        ctx.lineTo(cx + 28, cy);
        ctx.moveTo(cx, cy - 28);
        ctx.lineTo(cx, cy - 18);
        ctx.moveTo(cx, cy + 18);
        ctx.lineTo(cx, cy + 28);
        ctx.stroke();
      } else {
        // Standard Outdoor Tactical Feed (Deep surveillance charcoal with scanline)
        ctx.fillStyle = "#070c0e";
        ctx.fillRect(0, 0, w, h);

        // Ground / horizon line
        ctx.strokeStyle = "rgba(60, 90, 80, 0.25)";
        ctx.beginPath();
        ctx.moveTo(0, h * 0.48);
        ctx.lineTo(w, h * 0.48);
        ctx.stroke();

        // Subtle moving scanline
        const scanY = (Math.sin(t) * 0.5 + 0.5) * h;
        ctx.strokeStyle = "rgba(100, 220, 180, 0.08)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, scanY);
        ctx.lineTo(w, scanY);
        ctx.stroke();
      }

      // Perimeter Tripwire representation for Border Threat cameras
      if (camera.dataset === "BORDER_THREAT") {
        ctx.strokeStyle = isBreachedLocal
          ? "rgba(239, 68, 68, 0.85)"
          : "rgba(6, 182, 212, 0.55)";
        ctx.lineWidth = isBreachedLocal ? 3 : 1.5;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(0, h * 0.72);
        ctx.lineTo(w, h * 0.68);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      animFrame = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(animFrame);
  }, [camera.online, camera.dataset, thermalMode, isBreachedLocal]);

  return (
    <div
      onClick={onClick}
      className={`relative w-full h-full bg-[#05090b] select-none overflow-hidden flex flex-col justify-between ${
        onClick ? "cursor-pointer" : ""
      } ${
        isBreachedLocal
          ? "ring-2 ring-red-500/80 shadow-[inset_0_0_20px_rgba(239,68,68,0.4)]"
          : ""
      }`}
    >
      {/* Background Simulation Canvas */}
      {camera.online ? (
        <canvas
          ref={canvasRef}
          width={focused ? 720 : 360}
          height={focused ? 440 : 220}
          className="absolute inset-0 w-full h-full object-cover pointer-events-none"
        />
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#06080a] text-g-red">
          <Icon name="videocam_off" size={focused ? 48 : 24} />
          <span className="text-micro font-mono tracking-wider mt-1 uppercase text-g-red/80">
            NO CARRIER · RTSP LOSS
          </span>
          <span className="text-[10px] text-g-muted font-mono">{camera.rtspUri}</span>
        </div>
      )}

      {/* Sensor Noise Scanlines */}
      <div className="absolute inset-0 pointer-events-none opacity-20 bg-[radial-gradient(#ffffff_1px,transparent_1px)] [background-size:16px_16px]" />

      {/* AI Bounding Boxes Layer */}
      {camera.online && showAiBoxes && (
        <div className="absolute inset-0 pointer-events-none z-10">
          {boxes.map((b) => {
            const isAlert = b.isBreach || b.category === "threat";
            const borderCol = isAlert
              ? "border-red-500 bg-red-500/10 text-red-400"
              : b.category === "plate"
                ? "border-amber-400 bg-amber-400/10 text-amber-300"
                : b.category === "vehicle"
                  ? "border-purple-400 bg-purple-400/10 text-purple-300"
                  : "border-cyan-400 bg-cyan-400/10 text-cyan-300";

            return (
              <div
                key={b.id}
                style={{
                  left: `${b.x}%`,
                  top: `${b.y}%`,
                  width: `${b.w}%`,
                  height: `${b.h}%`,
                }}
                className={`absolute border transition-all duration-300 flex flex-col justify-between ${borderCol} ${
                  isAlert ? "animate-pulse" : ""
                }`}
              >
                {/* Corner Bracket styling */}
                <div className="flex justify-between w-full">
                  <span className="w-1.5 h-1.5 border-t-2 border-l-2 border-current" />
                  <span className="w-1.5 h-1.5 border-t-2 border-r-2 border-current" />
                </div>

                {/* AI Label & Confidence */}
                <div className="bg-black/80 px-1 py-0.5 text-[9px] font-mono leading-tight tracking-tight border-b border-current truncate self-start max-w-full">
                  {b.label}
                  {b.trackId && <span className="opacity-75 ml-1">#{b.trackId}</span>}
                  <span className="font-semibold ml-1">{b.confidence}%</span>
                </div>

                <div className="flex justify-between w-full">
                  <span className="w-1.5 h-1.5 border-b-2 border-l-2 border-current" />
                  <span className="w-1.5 h-1.5 border-b-2 border-r-2 border-current" />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Tactical Top Bar */}
      <div className="relative z-20 flex items-center justify-between p-1.5 bg-gradient-to-b from-black/85 via-black/40 to-transparent">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[10px] font-mono font-bold text-g-text uppercase truncate">
            {camera.id} · {camera.name}
          </span>
          {camera.isFixed && (
            <span
              title="Fixed Core Surveillance Post"
              className="text-[8px] font-mono px-1 py-0.2 bg-blue-900/60 border border-blue-500/50 text-blue-300 rounded-[2px]"
            >
              PINNED
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {/* Dataset Badge */}
          <span
            className="text-[9px] font-mono px-1 py-0.5 rounded-[2px] bg-white/10 border border-white/20 text-white/90"
            title={`Source: ${dataset.name} (${dataset.provider})`}
          >
            {camera.dataset}
          </span>

          {/* Rec Status */}
          {camera.online && camera.recording && (
            <span className="flex items-center gap-1 text-[9px] font-mono text-red-400">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-ping" />
              REC
            </span>
          )}
        </div>
      </div>

      {/* Tactical Bottom Bar */}
      <div className="relative z-20 flex items-center justify-between p-1.5 bg-gradient-to-t from-black/90 via-black/50 to-transparent">
        <div className="flex items-center gap-2 text-[9px] font-mono text-g-muted">
          <span>{camera.zone}</span>
          <span className="opacity-50">|</span>
          <span>{dataset.inferenceModel}</span>
        </div>

        <div className="flex items-center gap-2 text-[9px] font-mono text-g-text-2">
          {thermalMode && (
            <span className="text-amber-400 bg-amber-950/60 px-1 rounded-[2px] border border-amber-600/40">
              IR THERMAL
            </span>
          )}
          <span className="text-emerald-400">{camera.online ? `${camera.fps} FPS` : "--"}</span>
          <span className="text-white/80">{camera.online ? clock : "--:--:--"}</span>
        </div>
      </div>

      {/* Interactive Controls Overlay for Focused Mode */}
      {focused && (
        <div className="absolute top-8 right-2 z-30 flex flex-col gap-1 bg-black/85 p-1 rounded border border-white/10 text-micro">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setUserThermalToggle(!thermalMode);
            }}
            className={`px-2 py-1 text-left flex items-center gap-1 rounded ${
              thermalMode ? "bg-amber-600 text-black font-semibold" : "text-white/80 hover:bg-white/10"
            }`}
          >
            <Icon name="thermostat" size={12} />
            {thermalMode ? "Thermal ON" : "Thermal OFF"}
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setShowHud(!showHud);
            }}
            className="px-2 py-1 text-left flex items-center gap-1 text-white/80 hover:bg-white/10 rounded"
          >
            <Icon name="layers" size={12} />
            {showHud ? "HUD Display" : "Raw Feed"}
          </button>
        </div>
      )}
    </div>
  );
}
