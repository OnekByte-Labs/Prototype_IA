"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cx } from "@/lib/design/cx";
import { IconButton } from "./Button";
import { Icon } from "./Icon";

/** Close on Escape while mounted. */
function useEscape(onClose: () => void, enabled = true) {
  const ref = useRef(onClose);
  useEffect(() => {
    ref.current = onClose;
  });
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") ref.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}

/* -------------------------------------------------------------------- Modal */

const SIZE = { sm: "w-[400px]", md: "w-[560px]", lg: "w-[760px]", xl: "w-[980px]" } as const;

/**
 * Centred dialog. A flat warm scrim (no blur) dims the page; the panel is the
 * highest elevation in the system.
 */
export function Modal({
  open = true,
  title,
  description,
  onClose,
  children,
  footer,
  size = "md",
  dismissOnScrim = true,
  testId,
}: {
  open?: boolean;
  title: ReactNode;
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: keyof typeof SIZE;
  dismissOnScrim?: boolean;
  testId?: string;
}) {
  const id = useId();
  useEscape(onClose, open);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[160] flex items-center justify-center p-6">
      <button
        type="button"
        aria-label="Close dialog"
        tabIndex={-1}
        onClick={dismissOnScrim ? onClose : undefined}
        className="absolute inset-0 bg-ink/35 cursor-default"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        data-testid={testId}
        className={cx(
          "relative max-w-full max-h-[88vh] flex flex-col bg-raised border border-line rounded-xl shadow-pop animate-rise",
          SIZE[size],
        )}
      >
        <header className="px-5 pt-4 pb-3 flex items-start justify-between gap-4 border-b border-line">
          <div className="min-w-0">
            <h2 id={id} className="text-headline text-ink">
              {title}
            </h2>
            {description && <p className="text-ui text-ink-2 mt-0.5">{description}</p>}
          </div>
          <IconButton label="Close" onClick={onClose}>
            <Icon name="close" size={18} />
          </IconButton>
        </header>
        <div className="flex-1 min-h-0 overflow-y-auto p-5">{children}</div>
        {footer && <footer className="px-5 py-3 border-t border-line flex items-center justify-end gap-2">{footer}</footer>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- Drawer */

/** Side sheet anchored to the right edge: inspectors, forms and detail views that keep the page visible. */
export function Drawer({
  open = true,
  title,
  description,
  onClose,
  children,
  footer,
  width = "w-[440px]",
  scrim = false,
  aside,
  testId,
}: {
  open?: boolean;
  title: ReactNode;
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
  /** Dim the page behind the drawer (modal behaviour). */
  scrim?: boolean;
  aside?: ReactNode;
  testId?: string;
}) {
  const id = useId();
  useEscape(onClose, open);
  if (!open) return null;
  return (
    <div className={cx("fixed inset-0 z-[110]", !scrim && "pointer-events-none")}>
      {scrim && (
        <button type="button" aria-label="Close panel" tabIndex={-1} onClick={onClose} className="absolute inset-0 bg-ink/30 cursor-default" />
      )}
      <aside
        role="dialog"
        aria-labelledby={id}
        data-testid={testId}
        className={cx(
          "pointer-events-auto absolute right-0 top-0 bottom-0 max-w-full flex flex-col bg-raised border-l border-line shadow-pop animate-rise",
          width,
        )}
      >
        <header className="px-5 py-3 flex items-start justify-between gap-3 border-b border-line">
          <div className="min-w-0">
            <h2 id={id} className="text-headline text-ink truncate">
              {title}
            </h2>
            {description && <p className="text-ui text-ink-2 truncate">{description}</p>}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {aside}
            <IconButton label="Close" onClick={onClose}>
              <Icon name="close" size={18} />
            </IconButton>
          </div>
        </header>
        <div className="flex-1 min-h-0 overflow-y-auto">{children}</div>
        {footer && <footer className="px-5 py-3 border-t border-line flex items-center justify-end gap-2">{footer}</footer>}
      </aside>
    </div>
  );
}

/* ----------------------------------------------------------------- Dropdown */

/**
 * Anchored popover menu. `trigger` receives the open state and toggler so any
 * button can drive it; the panel closes on outside click, Escape and selection.
 */
export function Dropdown({
  trigger,
  children,
  align = "right",
  width = "w-60",
  className,
}: {
  trigger: (api: { open: boolean; toggle: () => void }) => ReactNode;
  children: (api: { close: () => void }) => ReactNode;
  align?: "left" | "right";
  width?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  useEscape(() => setOpen(false), open);
  return (
    <div className={cx("relative", className)}>
      {trigger({ open, toggle: () => setOpen((v) => !v) })}
      {open && (
        <>
          <button type="button" aria-label="Close menu" tabIndex={-1} onClick={() => setOpen(false)} className="fixed inset-0 z-40 cursor-default" />
          <div
            role="menu"
            className={cx(
              "absolute top-[calc(100%+6px)] z-50 bg-raised border border-line rounded-lg shadow-pop py-1 animate-rise",
              align === "right" ? "right-0" : "left-0",
              width,
            )}
          >
            {children({ close: () => setOpen(false) })}
          </div>
        </>
      )}
    </div>
  );
}

export function MenuItem({
  children,
  icon,
  onClick,
  tone = "default",
  testId,
}: {
  children: ReactNode;
  icon?: string;
  onClick: () => void;
  tone?: "default" | "crit";
  testId?: string;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      data-testid={testId}
      onClick={onClick}
      className={cx(
        "w-full h-8 px-3 flex items-center gap-2 text-ui text-left hover:bg-hover transition-colors",
        tone === "crit" ? "text-crit-ink" : "text-ink",
      )}
    >
      {icon && <Icon name={icon} size={16} className="text-ink-2" />}
      {children}
    </button>
  );
}
