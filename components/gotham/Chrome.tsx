"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { isActivePath } from "@/lib/navigation";
import { useConsole } from "./ConsoleProvider";
import { useClock } from "./hooks";
import { MicroLabel } from "./primitives";

/* ------------------------------------------------------------------ icon rail */

type RailItem = { label: string; icon: string; href?: string };

const RAIL: RailItem[] = [
  { label: "Dashboard", icon: "dashboard", href: "/dashboard" },
  { label: "Alerts", icon: "warning", href: "/alerts" },
  { label: "Map", icon: "map", href: "/map" },
  { label: "Devices", icon: "router", href: "/devices" },
  { label: "Cameras", icon: "videocam", href: "/cameras" },
  { label: "Vehicles", icon: "directions_car", href: "/vehicles" },
  { label: "Reports", icon: "description", href: "/reports" },
  { label: "Admin", icon: "admin_panel_settings", href: "/admin" },
];

/** 56px icon rail. Labels are collapsed and surface on hover. */
export function IconRail() {
  const pathname = usePathname();
  const { unacked } = useConsole();

  return (
    <nav
      aria-label="Primary"
      className="w-14 shrink-0 bg-g-panel border-r border-g-border flex flex-col items-stretch py-1 z-40"
    >
      {RAIL.map(({ label, icon, href }) => {
        const active = href !== undefined && isActivePath(pathname, href);
        const inner = (
          <>
            <span
              className={`absolute left-0 top-1 bottom-1 w-0.5 ${active ? "bg-g-blue" : "bg-transparent"}`}
            />
            <Icon name={icon} size={20} className={active ? "text-g-blue" : ""} />
            {label === "Alerts" && unacked > 0 && (
              <span className="absolute top-2 right-2.5 min-w-3 h-3 px-0.5 bg-g-red text-g-bg text-[9px] leading-3 font-data text-center rounded-[2px]">
                {unacked > 99 ? "99" : unacked}
              </span>
            )}
            {/* Collapsed label, revealed on hover */}
            <span className="pointer-events-none absolute left-[calc(100%+1px)] top-1/2 -translate-y-1/2 hidden group-hover:block bg-g-raised border border-g-border-strong px-2 h-6 leading-6 text-ui text-g-text whitespace-nowrap z-50 rounded-[2px]">
              {label}
              {!href && <span className="text-g-muted"> · not built</span>}
            </span>
          </>
        );

        const cls = `group relative h-12 flex items-center justify-center transition-none ${
          active ? "text-g-blue bg-g-raised" : "text-g-text-2 hover:text-g-text hover:bg-g-hover"
        }`;

        return href ? (
          <Link
            key={label}
            href={href}
            title={label}
            aria-current={active ? "page" : undefined}
            className={cls}
          >
            {inner}
          </Link>
        ) : (
          <button key={label} type="button" title={`${label} — not built`} className={cls} disabled>
            {inner}
          </button>
        );
      })}
    </nav>
  );
}

/* --------------------------------------------------------------------- top bar */

const TITLES: { match: string; crumb: string[] }[] = [
  { match: "/dashboard", crumb: ["Watchfloor", "Dashboard"] },
  { match: "/alerts", crumb: ["Watchfloor", "Alert console"] },
  { match: "/map", crumb: ["Watchfloor", "Tactical map"] },
  { match: "/devices", crumb: ["Watchfloor", "Device health"] },
  { match: "/cameras", crumb: ["Watchfloor", "Cameras"] },
  { match: "/vehicles", crumb: ["Watchfloor", "Vehicle intelligence & ANPR"] },
  { match: "/reports", crumb: ["Watchfloor", "Incident & audit reports"] },
  { match: "/admin", crumb: ["Watchfloor", "Administration"] },
];

/** 44px top bar: breadcrumb, live clock, alert badge, operator. Nothing else. */
export function TopBar() {
  const pathname = usePathname();
  const clock = useClock();
  const { unacked, muted, toggleMute } = useConsole();
  const [helpOpen, setHelpOpen] = useState(false);

  const crumb = TITLES.find((t) => isActivePath(pathname, t.match))?.crumb ?? ["Watchfloor"];

  return (
    <header className="h-11 shrink-0 bg-g-panel border-b border-g-border px-3 flex items-center justify-between z-30 relative">
      <div className="flex items-center gap-1.5 w-64">
        {crumb.map((c, i) => (
          <span key={c} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-g-muted">/</span>}
            <span className={i === crumb.length - 1 ? "text-ui text-g-text" : "text-ui text-g-muted"}>
              {c}
            </span>
          </span>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <span data-testid="clock" className="text-data font-data text-g-text tracking-wider">
          {clock}
        </span>
        <MicroLabel>HRS</MicroLabel>
      </div>

      <div className="flex items-center gap-2 w-64 justify-end">
        <button
          type="button"
          title={muted ? "Unmute alert tone" : "Mute alert tone"}
          onClick={toggleMute}
          className="w-7 h-7 flex items-center justify-center text-g-text-2 hover:text-g-text hover:bg-g-hover rounded-[2px]"
        >
          <Icon name={muted ? "volume_off" : "volume_up"} size={16} />
        </button>

        <button
          type="button"
          title="Keyboard shortcuts"
          onClick={() => setHelpOpen((v) => !v)}
          className="w-7 h-7 flex items-center justify-center text-g-text-2 hover:text-g-text hover:bg-g-hover rounded-[2px]"
        >
          <Icon name="help" size={16} />
        </button>

        <Link
          href="/alerts"
          data-testid="unack-badge"
          className={`h-6 px-2 flex items-center gap-1.5 border rounded-[2px] text-data font-data ${
            unacked > 0
              ? "border-g-red/50 text-g-red hover:bg-g-red/10"
              : "border-g-border-strong text-g-muted"
          }`}
        >
          {unacked} unack
        </Link>

        <span className="text-ui text-g-text-2">A. Verma</span>
      </div>

      {helpOpen && <ShortcutHelp onClose={() => setHelpOpen(false)} />}
    </header>
  );
}

const SHORTCUTS: [string, string][] = [
  ["/", "Focus search"],
  ["j / k", "Move down / up the alert rows"],
  ["a", "Acknowledge the selected alert"],
  ["x", "Select / deselect the focused row"],
  ["Esc", "Close panel, popover or selection"],
  ["?", "This help"],
];

function ShortcutHelp({ onClose }: { onClose: () => void }) {
  return (
    <>
      <button
        type="button"
        aria-label="Close shortcuts"
        onClick={onClose}
        className="fixed inset-0 z-40 cursor-default"
      />
      <div
        data-testid="shortcuts"
        className="absolute right-3 top-[calc(100%+4px)] z-50 w-72 bg-g-raised border border-g-border-strong rounded-[4px]"
      >
        <div className="h-8 px-3 flex items-center border-b border-g-border">
          <MicroLabel>Keyboard</MicroLabel>
        </div>
        <ul className="p-2">
          {SHORTCUTS.map(([k, d]) => (
            <li key={k} className="flex items-center justify-between h-6 px-1">
              <span className="text-ui text-g-text-2">{d}</span>
              <kbd className="text-data font-data text-g-text bg-g-bg border border-g-border-strong px-1.5 rounded-[2px]">
                {k}
              </kbd>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
