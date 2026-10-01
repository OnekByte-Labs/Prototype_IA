import type { Metadata } from "next";
import { AlertConsole } from "@/components/gotham/alerts/AlertConsole";

export const metadata: Metadata = {
  title: "Alert console · ARGUS",
};

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** `?alert=INC-000123` / `?incident=INCD-000042` open that alert (linked from Argus Agent). */
export default async function AlertsPage({ searchParams }: PageProps<"/alerts">) {
  const { alert, incident } = await searchParams;
  return (
    <AlertConsole
      key={`${one(alert) ?? ""}|${one(incident) ?? ""}`}
      focusAlert={one(alert)}
      focusIncident={one(incident)}
    />
  );
}
