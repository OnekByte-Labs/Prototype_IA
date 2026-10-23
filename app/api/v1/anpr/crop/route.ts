import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import anprLogsData from "@/lib/datasets/anpr_logs.json";

// Video mapping for cameras
const VIDEO_PATHS: Record<string, string> = {
  "CAM-01": "Dataset/vehical_TYPE-ANPR_DETECTION/anpr_footage1.mp4",
  "CAM-02": "Dataset/vehical_TYPE-ANPR_DETECTION/anpr_footage2.mp4",
  "CAM-03": "Dataset/vehical_TYPE-ANPR_DETECTION/indain_road_footage3.mp4",
  "CAM-04": "Dataset/vehical_TYPE-ANPR_DETECTION/indian_road_footage2.mp4",
  "CAM-05": "Dataset/vehical_TYPE-ANPR_DETECTION/indian_road_footages1.mp4",
};

/**
 * On-the-fly dynamic vehicle crop extractor (Option A)
 * Serves cached crop if present, or dynamically invokes OpenCV to extract from video frame on demand.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  const plate = url.searchParams.get("plate");
  const queryCamera = url.searchParams.get("camera");
  const queryFrame = url.searchParams.get("frame");
  const queryBbox = url.searchParams.get("bbox");

  const cwd = process.cwd();
  const cropsDir = path.resolve(cwd, "public/crops/anpr");
  if (!fs.existsSync(cropsDir)) {
    fs.mkdirSync(cropsDir, { recursive: true });
  }

  let targetCamera = queryCamera;
  let targetFrame = queryFrame ? parseInt(queryFrame, 10) : undefined;
  let targetBbox = queryBbox;
  let cacheFileName = "";
  let plateDisplay = "";
  let confidenceVal = "";

  // 1. Try resolving via Log ID or Plate lookup
  if (id || plate) {
    let log = (anprLogsData as any[]).find((l) => l.id === id);
    if (!log && plate) {
      const cleanP = plate.replace(/\s+/g, "").toUpperCase();
      log = (anprLogsData as any[]).find(
        (l) => l.rawPlate === cleanP || l.plate.replace(/\s+/g, "").toUpperCase() === cleanP
      );
    }

    if (log) {
      plateDisplay = log.plate;
      confidenceVal = String(log.confidence);
      targetCamera = targetCamera || log.cameraId;
      targetFrame = targetFrame !== undefined ? targetFrame : log.frameIdx;
      if (Array.isArray(log.bbox) && log.bbox.length === 4 && !targetBbox) {
        targetBbox = log.bbox.join(",");
      }

      // Check if pre-extracted path exists
      if (log.carCropUrl) {
        const directPath = path.resolve(cwd, "public", log.carCropUrl.replace(/^\//, ""));
        if (fs.existsSync(directPath)) {
          const buffer = fs.readFileSync(directPath);
          return new NextResponse(buffer, {
            status: 200,
            headers: {
              "Content-Type": "image/jpeg",
              "Cache-Control": "public, max-age=86400",
              "X-Crop-Source": "cache-hit",
              "X-ANPR-Plate": plateDisplay,
              "X-ANPR-Confidence": confidenceVal,
              "X-ANPR-Frame": String(targetFrame ?? 0),
            },
          });
        }
        cacheFileName = path.basename(directPath);
      }
    }
  }

  // 2. Determine target video file
  const camKey = (targetCamera || "CAM-01").toUpperCase();
  const relVideo = VIDEO_PATHS[camKey] || VIDEO_PATHS["CAM-01"];
  const absVideo = path.resolve(cwd, relVideo);

  if (!fs.existsSync(absVideo)) {
    return new NextResponse(
      JSON.stringify({ error: `Video source for camera ${camKey} not found on server` }),
      { status: 404, headers: { "Content-Type": "application/json" } }
    );
  }

  // 3. Fallback default bbox & frame if unspecified
  const safeFrame = targetFrame !== undefined && !isNaN(targetFrame) ? targetFrame : 10;
  const safeBbox = targetBbox || "200,200,300,200";

  if (!cacheFileName) {
    const cleanBbox = safeBbox.replace(/[^0-9,]/g, "").replace(/,/g, "_");
    cacheFileName = `dyn_${camKey.toLowerCase()}_f${safeFrame}_${cleanBbox}.jpg`;
  }

  const absCropPath = path.resolve(cropsDir, cacheFileName);

  // 4. Check dynamic cache on disk
  if (fs.existsSync(absCropPath)) {
    const buffer = fs.readFileSync(absCropPath);
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=86400",
        "X-Crop-Source": "dynamic-cache-hit",
        "X-ANPR-Camera": camKey,
        "X-ANPR-Frame": String(safeFrame),
      },
    });
  }

  // 5. On-The-Fly Dynamic Generation using backend/extract_single_crop.py
  try {
    const scriptPath = path.resolve(cwd, "backend/extract_single_crop.py");
    execFileSync(
      "python",
      [
        scriptPath,
        "--video",
        absVideo,
        "--frame",
        String(safeFrame),
        "--bbox",
        safeBbox,
        "--out",
        absCropPath,
      ],
      {
        timeout: 5000,
        windowsHide: true,
      }
    );

    if (fs.existsSync(absCropPath)) {
      const buffer = fs.readFileSync(absCropPath);
      return new NextResponse(buffer, {
        status: 200,
        headers: {
          "Content-Type": "image/jpeg",
          "Cache-Control": "public, max-age=86400",
          "X-Crop-Source": "opencv-generated-on-the-fly",
          "X-ANPR-Camera": camKey,
          "X-ANPR-Frame": String(safeFrame),
          "X-ANPR-Plate": plateDisplay,
        },
      });
    } else {
      throw new Error("Worker script finished without creating crop file");
    }
  } catch (err: any) {
    // If dynamic extraction fails, return a graceful fallback reference image
    const fallbackPath = path.resolve(cropsDir, "test_creta.jpg");
    if (fs.existsSync(fallbackPath)) {
      const buffer = fs.readFileSync(fallbackPath);
      return new NextResponse(buffer, {
        status: 200,
        headers: {
          "Content-Type": "image/jpeg",
          "Cache-Control": "no-cache",
          "X-Crop-Source": "fallback-reference",
        },
      });
    }

    return new NextResponse(
      JSON.stringify({
        error: "On-the-fly crop generation failed",
        details: err?.message || String(err),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
