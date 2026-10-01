import type { Metadata } from "next";
import { CameraConsole } from "@/components/cameras/CameraConsole";

export const metadata: Metadata = {
  title: "Tactical Cameras · ARGUS",
  description: "Live 32-camera surveillance matrix with optical video ingest, real-time AI analytics, and sector telemetry.",
};

/** `?inspect=CAM-07` opens that camera's inspector (linked from the tactical map). */
export default async function CamerasPage({ searchParams }: PageProps<"/cameras">) {
  const { inspect } = await searchParams;
  return <CameraConsole key={String(inspect ?? "")} initialInspectId={Array.isArray(inspect) ? inspect[0] : inspect} />;
}
