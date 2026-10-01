"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { ConsoleProvider } from "./ConsoleProvider";
import { GlassDock, GlassFooter, GlassTitleBar } from "./dashboard/GlassChrome";
import { GlassPanel } from "./dashboard/glass";
import { LockOverlay } from "./LockOverlay";
import { ToastProvider } from "./Toast";

/**
 * Providers + the persistent liquid-glass chrome: title bar on top, bottom
 * dock, footer. Mounted once, so it never remounts across navigation. The
 * dashboard lays its own panels on the canvas; every other screen sits inside
 * one glass panel so all pages share the same surface language.
 */
export function Chrome({ children }: { children: ReactNode }) {
  const bare = usePathname().startsWith("/dashboard");
  return (
    <ToastProvider>
      <ConsoleProvider>
        <div className="theme-glass w-screen h-screen overflow-hidden bg-canvas text-ink flex flex-col p-3 gap-2.5">
          <GlassTitleBar />
          <main className="flex-1 min-h-0 flex flex-col overflow-hidden">
            {bare ? (
              children
            ) : (
              <GlassPanel as="div" className="flex-1 min-h-0 rounded-2xl flex flex-col overflow-hidden">
                {children}
              </GlassPanel>
            )}
          </main>
          <GlassDock />
          <GlassFooter />
        </div>
        <LockOverlay />
      </ConsoleProvider>
    </ToastProvider>
  );
}
