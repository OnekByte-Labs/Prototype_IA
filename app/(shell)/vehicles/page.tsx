import type { Metadata } from "next";
import { VehiclesConsole } from "@/components/gotham/vehicles/VehiclesConsole";

export const metadata: Metadata = {
  title: "Vehicle Intelligence & ANPR · ISCC Watchfloor",
  description: "Automated license plate recognition and multi-camera vehicle tracking across cantonment sectors.",
};

export default function VehiclesPage() {
  return <VehiclesConsole />;
}
