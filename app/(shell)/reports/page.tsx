import type { Metadata } from "next";
import { ReportsConsole } from "@/components/gotham/reports/ReportsConsole";

export const metadata: Metadata = {
  title: "Incident & Audit Reports · ISCC Watchfloor",
  description: "Tactical incident briefings, cordon breaches, vehicle ANPR logs, and perimeter security audit reports.",
};

export default function ReportsPage() {
  return <ReportsConsole />;
}
