import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "@/lib/design/cx";
import { Icon } from "./Icon";

/* ----------------------------------------------------------------- AppShell */

/** Sidebar on the left; header and the screen stacked on the right. */
export function AppShell({ sidebar, header, children }: { sidebar: ReactNode; header: ReactNode; children: ReactNode }) {
  return (
    <div className="w-screen h-screen flex overflow-hidden bg-canvas text-ink">
      {sidebar}
      <div className="flex-1 min-w-0 flex flex-col">
        {header}
        <main className="flex-1 min-h-0 flex flex-col overflow-hidden">{children}</main>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Sidebar */

/** Slim primary navigation: icon over a short label, so every destination is named. */
export function Sidebar({ brand, children, footer }: { brand?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <nav
      aria-label="Primary"
      className="w-[var(--ds-nav-w)] shrink-0 bg-surface border-r border-line flex flex-col items-stretch z-40"
    >
      {brand && (
        <div className="h-[var(--ds-header-h)] shrink-0 flex items-center justify-center border-b border-line">{brand}</div>
      )}
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-1 p-2">{children}</div>
      {footer && <div className="p-2 border-t border-line">{footer}</div>}
    </nav>
  );
}

export function NavigationItem({
  label,
  icon,
  href,
  active,
  badge,
  hint,
}: {
  label: string;
  icon: string;
  /** Without an href the destination isn't built yet: the item renders disabled. */
  href?: string;
  active?: boolean;
  badge?: number;
  hint?: string;
}) {
  const cls = cx(
    "relative flex flex-col items-center justify-center gap-0.5 h-[52px] rounded-md text-caption font-medium transition-[box-shadow,background-color,color] duration-100",
    active
      ? "bg-canvas shadow-inset-sm text-ink"
      : href
        ? "text-ink-2 hover:text-ink hover:bg-hover"
        : "text-ink-3 opacity-60",
  );
  const body = (
    <>
      <Icon name={icon} size={21} className={active ? "text-accent-ink" : ""} />
      <span className="leading-none">{label}</span>
      {!!badge && badge > 0 && (
        <span
          aria-label={`${badge} unacknowledged`}
          className="absolute top-1 right-2 min-w-4 h-4 px-1 rounded-full bg-crit text-white text-[11px] leading-4 font-medium text-center tnum"
        >
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </>
  );
  return href ? (
    <Link href={href} aria-current={active ? "page" : undefined} title={hint ?? label} className={cls}>
      {body}
    </Link>
  ) : (
    <button type="button" disabled title={hint ?? `${label} — not built`} className={cls}>
      {body}
    </button>
  );
}

/* ------------------------------------------------------------------- Header */

/** Top bar: identity on the left, live context centred, global actions right. */
export function Header({ left, center, right }: { left?: ReactNode; center?: ReactNode; right?: ReactNode }) {
  return (
    <header className="h-[var(--ds-header-h)] shrink-0 bg-surface border-b border-line px-5 grid grid-cols-[1fr_auto_1fr] items-center gap-4 z-30 relative">
      <div className="flex items-center gap-3 min-w-0">{left}</div>
      <div className="flex items-center justify-center">{center}</div>
      <div className="flex items-center justify-end gap-2 min-w-0">{right}</div>
    </header>
  );
}

/* ----------------------------------------------------------------- PageHeader */

/**
 * Title, one line of context and the screen's contextual actions. `dense` is
 * for screens where the live wall or map owns the vertical space.
 */
export function PageHeader({
  title,
  description,
  actions,
  meta,
  children,
  dense,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Inline read-out beside the title (counts, live status). */
  meta?: ReactNode;
  children?: ReactNode;
  dense?: boolean;
  className?: string;
}) {
  return (
    <div className={cx("shrink-0", dense ? "px-5 pt-3 pb-2" : "px-5 pt-5 pb-3", className)}>
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-4 min-w-0">
            <h1 className={cx("text-ink truncate", dense ? "text-headline" : "text-title")}>{title}</h1>
            {meta && <div className="flex items-center gap-3 text-ui text-ink-2 shrink-0">{meta}</div>}
          </div>
          {description && !dense && <p className="text-ui text-ink-2 mt-0.5 truncate">{description}</p>}
        </div>
        {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

/** Scrolling content area under a PageHeader with the standard gutter. */
export function PageBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("flex-1 min-h-0 px-5 pb-5", className)}>{children}</div>;
}

/* ------------------------------------------------------------------- SubNav */

/** Secondary navigation (e.g. the Administration section tree). Two levels at most. */
export function SubNav({ children, className, label }: { children: ReactNode; className?: string; label: string }) {
  return (
    <nav aria-label={label} className={cx("overflow-y-auto py-3 px-2 flex flex-col gap-4", className)}>
      {children}
    </nav>
  );
}

export function SubNavGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="px-3 pb-1 text-caption font-medium text-ink-3">{title}</div>
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  );
}

export function SubNavItem({
  label,
  icon,
  active,
  onClick,
  count,
  testId,
}: {
  label: string;
  icon?: string;
  active?: boolean;
  onClick: () => void;
  count?: ReactNode;
  testId?: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      className={cx(
        "h-8 px-3 rounded-md flex items-center gap-2.5 text-ui text-left transition-[box-shadow,background-color,color] duration-100",
        active ? "bg-canvas shadow-inset-sm text-ink font-medium" : "text-ink-2 hover:text-ink hover:bg-hover",
      )}
    >
      {icon && <Icon name={icon} size={17} className={active ? "text-accent-ink" : ""} />}
      <span className="flex-1 truncate">{label}</span>
      {count !== undefined && <span className="text-caption text-ink-3 tnum">{count}</span>}
    </button>
  );
}
