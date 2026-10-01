"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Icon, Input } from "@/components/ds";

/** Sign-in, then — when the account carries a temporary password — the mandatory change. */
export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [stage, setStage] = useState<"login" | "change">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (stage === "login") {
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? `Sign-in failed (${res.status})`);
        if (body.principal?.must_change_password) {
          setStage("change");
          return;
        }
        router.replace(next);
        router.refresh();
      } else {
        if (newPw !== confirm) throw new Error("The new passwords do not match");
        const res = await fetch("/api/auth/password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ current: password, new: newPw }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? `Password change failed (${res.status})`);
        router.replace(next);
        router.refresh();
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="theme-glass h-full flex flex-col items-center justify-center bg-canvas p-6 gap-6 text-ink">
      <form
        onSubmit={submit}
        className="glass-panel w-[400px] max-w-full rounded-2xl p-7 flex flex-col gap-5"
        data-testid="login-form"
      >
        <div className="flex items-center gap-3">
          <span className="w-11 h-11 rounded-xl bg-white/10 ring-1 ring-white/20 flex items-center justify-center text-white">
            <Icon name="shield" size={24} filled />
          </span>
          <div>
            <div className="text-headline tracking-[0.18em] text-white">ARGUS</div>
            <p className="text-caption text-ink-2">Surveillance Command Centre</p>
          </div>
        </div>

        <h1 className="text-section text-ink border-t border-white/[0.06] pt-4">
          {stage === "login" ? "Sign in" : "Choose a new password"}
        </h1>

        <div className="flex flex-col gap-3.5">
          {stage === "login" ? (
            <>
              <Field label="Username">
                <Input autoFocus autoComplete="username" value={username}
                  onChange={(e) => setUsername(e.target.value)} name="username" />
              </Field>
              <Field label="Password">
                <Input type="password" autoComplete="current-password" value={password}
                  onChange={(e) => setPassword(e.target.value)} name="password" />
              </Field>
            </>
          ) : (
            <>
              <p className="text-ui text-ink-2">
                This account has a temporary password. Choose a new one to continue (12+ characters, 3 of:
                lowercase, uppercase, digit, symbol).
              </p>
              <Field label="New password">
                <Input type="password" autoFocus autoComplete="new-password" value={newPw}
                  onChange={(e) => setNewPw(e.target.value)} name="new-password" />
              </Field>
              <Field label="Confirm new password">
                <Input type="password" autoComplete="new-password" value={confirm}
                  onChange={(e) => setConfirm(e.target.value)} name="confirm-password" />
              </Field>
            </>
          )}
          {error && (
            <p className="text-ui text-crit-ink bg-crit-wash rounded-md px-3 py-2" data-testid="login-error">
              {error}
            </p>
          )}
          <Button
            type="submit"
            variant="primary"
            size="lg"
            disabled={busy || (stage === "login" ? !username || !password : !newPw || !confirm)}
          >
            {busy ? "…" : stage === "login" ? "Sign in" : "Set password and continue"}
          </Button>
        </div>
        <p className="text-caption text-ink-3">Every sign-in and administrative action is recorded in the audit log.</p>
      </form>
      <p className="text-[10px] font-data text-ink-3 tracking-tight">RESTRICTED // AUTHORISED OPERATORS ONLY</p>
    </main>
  );
}
