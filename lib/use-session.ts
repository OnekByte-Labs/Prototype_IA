"use client";

import useSWR from "swr";

export type Session = {
  id: number;
  username: string;
  display_name: string;
  role: string;
  permissions: string[];
  scope_type: "battalion" | "company" | "post";
  scope_id: string | null;
  session_id: string;
  must_change_password: boolean;
  site?: { site_name: string; classification: string };
};

async function fetchMe(url: string): Promise<Session> {
  const res = await fetch(url, { cache: "no-store" });
  if (res.status === 401 || res.status === 403) {
    // Session ended (expired, idle, revoked, disabled): back to sign-in
    if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
    }
    throw new Error("signed out");
  }
  if (!res.ok) throw new Error(`session check failed (${res.status})`);
  return res.json();
}

/** The signed-in user. Re-validated every minute so revoked sessions end promptly. */
export function useSession() {
  const { data, error, mutate } = useSWR<Session>("/api/auth/me", fetchMe, {
    refreshInterval: 60000,
    revalidateOnFocus: true,
    shouldRetryOnError: false,
  });
  const can = (perm: string) => !!data?.permissions.includes(perm);
  return { session: data ?? null, error, can, refresh: mutate };
}

export async function signOut() {
  await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
  window.location.href = "/login";
}
