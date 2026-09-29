"use client";

import { useEffect, useState, useRef, useMemo, memo } from "react";
import Link from "next/link";
import Hls from "hls.js";
import { Icon } from "@/components/ui/Icon";
import { secondsOfDay, type Camera, type Alert, type AlertClass } from "@/lib/gotham/model";
import { useConsole } from "../ConsoleProvider";
import { useClock } from "../hooks";
import { MicroLabel, StatusDot } from "../primitives";

export interface FrameDetection {
  id: number | string;
  class?: string;
  confidence?: number;
  x: number;
  y: number;
  w: number;
  h: number;
  plate?: string;
}

export interface FrameEvent {
  type: string;
  stream_id?: string;
  frame_id: number;
  object_id?: number | string;
  total_count?: number;
  location?: [number, number];
  [key: string]: unknown;
}

export interface PrecomputedFrame {
  frame_id: number;
  video_time_sec?: number;
  timestamp?: string;
  detections?: FrameDetection[];
  events?: FrameEvent[];
}

const globalVideoTime = new Map<string, number>();
const globalPrecomputedCache = new Map<string, PrecomputedFrame[]>();

interface StreamTrackingState {
  crossedIds: Set<number | string>;
  count: number;
  recentCrossed: Map<number | string, number>;
  prevPositions: Map<number | string, { x: number; y: number; frame: number }>;
  lastTime: number;
}

function pointInPolygon(ptX: number, ptY: number, polygon: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1];
    const xj = polygon[j][0], yj = polygon[j][1];
    const intersect = ((yi > ptY) !== (yj > ptY)) &&
      (ptX < ((xj - xi) * (ptY - yi)) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function segmentsIntersect(
  p0_x: number, p0_y: number, p1_x: number, p1_y: number,
  p2_x: number, p2_y: number, p3_x: number, p3_y: number
): boolean {
  const s1_x = p1_x - p0_x;
  const s1_y = p1_y - p0_y;
  const s2_x = p3_x - p2_x;
  const s2_y = p3_y - p2_y;

  const denom = -s2_x * s1_y + s1_x * s2_y;
  if (Math.abs(denom) < 1e-6) return false;

  const s = (-s1_y * (p0_x - p2_x) + s1_x * (p0_y - p2_y)) / denom;
  const t = (s2_x * (p0_y - p2_y) - s2_y * (p0_x - p2_x)) / denom;

  return s >= 0 && s <= 1 && t >= 0 && t <= 1;
}

function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const l2 = (x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1);
  if (l2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1)));
}

function drawCameraOverlay(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  cam: Camera,
  frameData: PrecomputedFrame | null,
  addAlert: (alert: Alert) => void,
  alertedIdsRef: React.MutableRefObject<Set<string>>,
  trackingState: StreamTrackingState
) {
  const hasAnalytics = cam.analytics && cam.analytics.type && cam.analytics.type !== "none";
  if (!cam.aiEnabled && !hasAnalytics) return;

  const resParts = cam.resolution ? cam.resolution.split("×") : ["1920", "1080"];
  const origW = parseInt(resParts[0], 10) || 1920;
  const origH = parseInt(resParts[1], 10) || 1080;
  const scaleX = canvas.width / origW;
  const scaleY = canvas.height / origH;
  const currentFrameId = frameData?.frame_id ?? 0;

  // Sync live backend traffic count & intrusion events if present
  if (frameData?.events && Array.isArray(frameData.events)) {
    for (const ev of frameData.events) {
      if (ev.type === 'traffic_count') {
        if (typeof ev.total_count === 'number') {
          trackingState.count = Math.max(trackingState.count, ev.total_count);
        }
        if (ev.object_id !== undefined) {
          trackingState.crossedIds.add(ev.object_id);
          trackingState.recentCrossed.set(ev.object_id, currentFrameId);
        }
      }
    }
  }

  // 1. Process Tripwire Line Crossings (Active across ALL cameras with a tripwire line)
  if (cam.analytics?.type === 'traffic_count' && cam.analytics.line && cam.analytics.line.length >= 2) {
    const line = cam.analytics.line;

    if (frameData?.detections) {
      frameData.detections.forEach((box: FrameDetection) => {
        if ((box.confidence || 0) < 0.35) return;
        // Bounding box coordinates in frameData are ALREADY in native canvas pixel coordinates
        const bcx = box.x + box.w / 2;
        const bcy = box.y + box.h * 0.75;
        const prev = trackingState.prevPositions.get(box.id);

        if (prev) {
          let crossed = false;
          let near = false;

          // Check every line segment in the polyline
          for (let s = 0; s < line.length - 1; s++) {
            const p1x = line[s][0] * scaleX;
            const p1y = line[s][1] * scaleY;
            const p2x = line[s + 1][0] * scaleX;
            const p2y = line[s + 1][1] * scaleY;

            if (segmentsIntersect(prev.x, prev.y, bcx, bcy, p1x, p1y, p2x, p2y)) {
              crossed = true;
              break;
            }

            const maxNearDist = Math.max(12, Math.min(box.w, box.h) * 0.35);
            if (distToSegment(bcx, bcy, p1x, p1y, p2x, p2y) < maxNearDist) {
              near = true;
              break;
            }
          }

          if ((crossed || near) && !trackingState.crossedIds.has(box.id)) {
            trackingState.crossedIds.add(box.id);
            trackingState.count += 1;
            trackingState.recentCrossed.set(box.id, currentFrameId);
          }
        }

        trackingState.prevPositions.set(box.id, { x: bcx, y: bcy, frame: currentFrameId });
      });
    }
  }

  // 2. Process Intrusion Zone Breaches (Active across ALL cameras with a perimeter zone)
  let hasIntrusion = false;
  let intrudingBox: FrameDetection | null = null;

  if (cam.analytics?.type === 'intrusion_zone' && cam.analytics.zone && cam.analytics.zone.length >= 3) {
    const scaledZone = cam.analytics.zone.map((p: number[]) => [p[0] * scaleX, p[1] * scaleY]);

    if (frameData?.detections) {
      for (const box of frameData.detections) {
        if ((box.confidence || 0) < 0.35) continue;
        const bcx = box.x + box.w / 2;
        const bcy_ground = box.y + box.h * 0.85;
        const bcy_mid = box.y + box.h / 2;

        if (pointInPolygon(bcx, bcy_ground, scaledZone) || pointInPolygon(bcx, bcy_mid, scaledZone)) {
          hasIntrusion = true;
          intrudingBox = box;
          break;
        }
      }
    }

    if (!hasIntrusion && frameData?.events?.some((e: FrameEvent) => e.type === 'intrusion')) {
      hasIntrusion = true;
    }
  }

  // 3. Draw Bounding Boxes (if AI is enabled)
  const boxes = (cam.aiEnabled && frameData) ? frameData.detections : null;
  if (boxes) {
    boxes.forEach((box: FrameDetection) => {
      const objClass = box.class?.toLowerCase() || 'obj';
      const confidence = box.confidence || 0;

      const minConfidence = objClass === 'animal' ? 0.30 : 0.40;
      if (confidence < minConfidence) return;

      let x = box.x;
      let y = box.y;
      let w = box.w;
      let h = box.h;
      if (w < 0) { x += w; w = -w; }
      if (h < 0) { y += h; h = -h; }

      // Check if this object recently crossed the tripwire
      const isRecentlyCounted = Boolean(
        (trackingState.recentCrossed.has(box.id) &&
          Math.abs(currentFrameId - (trackingState.recentCrossed.get(box.id) ?? 0)) < 45) ||
        frameData?.events?.some(
          (e: FrameEvent) =>
            e.type === 'traffic_count' &&
            e.object_id === box.id &&
            (currentFrameId - e.frame_id) < 45 &&
            (currentFrameId - e.frame_id) >= 0
        )
      );

      // Check if this object is an active intruder
      const isIntruder = hasIntrusion && intrudingBox && intrudingBox.id === box.id;

      // Tactical UI Colors
      const isVehicle = ['car', 'truck', 'bus', 'motorcycle'].includes(objClass);
      const strokeColor = isIntruder
        ? 'rgba(239, 68, 68, 0.95)'
        : isRecentlyCounted
          ? 'rgba(34, 197, 94, 0.95)'
          : isVehicle
            ? 'rgba(56, 189, 248, 0.9)'
            : 'rgba(251, 191, 36, 0.9)';
      const bgColor = isIntruder
        ? 'rgba(153, 27, 27, 0.9)'
        : isRecentlyCounted
          ? 'rgba(6, 78, 59, 0.9)'
          : isVehicle
            ? 'rgba(12, 74, 110, 0.85)'
            : 'rgba(120, 53, 15, 0.85)';

      // 1. Thin main bounding box
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = Math.max(1, canvas.width / 1000);
      ctx.strokeRect(x, y, w, h);

      // 2. Thick tactical corner accents
      const cornerLen = Math.max(5, Math.min(w, h) * 0.15);
      ctx.lineWidth = Math.max(2, canvas.width / 600);

      // Top-left
      ctx.beginPath(); ctx.moveTo(x, y + cornerLen); ctx.lineTo(x, y); ctx.lineTo(x + cornerLen, y); ctx.stroke();
      // Top-right
      ctx.beginPath(); ctx.moveTo(x + w - cornerLen, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + cornerLen); ctx.stroke();
      // Bottom-left
      ctx.beginPath(); ctx.moveTo(x, y + h - cornerLen); ctx.lineTo(x, y + h); ctx.lineTo(x + cornerLen, y + h); ctx.stroke();
      // Bottom-right
      ctx.beginPath(); ctx.moveTo(x + w, y + h - cornerLen); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w - cornerLen, y + h); ctx.stroke();

      // 3. Label text
      const confPercent = Math.round(confidence * 100);
      const className = (box.class || 'OBJ').toUpperCase();
      const mainLabel = isIntruder
        ? `⚠ INTRUDER · ${confPercent}%`
        : isRecentlyCounted
          ? `${className} · ${confPercent}%  ✓`
          : `${className} · ${confPercent}%`;

      const fontSize = Math.max(10, canvas.width / 130);
      ctx.font = `600 ${fontSize}px "Inter", sans-serif`;
      const textWidth = ctx.measureText(mainLabel).width;
      const textHeight = fontSize;

      // 4. Sleek dark label background
      ctx.fillStyle = bgColor;
      ctx.fillRect(x, y - textHeight - 8, textWidth + 10, textHeight + 8);

      // 5. Crisp white text
      ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
      ctx.fillText(mainLabel, x + 5, y - 5);

      let displayPlate = box.plate;
      if (displayPlate) {
        const plateStr = String(displayPlate).replace(/\s/g, '');
        if (plateStr.length < 6) {
          displayPlate = undefined;
        }
      }

      if (displayPlate) {
        ctx.font = `700 ${fontSize + 2}px monospace`;
        const pWidth = ctx.measureText(displayPlate).width;

        ctx.fillStyle = "rgba(251, 191, 36, 0.95)";
        ctx.fillRect(x, y + h, pWidth + 16, textHeight + 12);

        ctx.fillStyle = "#000000";
        ctx.fillText(displayPlate, x + 8, y + h + textHeight + 5);
      }
    });
  }

  // 4. Draw Custom Analytics Zones/Lines if configured
  if (cam.analytics) {
    if (cam.analytics.type === 'traffic_count' && cam.analytics.line && cam.analytics.line.length >= 2) {
      const pts = cam.analytics.line;
      const scale = Math.max(canvas.width / 960, 0.65);

      ctx.save();

      // Path of the tripwire line in canvas coordinates
      const path = new Path2D();
      path.moveTo(pts[0][0] * scaleX, pts[0][1] * scaleY);
      for (let i = 1; i < pts.length; i++) {
        path.lineTo(pts[i][0] * scaleX, pts[i][1] * scaleY);
      }

      // Simple, elegant thin line (solid, no dash dash) - easy on the eye
      ctx.strokeStyle = "rgba(56, 189, 248, 0.85)";
      ctx.lineWidth = Math.max(1.5, Math.round(canvas.width / 650));
      ctx.stroke(path);
      ctx.restore();

      // Dynamic Object Crossing Feedback (Clean Green Blink Pulse - No Text)
      trackingState.recentCrossed.forEach((crossingFrameId, boxId) => {
        const age = currentFrameId - crossingFrameId;
        if (age >= 0 && age < 40) {
          const prev = trackingState.prevPositions.get(boxId);
          if (prev) {
            const alpha = Math.max(0, 1 - age / 40);
            const baseR = Math.max(7, canvas.width / 260);
            const expandR = baseR + (age / 40) * baseR * 2.5;

            ctx.save();
            // Outer pulse ring
            ctx.beginPath();
            ctx.arc(prev.x, prev.y, expandR, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(34, 197, 94, ${alpha * 0.85})`;
            ctx.lineWidth = Math.max(1.5, 2 * scale);
            ctx.stroke();

            // Inner pulse ring
            ctx.beginPath();
            ctx.arc(prev.x, prev.y, expandR * 0.6, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(74, 222, 128, ${alpha * 0.5})`;
            ctx.lineWidth = Math.max(1, 1.2 * scale);
            ctx.stroke();

            // Center green flash blip
            ctx.beginPath();
            ctx.arc(prev.x, prev.y, baseR * 0.45, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(34, 197, 94, ${alpha * 0.95})`;
            ctx.fill();

            ctx.restore();
          }
        }
      });

      // Total Traffic Count Calculation
      const countEvent = frameData?.events?.find((e: FrameEvent) => e.type === 'traffic_count');
      const totalCount = countEvent?.total_count !== undefined
        ? Math.max(countEvent.total_count, trackingState.count)
        : trackingState.count;

      // Minimal Clean Count Pill (Upper-Left) - Easy on the eye
      const countStr = String(totalCount).padStart(3, "0");
      const pillX = Math.round(12 * scale);
      const pillY = Math.round(12 * scale);
      const pillH = Math.round(24 * scale);

      ctx.save();
      ctx.font = `600 ${Math.round(11 * scale)}px "JetBrains Mono", monospace`;
      const numW = ctx.measureText(countStr).width;
      ctx.font = `500 ${Math.round(8 * scale)}px "JetBrains Mono", monospace`;
      const labelW = ctx.measureText("COUNT").width;
      const pillW = Math.round(24 * scale + numW + 6 * scale + labelW + 10 * scale);

      // Soft dark glassmorphic pill background
      ctx.fillStyle = "rgba(10, 15, 25, 0.75)";
      ctx.beginPath();
      ctx.roundRect(pillX, pillY, pillW, pillH, pillH / 2);
      ctx.fill();

      // Subtle light border
      ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
      ctx.lineWidth = 1;
      ctx.stroke();

      // Green active sensing dot
      ctx.fillStyle = "#22c55e";
      ctx.beginPath();
      ctx.arc(pillX + 10 * scale, pillY + pillH / 2, 2.5 * scale, 0, Math.PI * 2);
      ctx.fill();

      // Clean number
      ctx.font = `600 ${Math.round(11 * scale)}px "JetBrains Mono", monospace`;
      ctx.fillStyle = "#f8fafc";
      ctx.fillText(countStr, pillX + 18 * scale, pillY + pillH / 2 + 3.5 * scale);

      // Modest "COUNT" label
      ctx.font = `500 ${Math.round(8 * scale)}px "JetBrains Mono", monospace`;
      ctx.fillStyle = "rgba(148, 163, 184, 0.8)";
      ctx.fillText("COUNT", pillX + 18 * scale + numW + 6 * scale, pillY + pillH / 2 + 3 * scale);

      ctx.restore();

    } else if (cam.analytics.type === 'intrusion_zone' && cam.analytics.zone && cam.analytics.zone.length >= 3) {
      const pts = cam.analytics.zone;
      const zScale = Math.max(canvas.width / 960, 1);
      ctx.beginPath();
      ctx.moveTo(pts[0][0] * scaleX, pts[0][1] * scaleY);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i][0] * scaleX, pts[i][1] * scaleY);
      }
      ctx.closePath();

      if (hasIntrusion) {
        ctx.fillStyle = "rgba(255, 0, 0, 0.35)";
        ctx.fill();
        ctx.strokeStyle = "rgba(255, 0, 0, 0.95)";
        ctx.lineWidth = 3;
        ctx.stroke();

        const labelX = pts[0][0] * scaleX + Math.round(20 * scaleX);
        const labelY = (pts[0][1] * scaleY + pts[pts.length - 1][1] * scaleY) / 2;
        ctx.font = `bold ${Math.round(18 * zScale)}px monospace`;
        ctx.fillStyle = "rgba(255, 60, 60, 0.9)";
        ctx.fillText("INTRUSION ZONE", labelX, labelY);

        const flash = Math.floor(Date.now() / 500) % 2 === 0;
        if (flash) {
          const bannerW = Math.round(260 * zScale);
          const bannerH = Math.round(40 * zScale);
          const bx = (canvas.width - bannerW) / 2;
          const by = Math.round(12 * zScale);
          ctx.fillStyle = "rgba(220, 0, 0, 0.9)";
          ctx.beginPath();
          ctx.roundRect(bx, by, bannerW, bannerH, 8);
          ctx.fill();
          ctx.font = `bold ${Math.round(16 * zScale)}px monospace`;
          ctx.fillStyle = "#ffffff";
          ctx.textAlign = "center";
          ctx.fillText("⚠ INTRUSION ALERT", canvas.width / 2, by + Math.round(26 * zScale));
          ctx.textAlign = "start";
        }

        // Deduplicated alert sync
        const alertId = `${cam.id}-evt-intrude-${intrudingBox?.id || 'alert'}`;
        if (!alertedIdsRef.current.has(alertId)) {
          alertedIdsRef.current.add(alertId);
          if (alertedIdsRef.current.size > 200) {
            alertedIdsRef.current.clear();
            alertedIdsRef.current.add(alertId);
          }
          addAlert({
            id: alertId,
            t: secondsOfDay(new Date()),
            cameraId: cam.id,
            zone: cam.zone,
            cls: (intrudingBox?.class === "vehicle" || intrudingBox?.class === "animal" ? intrudingBox.class : "person") as AlertClass,
            severity: "high",
            confidence: intrudingBox?.confidence || 0.92,
            status: "new",
            live: true,
          });
        }
      } else {
        ctx.fillStyle = "rgba(0, 255, 0, 0.20)";
        ctx.fill();
        ctx.strokeStyle = "rgba(0, 255, 0, 0.8)";
        ctx.lineWidth = 2;
        ctx.stroke();

        const labelX = pts[0][0] * scaleX + Math.round(20 * scaleX);
        const labelY = (pts[0][1] * scaleY + pts[pts.length - 1][1] * scaleY) / 2;
        ctx.font = `bold ${Math.round(18 * zScale)}px monospace`;
        ctx.fillStyle = "rgba(0, 255, 0, 0.9)";
        ctx.fillText("INTRUSION ZONE", labelX, labelY);
      }
    }
  }

  // Deduplicated alert sync from precomputed frameData.events if any exist
  if (frameData?.events) {
    frameData.events.forEach((ev: FrameEvent) => {
      if (ev.type === 'intrusion') {
        const alertId = `${cam.id}-evt-intrude-${ev.object_id}`;
        if (!alertedIdsRef.current.has(alertId)) {
          alertedIdsRef.current.add(alertId);
          if (alertedIdsRef.current.size > 200) {
            alertedIdsRef.current.clear();
            alertedIdsRef.current.add(alertId);
          }
          addAlert({
            id: alertId,
            t: secondsOfDay(new Date()),
            cameraId: cam.id,
            zone: cam.zone,
            cls: "person",
            severity: "high",
            confidence: 0.92,
            status: "new",
            live: true,
          });
        }
      }
    });
  }
}

export function DecoupledStream({ cam }: { cam: Camera }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fullDataRef = useRef<PrecomputedFrame[] | null>(globalPrecomputedCache.get(cam.id) || null);
  const alertedIdsRef = useRef<Set<string>>(new Set());
  const trackingStateRef = useRef<StreamTrackingState>({
    crossedIds: new Set(),
    count: 0,
    recentCrossed: new Map(),
    prevPositions: new Map(),
    lastTime: 0,
  });
  const { addAlert } = useConsole();

  // Reset tracking state when camera id or geometry line changes
  useEffect(() => {
    trackingStateRef.current = {
      crossedIds: new Set(),
      count: 0,
      recentCrossed: new Map(),
      prevPositions: new Map(),
      lastTime: 0,
    };
  }, [cam.id, cam.analytics?.line, cam.analytics?.zone]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onLoadedMetadata = () => {
      const savedTime = globalVideoTime.get(cam.id);
      if (savedTime !== undefined && savedTime < video.duration) {
        video.currentTime = savedTime;
      }
    };

    const onTimeUpdate = () => {
      globalVideoTime.set(cam.id, video.currentTime);
    };

    video.addEventListener("loadedmetadata", onLoadedMetadata);
    video.addEventListener("timeupdate", onTimeUpdate);

    return () => {
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      video.removeEventListener("timeupdate", onTimeUpdate);
    };
  }, [cam.id]);

  useEffect(() => {
    const hasAnalytics = cam.analytics && cam.analytics.type && cam.analytics.type !== "none";
    if (!cam.aiEnabled && !hasAnalytics) return;

    if (globalPrecomputedCache.has(cam.id)) {
      fullDataRef.current = globalPrecomputedCache.get(cam.id)!;
      return;
    }

    const sid = cam.id.toLowerCase().replace("-", "_");
    const precomputedUrl = cam.precomputedUrl || `/api/precomputed/${sid}`;

    let active = true;
    fetch(precomputedUrl)
      .then(res => {
        if (!res.ok) throw new Error("Not found");
        return res.json();
      })
      .then(data => {
        globalPrecomputedCache.set(cam.id, data);
        if (active) fullDataRef.current = data;
      })
      .catch(e => console.error("Mock data fetch error for", cam.id, e));

    return () => { active = false; };
  }, [cam.id, cam.aiEnabled, cam.metadataUrl, cam.analytics?.type]);

  // RAF loop: runs whenever AI or custom Analytics (tripwire / intrusion zone) is enabled
  useEffect(() => {
    const canvas = canvasRef.current;
    const hasAnalytics = cam.analytics && cam.analytics.type && cam.analytics.type !== "none";
    const shouldRenderOverlay = cam.aiEnabled || hasAnalytics;

    if (!shouldRenderOverlay) {
      if (canvas) {
        const ctx = canvas.getContext("2d");
        if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
      return;
    }

    let animationId: number;
    let lastRenderedTime = -1;

    const renderLoop = () => {
      const video = videoRef.current;
      const fullData = fullDataRef.current;

      if (video && canvas) {
        const currentTime = video.currentTime || 0;

        // Reset positions & crossed IDs when video loops back to 0
        if (currentTime < trackingStateRef.current.lastTime - 2) {
          trackingStateRef.current.prevPositions.clear();
          trackingStateRef.current.crossedIds.clear();
        }
        trackingStateRef.current.lastTime = currentTime;

        // Throttle canvas draw if time hasn't advanced by at least 25ms
        if (Math.abs(currentTime - lastRenderedTime) >= 0.025 || lastRenderedTime === -1) {
          lastRenderedTime = currentTime;
          const ctx = canvas.getContext("2d");
          if (ctx) {
            const resParts = cam.resolution ? cam.resolution.split("×") : ["1920", "1080"];
            const origW = parseInt(resParts[0], 10) || 1920;
            const origH = parseInt(resParts[1], 10) || 1080;
            const targetW = video.videoWidth > 0 ? video.videoWidth : origW;
            const targetH = video.videoHeight > 0 ? video.videoHeight : origH;
            if (canvas.width !== targetW && targetW > 0) {
              canvas.width = targetW;
              canvas.height = targetH;
            }

            ctx.clearRect(0, 0, canvas.width, canvas.height);

            if (fullData && fullData.length > 0) {
              let low = 0;
              let high = fullData.length - 1;
              while (low <= high) {
                const mid = (low + high) >> 1;
                const midTime = fullData[mid].video_time_sec || 0;
                if (midTime < currentTime) {
                  low = mid + 1;
                } else {
                  high = mid - 1;
                }
              }
              const idx1 = Math.max(0, Math.min(high, fullData.length - 1));
              const idx2 = Math.max(0, Math.min(low, fullData.length - 1));
              const diff1 = Math.abs((fullData[idx1].video_time_sec || 0) - currentTime);
              const diff2 = Math.abs((fullData[idx2].video_time_sec || 0) - currentTime);
              const closestData = diff1 <= diff2 ? fullData[idx1] : fullData[idx2];

              drawCameraOverlay(ctx, canvas, cam, closestData, addAlert, alertedIdsRef, trackingStateRef.current);
            } else if (hasAnalytics || cam.aiEnabled) {
              // Even before precomputed detections load, draw calibrated tripwire / zone
              drawCameraOverlay(ctx, canvas, cam, null, addAlert, alertedIdsRef, trackingStateRef.current);
            }
          }
        }
      }
      animationId = requestAnimationFrame(renderLoop);
    };

    animationId = requestAnimationFrame(renderLoop);
    return () => cancelAnimationFrame(animationId);
  }, [cam.aiEnabled, cam.analytics, cam.id, cam.resolution, cam.zone, addAlert]);

  // Watchdog to prevent Chromium media freeze on tab switch or loop stall
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const resumePlayback = () => {
      if (video && video.paused && !video.ended) {
        video.play().catch(() => { });
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        resumePlayback();
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    video.addEventListener("waiting", resumePlayback);
    video.addEventListener("stalled", resumePlayback);
    video.addEventListener("pause", resumePlayback);
    video.addEventListener("ended", () => {
      video.currentTime = 0;
      resumePlayback();
    });

    const watchdog = setInterval(resumePlayback, 2500);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      video.removeEventListener("waiting", resumePlayback);
      video.removeEventListener("stalled", resumePlayback);
      video.removeEventListener("pause", resumePlayback);
      clearInterval(watchdog);
    };
  }, []);

  return (
    <>
      <video
        ref={videoRef}
        src={`/api/videos/${cam.id}`}
        autoPlay
        muted
        loop
        playsInline
        className="absolute inset-0 w-full h-full object-contain z-0"
      />
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full object-contain z-10 pointer-events-none"
      />
    </>
  );
}

function LiveMJPEGStream({ cam }: { cam: Camera }) {
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const latestData = useRef<PrecomputedFrame | null>(null);
  const alertedIdsRef = useRef<Set<string>>(new Set());
  const trackingStateRef = useRef<StreamTrackingState>({
    crossedIds: new Set(),
    count: 0,
    recentCrossed: new Map(),
    prevPositions: new Map(),
    lastTime: 0,
  });
  const { addAlert } = useConsole();
  const [prevUrl, setPrevUrl] = useState(cam.mjpegUrl);
  const [streamSrc, setStreamSrc] = useState<string>(() => cam.mjpegUrl || "");

  if (cam.mjpegUrl !== prevUrl) {
    setPrevUrl(cam.mjpegUrl);
    setStreamSrc(cam.mjpegUrl || "");
  }

  // Self-healing watchdog: reconnect MJPEG stream when returning to tab or on network recovery
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible" && cam.mjpegUrl) {
        setStreamSrc(`${cam.mjpegUrl}?t=${Date.now()}`);
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [cam.mjpegUrl]);

  useEffect(() => {
    const hasAnalytics = cam.analytics && cam.analytics.type && cam.analytics.type !== "none";
    if (!cam.metadataUrl || (!cam.aiEnabled && !hasAnalytics)) {
      latestData.current = null;
      return;
    }

    let evtSource: EventSource | null = null;
    try {
      evtSource = new EventSource(cam.metadataUrl);
      evtSource.onmessage = (event) => {
        try {
          latestData.current = JSON.parse(event.data);
        } catch (e) { }
      };
      evtSource.onerror = () => {
        latestData.current = null;
      };
    } catch (e) {
      console.warn("SSE init error for", cam.id, e);
    }

    return () => {
      if (evtSource) evtSource.close();
    };
  }, [cam.metadataUrl, cam.aiEnabled, cam.id, cam.analytics?.type]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const hasAnalytics = cam.analytics && cam.analytics.type && cam.analytics.type !== "none";
    const shouldRenderOverlay = cam.aiEnabled || hasAnalytics;

    if (!shouldRenderOverlay) {
      if (canvas) {
        const ctx = canvas.getContext("2d");
        if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
      return;
    }

    let animationId: number;

    const renderLoop = () => {
      const img = imgRef.current;
      if (img && canvas) {
        const ctx = canvas.getContext("2d");
        if (ctx) {
          const resParts = cam.resolution ? cam.resolution.split("×") : ["1920", "1080"];
          const origW = parseInt(resParts[0], 10) || 1920;
          const origH = parseInt(resParts[1], 10) || 1080;
          const w = (img.naturalWidth && img.naturalWidth > 0) ? img.naturalWidth : origW;
          const h = (img.naturalHeight && img.naturalHeight > 0) ? img.naturalHeight : origH;
          if (canvas.width !== w && w > 0) {
            canvas.width = w;
            canvas.height = h;
          }

          ctx.clearRect(0, 0, canvas.width, canvas.height);

          if (latestData.current) {
            drawCameraOverlay(ctx, canvas, cam, latestData.current, addAlert, alertedIdsRef, trackingStateRef.current);
          } else if (hasAnalytics || cam.aiEnabled) {
            drawCameraOverlay(ctx, canvas, cam, null, addAlert, alertedIdsRef, trackingStateRef.current);
          }
        }
      }
      animationId = requestAnimationFrame(renderLoop);
    };

    animationId = requestAnimationFrame(renderLoop);
    return () => cancelAnimationFrame(animationId);
  }, [cam.aiEnabled, cam.analytics, cam.id, cam.resolution, cam.zone, addAlert]);

  return (
    <>
      <img
        ref={imgRef}
        src={streamSrc}
        alt={cam.name}
        onError={() => {
          setTimeout(() => {
            if (cam.mjpegUrl) {
              setStreamSrc(`${cam.mjpegUrl}?t=${Date.now()}`);
            }
          }, 1500);
        }}
        className="absolute inset-0 w-full h-full object-contain z-0"
      />
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full object-contain z-10 pointer-events-none"
      />
    </>
  );
}

function TileClock({ online }: { online: boolean }) {
  const clock = useClock();
  return (
    <span className="text-micro font-data text-g-muted shrink-0">
      {online ? clock : "--:--:--"}
    </span>
  );
}

const Tile = memo(function Tile({
  cam,
  focused,
  streamMode = "precomputed",
  onClick,
}: {
  cam: Camera;
  focused?: boolean;
  streamMode?: "precomputed" | "live";
  onClick: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  const isLiveMode = streamMode === "live" && !!cam.mjpegUrl;
  const isMockMode = !isLiveMode && !!cam.metadataUrl;

  useEffect(() => {
    if (isLiveMode || isMockMode) return;
    if (!videoRef.current || !cam.hlsUrl || !cam.online) return;

    let hls: Hls | null = null;
    const video = videoRef.current;

    if (Hls.isSupported()) {
      hls = new Hls({
        enableWorker: false,
        lowLatencyMode: true,
      });
      hls.loadSource(cam.hlsUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => { });
      });
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = cam.hlsUrl;
      video.addEventListener("loadedmetadata", () => {
        video.play().catch(() => { });
      });
    }

    return () => {
      if (hls) {
        hls.destroy();
      }
    };
  }, [cam.hlsUrl, cam.online, isLiveMode, isMockMode]);

  return (
    <div
      data-testid={`cam-tile-${cam.id}`}
      data-online={cam.online}
      onClick={(e) => {
        const target = e.target as HTMLElement;
        if (target.closest('button, [role="button"], input, textarea, select')) {
          return;
        }
        onClick();
      }}
      title={`${cam.id} · ${cam.name}`}
      className={`relative bg-g-bg border rounded-[2px] flex flex-col justify-between p-1.5 text-left overflow-hidden transition-none w-full h-full cursor-pointer select-none ${focused ? "border-g-blue" : "border-g-border hover:border-g-border-strong hover:bg-g-hover"
        }`}
    >
      {/* Top Header: Channel ID (with Status Dot) on left + AI indicator on right */}
      <div className="flex items-center justify-between gap-1 z-20">
        <div className="flex items-center gap-1.5 min-w-0">
          <StatusDot tone={cam.online ? (cam.recording ? "ok" : "warn") : "idle"} />
          <span className="text-micro uppercase text-g-text-2 truncate">
            {cam.id} · {cam.name}
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {cam.online && !cam.recording && (
            <span className="text-micro text-g-amber">NO REC</span>
          )}
          {cam.aiEnabled && (
            <span
              title="AI Detection Active"
              className="text-[8.5px] font-mono font-bold px-1.5 py-0.5 bg-red-950/60 border border-red-900/40 text-red-400 tracking-wider"
            >
              AI
            </span>
          )}
        </div>
      </div>

      {/* Main Viewport: Decoupled / Live video with analytics overlay */}
      <div className="flex-1 flex items-center justify-center relative overflow-hidden">
        {cam.online ? (
          <>
            {isLiveMode ? (
              <LiveMJPEGStream cam={cam} />
            ) : (
              <DecoupledStream cam={cam} />
            )}
            {focused && <Icon name="videocam" size={40} className="text-white/20 absolute z-10 pointer-events-none" />}
          </>
        ) : (
          <span className="flex flex-col items-center gap-1 text-g-red z-10 relative">
            <Icon name="videocam_off" size={focused ? 40 : 18} />
            <span className="text-micro uppercase">No signal</span>
          </span>
        )}
      </div>

      {/* Bottom Bar: Zone & Isolated Clock */}
      <div className="flex items-center justify-between gap-1 z-20">
        <span className="text-micro uppercase text-g-muted truncate">{cam.zone}</span>
        <TileClock online={cam.online} />
      </div>
    </div>
  );
});

/** Camera wall. Click a tile to focus it full-panel; Esc returns to the grid. */
export function CameraWall({ cameras }: { cameras: Camera[] }) {
  const [focusId, setFocusId] = useState<string | null>(null);
  const [streamMode, setStreamMode] = useState<"precomputed" | "live">(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("gotham_stream_mode");
        if (saved === "live" || saved === "precomputed") return saved;
      } catch {}
    }
    return "precomputed";
  });
  const { dashboardFeedIds, disabledCameraIds, wallLayout, setWallLayout } = useConsole();

  useEffect(() => {
    if (!focusId) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFocusId(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusId]);

  // Displayed cameras: active (online & transmitting) cameras are ALWAYS prioritized on top!
  // If an operator closes a camera / sets it to standby, it immediately drops lower, keeping active cameras on top.
  // Within active and inactive tiers, pinned feeds take priority, filled up to wallLayout (4, 6, 9, or 12).
  const displayedCameras = useMemo(() => {
    const isCamActive = (c: Camera) => c.online && !disabledCameraIds.includes(c.id);

    const active = cameras.filter(isCamActive);
    const inactive = cameras.filter((c) => !isCamActive(c));

    // Active feeds: pinned first, then unpinned
    const activePinned = active.filter((c) => dashboardFeedIds.includes(c.id));
    const activeUnpinned = active.filter((c) => !dashboardFeedIds.includes(c.id));

    // Inactive feeds (closed, standby, or carrier dropped): pinned first, then unpinned
    const inactivePinned = inactive.filter((c) => dashboardFeedIds.includes(c.id));
    const inactiveUnpinned = inactive.filter((c) => !dashboardFeedIds.includes(c.id));

    const combined = [
      ...activePinned,
      ...activeUnpinned,
      ...inactivePinned,
      ...inactiveUnpinned,
    ];
    return combined.slice(0, wallLayout);
  }, [cameras, dashboardFeedIds, disabledCameraIds, wallLayout]);

  const focused = cameras.find((c: Camera) => c.id === focusId);
  const offline = displayedCameras.filter((c: Camera) => !c.online).length;

  const gridClass = useMemo(() => {
    switch (wallLayout) {
      case 4:
        return "grid-cols-2 grid-rows-2";
      case 6:
        return "grid-cols-3 grid-rows-2";
      case 12:
        return "grid-cols-4 grid-rows-3"; // 3 rows × 4 columns
      case 9:
      default:
        return "grid-cols-3 grid-rows-3";
    }
  }, [wallLayout]);

  return (
    <section className="flex-1 bg-g-panel border border-g-border rounded-[4px] flex flex-col min-h-0">
      <header className="h-8 px-3 flex items-center justify-between border-b border-g-border shrink-0">
        <div className="flex items-center gap-2">
          <MicroLabel>Camera wall</MicroLabel>
          <div className="h-3 w-[1px] bg-g-border mx-1" />
          {/* Layout density switcher */}
          <div className="flex items-center border border-g-border rounded-[2px] p-0.5 bg-g-bg">
            {([4, 6, 9, 12] as const).map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setWallLayout(n)}
                className={`h-5 px-1.5 text-[9px] font-mono font-bold rounded-[1px] transition-colors ${wallLayout === n
                    ? "bg-g-blue text-white"
                    : "text-g-muted hover:text-g-text hover:bg-g-hover"
                  }`}
                title={`Grid density: ${n} feeds (${n === 12 ? '3 rows × 4 cols' : n === 6 ? '2 rows × 3 cols' : n === 4 ? '2×2' : '3×3'})`}
              >
                {n}
              </button>
            ))}
          </div>

          {/* Stream Engine Selector: Zero-Lag Precomputed 60FPS vs Raw MJPEG */}
          <div className="flex items-center border border-g-border rounded-[2px] p-0.5 bg-g-bg ml-1">
            <button
              type="button"
              onClick={() => {
                setStreamMode("precomputed");
                try { localStorage.setItem("gotham_stream_mode", "precomputed"); } catch {}
              }}
              className={`h-5 px-1.5 text-[8.5px] font-mono font-bold rounded-[1px] transition-colors flex items-center gap-1 ${
                streamMode === "precomputed"
                  ? "bg-emerald-600 text-white shadow-sm"
                  : "text-g-muted hover:text-g-text hover:bg-g-hover"
              }`}
              title="Hardware-accelerated 60 FPS playback with zero lag using precomputed YOLOv11 & ByteTrack detections"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-300" />
              <span>60 FPS DEMO (SMOOTH)</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setStreamMode("live");
                try { localStorage.setItem("gotham_stream_mode", "live"); } catch {}
              }}
              className={`h-5 px-1.5 text-[8.5px] font-mono font-bold rounded-[1px] transition-colors flex items-center gap-1 ${
                streamMode === "live"
                  ? "bg-g-blue text-white shadow-sm"
                  : "text-g-muted hover:text-g-text hover:bg-g-hover"
              }`}
              title="Raw live MJPEG stream from python pipeline (subject to CPU latency)"
            >
              <span>RAW MJPEG</span>
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/cameras"
            className="text-[9.5px] font-mono uppercase text-g-blue hover:underline flex items-center gap-1 px-1.5 py-0.5 rounded-[2px] bg-g-blue/10 border border-g-blue/30 transition-colors"
            title="Open Camera Management Console"
          >
            <span>CAMERAS & AI ↗</span>
          </Link>
          <span className="text-micro font-data text-g-muted">
            {displayedCameras.length - offline}/{displayedCameras.length} live
          </span>
          {focused && (
            <button
              type="button"
              data-testid="wall-exit-focus"
              onClick={() => setFocusId(null)}
              className="text-micro uppercase text-g-blue hover:underline flex items-center gap-1"
            >
              <Icon name="fullscreen_exit" size={12} />
              Exit focus · Esc
            </button>
          )}
        </div>
      </header>

      <div className="flex-1 min-h-0 p-2 relative">
        <div className={`h-full grid ${gridClass} gap-2`}>
          {displayedCameras.map((c: Camera) => {
            const isThisFocused = c.id === focusId;
            return (
              <div
                key={c.id}
                className={
                  isThisFocused
                    ? "absolute inset-2 z-30 bg-g-panel"
                    : "relative w-full h-full min-h-0 overflow-hidden"
                }
              >
                <Tile
                  cam={c}
                  focused={isThisFocused}
                  streamMode={streamMode}
                  onClick={() => setFocusId(isThisFocused ? null : c.id)}
                />
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
