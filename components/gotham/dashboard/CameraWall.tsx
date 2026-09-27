"use client";

import { useEffect, useState, useRef } from "react";
import Hls from "hls.js";
import { Icon } from "@/components/ui/Icon";
import { secondsOfDay, type Camera } from "@/lib/gotham/model";
import { useConsole } from "../ConsoleProvider";
import { useClock } from "../hooks";
import { MicroLabel, StatusDot } from "../primitives";

const globalVideoTime = new Map<string, number>();
const globalPrecomputedCache = new Map<string, any[]>();

function DecoupledStream({ cam }: { cam: Camera }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Store the full precomputed data, initialized immediately from cache if available
  const fullDataRef = useRef<any[] | null>(globalPrecomputedCache.get(cam.id) || null);
  const { addAlert } = useConsole();

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
    if (!cam.aiEnabled || !cam.metadataUrl) return;
    
    // Check if we already have it in memory
    if (globalPrecomputedCache.has(cam.id)) {
      fullDataRef.current = globalPrecomputedCache.get(cam.id)!;
      return;
    }

    // Construct the correct Python backend URL by replacing /metadata/ with /precomputed/
    const precomputedUrl = cam.metadataUrl.replace('/metadata/', '/precomputed/');
    
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
  }, [cam.id, cam.aiEnabled, cam.metadataUrl]);

  useEffect(() => {
    let animationId: number;

    const renderLoop = () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const fullData = fullDataRef.current;
      
      if (video && canvas) {
        const ctx = canvas.getContext("2d");
        if (ctx) {
          if (canvas.width !== video.videoWidth && video.videoWidth > 0) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
          }

          ctx.clearRect(0, 0, canvas.width, canvas.height);

          if (cam.aiEnabled && fullData && fullData.length > 0) {
            const currentTime = video.currentTime;
            
            // Fast binary search: fullData is chronologically ordered by video_time_sec
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

            const boxes = closestData.detections;
            
            // Always draw since video is perfectly synced with the lookup
            if (boxes) {
              boxes.forEach((box: any) => {
                const objClass = box.class?.toLowerCase() || 'obj';
                const confidence = box.confidence || 0;
                
                // Thresholds: 30% for animals, 40% for everything else
                const minConfidence = objClass === 'animal' ? 0.30 : 0.40;
                if (confidence < minConfidence) return;

                let x = box.x;
                let y = box.y;
                let w = box.w;
                let h = box.h;
                if (w < 0) { x += w; w = -w; }
                if (h < 0) { y += h; h = -h; }
                
                // Check if this vehicle recently crossed the counting line
                const isRecentlyCounted = closestData.events?.some(
                  (e: any) => e.type === 'traffic_count' && e.object_id === box.id && ((closestData.frame_id ?? 0) - e.frame_id) < 45 && ((closestData.frame_id ?? 0) - e.frame_id) >= 0
                );

                // Tactical UI Colors
                const isVehicle = ['car', 'truck', 'bus', 'motorcycle'].includes(objClass);
                // Emerald green if counted, sky blue for vehicles, amber for others
                const strokeColor = isRecentlyCounted
                  ? 'rgba(34, 197, 94, 0.95)'
                  : isVehicle
                  ? 'rgba(56, 189, 248, 0.9)'
                  : 'rgba(251, 191, 36, 0.9)'; 
                const bgColor = isRecentlyCounted
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
                
                // 3. Label text (e.g. "CAR · 85%" or "CAR · 85% ✓")
                const confPercent = Math.round(confidence * 100);
                const className = (box.class || 'OBJ').toUpperCase();
                const mainLabel = isRecentlyCounted 
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
                    
                    // Draw at the bottom of the bounding box
                    ctx.fillStyle = "rgba(251, 191, 36, 0.95)"; // Bright amber
                    ctx.fillRect(x, y + h, pWidth + 16, textHeight + 12);
                    
                    ctx.fillStyle = "#000000"; // Black text
                    ctx.fillText(displayPlate, x + 8, y + h + textHeight + 5);
                }
              });
            }

            // Draw Custom Analytics Zones/Lines if configured
            if (cam.analytics) {
              const resParts = cam.resolution ? cam.resolution.split("×") : ["1920", "1080"];
              const origW = parseInt(resParts[0], 10) || 1920;
              const origH = parseInt(resParts[1], 10) || 1080;
              const scaleX = canvas.width / origW;
              const scaleY = canvas.height / origH;
              
              if (cam.analytics.type === 'traffic_count' && cam.analytics.line) {
                const pts = cam.analytics.line;
                ctx.beginPath();
                ctx.moveTo(pts[0][0] * scaleX, pts[0][1] * scaleY);
                for (let i = 1; i < pts.length; i++) {
                  ctx.lineTo(pts[i][0] * scaleX, pts[i][1] * scaleY);
                }
                ctx.strokeStyle = "rgba(0, 200, 255, 0.9)";
                ctx.lineWidth = 3;
                ctx.setLineDash([10, 6]);
                ctx.stroke();
                ctx.setLineDash([]);
                
                // Draw "COUNTING LINE" label at midpoint
                const midIdx = Math.floor(pts.length / 2);
                const lx = pts[midIdx][0] * scaleX;
                const ly = pts[midIdx][1] * scaleY - 12;
                ctx.font = "bold 11px monospace";
                ctx.fillStyle = "rgba(0, 200, 255, 0.9)";
                ctx.fillText("▼ COUNTING LINE", lx - 50, ly);

                // Draw running traffic count badge (top-left HUD)
                // Now that the backend injects this persistently, we can always render it
                const countEvent = closestData.events?.find((e: any) => e.type === 'traffic_count');
                const totalCount = countEvent?.total_count ?? 0;
                
                const scale = Math.max(canvas.width / 960, 1); // scale relative to a 960px reference
                const badgeW = Math.round(140 * scale);
                const badgeH = Math.round(56 * scale);
                const bx = Math.round(14 * scale);
                const by = Math.round(14 * scale);
                const pad = Math.round(12 * scale);
                // Glassy dark background
                ctx.fillStyle = "rgba(0, 0, 0, 0.75)";
                ctx.beginPath();
                ctx.roundRect(bx, by, badgeW, badgeH, 8);
                ctx.fill();
                ctx.strokeStyle = "rgba(0, 200, 255, 0.6)";
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.roundRect(bx, by, badgeW, badgeH, 8);
                ctx.stroke();
                // Label
                ctx.font = `bold ${Math.round(14 * scale)}px monospace`;
                ctx.fillStyle = "#00c8ff";
                ctx.fillText("VEHICLES", bx + pad, by + Math.round(22 * scale));
                // Count number
                ctx.font = `bold ${Math.round(24 * scale)}px monospace`;
                ctx.fillStyle = "#ffffff";
                ctx.fillText(String(totalCount), bx + pad, by + Math.round(48 * scale));

                // Draw small green marks when cars cross the line
                const crossingEvents = closestData.events?.filter(
                  (e: any) => e.type === 'traffic_count' && e.location && e.frame_id !== undefined
                );
                
                if (crossingEvents && crossingEvents.length > 0) {
                  crossingEvents.forEach((ev: any) => {
                    const currentFid = closestData.frame_id ?? 0;
                    const age = currentFid - ev.frame_id;
                    if (age >= 0 && age < 45) { // show for ~1.5 seconds after crossing
                      const alpha = Math.max(0, 1 - age / 45);
                      const px = ev.location[0] * scaleX;
                      const py = ev.location[1] * scaleY;
                      const markerRadius = Math.max(5, canvas.width / 320);
                      const pulseRadius = markerRadius + (age / 45) * markerRadius * 2.5;
                      
                      // 1. Expanding fading ripple ring
                      ctx.beginPath();
                      ctx.arc(px, py, pulseRadius, 0, Math.PI * 2);
                      ctx.strokeStyle = `rgba(34, 197, 94, ${alpha * 0.85})`;
                      ctx.lineWidth = Math.max(1.5, canvas.width / 800);
                      ctx.stroke();
                      
                      // 2. Solid glowing green center pip
                      ctx.beginPath();
                      ctx.arc(px, py, markerRadius, 0, Math.PI * 2);
                      ctx.fillStyle = `rgba(34, 197, 94, ${alpha})`;
                      ctx.fill();
                      ctx.strokeStyle = `rgba(255, 255, 255, ${alpha * 0.9})`;
                      ctx.lineWidth = 1;
                      ctx.stroke();
                      
                      // 3. Crisp "+1" floating indicator
                      const fontSize = Math.max(11, canvas.width / 160);
                      ctx.font = `bold ${fontSize}px monospace`;
                      ctx.fillStyle = `rgba(34, 197, 94, ${alpha})`;
                      ctx.fillText("+1", px + markerRadius + 4, py - markerRadius);
                    }
                  });
                }
              } else if (cam.analytics.type === 'intrusion_zone' && cam.analytics.zone) {
                const pts = cam.analytics.zone;
                ctx.beginPath();
                ctx.moveTo(pts[0][0] * scaleX, pts[0][1] * scaleY);
                for (let i = 1; i < pts.length; i++) {
                  ctx.lineTo(pts[i][0] * scaleX, pts[i][1] * scaleY);
                }
                ctx.closePath();
                
                const hasIntrusion = closestData.events?.some((e: any) => e.type === 'intrusion');
                const zScale = Math.max(canvas.width / 960, 1);
                
                if (hasIntrusion) {
                  // RED alert zone — matches screenshot style but red
                  ctx.fillStyle = "rgba(255, 0, 0, 0.3)";
                  ctx.fill();
                  ctx.strokeStyle = "rgba(255, 0, 0, 0.9)";
                  ctx.lineWidth = 3;
                  ctx.stroke();
                  
                  // "INTRUSION ZONE" label inside polygon
                  const labelX = pts[0][0] * scaleX + Math.round(20 * scaleX);
                  const labelY = (pts[0][1] * scaleY + pts[pts.length - 1][1] * scaleY) / 2;
                  ctx.font = `bold ${Math.round(18 * zScale)}px monospace`;
                  ctx.fillStyle = "rgba(255, 60, 60, 0.9)";
                  ctx.fillText("INTRUSION ZONE", labelX, labelY);
                  
                  // Flashing ALERT banner at top
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
                } else {
                  // Green safe zone — matches screenshot exactly
                  ctx.fillStyle = "rgba(0, 255, 0, 0.25)";
                  ctx.fill();
                  ctx.strokeStyle = "rgba(0, 255, 0, 0.8)";
                  ctx.lineWidth = 2;
                  ctx.stroke();
                  
                  // "INTRUSION ZONE" label inside polygon (matches screenshot)
                  const labelX = pts[0][0] * scaleX + Math.round(20 * scaleX);
                  const labelY = (pts[0][1] * scaleY + pts[pts.length - 1][1] * scaleY) / 2;
                  ctx.font = `bold ${Math.round(18 * zScale)}px monospace`;
                  ctx.fillStyle = "rgba(0, 255, 0, 0.9)";
                  ctx.fillText("INTRUSION ZONE", labelX, labelY);
                }
              }
            }

            // Sync alerts natively to the sidebar feed
            if (closestData.events) {
              closestData.events.forEach((ev: any) => {
                if (ev.type === 'intrusion') {
                  const alertId = `${cam.id}-evt-intrude-${ev.object_id}`;
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
              });
            }
            
          }
        }
      }
      animationId = requestAnimationFrame(renderLoop);
    };
    
    animationId = requestAnimationFrame(renderLoop);
    return () => cancelAnimationFrame(animationId);
  }, [cam, addAlert]);

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
  const latestData = useRef<any>(null);

  useEffect(() => {
    if (!cam.metadataUrl || !cam.aiEnabled) {
      latestData.current = null;
      return;
    }
    
    const evtSource = new EventSource(cam.metadataUrl);
    evtSource.onmessage = (event) => {
      try {
        latestData.current = JSON.parse(event.data);
      } catch (e) {}
    };

    return () => evtSource.close();
  }, [cam.metadataUrl, cam.aiEnabled]);

  useEffect(() => {
    let animationId: number;

    const renderLoop = () => {
      const img = imgRef.current;
      const canvas = canvasRef.current;
      if (img && canvas) {
        const ctx = canvas.getContext("2d");
        if (ctx) {
          if (canvas.width !== img.naturalWidth && img.naturalWidth > 0) {
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
          }

          ctx.clearRect(0, 0, canvas.width, canvas.height);

          if (cam.aiEnabled && latestData.current && latestData.current.detections) {
            const boxes = latestData.current.detections;
            
            boxes.forEach((box: any) => {
                let x = box.x;
                let y = box.y;
                let w = box.w;
                let h = box.h;
                if (w < 0) { x += w; w = -w; }
                if (h < 0) { y += h; h = -h; }
                
                // Tactical UI Colors
                const isVehicle = ['car', 'truck', 'bus', 'motorcycle'].includes(box.class?.toLowerCase());
                const strokeColor = isVehicle ? 'rgba(56, 189, 248, 0.9)' : 'rgba(251, 191, 36, 0.9)'; 
                const bgColor = isVehicle ? 'rgba(12, 74, 110, 0.85)' : 'rgba(120, 53, 15, 0.85)';
                
                ctx.strokeStyle = strokeColor;
                ctx.lineWidth = Math.max(1, canvas.width / 1000);
                ctx.strokeRect(x, y, w, h);
                
                const cornerLen = Math.max(5, Math.min(w, h) * 0.15);
                ctx.lineWidth = Math.max(2, canvas.width / 600);
                
                ctx.beginPath(); ctx.moveTo(x, y + cornerLen); ctx.lineTo(x, y); ctx.lineTo(x + cornerLen, y); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(x + w - cornerLen, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + cornerLen); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(x, y + h - cornerLen); ctx.lineTo(x, y + h); ctx.lineTo(x + cornerLen, y + h); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(x + w, y + h - cornerLen); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w - cornerLen, y + h); ctx.stroke();
                
                const confPercent = Math.round((box.confidence || 0) * 100);
                const className = (box.class || 'OBJ').toUpperCase();
                const mainLabel = `${className} · ${confPercent}%`;
                
                const fontSize = Math.max(10, canvas.width / 130);
                ctx.font = `600 ${fontSize}px "Inter", sans-serif`;
                const textWidth = ctx.measureText(mainLabel).width;
                const textHeight = fontSize;
                
                ctx.fillStyle = bgColor;
                ctx.fillRect(x, y - textHeight - 8, textWidth + 10, textHeight + 8);
                
                ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
                ctx.fillText(mainLabel, x + 5, y - 5);
                
                if (box.plate) {
                    const plateLabel = box.plate;
                    ctx.font = `700 ${fontSize + 2}px monospace`;
                    const pWidth = ctx.measureText(plateLabel).width;
                    
                    ctx.fillStyle = "rgba(251, 191, 36, 0.95)";
                    ctx.fillRect(x, y + h, pWidth + 16, textHeight + 12);
                    
                    ctx.fillStyle = "#000000";
                    ctx.fillText(plateLabel, x + 8, y + h + textHeight + 5);
                }
            });
          }
        }
      }
      animationId = requestAnimationFrame(renderLoop);
    };
    
    animationId = requestAnimationFrame(renderLoop);
    return () => cancelAnimationFrame(animationId);
  }, [cam.aiEnabled]);

  return (
    <>
      <img
        ref={imgRef}
        src={cam.mjpegUrl}
        alt={cam.name}
        className="absolute inset-0 w-full h-full object-contain z-0"
      />
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full object-contain z-10 pointer-events-none"
      />
    </>
  );
}

function Tile({
  cam,
  clock,
  focused,
  onClick,
}: {
  cam: Camera;
  clock: string;
  focused?: boolean;
  onClick: () => void;
}) {
  const { toggleAi } = useConsole();
  const videoRef = useRef<HTMLVideoElement>(null);
  
  const isLiveMode = !!cam.mjpegUrl;
  const isMockMode = !isLiveMode && !!cam.metadataUrl;

  useEffect(() => {
    // Standard HLS player (fallback if neither mock nor live streams are active)
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
        video.play().catch(() => {});
      });
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = cam.hlsUrl;
      video.addEventListener("loadedmetadata", () => {
        video.play().catch(() => {});
      });
    }

    return () => {
      if (hls) {
        hls.destroy();
      }
    };
  }, [cam.hlsUrl, cam.online, isLiveMode, isMockMode]);

  return (
    <button
      type="button"
      data-testid={`cam-tile-${cam.id}`}
      data-online={cam.online}
      onClick={onClick}
      title={`${cam.id} · ${cam.name}`}
      className={`relative bg-g-bg border rounded-[2px] flex flex-col justify-between p-1.5 text-left overflow-hidden transition-none w-full h-full ${
        focused ? "border-g-blue" : "border-g-border hover:border-g-border-strong hover:bg-g-hover"
      }`}
    >
      <div className="flex items-center justify-between gap-1 z-20">
        <span className="text-micro uppercase text-g-text-2 truncate">
          {cam.id} · {cam.name}
        </span>
        {cam.online ? (
          cam.recording ? (
            <span className="flex items-center gap-1 shrink-0">
              <StatusDot tone={cam.aiEnabled ? "red" : "idle"} className={cam.aiEnabled ? "animate-pulse" : ""} />
              {(isLiveMode || isMockMode) ? (
                <span
                  role="button"
                  title={cam.aiEnabled ? "Disable AI" : "Enable AI"}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleAi(cam.id, !cam.aiEnabled);
                  }}
                  className={`text-micro px-1 py-0.5 rounded-[2px] transition-colors cursor-pointer ${
                    cam.aiEnabled 
                      ? "bg-g-red/10 text-g-red hover:bg-g-red/20" 
                      : "bg-g-bg border border-g-border text-g-muted hover:text-g-text"
                  }`}
                >
                  AI
                </span>
              ) : (
                <span className="text-micro text-g-muted">REC</span>
              )}
            </span>
          ) : (
            <span className="text-micro text-g-amber shrink-0">NO REC</span>
          )
        ) : (
          <StatusDot tone="idle" className="shrink-0" />
        )}
      </div>

      <div className="flex-1 flex items-center justify-center relative">
        {cam.online ? (
          <>
            {isMockMode ? (
              <DecoupledStream cam={cam} />
            ) : isLiveMode ? (
              <LiveMJPEGStream cam={cam} />
            ) : (
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                className="absolute inset-0 w-full h-full object-contain z-0"
              />
            )}
            {/* Overlay icon only when focused or on hover? Actually, let's keep it clean if video is playing */}
            {focused && <Icon name="videocam" size={40} className="text-white/20 absolute z-10 pointer-events-none" />}
          </>
        ) : (
          <span className="flex flex-col items-center gap-1 text-g-red z-10 relative">
            <Icon name="videocam_off" size={focused ? 40 : 18} />
            <span className="text-micro uppercase">No signal</span>
          </span>
        )}
      </div>

      <div className="flex items-center justify-between gap-1">
        <span className="text-micro uppercase text-g-muted truncate">{cam.zone}</span>
        <span className="text-micro font-data text-g-muted shrink-0">
          {cam.online ? clock : "--:--:--"}
        </span>
      </div>
    </button>
  );
}

/** Camera wall. Click a tile to focus it full-panel; Esc returns to the grid. */
export function CameraWall({ cameras }: { cameras: Camera[] }) {
  const [focusId, setFocusId] = useState<string | null>(null);
  const clock = useClock();

  useEffect(() => {
    if (!focusId) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFocusId(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusId]);

  const focused = cameras.find((c) => c.id === focusId);
  const offline = cameras.filter((c) => !c.online).length;

  return (
    <section className="flex-1 bg-g-panel border border-g-border rounded-[4px] flex flex-col min-h-0">
      <header className="h-8 px-3 flex items-center justify-between border-b border-g-border shrink-0">
        <MicroLabel>Camera wall</MicroLabel>
        <div className="flex items-center gap-3">
          <span className="text-micro font-data text-g-muted">
            {cameras.length - offline}/{cameras.length} live
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

      <div className="flex-1 min-h-0 p-2">
        {focused ? (
          <div className="h-full" data-testid="wall-focus">
            <Tile cam={focused} clock={clock} focused onClick={() => setFocusId(null)} />
          </div>
        ) : (
          <div className="h-full grid grid-cols-3 grid-rows-3 gap-2">
            {cameras.slice(0, 9).map((c) => (
              <Tile key={c.id} cam={c} clock={clock} onClick={() => setFocusId(c.id)} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
