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
  "cam_08": "person-bicycle-car-detection.mp4"
};

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
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunksize = (end - start) + 1;
    const file = fs.createReadStream(videoPath, { start, end });
    
    return new NextResponse(file as any, {
      status: 206,
      headers: {
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunksize.toString(),
        "Content-Type": "video/mp4",
      },
    });
  } else {
    const file = fs.createReadStream(videoPath);
    return new NextResponse(file as any, {
      status: 200,
      headers: {
        "Content-Length": fileSize.toString(),
        "Content-Type": "video/mp4",
      },
    });
  }
}
