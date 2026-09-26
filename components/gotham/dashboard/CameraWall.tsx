"use client";

import { useEffect, useState, useRef } from "react";
import Hls from "hls.js";
import { Icon } from "@/components/ui/Icon";
import type { Camera } from "@/lib/gotham/model";
import { useConsole } from "../ConsoleProvider";
import { useClock } from "../hooks";
import { MicroLabel, StatusDot } from "../primitives";

function DecoupledStream({ cam }: { cam: Camera }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Store the last 600 frames (approx 20 seconds) of metadata
  const metadataBuffer = useRef<any[]>([]);

  useEffect(() => {
    if (!cam.metadataUrl || !cam.aiEnabled) return;
    
    const evtSource = new EventSource(cam.metadataUrl);
    evtSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (typeof data.video_time_sec === 'number') {
            metadataBuffer.current.push(data);
            // Keep buffer size manageable
            if (metadataBuffer.current.length > 600) {
                metadataBuffer.current.shift();
            }
        }
      } catch (e) {}
    };

    return () => evtSource.close();
  }, [cam.metadataUrl, cam.aiEnabled]);

  useEffect(() => {
    let animationId: number;

    const renderLoop = () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video && canvas) {
        const ctx = canvas.getContext("2d");
        if (ctx) {
          if (canvas.width !== video.videoWidth && video.videoWidth > 0) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
          }

          ctx.clearRect(0, 0, canvas.width, canvas.height);

          if (cam.aiEnabled && metadataBuffer.current.length > 0) {
            const buffer = metadataBuffer.current;
            const duration = video.duration || 60;
            
            // Because the backend loops, video_time_sec goes to infinity. 
            // We modulo it so it matches the video's local 0->duration time.
            let latestBackendTime = buffer[buffer.length - 1].video_time_sec % duration;
            
            // 1. YouTube-style Buffering:
            // If the video plays faster than the AI can process, pause the video and wait!
            // If the AI is ahead of the video, let the video play smoothly.
            if (Math.abs(video.currentTime - latestBackendTime) > 1.0) {
                // Snap in either direction (if newly mounted or if backend loops mock data)
                video.currentTime = latestBackendTime;
            } else if (video.currentTime > latestBackendTime + 0.1) {
                if (!video.paused) video.pause();
            } else if (video.currentTime < latestBackendTime) {
                if (video.paused) {
                    const playPromise = video.play();
                    if (playPromise !== undefined) {
                        playPromise.catch(() => {});
                    }
                }
            }

            // 2. Find the absolutely closest metadata to the current video time
            let closestData = buffer[0];
            let minDiff = Infinity;
            for (let i = 0; i < buffer.length; i++) {
                const diff = Math.abs((buffer[i].video_time_sec % duration) - video.currentTime);
                if (diff < minDiff) {
                    minDiff = diff;
                    closestData = buffer[i];
                }
            }

            const boxes = closestData.detections;
            
            // Only draw if we found a match within a reasonable threshold (0.5s)
            if (boxes && minDiff < 0.5) {
              boxes.forEach((box: any) => {
                let x = box.x;
                let y = box.y;
                let w = box.w;
                let h = box.h;
                if (w < 0) { x += w; w = -w; }
                if (h < 0) { y += h; h = -h; }
                
                // Tactical UI Colors
                const isVehicle = ['car', 'truck', 'bus', 'motorcycle'].includes(box.class?.toLowerCase());
                // Sky blue for vehicles, amber for others
                const strokeColor = isVehicle ? 'rgba(56, 189, 248, 0.9)' : 'rgba(251, 191, 36, 0.9)'; 
                const bgColor = isVehicle ? 'rgba(12, 74, 110, 0.85)' : 'rgba(120, 53, 15, 0.85)';
                
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
                
                // 3. Label text (e.g. "CAR · 85%")
                const confPercent = Math.round((box.confidence || 0) * 100);
                const className = (box.class || 'OBJ').toUpperCase();
                const mainLabel = `${className} · ${confPercent}%`;
                
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
                
                // 6. Distinct License Plate Badge (if detected)
                if (box.plate) {
                    const plateLabel = box.plate;
                    ctx.font = `700 ${fontSize + 2}px monospace`;
                    const pWidth = ctx.measureText(plateLabel).width;
                    
                    // Draw at the bottom of the bounding box
                    ctx.fillStyle = "rgba(251, 191, 36, 0.95)"; // Bright amber
                    ctx.fillRect(x, y + h, pWidth + 16, textHeight + 12);
                    
                    ctx.fillStyle = "#000000"; // Black text
                    ctx.fillText(plateLabel, x + 8, y + h + textHeight + 5);
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
  }, [cam.aiEnabled]);

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
