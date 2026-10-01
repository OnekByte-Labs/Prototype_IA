"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Icon, Input } from "@/components/ds";
import { cx } from "@/lib/design/cx";
import { signOut, useSession } from "@/lib/use-session";

const IDLE_MS = 15 * 60 * 1000;

/**
 * Unattended-terminal lock. After 15 minutes without input the console dims and
 * demands the operator password again. Any key or pointer event resets the timer.
 */
export function LockOverlay() {
  const [locked, setLocked] = useState(false);
  const [pw, setPw] = useState("");
  const [bad, setBad] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { session } = useSession();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (locked) return;

    const arm = () => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setLocked(true), IDLE_MS);
    };

    const events = ["mousemove", "mousedown", "keydown", "wheel", "touchstart"] as const;
    events.forEach((e) => window.addEventListener(e, arm, { passive: true }));
    arm();

    return () => {
      clearTimeout(timer.current);
      events.forEach((e) => window.removeEventListener(e, arm));
    };
  }, [locked]);

  if (!locked) return null;

  const unlock = async () => {
    if (pw.trim().length === 0 || busy) return;
    setBusy(true);
    try {
      // Re-authenticates the signed-in user against the backend (audited; failures count toward lockout)
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pw }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 423 || res.status === 403) {
        await signOut();
        return;
      }
      if (!res.ok) {
        setBad(body.error ?? "Incorrect password");
        setTimeout(() => setBad(null), 1500);
        return;
      }
      setPw("");
      setLocked(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="lock-overlay" className="theme-glass fixed inset-0 z-[300] bg-canvas/95 flex items-center justify-center">
      <div
        className={cx(
          "w-[360px] bg-raised border rounded-xl shadow-pop p-6 flex flex-col gap-4",
          bad ? "border-crit animate-shake" : "border-line",
        )}
      >
        <div className="flex items-center gap-3">
          <span className="w-10 h-10 rounded-md bg-surface border border-line shadow-key flex items-center justify-center text-warn-ink">
            <Icon name="lock" size={20} />
          </span>
          <div>
            <h2 className="text-headline text-ink">Session locked</h2>
            <p className="text-caption text-ink-2">No activity for 15 minutes</p>
          </div>
        </div>
        <p className="text-ui text-ink-2">
          <span className="text-ink font-medium">{session?.display_name ?? "—"}</span>
          <span className="text-ink-3"> · {session?.username}</span>
        </p>
        <div className="flex flex-col gap-2">
          <Input
            autoFocus
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void unlock()}
            placeholder="Password"
            aria-label="Operator password"
          />
          {bad && <span className="text-caption text-crit-ink">{bad}</span>}
        </div>
        <div className="flex flex-col gap-2">
          <Button variant="primary" size="lg" onClick={() => void unlock()} disabled={busy}>
            Resume session
          </Button>
          <Button variant="ghost" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </div>
    </div>
  );
}
