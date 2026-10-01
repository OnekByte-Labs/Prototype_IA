import type { Metadata } from "next";
import { DeviceRegistry } from "@/components/devices/DeviceRegistry";

export const metadata: Metadata = {
  title: "Device registry · ARGUS",
};

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** `?nvr=NVR-03` opens that recorder; `?q=CAM-40` pre-fills the search (linked from Argus Agent). */
export default async function DevicesPage({ searchParams }: PageProps<"/devices">) {
  const { nvr, q } = await searchParams;
  return <DeviceRegistry key={`${one(nvr) ?? ""}|${one(q) ?? ""}`} initialNvr={one(nvr)} initialQuery={one(q)} />;
}
