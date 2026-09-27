import type { Metadata } from "next";
import { CameraConsole } from "@/components/cameras/CameraConsole";

export const metadata: Metadata = {
  title: "Tactical Cameras · ISCC Watchfloor",
  description: "Live 32-camera surveillance matrix with optical video ingest, real-time AI analytics, and sector telemetry.",
};

export default function CamerasPage() {
  return <CameraConsole />;
}
