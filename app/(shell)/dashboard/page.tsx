import type { Metadata } from "next";
import { Dashboard } from "@/components/gotham/dashboard/Dashboard";

export const metadata: Metadata = {
  title: "Dashboard · ARGUS",
};

export default function DashboardPage() {
  return <Dashboard />;
}
