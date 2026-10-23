import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { Readable } from "stream";

// Map camera IDs and stems to actual filenames in Dataset / 5090
const VIDEO_MAP: Record<string, { raw: string; annotated: string }> = {
  cam_01: {
    raw: "anpr_footage1.mp4",
    annotated: "anpr_footage1_annotated.mp4",
  },
  cam_02: {
    raw: "anpr_footage2.mp4",
    annotated: "anpr_footage2_annotated.mp4",
  },
  cam_03: {
    raw: "indain_road_footage3.mp4",
    annotated: "indain_road_footage3_annotated.mp4",
  },
  cam_04: {
    raw: "indian_road_footage2.mp4",
    annotated: "indian_road_footage2_annotated.mp4",
  },
  cam_05: {
    raw: "indian_road_footages1.mp4",
    annotated: "indian_road_footages1_annotated.mp4",
  },
  anpr_footage1: {
    raw: "anpr_footage1.mp4",
    annotated: "anpr_footage1_annotated.mp4",
  },
  anpr_footage2: {
    raw: "anpr_footage2.mp4",
    annotated: "anpr_footage2_annotated.mp4",
  },
  indain_road_footage3: {
    raw: "indain_road_footage3.mp4",
    annotated: "indain_road_footage3_annotated.mp4",
  },
  indian_road_footage2: {
    raw: "indian_road_footage2.mp4",
    annotated: "indian_road_footage2_annotated.mp4",
  },
  indian_road_footages1: {
    raw: "indian_road_footages1.mp4",
    annotated: "indian_road_footages1_annotated.mp4",
  },
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const url = new URL(request.url);
  const type = url.searchParams.get("type") === "annotated" ? "annotated" : "raw";

  // Normalize name
  const cleanName = name.toLowerCase().replace(/\.mp4$/i, "").replace("cam-", "cam_");
  const mapping = VIDEO_MAP[cleanName];

  let filePath: string | null = null;
  const cwd = process.cwd();

  if (mapping) {
    if (type === "annotated") {
      const p = path.resolve(cwd, "5090/Test/output", mapping.annotated);
      if (fs.existsSync(p)) filePath = p;
    }
    if (!filePath) {
      const p = path.resolve(cwd, "Dataset/vehical_TYPE-ANPR_DETECTION", mapping.raw);
      if (fs.existsSync(p)) filePath = p;
    }
  }

  // Fallback direct check
  if (!filePath) {
    const rawDirect = path.resolve(cwd, "Dataset/vehical_TYPE-ANPR_DETECTION", `${cleanName}.mp4`);
    const annDirect = path.resolve(cwd, "5090/Test/output", `${cleanName}_annotated.mp4`);
    if (type === "annotated" && fs.existsSync(annDirect)) {
      filePath = annDirect;
    } else if (fs.existsSync(rawDirect)) {
      filePath = rawDirect;
    } else if (fs.existsSync(annDirect)) {
      filePath = annDirect;
    }
  }


  if (!filePath || !fs.existsSync(filePath)) {
    return new NextResponse(JSON.stringify({ error: `Video not found: ${name} (${type})` }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = request.headers.get("range");

  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

    if (start >= fileSize || end >= fileSize) {
      return new NextResponse(null, {
        status: 416,
        headers: {
          "Content-Range": `bytes */${fileSize}`,
        },
      });
    }

    const chunksize = end - start + 1;
    const fileStream = fs.createReadStream(filePath, { start, end });
    const webStream = Readable.toWeb(fileStream) as unknown as ReadableStream;

    return new NextResponse(webStream, {
      status: 206,
      headers: {
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": String(chunksize),
        "Content-Type": "video/mp4",
        "Cache-Control": "public, max-age=3600",
      },
    });
  }

  // No range requested - stream full file
  const fileStream = fs.createReadStream(filePath);
  const webStream = Readable.toWeb(fileStream) as unknown as ReadableStream;

  return new NextResponse(webStream, {
    status: 200,
    headers: {
      "Content-Length": String(fileSize),
      "Accept-Ranges": "bytes",
      "Content-Type": "video/mp4",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
