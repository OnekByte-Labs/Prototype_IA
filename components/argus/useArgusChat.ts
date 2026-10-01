"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import useSWR, { mutate as revalidate } from "swr";

/* --------------------------------------------------------------------- types */

export type ToolCall = {
  name: string;
  arguments: Record<string, unknown>;
  ok?: boolean;
  ms?: number;
  as_of?: string | null;
  error?: string | null;
  /** Still running (live turn only). */
  pending?: boolean;
};

export type Source =
  | { kind: "camera" | "alert" | "incident" | "nvr"; id: string; verified: boolean }
  | { kind: "data"; id: string; arguments: Record<string, unknown>; ok: boolean; as_of: string };

export type ChatMessage = {
  id: number | string;
  role: "user" | "assistant";
  content: string;
  tool_calls: ToolCall[];
  sources: Source[];
  status: "complete" | "stopped" | "error" | "streaming";
  created_at: number;
  duration_ms?: number | null;
  error?: string;
  /** Live turn: the model is reasoning before it answers. */
  thinking?: boolean;
};

export type Conversation = {
  conversation_id: string;
  title: string;
  created_at: number;
  updated_at: number;
  messages: number;
};

export type AgentHealth = {
  ok: boolean;
  ollama: "up" | "unreachable";
  model: string;
  model_installed?: boolean;
  model_loaded?: boolean;
  detail?: string | null;
};

type StreamEvent =
  | { type: "start"; conversation_id: string; title: string; user_message: ChatMessage; model: string }
  | { type: "thinking" }
  | { type: "tool_call"; index: number; name: string; arguments: Record<string, unknown> }
  | ({ type: "tool_result"; index: number } & ToolCall)
  | { type: "delta"; text: string }
  | { type: "reset" }
  | { type: "done"; message: ChatMessage }
  | { type: "error"; error: string; message?: ChatMessage }
  | { type: "ping" };

/* ------------------------------------------------------------------- fetching */

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (res.status === 401) {
    void revalidate("/api/auth/me");          // the shell's session check returns to sign-in
    throw new Error("Session expired");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return body as T;
}

export function useAgentHealth() {
  return useSWR<AgentHealth>("/api/agent/health", getJson, { refreshInterval: 15000, revalidateOnFocus: false });
}

/* ----------------------------------------------------------------------- chat */

/**
 * Conversation list + the open conversation + one streaming turn at a time.
 * Turns stream NDJSON from /api/agent/chat; Stop aborts the request, which stops
 * the local model (the backend keeps the partial answer, marked stopped).
 */
export function useArgusChat() {
  const { data: list, mutate: refreshList } = useSWR<{ conversations: Conversation[] }>(
    "/api/agent/conversations",
    getJson,
    { revalidateOnFocus: false },
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [loadingConv, setLoadingConv] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const open = useCallback(async (id: string) => {
    abortRef.current?.abort();
    setActiveId(id);
    setError(null);
    setLoadingConv(true);
    try {
      const c = await getJson<{ title: string; messages: ChatMessage[] }>(
        `/api/agent/conversations/${encodeURIComponent(id)}`,
      );
      setTitle(c.title);
      setMessages(c.messages);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setMessages([]);
    } finally {
      setLoadingConv(false);
    }
  }, []);

  const newChat = useCallback(() => {
    abortRef.current?.abort();
    setActiveId(null);
    setTitle(null);
    setMessages([]);
    setError(null);
  }, []);

  const remove = useCallback(
    async (id: string) => {
      await fetch(`/api/agent/conversations/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (id === activeId) newChat();
      void refreshList();
    },
    [activeId, newChat, refreshList],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const send = useCallback(
    async (text: string) => {
      const message = text.trim();
      if (!message || busy) return;
      setError(null);
      setBusy(true);
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      const now = Date.now() / 1000;
      const tempUser: ChatMessage = {
        id: `u-${now}`, role: "user", content: message, tool_calls: [], sources: [], status: "complete", created_at: now,
      };
      const draftId = `a-${now}`;
      const draft: ChatMessage = {
        id: draftId, role: "assistant", content: "", tool_calls: [], sources: [], status: "streaming", created_at: now,
      };
      setMessages((m) => [...m, tempUser, draft]);
      const patchDraft = (fn: (d: ChatMessage) => ChatMessage) =>
        setMessages((m) => m.map((x) => (x.id === draftId ? fn(x) : x)));

      let finished = false;
      try {
        const res = await fetch("/api/agent/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message, conversation_id: activeId }),
          signal: ctrl.signal,
        });
        if (res.status === 401) {
          void revalidate("/api/auth/me");
          throw new Error("Session expired — sign in again");
        }
        if (!res.ok || !res.body) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error ?? `Argus returned ${res.status}`);
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line) continue;
            const ev = JSON.parse(line) as StreamEvent;
            switch (ev.type) {
              case "start":
                setActiveId(ev.conversation_id);
                setTitle(ev.title);
                setMessages((m) => m.map((x) => (x.id === tempUser.id ? ev.user_message : x)));
                void refreshList();
                break;
              case "thinking":
                patchDraft((d) => ({ ...d, thinking: true }));
                break;
              case "tool_call":
                patchDraft((d) => ({
                  ...d,
                  thinking: false,
                  tool_calls: [...d.tool_calls, { name: ev.name, arguments: ev.arguments, pending: true }],
                }));
                break;
              case "tool_result":
                patchDraft((d) => ({
                  ...d,
                  tool_calls: d.tool_calls.map((t, i) =>
                    i === ev.index ? { name: ev.name, arguments: ev.arguments, ok: ev.ok, ms: ev.ms, as_of: ev.as_of, error: ev.error } : t,
                  ),
                }));
                break;
              case "delta":
                patchDraft((d) => ({ ...d, thinking: false, content: d.content + ev.text }));
                break;
              case "reset":
                patchDraft((d) => ({ ...d, content: "" }));
                break;
              case "done":
                finished = true;
                setMessages((m) => m.map((x) => (x.id === draftId ? ev.message : x)));
                break;
              case "error":
                finished = true;
                setMessages((m) =>
                  m.map((x) =>
                    x.id === draftId
                      ? { ...(ev.message ?? x), status: "error", error: ev.error, thinking: false }
                      : x,
                  ),
                );
                break;
            }
          }
        }
        if (!finished) throw new Error("The answer stream ended unexpectedly");
      } catch (e) {
        if (ctrl.signal.aborted) {
          patchDraft((d) => ({ ...d, status: "stopped", thinking: false, tool_calls: d.tool_calls.map((t) => ({ ...t, pending: false })) }));
        } else {
          const msg = e instanceof Error ? e.message : String(e);
          patchDraft((d) => ({ ...d, status: "error", error: msg, thinking: false }));
        }
      } finally {
        if (abortRef.current === ctrl) abortRef.current = null;
        setBusy(false);
        void refreshList();
      }
    },
    [activeId, busy, refreshList],
  );

  return {
    conversations: list?.conversations ?? null,
    activeId,
    title,
    messages,
    busy,
    loadingConv,
    error,
    open,
    newChat,
    remove,
    send,
    stop,
  };
}
