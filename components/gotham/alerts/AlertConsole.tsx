"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import {
  CLASS_LABEL,
  cameraById,
  hms,
  type Alert,
  type AlertClass,
  type AlertStatus,
  type Severity,
} from "@/lib/gotham/model";
import { useConsole } from "../ConsoleProvider";
import { useHotkeys, useSortable } from "../hooks";
import {
  Button,
  ClassTag,
  EmptyState,
  MicroLabel,
  SeverityChip,
  SkeletonRows,
  StatusCell,
  StatusDot,
} from "../primitives";
import { useToast } from "../Toast";

const SEV_RANK: Record<Severity, number> = { low: 0, med: 1, high: 2 };
const CLASSES: AlertClass[] = ["person", "vehicle", "animal"];

type Row = Alert & { sevRank: number; camName: string };

/* --------------------------------------------------------------- filter bar */

type Filters = {
  q: string;
  classes: AlertClass[];
  severity: Severity | "all";
  status: AlertStatus | "all";
};

const EMPTY: Filters = { q: "", classes: [], severity: "all", status: "all" };

const selectCls =
  "h-7 pl-2 pr-6 bg-g-bg border border-g-border-strong rounded-[2px] text-ui text-g-text focus:border-g-blue focus:outline-none appearance-none cursor-pointer alerts-select";

function FilterBar({
  filters,
  setFilters,
  count,
  total,
  searchRef,
  onRefresh,
}: {
  filters: Filters;
  setFilters: (f: Filters) => void;
  count: number;
  total: number;
  searchRef: React.RefObject<HTMLInputElement | null>;
  onRefresh: () => void;
}) {
  const dirty =
    filters.q !== "" ||
    filters.classes.length > 0 ||
    filters.severity !== "all" ||
    filters.status !== "all";

  const toggleClass = (c: AlertClass) =>
    setFilters({
      ...filters,
      classes: filters.classes.includes(c)
        ? filters.classes.filter((x) => x !== c)
        : [...filters.classes, c],
    });

  return (
    <div className="h-10 shrink-0 px-2 flex items-center gap-2 bg-g-panel border-b border-g-border">
      <div className="relative">
        <Icon
          name="search"
          size={14}
          className="absolute left-2 top-1/2 -translate-y-1/2 text-g-muted pointer-events-none"
        />
        <input
          ref={searchRef}
          value={filters.q}
          onChange={(e) => setFilters({ ...filters, q: e.target.value })}
          placeholder="Search id, camera, zone…  /"
          aria-label="Search alerts"
          data-testid="alert-search"
          className="h-7 w-64 pl-7 pr-2 bg-g-bg border border-g-border-strong rounded-[2px] text-ui text-g-text placeholder:text-g-muted focus:border-g-blue focus:outline-none"
        />
      </div>

      <div className="flex items-center gap-1">
        {CLASSES.map((c) => {
          const on = filters.classes.includes(c);
          return (
            <button
              key={c}
              type="button"
              data-testid={`chip-${c}`}
              aria-pressed={on}
              onClick={() => toggleClass(c)}
              className={`h-7 px-2 border rounded-[2px] text-ui transition-none ${
                on
                  ? "border-g-blue text-g-blue bg-g-blue/10"
                  : "border-g-border-strong text-g-text-2 hover:text-g-text hover:bg-g-hover"
              }`}
            >
              {CLASS_LABEL[c]}
            </button>
          );
        })}
      </div>

      <select
        aria-label="Severity"
        data-testid="filter-severity"
        className={selectCls}
        value={filters.severity}
        onChange={(e) => setFilters({ ...filters, severity: e.target.value as Filters["severity"] })}
      >
        <option value="all">All severity</option>
        <option value="high">High</option>
        <option value="med">Med</option>
        <option value="low">Low</option>
      </select>

      <select
        aria-label="Status"
        data-testid="filter-status"
        className={selectCls}
        value={filters.status}
        onChange={(e) => setFilters({ ...filters, status: e.target.value as Filters["status"] })}
      >
        <option value="all">All status</option>
        <option value="new">Unacknowledged</option>
        <option value="ack">Acknowledged</option>
        <option value="dispatched">Dispatched</option>
      </select>

      {dirty && (
        <button
          type="button"
          data-testid="clear-filters"
          onClick={() => setFilters(EMPTY)}
          className="h-7 px-2 text-ui text-g-text-2 hover:text-g-text hover:bg-g-hover rounded-[2px]"
        >
          Clear all
        </button>
      )}

      <div className="ml-auto flex items-center gap-2">
        <span data-testid="result-count" className="text-data font-data text-g-muted">
          {count === total ? `${total} events` : `${count} of ${total} events`}
        </span>
        <button
          type="button"
          title="Re-poll alert store"
          onClick={onRefresh}
          className="w-7 h-7 flex items-center justify-center text-g-text-2 hover:text-g-text hover:bg-g-hover rounded-[2px]"
        >
          <Icon name="refresh" size={15} />
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ summary strip */

function SummaryStrip({ rows }: { rows: Alert[] }) {
  const byClass = (c: AlertClass) => rows.filter((a) => a.cls === c).length;
  const resolved = rows.filter((a) => a.ackAt !== undefined);
  const avg =
    resolved.length === 0
      ? 0
      : Math.round(resolved.reduce((s, a) => s + Math.max(0, (a.ackAt ?? 0) - a.t), 0) / resolved.length);

  const cell = (label: string, value: string) => (
    <div className="flex items-baseline gap-1.5">
      <MicroLabel>{label}</MicroLabel>
      <span className="text-data font-data text-g-text">{value}</span>
    </div>
  );

  return (
    <div className="h-10 shrink-0 px-3 flex items-center gap-6 bg-g-panel border-b border-g-border">
      {cell("24h total", String(rows.length))}
      <span className="w-px h-4 bg-g-border" />
      {cell("Person", String(byClass("person")))}
      {cell("Vehicle", String(byClass("vehicle")))}
      {cell("Animal", String(byClass("animal")))}
      <span className="w-px h-4 bg-g-border" />
      {cell("Avg response", `${Math.floor(avg / 60)}m ${avg % 60}s`)}
      <span className="w-px h-4 bg-g-border" />
      {cell("High severity", String(rows.filter((a) => a.severity === "high").length))}
    </div>
  );
}

/* -------------------------------------------------------------------- table */

type Col = { key: string; label: string; w?: string; align?: "right" | "center" };

const COLS: Col[] = [
  { key: "t", label: "Time", w: "w-[74px]" },
  { key: "id", label: "Incident", w: "w-[116px]" },
  { key: "cameraId", label: "Camera", w: "w-[92px]" },
  { key: "camName", label: "Location" },
  { key: "zone", label: "Zone", w: "w-[132px]" },
  { key: "cls", label: "Class", w: "w-[84px]" },
  { key: "sevRank", label: "Severity", w: "w-[78px]" },
  { key: "confidence", label: "Conf", w: "w-[64px]", align: "right" },
  { key: "status", label: "Status", w: "w-[150px]" },
  { key: "actions", label: "", w: "w-[104px]", align: "right" },
];

export function AlertConsole() {
  const { alerts, ack, ackMany, dispatch } = useConsole();
  const toast = useToast();

  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cursorRaw, setCursor] = useState(0);
  const [loading, setLoading] = useState(false);

  const searchRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const rows: Row[] = useMemo(
    () =>
      alerts.map((a) => ({
        ...a,
        sevRank: SEV_RANK[a.severity],
        camName: cameraById(a.cameraId)?.name ?? "",
      })),
    [alerts],
  );

  const filtered = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return rows.filter((r) => {
      if (filters.classes.length && !filters.classes.includes(r.cls)) return false;
      if (filters.severity !== "all" && r.severity !== filters.severity) return false;
      if (filters.status !== "all" && r.status !== filters.status) return false;
      if (q) {
        const hay = `${r.id} ${r.cameraId} ${r.camName} ${r.zone}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, filters]);

  const { sorted, key, dir, toggle } = useSortable<Row>(filtered, "t", "desc");

  // Derived, not stored: the cursor is clamped to the visible set every render,
  // so changing filters can never leave it pointing past the end of the table.
  const cursor = Math.min(cursorRaw, Math.max(0, sorted.length - 1));

  const focusRow = useCallback((i: number) => {
    bodyRef.current
      ?.querySelector(`[data-row-index="${i}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, []);

  const refresh = useCallback(() => {
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      toast("Alert store re-polled", "ok");
    }, 600);
  }, [toast]);

  const toggleSel = useCallback((id: string) => {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }, []);

  useHotkeys({
    "/": () => searchRef.current?.focus(),
    j: () => {
      const n = Math.min(cursor + 1, sorted.length - 1);
      setCursor(n);
      focusRow(n);
    },
    k: () => {
      const n = Math.max(cursor - 1, 0);
      setCursor(n);
      focusRow(n);
    },
    a: () => {
      const r = sorted[cursor];
      if (r && r.status === "new") ack(r.id);
    },
    x: () => {
      const r = sorted[cursor];
      if (r) toggleSel(r.id);
    },
    Escape: () => {
      setSelected(new Set());
      (document.activeElement as HTMLElement | null)?.blur();
    },
  });

  const selectedIds = [...selected];
  const allShownSelected = sorted.length > 0 && sorted.every((r) => selected.has(r.id));

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <FilterBar
        filters={filters}
        setFilters={setFilters}
        count={sorted.length}
        total={rows.length}
        searchRef={searchRef}
        onRefresh={refresh}
      />
      <SummaryStrip rows={alerts} />

      {selectedIds.length > 0 && (
        <div
          data-testid="bulk-bar"
          className="h-10 shrink-0 px-3 flex items-center gap-3 bg-g-blue/10 border-b border-g-blue/40"
        >
          <span data-testid="bulk-count" className="text-data font-data text-g-blue">
            {selectedIds.length} selected
          </span>
          <Button
            size="sm"
            onClick={() => {
              ackMany(selectedIds);
              setSelected(new Set());
            }}
          >
            Acknowledge all
          </Button>
          <Button
            size="sm"
            onClick={() => toast(`Export started · ${selectedIds.length} rows → CSV`, "ok")}
          >
            Export
          </Button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="ml-auto text-micro uppercase text-g-text-2 hover:text-g-text"
          >
            Clear selection · Esc
          </button>
        </div>
      )}

      <div ref={bodyRef} className="flex-1 min-h-0 overflow-auto">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 z-10 bg-g-panel">
            <tr className="h-8 border-b border-g-border">
              <th className="w-8 px-2">
                <input
                  type="checkbox"
                  aria-label="Select all shown"
                  className="g-check"
                  checked={allShownSelected}
                  onChange={() =>
                    setSelected(allShownSelected ? new Set() : new Set(sorted.map((r) => r.id)))
                  }
                />
              </th>
              {COLS.map((c) => (
                <th
                  key={c.key}
                  className={`px-2 ${c.w ?? ""} ${c.align === "right" ? "text-right" : "text-left"}`}
                >
                  {c.key === "actions" ? (
                    <MicroLabel>{c.label}</MicroLabel>
                  ) : (
                    <button
                      type="button"
                      data-testid={`sort-${c.key}`}
                      onClick={() => toggle(c.key)}
                      className={`inline-flex items-center gap-1 text-micro uppercase tracking-[0.08em] hover:text-g-text ${
                        key === c.key ? "text-g-text" : "text-g-muted"
                      } ${c.align === "right" ? "flex-row-reverse" : ""}`}
                    >
                      {c.label}
                      {key === c.key && (
                        <Icon name={dir === "asc" ? "arrow_upward" : "arrow_downward"} size={12} />
                      )}
                    </button>
                  )}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {loading ? (
              <tr>
                <td colSpan={COLS.length + 1} className="p-0">
                  <SkeletonRows rows={10} cols={6} />
                </td>
              </tr>
            ) : sorted.length === 0 ? (
              <tr>
                <td colSpan={COLS.length + 1}>
                  <EmptyState
                    message="No alerts match the current filters."
                    actionLabel="Clear filters"
                    onAction={() => setFilters(EMPTY)}
                  />
                </td>
              </tr>
            ) : (
              sorted.map((r, i) => {
                const unack = r.status === "new";
                const isSel = selected.has(r.id);
                const isCursor = i === cursor;
                return (
                  <tr
                    key={r.id}
                    data-testid="alert-row"
                    data-row-index={i}
                    data-status={r.status}
                    data-cursor={isCursor || undefined}
                    data-selected={isSel || undefined}
                    onClick={() => setCursor(i)}
                    className={`group h-9 border-b border-g-border border-l-2 transition-none ${
                      unack ? "border-l-g-red" : "border-l-transparent"
                    } ${isSel ? "bg-g-blue/10" : isCursor ? "bg-g-hover" : "hover:bg-g-hover"} ${
                      r.live ? "animate-g-in" : ""
                    }`}
                  >
                    <td className="px-2">
                      <input
                        type="checkbox"
                        aria-label={`Select ${r.id}`}
                        className="g-check"
                        checked={isSel}
                        onChange={() => toggleSel(r.id)}
                      />
                    </td>
                    <td className="px-2 text-data font-data text-g-text-2">{hms(r.t)}</td>
                    <td className="px-2 text-data font-data text-g-text">{r.id}</td>
                    <td className="px-2 text-data font-data text-g-text-2">{r.cameraId}</td>
                    <td className={`px-2 text-ui truncate ${unack ? "text-g-text" : "text-g-text-2"}`}>
                      {r.camName}
                    </td>
                    <td className="px-2 text-ui text-g-text-2 truncate">{r.zone}</td>
                    <td className="px-2">
                      <ClassTag cls={r.cls} />
                    </td>
                    <td className="px-2">
                      <SeverityChip severity={r.severity} />
                    </td>
                    <td className="px-2 text-right text-data font-data text-g-text-2">
                      {r.confidence.toFixed(1)}
                    </td>
                    <td className="px-2 text-ui">
                      <StatusCell status={r.status} by={r.ackBy} />
                    </td>
                    <td className="px-2">
                      <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                        {unack && (
                          <Button size="sm" title={`Acknowledge ${r.id}`} onClick={() => ack(r.id)}>
                            Ack
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="danger"
                          title={`Dispatch QRF for ${r.id}`}
                          onClick={() => dispatch(r.id)}
                        >
                          QRF
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="h-7 shrink-0 px-3 flex items-center justify-between bg-g-panel border-t border-g-border">
        <MicroLabel>
          Sorted by {COLS.find((c) => c.key === key)?.label ?? key} · {dir}
        </MicroLabel>
        <span className="flex items-center gap-1.5 text-micro uppercase text-g-muted">
          <StatusDot tone="ok" />
          Audit log recording
        </span>
      </div>
    </div>
  );
}
