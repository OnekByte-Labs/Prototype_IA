"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Dropdown, Icon, MenuItem } from "@/components/ds";
import { cx } from "@/lib/design/cx";
import { isActivePath, navItems } from "@/lib/navigation";
import { signOut, useSession } from "@/lib/use-session";
import { ShortcutHelp } from "../Chrome";
import { useConsole } from "../ConsoleProvider";
import { DatasetRegistryModal } from "./DatasetRegistryModal";
import { GlassIconButton, GlassPanel, Pill } from "./glass";

/* ------------------------------------------------------------------- clock */

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** UTC "ZULU" clock. Empty until mounted so server and client markup agree. */
function useZuluClock() {
  const [text, setText] = useState("--:--:-- UTC · -- --- ---- ZULU");
  useEffect(() => {
    const pad = (n: number) => String(n).padStart(2, "0");
    const tick = () => {
      const d = new Date();
      setText(
        `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC · ${pad(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} ZULU`,
      );
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);
  return text;
}

/* --------------------------------------------------------------- title bar */

/** Floating command bar: identity and AI status, Zulu clock and link, alerts, operator, actions. */
export function GlassTitleBar() {
  const router = useRouter();
  const clock = useZuluClock();
  const { unacked, muted, toggleMute, feedLink, wsConnected, liveStreams } = useConsole();
  const liveAiCount = Object.keys(liveStreams).length;
  const { session } = useSession();
  const [helpOpen, setHelpOpen] = useState(false);
  const [registryOpen, setRegistryOpen] = useState(false);

  const link = feedLink === "up" ? "LIVE" : feedLink === "down" ? "DOWN" : "…";
  const linkTone = feedLink === "up" ? "text-ok-ink" : feedLink === "down" ? "text-crit-ink" : "text-warn-ink";
  const initials = (session?.display_name ?? "?")
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <>
      <GlassPanel variant="bar" className="rounded-2xl px-4 py-2 flex items-center justify-between gap-4 shrink-0 h-[52px]">
        {/* Left: identity + AI pipeline status */}
        <div className="flex items-center gap-4 min-w-0">
          <div aria-hidden="true" className="hidden md:flex items-center gap-1.5 pr-2 border-r border-white/10">
            <span className="w-3 h-3 rounded-full bg-crit border border-crit/60 inline-block" />
            <span className="w-3 h-3 rounded-full bg-warn border border-warn/60 inline-block" />
            <span className="w-3 h-3 rounded-full bg-ok border border-ok/60 inline-block" />
          </div>
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-7 h-7 shrink-0 rounded-lg bg-white/10 flex items-center justify-center text-white shadow-sm ring-1 ring-white/20">
              <Icon name="shield" size={16} filled />
            </div>
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xs font-semibold tracking-tight text-white">ARGUS</span>
              <span className="text-white/20 font-light">/</span>
              <span className="text-xs font-medium text-ink-2 tracking-tight truncate">Command Centre</span>
            </div>
            <Pill tone={liveAiCount ? "ok" : "crit"} dot pulse={!!liveAiCount} className="ml-1 hidden lg:inline-flex" title="Live AI channels reported by the detection pipeline">
              {liveAiCount ? `${liveAiCount} AI CHANNELS LIVE` : "AI PIPELINE OFFLINE"}
            </Pill>
          </div>
        </div>

        {/* Centre: Zulu clock + backend link */}
        <div className="hidden md:flex items-center gap-2 bg-white/[0.04] border border-white/[0.08] rounded-full px-3.5 py-1 text-ink-2 shadow-inner">
          <span className={cx("w-1.5 h-1.5 rounded-full glass-pulse", feedLink === "up" ? "bg-ok-ink" : "bg-warn-ink")} />
          <span data-testid="clock" className="font-data text-[11px] font-medium text-ink tracking-tight">
            {clock}
          </span>
          <span className="text-white/20">|</span>
          <span className="font-data text-[10px] text-ink-3" title="AI backend event link">
            LINK <span className={cx("font-semibold", linkTone)}>{link}</span>
          </span>
        </div>

        {/* Right: alerts, operator, actions */}
        <div className="flex items-center gap-2.5 shrink-0">
          <Link
            href="/alerts"
            data-testid="unack-badge"
            className={cx(
              "flex items-center gap-1.5 border px-2.5 py-1 rounded-full font-data text-[11px] font-medium",
              unacked > 0 ? "bg-crit/10 border-crit/30 text-crit-ink" : "bg-white/[0.06] border-white/15 text-white/90",
            )}
          >
            <span className={cx("w-1.5 h-1.5 rounded-full glass-pulse", unacked > 0 ? "bg-crit-ink" : "bg-white/80")} />
            {unacked} ACTIVE {unacked === 1 ? "ALERT" : "ALERTS"}
          </Link>

          {session ? (
            <Dropdown
              width="w-64"
              trigger={({ toggle, open }) => (
                <button
                  type="button"
                  data-testid="user-menu"
                  onClick={toggle}
                  aria-expanded={open}
                  className="flex items-center gap-2 bg-white/[0.04] border border-white/[0.08] rounded-full pl-1.5 pr-2.5 py-1 hover:bg-white/[0.07] transition"
                >
                  <span className="w-5 h-5 rounded-full bg-gradient-to-tr from-ink-3 to-ink-2 text-black flex items-center justify-center font-semibold text-[9px] ring-1 ring-white/20">
                    {initials}
                  </span>
                  <span className="text-[11px] font-medium text-ink hidden sm:inline">{session.display_name}</span>
                  <span className="text-[9px] font-data text-ink-3 uppercase hidden sm:inline">{session.role}</span>
                  <Icon name="expand_more" size={13} className="text-ink-3" />
                </button>
              )}
            >
              {() => (
                <>
                  <div className="px-3 py-2 mb-1 border-b border-line text-caption text-ink-2 flex flex-col gap-0.5">
                    <span className="text-ui text-ink font-medium">{session.username}</span>
                    <span>Role · {session.role}</span>
                    <span>
                      Scope · {session.scope_type}
                      {session.scope_id ? ` · ${session.scope_id}` : ""}
                    </span>
                    <span className="font-data text-data">Session {session.session_id}</span>
                  </div>
                  <MenuItem testId="sign-out" icon="logout" onClick={() => void signOut()}>
                    Sign out
                  </MenuItem>
                </>
              )}
            </Dropdown>
          ) : (
            <span className="text-[11px] text-ink-3">…</span>
          )}

          <GlassIconButton icon="database" label="Datasets & agent skills registry" onClick={() => setRegistryOpen(true)} />
          <GlassIconButton icon={muted ? "volume_off" : "volume_up"} label={muted ? "Unmute alert tone" : "Mute alert tone"} onClick={toggleMute} />
          <GlassIconButton icon="keyboard" label="Keyboard shortcuts" onClick={() => setHelpOpen(true)} />
          <GlassIconButton icon="settings" label="Administration" onClick={() => router.push("/admin")} />
          <GlassIconButton icon="power_settings_new" label="Sign out" onClick={() => void signOut()} />
        </div>
      </GlassPanel>
      <ShortcutHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
      <DatasetRegistryModal isOpen={registryOpen} onClose={() => setRegistryOpen(false)} />
    </>
  );
}

/* -------------------------------------------------------------------- dock */

/** Stitch labels the map destination "Tactical Map". */
const DOCK_LABEL: Record<string, string> = { Map: "Tactical Map" };

/** Bottom command dock: segmented primary navigation plus session read-outs. */
export function GlassDock() {
  const pathname = usePathname();
  const { unacked, feedLink } = useConsole();
  const { session } = useSession();

  return (
    <GlassPanel as="nav" className="rounded-2xl px-3 py-1 flex items-center justify-between gap-3 shrink-0 h-12 shadow-2xl">
      <div aria-label="Primary" className="flex items-center gap-1 overflow-x-auto">
        {navItems.map(({ label, icon, href }) => {
          const active = href !== undefined && isActivePath(pathname, href);
          const cls = cx(
            "relative px-3 py-1.5 rounded-xl flex items-center gap-1.5 text-xs font-medium whitespace-nowrap transition",
            active
              ? "bg-white/10 text-white border border-white/15 shadow-sm"
              : href
                ? "text-ink-2 hover:text-white hover:bg-white/[0.06]"
                : "text-ink-3 opacity-60",
          );
          const body = (
            <>
              <Icon name={icon} size={16} className={active ? "text-white" : "text-ink-3"} />
              <span>{DOCK_LABEL[label] ?? label}</span>
              {label === "Alerts" && unacked > 0 && (
                <span
                  aria-label={`${unacked} unacknowledged`}
                  className="min-w-4 h-4 px-1 rounded-full bg-crit text-white text-[10px] leading-4 font-semibold text-center tnum"
                >
                  {unacked > 99 ? "99+" : unacked}
                </span>
              )}
            </>
          );
          return href ? (
            <Link key={label} href={href} aria-current={active ? "page" : undefined} className={cls}>
              {body}
            </Link>
          ) : (
            <button key={label} type="button" disabled title={`${label} — not built`} className={cls}>
              {body}
            </button>
          );
        })}
      </div>

      <div className="hidden md:flex items-center gap-3 text-[10px] font-data text-ink-3 pr-2 shrink-0">
        <Pill tone={feedLink === "up" ? "ok" : feedLink === "down" ? "crit" : "warn"} dot>
          {feedLink === "up" ? "AI BACKEND LINKED" : feedLink === "down" ? "AI BACKEND UNREACHABLE" : "CONNECTING"}
        </Pill>
        {session && (
          <>
            <span className="text-white/20">|</span>
            <span>
              SESSION <strong className="text-ink-2 font-semibold">{session.session_id}</strong>
            </span>
          </>
        )}
      </div>
    </GlassPanel>
  );
}

/* ------------------------------------------------------------------ footer */

/** Compliance line and pipeline facts under the dock. */
export function GlassFooter() {
  return (
    <footer className="px-3 py-0.5 text-[9px] font-data text-ink-3 flex justify-between items-center gap-4 shrink-0">
      <div className="tracking-tight text-ink-3/80 truncate">
        RESTRICTED // ARGUS KUPWARA SECTOR // AUTHORISED OPERATORS ONLY // ALL ACCESS IS AUDITED
      </div>
      <div className="hidden md:flex items-center gap-3 shrink-0">
        <span className="text-warn-ink/90 font-medium">AIR-GAPPED</span>
        <span>MEDIAMTX · NVDEC · TENSORRT FP16 · WEBSOCKET</span>
      </div>
    </footer>
  );
}
