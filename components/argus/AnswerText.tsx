"use client";

import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { Tooltip } from "@/components/ds";
import { cx } from "@/lib/design/cx";
import { TACTICAL_CAMERAS } from "@/lib/datasets/dataset-definitions";

export type EntityKind = "camera" | "alert" | "incident" | "nvr";

const ENTITY_RE = /\b(INCD-\d{6}|INC-\d{6}|CAM-\d{2,3}|NVR-\d{2}|HIK-\d{2}|FILE-\d{2})\b/g;
const LIVE_CAMERAS = new Set(TACTICAL_CAMERAS.map((c) => c.id));

export function entityKind(id: string): EntityKind {
  if (id.startsWith("INCD-")) return "incident";
  if (id.startsWith("INC-")) return "alert";
  if (id.startsWith("CAM-")) return "camera";
  return "nvr";
}

/** The existing Command Centre screen that shows an entity (null: no screen for it). */
export function entityHref(kind: EntityKind, id: string): string | null {
  switch (kind) {
    case "camera":
      return LIVE_CAMERAS.has(id) ? `/cameras?inspect=${id}` : `/devices?q=${id}`;
    case "alert":
      return `/alerts?alert=${id}`;
    case "incident":
      return `/alerts?incident=${id}`;
    case "nvr":
      return /^NVR-\d{2}$/.test(id) ? `/devices?nvr=${id}` : null;
  }
}

/** An ID in prose: links to its screen when the data confirmed it; flagged when it did not. */
function EntityRef({ id, verified }: { id: string; verified: boolean | undefined }) {
  const href = entityHref(entityKind(id), id);
  if (verified === false) {
    return (
      <Tooltip text="Not found in the data Argus retrieved for this answer">
        <span className="font-data text-data text-warn-ink underline decoration-dotted underline-offset-2">{id}</span>
      </Tooltip>
    );
  }
  if (!href) return <span className="font-data text-data text-ink">{id}</span>;
  return (
    <Link
      href={href}
      className="font-data text-data text-accent-ink underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
    >
      {id}
    </Link>
  );
}

/** Inline markdown: **bold**, `code`, and entity IDs. */
function inline(text: string, verified: Map<string, boolean>, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  parts.forEach((part, i) => {
    if (!part) return;
    if (part.startsWith("**") && part.endsWith("**")) {
      out.push(
        <strong key={`${key}-${i}`} className="font-semibold text-ink">
          {inline(part.slice(2, -2), verified, `${key}-${i}b`)}
        </strong>,
      );
      return;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      out.push(
        <code key={`${key}-${i}`} className="font-data text-data bg-sunken rounded-sm px-1">
          {part.slice(1, -1)}
        </code>,
      );
      return;
    }
    let last = 0;
    for (const m of part.matchAll(ENTITY_RE)) {
      if (m.index! > last) out.push(<Fragment key={`${key}-${i}-${last}`}>{part.slice(last, m.index)}</Fragment>);
      out.push(<EntityRef key={`${key}-${i}-${m.index}`} id={m[0]} verified={verified.get(m[0])} />);
      last = m.index! + m[0].length;
    }
    if (last < part.length) out.push(<Fragment key={`${key}-${i}-end`}>{part.slice(last)}</Fragment>);
  });
  return out;
}

type Block = { type: "p" | "h"; text: string } | { type: "ul" | "ol"; items: string[] };

function blocks(src: string): Block[] {
  const out: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push({ type: "p", text: para.join(" ") });
    para = [];
  };
  for (const raw of src.replace(/\r/g, "").split("\n")) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const num = line.match(/^\s*\d+[.)]\s+(.*)$/);
    const head = line.match(/^#{1,6}\s+(.*)$/);
    if (!line.trim()) {
      flush();
    } else if (head) {
      flush();
      out.push({ type: "h", text: head[1] });
    } else if (bullet || num) {
      flush();
      const type = bullet ? "ul" : "ol";
      const prev = out[out.length - 1];
      const text = (bullet ?? num)![1];
      if (prev && prev.type === type) prev.items.push(text);
      else out.push({ type, items: [text] });
    } else if (/^\s{2,}\S/.test(raw) && out.length && (out[out.length - 1].type === "ul" || out[out.length - 1].type === "ol") && !para.length) {
      const prev = out[out.length - 1] as { items: string[] };
      prev.items[prev.items.length - 1] += ` ${line.trim()}`;
    } else {
      para.push(line.trim());
    }
  }
  flush();
  return out;
}

/** Argus answer body. Rendered as React elements (never raw HTML). */
export function AnswerText({
  text,
  verified,
  className,
}: {
  text: string;
  verified: Map<string, boolean>;
  className?: string;
}) {
  return (
    <div className={cx("flex flex-col gap-2 text-body text-ink select-text", className)}>
      {blocks(text).map((b, i) => {
        if (b.type === "h") {
          return (
            <h3 key={i} className="text-section text-ink mt-1">
              {inline(b.text, verified, `h${i}`)}
            </h3>
          );
        }
        if (b.type === "p") {
          return (
            <p key={i} className="leading-relaxed">
              {inline(b.text, verified, `p${i}`)}
            </p>
          );
        }
        if (b.type !== "ul" && b.type !== "ol") return null;
        const List = b.type;
        return (
          <List key={i} className={cx("flex flex-col gap-1 pl-5", b.type === "ul" ? "list-disc" : "list-decimal")}>
            {b.items.map((it, j) => (
              <li key={j} className="leading-relaxed marker:text-ink-3">
                {inline(it, verified, `l${i}-${j}`)}
              </li>
            ))}
          </List>
        );
      })}
    </div>
  );
}
