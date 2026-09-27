import re

with open('E:/MIlitary_Prototype_IA/components/gotham/dashboard/CameraWall.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# We need to find the LiveMJPEGStream renderLoop boxes.forEach logic and replace it,
# AND append the if (cam.analytics) logic.
# It is simpler to just overwrite LiveMJPEGStream's renderLoop entirely.

match = re.search(r'function LiveMJPEGStream\(\{ cam, isHidden \}: \{ cam: Camera; isHidden\?: boolean \}\) \{.*?(?=function Tile)', content, re.DOTALL)
if not match:
    print("Could not find LiveMJPEGStream")
    exit(1)

live_mjpeg = match.group(0)

new_live_mjpeg = r'''function LiveMJPEGStream({ cam, isHidden }: { cam: Camera; isHidden?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const latestData = useRef<any>(null);

  useEffect(() => {
    if (!cam.metadataUrl || !cam.aiEnabled) return;
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
      if (isHidden) {
          animationId = requestAnimationFrame(renderLoop);
          return;
      }
      const img = imgRef.current;
      const canvas = canvasRef.current;
      if (img && canvas) {
        const ctx = canvas.getContext("2d");
        if (ctx) {
          // Sync canvas size to intrinsic image size (assuming 16:9 1920x1080 typical)
          const vw = img.naturalWidth || 1920;
          const vh = img.naturalHeight || 1080;
          if (canvas.width !== vw && vw > 0) {
            canvas.width = vw;
            canvas.height = vh;
          }

          ctx.clearRect(0, 0, canvas.width, canvas.height);

          if (cam.aiEnabled && latestData.current && latestData.current.detections) {
            const boxes = latestData.current.detections;
            
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
                
                // Tactical UI Colors
                const isVehicle = ['car', 'truck', 'bus', 'motorcycle'].includes(objClass);
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
                const mainLabel = ${className} · %;
                
                const fontSize = Math.max(10, canvas.width / 130);
                ctx.font = 600 px "Inter", sans-serif;
                const textWidth = ctx.measureText(mainLabel).width;
                const textHeight = fontSize;
                
                ctx.fillStyle = bgColor;
                ctx.fillRect(x, y - textHeight - 8, textWidth + 10, textHeight + 8);
                
                ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
                ctx.fillText(mainLabel, x + 5, y - 5);
                
                let displayPlate = box.plate;
                if (displayPlate) {
                   const plateStr = String(displayPlate).replace(/\s/g, '');
                   if (plateStr.length < 6 || confidence < 0.30) {
                      displayPlate = undefined;
                   }
                }

                if (displayPlate) {
                    ctx.font = 700 px monospace;
                    const pWidth = ctx.measureText(displayPlate).width;
                    
                    ctx.fillStyle = "rgba(251, 191, 36, 0.95)";
                    ctx.fillRect(x, y + h, pWidth + 16, textHeight + 12);
                    
                    ctx.fillStyle = "#000000";
                    ctx.fillText(displayPlate, x + 8, y + h + textHeight + 5);
                }
            });

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
                
                const midIdx = Math.floor(pts.length / 2);
                const lx = pts[midIdx][0] * scaleX;
                const ly = pts[midIdx][1] * scaleY - 12;
                ctx.font = "bold 11px monospace";
                ctx.fillStyle = "rgba(0, 200, 255, 0.9)";
                ctx.fillText("▼ COUNTING LINE", lx - 50, ly);

                const countEvent = latestData.current.events?.find((e: any) => e.type === 'traffic_count');
                const totalCount = countEvent?.total_count ?? 0;
                
                const scale = Math.max(canvas.width / 960, 1);
                const badgeW = Math.round(140 * scale);
                const badgeH = Math.round(56 * scale);
                const bx = Math.round(14 * scale);
                const by = Math.round(14 * scale);
                const pad = Math.round(12 * scale);
                ctx.fillStyle = "rgba(0, 0, 0, 0.75)";
                ctx.beginPath();
                ctx.roundRect(bx, by, badgeW, badgeH, 8);
                ctx.fill();
                ctx.strokeStyle = "rgba(0, 200, 255, 0.6)";
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.roundRect(bx, by, badgeW, badgeH, 8);
                ctx.stroke();
                ctx.font = old px monospace;
                ctx.fillStyle = "#00c8ff";
                ctx.fillText("VEHICLES", bx + pad, by + Math.round(22 * scale));
                ctx.font = old px monospace;
                ctx.fillStyle = "#ffffff";
                ctx.fillText(String(totalCount), bx + pad, by + Math.round(48 * scale));
              } else if (cam.analytics.type === 'intrusion_zone' && cam.analytics.zone) {
                const pts = cam.analytics.zone;
                ctx.beginPath();
                ctx.moveTo(pts[0][0] * scaleX, pts[0][1] * scaleY);
                for (let i = 1; i < pts.length; i++) {
                  ctx.lineTo(pts[i][0] * scaleX, pts[i][1] * scaleY);
                }
                ctx.closePath();
                
                const hasIntrusion = latestData.current.events?.some((e: any) => e.type === 'intrusion');
                const zScale = Math.max(canvas.width / 960, 1);
                
                if (hasIntrusion) {
                  ctx.fillStyle = "rgba(255, 0, 0, 0.3)";
                  ctx.fill();
                  ctx.strokeStyle = "rgba(255, 0, 0, 0.9)";
                  ctx.lineWidth = 3;
                  ctx.stroke();
                  
                  const labelX = pts[0][0] * scaleX + Math.round(20 * scaleX);
                  const labelY = (pts[0][1] * scaleY + pts[pts.length - 1][1] * scaleY) / 2;
                  ctx.font = old px monospace;
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
                    ctx.font = old px monospace;
                    ctx.fillStyle = "#ffffff";
                    ctx.textAlign = "center";
                    ctx.fillText("⚠ INTRUSION ALERT", canvas.width / 2, by + Math.round(26 * zScale));
                    ctx.textAlign = "start";
                  }
                } else {
                  ctx.fillStyle = "rgba(0, 255, 0, 0.25)";
                  ctx.fill();
                  ctx.strokeStyle = "rgba(0, 255, 0, 0.8)";
                  ctx.lineWidth = 2;
                  ctx.stroke();
                  
                  const labelX = pts[0][0] * scaleX + Math.round(20 * scaleX);
                  const labelY = (pts[0][1] * scaleY + pts[pts.length - 1][1] * scaleY) / 2;
                  ctx.font = old px monospace;
                  ctx.fillStyle = "rgba(0, 255, 0, 0.9)";
                  ctx.fillText("INTRUSION ZONE", labelX, labelY);
                }
              }
            }
          }
        }
      }
      animationId = requestAnimationFrame(renderLoop);
    };
    
    animationId = requestAnimationFrame(renderLoop);
    return () => cancelAnimationFrame(animationId);
  }, [cam.aiEnabled, isHidden]);

  return (
    <>
      <img
        ref={imgRef}
        src={cam.mjpegUrl}
        className={bsolute inset-0 w-full h-full object-contain z-0 }
        alt="Live Stream"
      />
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full object-contain z-10 pointer-events-none"
      />
    </>
  );
}
'''

content = content.replace(live_mjpeg, new_live_mjpeg)

with open('E:/MIlitary_Prototype_IA/components/gotham/dashboard/CameraWall.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
print("Updated LiveMJPEGStream!")
