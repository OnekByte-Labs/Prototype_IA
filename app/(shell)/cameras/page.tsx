import type { Metadata } from "next";
import { CamerasConsole } from "@/components/gotham/cameras/CamerasConsole";

export const metadata: Metadata = {
  title: "Cameras · ISCC Watchfloor",
};

export default function CamerasPage() {
  return <CamerasConsole />;
}
