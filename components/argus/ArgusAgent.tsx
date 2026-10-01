"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Badge, Button, Icon, IconButton, StatusIndicator } from "@/components/ds";
import { cx } from "@/lib/design/cx";
import { useToast } from "@/components/gotham/Toast";
import { AnswerText, entityHref, type EntityKind } from "./AnswerText";
import { useAgentHealth, useArgusChat, type ChatMessage, type Conversation, type Source, type ToolCall } from "./useArgusChat";

/* ------------------------------------------------------------------ content */

const SUGGESTIONS: { q: string; icon: string }[] = [
  { q: "What is happening right now?", icon: "dashboard" },
  { q: "Show me all active intrusion alerts.", icon: "notifications_active" },
  { q: "What happened in the last 15 minutes?", icon: "sync" },
  { q: "Which cameras are offline?", icon: "videocam_off" },
  { q: "Why is CAM-09 not working?", icon: "build" },
  { q: "Are there any NVR faults?", icon: "dns" },
  { q: "How many intrusion alerts happened today?", icon: "bar_chart" },
  { q: "Which cameras generated alerts recently?", icon: "videocam" },
];

const TOOL_LABEL: Record<string, string> = {
  get_system_status: "System status",
  get_active_alerts: "Active alerts",
  search_alerts: "Alert history",
  get_camera_status: "Camera status",
  get_nvr_status: "NVR status",
  get_incident_details: "Incident details",
  get_recent_events: "Recent events",
};

const KIND_ICON: Record<EntityKind, string> = {
  camera: "videocam",
  alert: "notifications",
  incident: "crisis_alert",
  nvr: "dns",
};

/* ------------------------------------------------------------------ helpers */

const pad = (n: number) => String(n).padStart(2, "0");

function clock(epoch: number) {
  const d = new Date(epoch * 1000);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function relative(epoch: number) {
  const s = Date.now() / 1000 - epoch;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  const d = new Date(epoch * 1000);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const y = new Date(today.getTime() - 86400000);
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** `camera_id: CAM-09, status: offline` — what a data call asked for. */
function argText(args: Record<string, unknown>) {
  const parts = Object.entries(args ?? {}).map(([k, v]) => `${k.replace(/_/g, " ")} ${String(v)}`);
  return parts.join(" · ");
}

/* ------------------------------------------------------------------ sidebar */

function History({
  conversations,
  activeId,
  onOpen,
  onDelete,
}: {
  conversations: Conversation[] | null;
  activeId: string | null;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  if (conversations === null) {
    return (
      <div className="flex flex-col gap-2 px-3 py-2">
        {[70, 55, 80].map((w, i) => (
          <div key={i} className="h-2.5 bg-sunken animate-skeleton rounded-sm" style={{ width: `${w}%` }} />
        ))}
      </div>
    );
  }
  if (!conversations.length) {
    return <p className="px-3 py-2 text-caption text-ink-3">Conversations you start are kept here.</p>;
  }
  return (
    <ul className="flex flex-col gap-0.5" data-testid="argus-history">
      {conversations.map((c) => {
        const active = c.conversation_id === activeId;
        return (
          <li key={c.conversation_id} className="group relative">
            <button
              type="button"
              onClick={() => onOpen(c.conversation_id)}
              aria-current={active ? "page" : undefined}
              className={cx(
                "w-full text-left rounded-md pl-3 pr-9 py-2 flex flex-col gap-0.5 transition-[box-shadow,background-color,color] duration-100",
                active ? "bg-canvas shadow-inset-sm text-ink" : "text-ink-2 hover:text-ink hover:bg-hover",
              )}
            >
              <span className={cx("text-ui truncate", active && "font-medium")}>{c.title}</span>
              <span className="text-caption text-ink-3 font-data">{relative(c.updated_at)}</span>
            </button>
            <IconButton
              label="Delete conversation"
              size="sm"
              onClick={() => onDelete(c.conversation_id)}
              className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            >
              <Icon name="delete" size={16} />
            </IconButton>
          </li>
        );
      })}
    </ul>
  );
}

function ModelStatus() {
  const { data, error } = useAgentHealth();
  const tone = error ? "crit" : !data ? "idle" : data.ok ? "ok" : data.ollama === "up" ? "warn" : "crit";
  const label = error
    ? "AI backend unreachable"
    : !data
      ? "Checking model…"
      : data.ok
        ? data.model_loaded
          ? "Model ready"
          : "Model installed · loads on first question"
        : data.ollama === "up"
          ? "Model not installed"
          : "Local model server offline";
  return (
    <div className="flex flex-col gap-1" data-testid="argus-model-status">
      <StatusIndicator tone={tone}>{label}</StatusIndicator>
      <span className="text-caption text-ink-3 font-data truncate" title={data?.detail ?? undefined}>
        {data?.model ?? "qwen3.5:4b"} · Ollama · on this machine
      </span>
    </div>
  );
}

/* ----------------------------------------------------------------- messages */

function ToolSteps({ calls, live }: { calls: ToolCall[]; live: boolean }) {
  const [open, setOpen] = useState(false);
  if (!calls.length) return null;
  const pending = calls.find((c) => c.pending);
  const failed = calls.filter((c) => c.ok === false).length;
  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="self-start flex items-center gap-1.5 text-caption text-ink-2 hover:text-ink rounded-sm"
      >
        <Icon
          name={pending && live ? "sync" : failed ? "warning" : "database"}
          size={15}
          className={cx(pending && live && "animate-spin", failed ? "text-warn-ink" : "text-ink-3")}
        />
        {pending && live
          ? `Checking ${TOOL_LABEL[pending.name]?.toLowerCase() ?? pending.name}…`
          : `Checked ${calls.length} data ${calls.length === 1 ? "source" : "sources"}${failed ? ` · ${failed} failed` : ""}`}
        <Icon name={open ? "expand_less" : "expand_more"} size={15} className="text-ink-3" />
      </button>
      {open && (
        <ol className="flex flex-col gap-1 border-l border-line ml-[7px] pl-3" data-testid="argus-tool-steps">
          {calls.map((c, i) => (
            <li key={i} className="flex items-baseline gap-2 text-caption min-w-0">
              <Icon
                name={c.pending ? "sync" : c.ok === false ? "error" : "check_circle"}
                size={14}
                className={cx("self-center", c.pending ? "text-ink-3 animate-spin" : c.ok === false ? "text-crit-ink" : "text-ok-ink")}
              />
              <span className="text-ink font-medium shrink-0">{TOOL_LABEL[c.name] ?? c.name}</span>
              {Object.keys(c.arguments ?? {}).length > 0 && (
                <span className="font-data text-ink-2 truncate">{argText(c.arguments)}</span>
              )}
              {c.error && <span className="text-crit-ink truncate">{c.error}</span>}
              {c.ms != null && <span className="ml-auto font-data text-ink-3 shrink-0">{Math.round(c.ms)} ms</span>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function Sources({ sources }: { sources: Source[] }) {
  const entities = sources.filter((s): s is Extract<Source, { verified: boolean }> => s.kind !== "data");
  const data = sources.filter((s): s is Extract<Source, { kind: "data" }> => s.kind === "data");
  if (!entities.length && !data.length) return null;
  const asOf = data.find((d) => d.as_of)?.as_of;
  return (
    <div className="flex flex-col gap-1.5 pt-2 border-t border-line" data-testid="argus-sources">
      <div className="flex items-center gap-2 text-caption text-ink-3">
        <span className="font-medium text-ink-2">Sources</span>
        {data.length > 0 && <span>{data.map((d) => TOOL_LABEL[d.id] ?? d.id).filter((v, i, a) => a.indexOf(v) === i).join(" · ")}</span>}
        {asOf && <span className="font-data">· data as of {asOf}</span>}
      </div>
      {entities.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {entities.map((e) => {
            const href = entityHref(e.kind, e.id);
            const body = (
              <>
                <Icon name={KIND_ICON[e.kind]} size={14} />
                <span className="font-data">{e.id}</span>
              </>
            );
            if (!e.verified) {
              return (
                <Badge key={e.id} tone="warn" title="Not found in the data Argus retrieved for this answer">
                  {body} unverified
                </Badge>
              );
            }
            return href ? (
              <Link
                key={e.id}
                href={href}
                title={`Open ${e.id}`}
                className="inline-flex items-center gap-1 h-6 px-2 rounded-md bg-raised border border-line shadow-key-sm text-caption text-ink hover:bg-hover hover:text-accent-ink transition-colors"
              >
                {body}
                <Icon name="open_in_new" size={12} className="text-ink-3" />
              </Link>
            ) : (
              <Badge key={e.id}>{body}</Badge>
            );
          })}
        </div>
      )}
    </div>
  );
}

function UserMessage({ m }: { m: ChatMessage }) {
  return (
    <div className="flex flex-col items-end gap-1 animate-rise" data-testid="argus-user-message">
      <div className="max-w-[78%] bg-raised border border-line shadow-key-sm rounded-lg px-3.5 py-2.5 text-body text-ink whitespace-pre-wrap break-words select-text">
        {m.content}
      </div>
      <span className="text-caption text-ink-3 font-data pr-1">{clock(m.created_at)}</span>
    </div>
  );
}

function AssistantMessage({
  m,
  verified,
  onRetry,
}: {
  m: ChatMessage;
  verified: Map<string, boolean>;
  onRetry?: () => void;
}) {
  const toast = useToast();
  const streaming = m.status === "streaming";
  const waiting = streaming && !m.content && !m.tool_calls.some((c) => c.pending);
  return (
    <div className="flex gap-3 animate-rise" data-testid="argus-assistant-message" data-status={m.status}>
      <div className="w-7 h-7 shrink-0 rounded-md bg-accent-wash text-accent-ink flex items-center justify-center mt-0.5">
        <Icon name="shield" size={16} filled />
      </div>
      <div className="flex-1 min-w-0 flex flex-col gap-2">
        <div className="flex items-center gap-2 h-7">
          <span className="text-ui font-medium text-ink">Argus</span>
          <span className="text-caption text-ink-3 font-data">{clock(m.created_at)}</span>
          {m.duration_ms != null && !streaming && (
            <span className="text-caption text-ink-3 font-data">· {(m.duration_ms / 1000).toFixed(1)} s</span>
          )}
          {m.status === "stopped" && <Badge tone="warn">Stopped</Badge>}
        </div>

        <ToolSteps calls={m.tool_calls} live={streaming} />

        {waiting && (
          <div className="flex flex-col gap-2 py-1" aria-label="Argus is working">
            <span className="text-caption text-ink-3">{m.tool_calls.length ? "Reading the data…" : m.thinking ? "Reasoning…" : "Thinking…"}</span>
            {[88, 64].map((w, i) => (
              <div key={i} className="h-2.5 bg-sunken animate-skeleton rounded-sm" style={{ width: `${w}%`, animationDelay: `${i * 120}ms` }} />
            ))}
          </div>
        )}

        {m.content && (
          <div className="relative">
            <AnswerText text={m.content} verified={verified} />
            {streaming && <span aria-hidden className="inline-block w-1.5 h-4 align-text-bottom bg-ink-3 animate-breathe ml-0.5" />}
          </div>
        )}

        {m.status === "stopped" && !m.content && <p className="text-ui text-ink-3">Stopped before Argus answered.</p>}

        {m.status === "error" && (
          <div role="alert" className="flex items-start gap-2 rounded-md border border-crit/35 bg-crit-wash px-3 py-2">
            <Icon name="error" size={16} className="text-crit-ink mt-0.5" />
            <div className="flex-1 min-w-0 text-ui text-crit-ink">
              <p className="font-medium">Argus could not answer.</p>
              <p className="text-caption break-words">{m.error ?? "Unknown error"}</p>
            </div>
            {onRetry && (
              <Button size="sm" onClick={onRetry}>
                <Icon name="refresh" size={15} /> Retry
              </Button>
            )}
          </div>
        )}

        {!streaming && m.status !== "error" && <Sources sources={m.sources} />}

        {!streaming && m.content && (
          <div className="flex items-center -ml-1.5">
            <IconButton
              label="Copy answer"
              size="sm"
              onClick={() => {
                void navigator.clipboard?.writeText(m.content).then(() => toast("Answer copied", "ok"));
              }}
            >
              <Icon name="content_copy" size={15} />
            </IconButton>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- composer */

function Composer({
  busy,
  disabled,
  onSend,
  onStop,
  inputRef,
}: {
  busy: boolean;
  disabled: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const [text, setText] = useState("");
  const resize = () => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  };
  useEffect(resize);
  const submit = () => {
    if (!text.trim() || busy || disabled) return;
    onSend(text);
    setText("");
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };
  return (
    <div className="flex flex-col gap-1.5">
      <div className="bg-canvas border border-line rounded-xl shadow-inset-sm px-3 pt-2.5 pb-2 flex flex-col gap-2 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/25 transition-colors">
        <textarea
          ref={inputRef}
          data-testid="argus-input"
          value={text}
          rows={1}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          maxLength={4000}
          placeholder={disabled ? "Argus is unavailable — the local model server is offline" : "Ask about cameras, NVRs, alerts or incidents…"}
          aria-label="Message Argus"
          className="w-full resize-none bg-transparent text-body text-ink placeholder:text-ink-3 focus:outline-none select-text"
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-caption text-ink-3">
            <kbd className="font-data">Enter</kbd> to send · <kbd className="font-data">Shift + Enter</kbd> new line
          </span>
          {busy ? (
            <Button size="sm" onClick={onStop} data-testid="argus-stop">
              <Icon name="stop" size={16} filled /> Stop
            </Button>
          ) : (
            <Button size="sm" variant="primary" onClick={submit} disabled={!text.trim() || disabled} data-testid="argus-send">
              <Icon name="send" size={15} /> Send
            </Button>
          )}
        </div>
      </div>
      <p className="text-caption text-ink-3 text-center">
        Argus answers only from Command Centre data and runs entirely on this machine. Confirm critical details on the linked screens.
      </p>
    </div>
  );
}

/* --------------------------------------------------------------------- page */

/** Argus Agent: the Command Centre's conversational assistant, grounded in live backend data. */
export function ArgusAgent() {
  const chat = useArgusChat();
  const { data: health } = useAgentHealth();
  const toast = useToast();
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true);
  const offline = health ? health.ollama !== "up" : false;

  // Every entity the conversation has verified (answers link only those)
  const verified = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const msg of chat.messages)
      for (const s of msg.sources) if (s.kind !== "data") m.set(s.id, (m.get(s.id) ?? false) || s.verified);
    return m;
  }, [chat.messages]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [chat.messages]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [chat.activeId]);

  const lastUser = [...chat.messages].reverse().find((m) => m.role === "user");
  const empty = chat.messages.length === 0 && !chat.loadingConv;

  return (
    <div className="flex-1 min-h-0 flex" data-testid="argus-agent">
      {/* Conversation history */}
      <aside className="w-64 shrink-0 border-r border-line flex flex-col min-h-0" aria-label="Argus conversations">
        <div className="px-4 pt-4 pb-3 flex flex-col gap-3 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-md bg-accent-wash text-accent-ink flex items-center justify-center">
              <Icon name="forum" size={18} />
            </div>
            <div className="min-w-0">
              <h1 className="text-section text-ink">Argus Agent</h1>
              <p className="text-caption text-ink-3 truncate">Command Centre assistant</p>
            </div>
          </div>
          <Button onClick={() => chat.newChat()} className="w-full" data-testid="argus-new-chat">
            <Icon name="add" size={16} /> New chat
          </Button>
        </div>
        <div className="px-4 pb-1 text-caption font-medium text-ink-3 shrink-0">History</div>
        <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2">
          <History
            conversations={chat.conversations}
            activeId={chat.activeId}
            onOpen={(id) => void chat.open(id)}
            onDelete={(id) => {
              void chat.remove(id).then(() => toast("Conversation deleted", "ok"));
            }}
          />
        </div>
        <div className="px-4 py-3 border-t border-line shrink-0">
          <ModelStatus />
        </div>
      </aside>

      {/* Chat */}
      <section className="flex-1 min-w-0 flex flex-col min-h-0">
        <header className="h-12 shrink-0 px-5 flex items-center justify-between gap-4 border-b border-line">
          <h2 className="text-section text-ink truncate" data-testid="argus-title">
            {chat.title ?? "New chat"}
          </h2>
          <div className="flex items-center gap-2 shrink-0">
            <Badge tone="ok">
              <Icon name="check_circle" size={14} /> Grounded in live data
            </Badge>
            <Badge mono>{health?.model ?? "qwen3.5:4b"}</Badge>
          </div>
        </header>

        <div
          ref={scrollRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
          className="flex-1 min-h-0 overflow-y-auto"
        >
          <div className="max-w-[820px] mx-auto px-6 py-6 flex flex-col gap-6">
            {chat.error && (
              <div role="alert" className="rounded-md border border-crit/35 bg-crit-wash px-3 py-2 text-ui text-crit-ink">
                {chat.error}
              </div>
            )}
            {chat.loadingConv && (
              <div className="flex flex-col gap-3">
                {[60, 85, 40].map((w, i) => (
                  <div key={i} className="h-3 bg-sunken animate-skeleton rounded-sm" style={{ width: `${w}%` }} />
                ))}
              </div>
            )}
            {empty && (
              <div className="flex flex-col items-center text-center gap-5 pt-[8vh]" data-testid="argus-empty">
                <div className="w-12 h-12 rounded-lg bg-accent-wash text-accent-ink flex items-center justify-center shadow-key-sm">
                  <Icon name="shield" size={26} filled />
                </div>
                <div className="flex flex-col gap-1">
                  <p className="text-headline text-ink">What do you need to know?</p>
                  <p className="text-ui text-ink-2 max-w-md">
                    Ask about the current operational picture. Argus reads live cameras, NVRs, alerts, incidents and
                    detection events, and cites the IDs it used.
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-[640px]" data-testid="argus-suggestions">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s.q}
                      type="button"
                      disabled={chat.busy || offline}
                      onClick={() => void chat.send(s.q)}
                      className="flex items-center gap-2.5 text-left px-3 py-2.5 rounded-lg bg-raised border border-line shadow-key-sm text-ui text-ink hover:bg-hover active:shadow-inset-sm disabled:opacity-45 transition-[box-shadow,background-color] duration-100"
                    >
                      <Icon name={s.icon} size={17} className="text-ink-3 shrink-0" />
                      <span className="truncate">{s.q}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {chat.messages.map((m) =>
              m.role === "user" ? (
                <UserMessage key={m.id} m={m} />
              ) : (
                <AssistantMessage
                  key={m.id}
                  m={m}
                  verified={verified}
                  onRetry={m === chat.messages[chat.messages.length - 1] && lastUser ? () => void chat.send(lastUser.content) : undefined}
                />
              ),
            )}
          </div>
        </div>

        <div className="shrink-0 px-6 pb-4 pt-2">
          <div className="max-w-[820px] mx-auto">
            {!empty && chat.messages.length > 0 && !chat.busy && (
              <div className="flex flex-wrap gap-1.5 pb-2" aria-label="Suggested questions">
                {SUGGESTIONS.slice(0, 3).map((s) => (
                  <Button key={s.q} size="sm" variant="ghost" onClick={() => void chat.send(s.q)} disabled={offline}>
                    {s.q}
                  </Button>
                ))}
              </div>
            )}
            <Composer
              busy={chat.busy}
              disabled={offline}
              onSend={(t) => {
                stick.current = true;
                void chat.send(t);
              }}
              onStop={chat.stop}
              inputRef={inputRef}
            />
          </div>
        </div>
      </section>
    </div>
  );
}
