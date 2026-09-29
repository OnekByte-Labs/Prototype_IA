import { Suspense } from "react";
import type { Metadata } from "next";
import { Dashboard } from "@/components/gotham/dashboard/Dashboard";

export const metadata: Metadata = {
  title: "Dashboard · ISCC Watchfloor",
};

export default function DashboardPage() {
  return (
    <Suspense fallback={null}>
      <Dashboard />
    </Suspense>
  );
}
