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
    const content = fs.readFileSync(filePath, "utf-8");
    return new NextResponse(content, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache, no-store, max-age=0, must-revalidate",
      },
    });
  } catch (err) {
    console.error(`[precomputed] Error reading ${filePath}:`, err);
    return new NextResponse(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
