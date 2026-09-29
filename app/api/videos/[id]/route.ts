import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

// Map internal camera IDs to their actual video filenames in the dataset
const CAM_FILES: Record<string, string> = {
  "cam_01": "4K Road traffic video for object detection and tracking.mp4",
  "cam_02": "Animal_car.mp4",
  "cam_03": "Person.mp4",
  "cam_04": "Person_crossing_line.mp4",
  "cam_05": "Robbery.mp4",
  "cam_06": "Traffic Control CCTV.mp4",
  "cam_07": "pedestrian_2.mp4",
  "cam_08": "person-bicycle-car-detection.mp4",
  "cam_09": "feed-worker-zone-intrusion.mp4",
  "cam_10": "pedestrian_2.mp4",
  "cam_11": "Animal_car.mp4",
  "cam_12": "Person_crossing_line.mp4"
};

const CHUNK_SIZE_MAX = 4 * 1024 * 1024; // 4MB maximum chunk per range response

function nodeStreamToWebStream(stream: fs.ReadStream): ReadableStream {
  let isClosed = false;
  return new ReadableStream({
    start(controller) {
      stream.on("data", (chunk) => {
        if (isClosed) return;
        try {
          controller.enqueue(chunk);
        } catch {
          isClosed = true;
          stream.destroy();
        }
      });
      stream.on("end", () => {
        if (isClosed) return;
        isClosed = true;
        try {
          controller.close();
        } catch {}
      });
      stream.on("error", (err) => {
        if (isClosed) return;
        isClosed = true;
        try {
          controller.error(err);
        } catch {}
      });
      stream.on("close", () => {
        if (!isClosed) {
          isClosed = true;
          try {
            controller.close();
          } catch {}
        }
      });
    },
    cancel() {
      isClosed = true;
      stream.destroy();
    },
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const internalId = id.toLowerCase().replace("cam-", "cam_");
  
  const filename = CAM_FILES[internalId];
  if (!filename) {
    return new NextResponse("Video not found", { status: 404 });
  }

  // Absolute path to the dataset folder
  const videoPath = path.resolve(process.cwd(), "Dataset/Test", filename);
  
  if (!fs.existsSync(videoPath)) {
    return new NextResponse("Video file missing on disk", { status: 404 });
  }

  const stat = fs.statSync(videoPath);
  const fileSize = stat.size;
  const range = request.headers.get("range");

  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    // If range is open-ended (e.g. bytes=0-), cap to CHUNK_SIZE_MAX so 444MB 4K files don't choke the socket
    let end = parts[1] ? parseInt(parts[1], 10) : start + CHUNK_SIZE_MAX - 1;
    if (end >= fileSize) {
      end = fileSize - 1;
    }
    const chunksize = (end - start) + 1;
    
    const file = fs.createReadStream(videoPath, { start, end });
    const webStream = nodeStreamToWebStream(file);
    
    return new NextResponse(webStream as unknown as BodyInit, {
      status: 206,
      headers: {
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunksize.toString(),
        "Content-Type": "video/mp4",
        "Cache-Control": "public, max-age=3600, immutable",
      },
    });
  } else {
    // Return first 4MB if no range specified
    const end = Math.min(CHUNK_SIZE_MAX - 1, fileSize - 1);
    const chunksize = end + 1;
    const file = fs.createReadStream(videoPath, { start: 0, end });
    const webStream = nodeStreamToWebStream(file);
    
    return new NextResponse(webStream as unknown as BodyInit, {
      status: 200,
      headers: {
        "Accept-Ranges": "bytes",
        "Content-Length": chunksize.toString(),
        "Content-Type": "video/mp4",
        "Cache-Control": "public, max-age=3600, immutable",
      },
    });
  }
}
