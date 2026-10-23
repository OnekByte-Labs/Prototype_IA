import type { Metadata } from "next";
import { AnprConsole } from "@/components/anpr/AnprConsole";

export const metadata: Metadata = {
  title: "ANPR console · ARGUS",
  description: "Automated number plate recognition across tactical cameras, newest first",
};

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function AnprPage({ searchParams }: PageProps<"/anpr">) {
  const { plate, camera } = await searchParams;
  return (
    <AnprConsole
      initialPlate={one(plate)}
      initialCamera={one(camera)}
    />
  );
}
