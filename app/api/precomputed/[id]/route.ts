import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { Readable } from "stream";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const internalId = id.toLowerCase().replace("cam-", "cam_").replace(/[^a-z0-9_]/g, "");

  const filePath = path.resolve(process.cwd(), "backend/outputs/precomputed", `${internalId}.json`);

  if (!fs.existsSync(filePath)) {
    return new NextResponse(JSON.stringify({ error: "Precomputed data not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const fileStream = fs.createReadStream(filePath);
    const webStream = Readable.toWeb(fileStream) as unknown as ReadableStream;
    return new NextResponse(webStream, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=86400, immutable",
      },
    });
  } catch (err) {
    console.error(`[precomputed] Error streaming ${filePath}:`, err);
    return new NextResponse(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
