"use client";

import { useEffect, useState, useRef } from "react";
import Hls from "hls.js";
import { Icon } from "@/components/ui/Icon";
import type { Camera } from "@/lib/gotham/model";
import { useClock } from "../hooks";
import { MicroLabel, StatusDot } from "../primitives";

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
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
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
  }, [cam.hlsUrl, cam.online]);

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
      <div className="flex items-center justify-between gap-1">
        <span className="text-micro uppercase text-g-text-2 truncate">
          {cam.id} · {cam.name}
        </span>
        {cam.online ? (
          cam.recording ? (
            <span className="flex items-center gap-1 shrink-0">
              <StatusDot tone="red" className="animate-pulse" />
              <span className="text-micro text-g-muted">REC</span>
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
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              className="absolute inset-0 w-full h-full object-cover z-0"
            />
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
