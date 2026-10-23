"use client";

import { useEffect, useRef, useState } from "react";
import type { DetectionMode } from "../ConsoleProvider";

interface Detection {
  id: number;
  class: string;
  confidence: number;
  x: number;
  y: number;
  w: number;
  h: number;
  plate?: string;
  model?: string;
}

interface FrameData {
  frame_id: number;
  video_time_sec: number;
  timestamp: string;
  detections: Detection[];
}

// In-memory cache for telemetry frames
const frameCache = new Map<string, FrameData[]>();

export function DatasetVideoPlayer({
  cameraId,
  mode = "both",
  showAiBoxes = true,
  labels = true,
  onDetections,
}: {
  cameraId: string;
  mode?: DetectionMode;
  showAiBoxes?: boolean;
  labels?: boolean;
  onDetections?: (detections: Detection[]) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [frames, setFrames] = useState<FrameData[]>([]);
  const lastDetectionsRef = useRef<string>("");
  const onDetectionsCb = useRef(onDetections);

  useEffect(() => {
    onDetectionsCb.current = onDetections;
  }, [onDetections]);

  const cleanId = cameraId.toLowerCase().replace("cam-", "cam_").replace(/[^a-z0-9_]/g, "");

  // Load telemetry data once per camera ID
  useEffect(() => {
    if (frameCache.has(cleanId)) {
      setFrames(frameCache.get(cleanId)!);
      return;
    }

    let active = true;
    fetch(`/api/precomputed/${cleanId}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data: FrameData[]) => {
        if (!active) return;
        if (Array.isArray(data) && data.length > 0) {
          frameCache.set(cleanId, data);
          setFrames(data);
        }
      })
      .catch(() => {
        // Fallback: silent ignore
      });

    return () => {
      active = false;
    };
  }, [cleanId]);

  // Canvas drawing loop synchronized with video.currentTime
  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId = 0;
    let lastReportTime = 0;

    const render = () => {
      animId = requestAnimationFrame(render);

      const dpr = window.devicePixelRatio || 1;
      const cw = canvas.clientWidth;
      const ch = canvas.clientHeight;
      if (cw === 0 || ch === 0) return;

      const targetW = Math.round(cw * dpr);
      const targetH = Math.round(ch * dpr);
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cw, ch);

      // Do not draw if AI boxes are toggled off, mode is explicitly 'none', or no frames loaded
      if (!showAiBoxes || mode === "none" || frames.length === 0) {
        return;
      }

      // Calculate exact frame index from current playback time at 25 fps
      const curTime = video.currentTime || 0;
      const frameIdx = Math.max(0, Math.min(frames.length - 1, Math.floor(curTime * 25) % frames.length));
      const frame = frames[frameIdx];
      if (!frame || !Array.isArray(frame.detections)) return;

      // Filter detections by threshold (0.35)
      const validDetections = frame.detections.filter((d) => (d.confidence ?? 1) >= 0.35);

      // Report detections to parent (e.g. focused inspector) at ~4-5 Hz
      const now = performance.now();
      if (now - lastReportTime > 200) {
        lastReportTime = now;
        const serialized = JSON.stringify(validDetections);
        if (serialized !== lastDetectionsRef.current) {
          lastDetectionsRef.current = serialized;
          onDetectionsCb.current?.(validDetections);
        }
      }

      // Accurate video aspect ratio
      const vw = video.videoWidth || (cleanId === "cam_02" || cleanId === "cam_03" ? 3840 : cleanId === "cam_01" ? 1280 : 1920);
      const vh = video.videoHeight || (cleanId === "cam_02" || cleanId === "cam_03" ? 2160 : cleanId === "cam_01" ? 720 : 1080);
      const s = Math.min(cw / vw, ch / vh);
      const ox = (cw - vw * s) / 2;
      const oy = (ch - vh * s) / 2;

      for (const d of validDetections) {
        // Enforce user rule: replace mini truck with truck, and capitalize category
        const rawCls = (d.class || "car").toLowerCase();
        let vType = "Car";
        if (rawCls.includes("truck")) vType = "Truck";
        else if (rawCls.includes("taxi")) vType = "Taxi";
        else if (rawCls.includes("auto")) vType = "Auto";
        else if (rawCls.includes("bus")) vType = "Bus";
        else if (rawCls.includes("motorcycle") || rawCls.includes("bike")) vType = "Motorcycle";
        else if (rawCls.includes("scoot")) vType = "Scooty";

        // Accurate color palette matching the reference image:
        // Bus = Purple, Truck = Blue, Taxi/Auto = Yellow, Bike = Cyan, Car = Lime Green
        let boxColor = "#22c55e"; // Green for Car (like #2657 Car in image)
        if (vType === "Truck") boxColor = "#2563eb"; // Blue for Truck (like #2730 Mini Truck in image)
        else if (vType === "Taxi" || vType === "Auto") boxColor = "#eab308"; // Yellow for Taxi/Auto (like #2507 Taxi in image)
        else if (vType === "Bus") boxColor = "#a855f7"; // Purple for Bus (like #2465 Bus in image)
        else if (vType === "Motorcycle" || vType === "Scooty") boxColor = "#06b6d4"; // Cyan for Bike

        const modelName = d.model ? d.model.trim() : "";
        let labelText = "";

        if (mode === "anpr") {
          // Rule: If ANPR, fetch number plate
          if (!d.plate) continue;
          labelText = `Plate : ${d.plate}`;
          boxColor = "#eab308";
        } else if (mode === "vehicle" || mode === "vehicle_counting") {
          // Rule: If vehicle, fetch vehicle type and model (NO #numbers)
          labelText = modelName ? `${vType} : ${modelName}` : vType;
        } else {
          // Rule: If both ANPR and Vehicle are selected, show original annotations (NO #numbers)
          let base = modelName ? `${vType} : ${modelName}` : vType;
          if (d.plate) {
            base += ` | ${d.plate}`;
            boxColor = "#eab308"; // Highlight plate
          }
          labelText = base;
        }

        const bx = ox + d.x * s;
        const by = oy + d.y * s;
        const bw = Math.max(6, d.w * s);
        const bh = Math.max(6, d.h * s);

        // Bounding box border
        ctx.strokeStyle = boxColor;
        ctx.lineWidth = 2.0;
        ctx.strokeRect(bx, by, bw, bh);

        // Label badge: solid black box with colored border and white text (NO #numbers)
        if (labels && labelText) {
          ctx.font = "bold 11px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
          const tw = ctx.measureText(labelText).width + 10;
          const labelH = 18;
          // Place label on the top border; if near top edge, place inside box
          const labelY = by >= labelH ? by - labelH : by;

          // Solid black badge background
          ctx.fillStyle = "#000000";
          ctx.fillRect(bx, labelY, tw, labelH);

          // Matching 1.2px border around badge
          ctx.strokeStyle = boxColor;
          ctx.lineWidth = 1.2;
          ctx.strokeRect(bx, labelY, tw, labelH);

          // Pure white text inside badge
          ctx.fillStyle = "#ffffff";
          ctx.fillText(labelText, bx + 5, labelY + 13);
        }
      }
    };

    animId = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(animId);
    };
  }, [frames, mode, showAiBoxes, labels, cleanId]);

  return (
    <div className="absolute inset-0 w-full h-full bg-black overflow-hidden select-none">
      <video
        ref={videoRef}
        src={`/api/videos/${cleanId}`}
        autoPlay
        loop
        muted
        playsInline
        className="absolute inset-0 w-full h-full object-contain bg-black"
      />
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none z-[5]" />
    </div>
  );
}
