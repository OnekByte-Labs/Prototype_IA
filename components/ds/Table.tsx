"use client";

import type { ReactNode } from "react";
import { cx } from "@/lib/design/cx";
import { EmptyState, SkeletonRows } from "./Card";
import { Icon } from "./Icon";

/* -------------------------------------------------------------- primitives */

/** Plain <table> shell. Tables are structurally flat: hairline rules, no cards inside cards. */
export function Table({ children, className, ...rest }: React.ComponentProps<"table">) {
  return (
    <table className={cx("w-full text-ui text-ink border-separate border-spacing-0", className)} {...rest}>
      {children}
    </table>
  );
}

export function Th({
  children,
  className,
  align = "left",
  sortKey,
  activeSortKey,
  sortDir,
  onSort,
  width,
}: {
  children?: ReactNode;
  className?: string;
  align?: "left" | "right" | "center";
  sortKey?: string;
  activeSortKey?: string;
  sortDir?: "asc" | "desc";
  onSort?: (key: string) => void;
  width?: string | number;
}) {
  const sortable = !!sortKey && !!onSort;
  const active = sortable && activeSortKey === sortKey;
  const alignCls = align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";
  return (
    <th
      scope="col"
      style={{ width }}
      aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : undefined}
      className={cx(
        "sticky top-0 z-10 h-9 px-3 bg-surface border-b border-line text-caption font-medium text-ink-2 whitespace-nowrap",
        alignCls,
        className,
      )}
    >
      {sortable ? (
        <button
          type="button"
          onClick={() => onSort!(sortKey!)}
          className={cx(
            "inline-flex items-center gap-1 hover:text-ink transition-colors",
            active && "text-ink",
          )}
        >
          {children}
          <Icon name={active ? (sortDir === "asc" ? "arrow_upward" : "arrow_downward") : "unfold_more"} size={13} className={active ? "text-accent-ink" : "text-ink-3"} />
        </button>
      ) : (
        children
      )}
    </th>
  );
}

export function Tr({
  children,
  selected,
  onClick,
  className,
  ...rest
}: {
  children: ReactNode;
  selected?: boolean;
  onClick?: () => void;
  className?: string;
} & Omit<React.HTMLAttributes<HTMLTableRowElement>, "onClick" | "children" | "className">) {
  return (
    <tr
      onClick={onClick}
      aria-selected={selected}
      className={cx(
        "group transition-colors",
        onClick && "cursor-pointer",
        selected ? "bg-accent-wash/70" : "hover:bg-hover",
        className,
      )}
      {...rest}
    >
      {children}
    </tr>
  );
}

export function Td({
  children,
  className,
  align = "left",
  mono,
  colSpan,
  title,
}: {
  children?: ReactNode;
  className?: string;
  align?: "left" | "right" | "center";
  mono?: boolean;
  colSpan?: number;
  title?: string;
}) {
  return (
    <td
      colSpan={colSpan}
      title={title}
      className={cx(
        "h-10 px-3 border-b border-line align-middle",
        align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left",
        mono && "font-data text-data tnum",
        className,
      )}
    >
      {children}
    </td>
  );
}

/* ---------------------------------------------------------------- DataTable */

export type Column<T> = {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  width?: string | number;
  align?: "left" | "right" | "center";
  mono?: boolean;
  sortable?: boolean;
};

/**
 * Declarative table: columns + rows, with sorting hooks, selection, loading and
 * empty states. Scrolls inside its parent and keeps the header pinned.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  selectedKey,
  loading,
  empty = "Nothing to show.",
  sortKey,
  sortDir,
  onSort,
  className,
  rowClassName,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  selectedKey?: string | null;
  loading?: boolean;
  empty?: ReactNode;
  sortKey?: string;
  sortDir?: "asc" | "desc";
  onSort?: (key: string) => void;
  className?: string;
  /** Extra classes per row (e.g. a status tint). */
  rowClassName?: (row: T) => string | undefined;
}) {
  return (
    <div className={cx("overflow-auto min-h-0", className)}>
      <Table>
        <thead>
          <tr>
            {columns.map((c) => (
              <Th
                key={c.key}
                width={c.width}
                align={c.align}
                sortKey={c.sortable ? c.key : undefined}
                activeSortKey={sortKey}
                sortDir={sortDir}
                onSort={onSort}
              >
                {c.header}
              </Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {!loading &&
            rows.map((r) => {
              const k = rowKey(r);
              return (
                <Tr key={k} selected={selectedKey === k} onClick={onRowClick ? () => onRowClick(r) : undefined} className={rowClassName?.(r)}>
                  {columns.map((c) => (
                    <Td key={c.key} align={c.align} mono={c.mono}>
                      {c.cell(r)}
                    </Td>
                  ))}
                </Tr>
              );
            })}
        </tbody>
      </Table>
      {loading && <SkeletonRows cols={columns.length} />}
      {!loading && rows.length === 0 && <EmptyState message={empty} />}
    </div>
  );
}
