import type { Metadata } from "next";
import { TacticalMapConsole } from "@/components/map/gis/TacticalMapConsole";

export const metadata: Metadata = {
  title: "Tactical map · ARGUS",
  description: "Battalion → Company → Post → Camera tactical GIS with live status, FOV and coverage analysis.",
};

/** Tactical GIS. `?camera=CAM-07` opens a camera, `?company=COY-01` a company (NVR / ingest health), `?alert=<id>&camera=<id>` focuses an alert's origin. */
export default async function MapPage({ searchParams }: PageProps<"/map">) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  return <TacticalMapConsole initialCameraId={one(sp.camera)} initialAlertId={one(sp.alert)} initialCompanyId={one(sp.company)} />;
}
