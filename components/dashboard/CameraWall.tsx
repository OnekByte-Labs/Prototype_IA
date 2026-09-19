import { useEffect, useRef } from "react";
import Hls from "hls.js";
import { Icon } from "@/components/ui/Icon";
import { Panel } from "@/components/ui/Panel";
import { useCameras, type Camera } from "@/lib/dashboard-data";
function CameraTile({ camera }: { camera: Camera }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!videoRef.current || !camera.hlsUrl) return;

    let hls: Hls | null = null;
    const video = videoRef.current;

    if (Hls.isSupported()) {
      hls = new Hls({
        enableWorker: false,
        lowLatencyMode: true,
      });
      hls.loadSource(camera.hlsUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => {
          // Ignore autoplay failures
        });
      });
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      // For Safari where HLS is natively supported
      video.src = camera.hlsUrl;
      video.addEventListener("loadedmetadata", () => {
        video.play().catch(() => {});
      });
    }

    return () => {
      if (hls) {
        hls.destroy();
      }
    };
  }, [camera.hlsUrl]);

  return (
    <div className="relative bg-well border border-brand-border flex flex-col justify-between overflow-hidden">
      <div className="flex justify-between items-center p-1 z-10">
        <div className="flex items-center space-x-1">
          <span className="w-1.5 h-1.5 bg-brand-red" />
          <span className="text-[9px] font-mono font-bold text-brand-red tracking-wider">
            REC
          </span>
        </div>
        <span className="w-1.5 h-1.5 bg-brand-green" />
      </div>
      {/* Reticle */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-20 z-20">
        <div className="w-8 h-8 border border-white/40" />
      </div>
      
      {/* Video Player */}
      <div className="absolute inset-0 z-0">
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className="w-full h-full object-cover"
        />
      </div>
      <div className="z-10 bg-black/60 px-1.5 py-0.5 text-[9px] font-mono text-fg-1 truncate">
        {camera.label}
      </div>
    </div>
  );
}

function CameraTileOffline({ camera }: { camera: Camera }) {
  return (
    <div className="relative bg-brand-bg border border-dashed border-brand-red flex flex-col justify-between items-center p-1 overflow-hidden">
      <div className="w-full flex justify-between items-center text-[9px] font-mono text-brand-red">
        <span>NO SIGNAL</span>
        <span className="w-1.5 h-1.5 bg-brand-red" />
      </div>
      <div className="flex flex-col items-center justify-center text-center">
        <Icon name="videocam_off" size={20} className="text-brand-red mb-1" />
        <span className="text-[9px] font-mono font-bold text-brand-red tracking-wider">
          NO SIGNAL // LOSS OF CARRIER
        </span>
      </div>
      <div className="w-full bg-black/60 px-1.5 py-0.5 text-[9px] font-mono text-fg-3 truncate">
        {camera.label}
      </div>
    </div>
  );
}

/** 3x3 camera wall. */
export function CameraWall() {
  const { cameras, isLoading } = useCameras();
  return (
    <Panel className="flex-1 p-1.5 flex flex-col min-h-0 overflow-hidden">
      <div className="grid grid-cols-3 grid-rows-3 gap-1.5 flex-1 min-h-0">
        {isLoading ? (
          <div className="col-span-3 row-span-3 flex items-center justify-center text-outline">
            Loading cameras...
          </div>
        ) : cameras.map((camera) =>
          camera.online ? (
            <CameraTile key={camera.id} camera={camera} />
          ) : (
            <CameraTileOffline key={camera.id} camera={camera} />
          ),
        )}
      </div>
    </Panel>
  );
}
