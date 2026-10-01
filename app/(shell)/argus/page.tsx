import type { Metadata } from "next";
import { ArgusAgent } from "@/components/argus/ArgusAgent";

export const metadata: Metadata = {
  title: "Argus Agent · ARGUS",
  description: "Ask the Command Centre about live cameras, NVRs, alerts and incidents.",
};

export default function ArgusPage() {
  return <ArgusAgent />;
}
