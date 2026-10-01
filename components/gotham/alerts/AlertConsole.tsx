"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Badge,
  Button,
  Card,
  ClassTag,
  EmptyState,
  Icon,
  IconButton,
  PageHeader,
  SeverityChip,
  SkeletonRows,
  Stat,
  StatStrip,
  StatusDot,
  StatusCell,
  Td,
  Th,
  Tr,
  Table,
  Input,
  Select,
  Checkbox,
} from "@/components/ds";
import { cx } from "@/lib/design/cx";
import { cameraById, hms, secondsOfDay, type Alert, type AlertClass, type AlertStatus, type Severity } from "@/lib/gotham/model";
import { useConsole } from "../ConsoleProvider";
import { useHotkeys, useSortable } from "../hooks";
import { useToast } from "../Toast";
import { AlertDetailRow, type AlertDetailData } from "./AlertDetail";

const SEV_RANK: Record<Severity, number> = { low: 0, med: 1, high: 2 };

type Row = Alert & { sevRank: number; location: string };

/** This console lists intrusion (perimeter breach) alerts raised by the AI
 *  pipeline only — alerts without a backing backend event are never shown. */
const isIntrusion = (a: Alert) => a.cls === "intrusion" && a.eventId != null;

/* --------------------------------------------------------------- filter bar */

type Filters = {
  q: string;
  severity: Severity | "all";
  status: AlertStatus | "all";
};

const EMPTY: Filters = { q: "", severity: "all", status: "all" };

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
  const dirty = filters.q !== "" || filters.severity !== "all" || filters.status !== "all";

  return (
    <div className="min-h-14 shrink-0 px-4 py-2 flex flex-wrap items-center gap-2 border-b border-line">
      <div className="relative">
        <Icon
          name="search"
          size={16}
          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none"
        />
        <Input
          ref={searchRef}
          value={filters.q}
          onChange={(e) => setFilters({ ...filters, q: e.target.value })}
          placeholder="Search ID, camera, post, company…  ( / )"
          aria-label="Search alerts"
          data-testid="alert-search"
          className="w-72 pl-8"
        />
      </div>

      <Select
        aria-label="Severity"
        data-testid="filter-severity"
        value={filters.severity}
        onChange={(e) => setFilters({ ...filters, severity: e.target.value as Filters["severity"] })}
      >
        <option value="all">All severities</option>
        <option value="high">High</option>
        <option value="med">Medium</option>
        <option value="low">Low</option>
      </Select>

      <Select
        aria-label="Status"
        data-testid="filter-status"
        value={filters.status}
        onChange={(e) => setFilters({ ...filters, status: e.target.value as Filters["status"] })}
      >
        <option value="all">All statuses</option>
        <option value="new">Unacknowledged</option>
        <option value="ack">Acknowledged</option>
        <option value="dispatched">Dispatched</option>
      </Select>

      {dirty && (
        <Button variant="ghost" size="sm" data-testid="clear-filters" onClick={() => setFilters(EMPTY)}>
          Clear all
        </Button>
      )}

      <div className="ml-auto flex items-center gap-2">
        <Badge tone="crit">
          <Icon name="crisis_alert" size={13} />
          Intrusion alerts only
        </Badge>
        <span data-testid="result-count" className="text-ui text-ink-2 tnum">
          {count === total ? `${total} intrusions` : `${count} of ${total} intrusions`}
        </span>
        <IconButton label="Re-poll alert store" onClick={onRefresh}>
          <Icon name="refresh" size={18} />
        </IconButton>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ summary strip */

function SummaryStrip({ rows }: { rows: Alert[] }) {
  const resolved = rows.filter((a) => a.ackAt !== undefined);
  const avg =
    resolved.length === 0
      ? 0
      : Math.round(resolved.reduce((s, a) => s + Math.max(0, (a.ackAt ?? 0) - a.t), 0) / resolved.length);
  const unack = rows.filter((a) => a.status === "new").length;

  return (
    <StatStrip>
      <Stat label="Intrusions" value={rows.length} />
      <Stat label="Unacknowledged" value={unack} tone={unack ? "crit" : "default"} />
      <Stat label="Dispatched" value={rows.filter((a) => a.status === "dispatched").length} />
      <Stat label="Cameras" value={new Set(rows.map((a) => a.cameraId)).size} />
      <Stat label="Avg response" value={`${Math.floor(avg / 60)}m ${avg % 60}s`} />
    </StatStrip>
  );
}

/* -------------------------------------------------------------------- table */

type Col = { key: string; label: string; w?: number; align?: "right" | "center" };

const COLS: Col[] = [
  { key: "t", label: "Time", w: 84 },
  { key: "id", label: "Alert / incident ID", w: 160 },
  { key: "cameraId", label: "Camera", w: 88 },
  { key: "location", label: "Location / zone" },
  { key: "cls", label: "Class", w: 100 },
  { key: "confidence", label: "Conf.", w: 72, align: "right" },
  { key: "sevRank", label: "Severity", w: 96 },
  { key: "status", label: "Status", w: 170 },
  { key: "actions", label: "", w: 168, align: "right" },
];

const locationOf = (a: Alert) =>
  [a.site?.cameraName, a.site?.postName, a.site?.companyName].filter(Boolean).join(" · ");

/** A stored alert opened by link (Argus Agent, map) that is not in this session's feed. */
function alertFromDetail(d: AlertDetailData): Alert {
  const cam = cameraById(d.camera.camera_id);
  return {
    id: d.alert_id,
    t: secondsOfDay(new Date(d.timestamp)),
    cameraId: d.camera.camera_id,
    zone: cam?.zone ?? "HQ COMPLEX",
    cls: d.class as AlertClass,
    severity: (d.severity ?? "med") as Severity,
    confidence: d.confidence ?? 0,
    status: d.acknowledged_by ? "ack" : "new",
    ackBy: d.acknowledged_by ?? undefined,
    eventId: d.event_id,
    trackId: d.track_id,
    site: { cameraName: d.camera.name, postName: d.site.post_name, companyName: d.site.company_name },
  };
}

/**
 * `focusAlert` (INC-…) or `focusIncident` (INCD-…, opens its latest alert) expands
 * that alert on arrival — linked from Argus Agent answers.
 */
export function AlertConsole({ focusAlert, focusIncident }: { focusAlert?: string; focusIncident?: string } = {}) {
  const { alerts, ack: ackLive, ackMany, dispatch } = useConsole();
  const [pinned, setPinned] = useState<Alert | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const ack = useCallback(
    (id: string) => {
      ackLive(id);
      setPinned((p) => (p && p.id === id && p.status === "new" ? { ...p, status: "ack" } : p));
    },
    [ackLive],
  );
  const toast = useToast();
  const router = useRouter();

  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cursorRaw, setCursor] = useState(0);
  const [loading, setLoading] = useState(false);
  // One inline-expanded alert at a time; `closing` lets it animate shut first.
  const [expanded, setExpanded] = useState<{ id: string; closing: boolean } | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const rows: Row[] = useMemo(() => {
    const live = alerts.filter(isIntrusion);
    const all = pinned && !live.some((a) => a.id === pinned.id) ? [pinned, ...live] : live;
    return all.map((a) => ({ ...a, sevRank: SEV_RANK[a.severity], location: locationOf(a) }));
  }, [alerts, pinned]);

  // Deep link: resolve the incident to its latest alert, fetch the alert if it is
  // not in this session's feed, then expand it.
  useEffect(() => {
    if (!focusAlert && !focusIncident) return;
    let cancelled = false;
    (async () => {
      try {
        let id = focusAlert;
        if (!id && focusIncident) {
          const res = await fetch(`/api/v1/incidents/${encodeURIComponent(focusIncident)}`, { cache: "no-store" });
          const body = await res.json();
          if (!res.ok) throw new Error(body?.error ?? `Incident ${focusIncident} not found`);
          id = body.incident?.latest_alert_id as string;
        }
        if (!id) return;
        const res = await fetch(`/api/v1/alerts/${encodeURIComponent(id)}`, { cache: "no-store" });
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error ?? `Alert ${id} not found`);
        if (cancelled) return;
        setPinned(alertFromDetail(body as AlertDetailData));
        setExpanded({ id, closing: false });
      } catch (e) {
        if (!cancelled) setLinkError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [focusAlert, focusIncident]);

  const filtered = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return rows.filter((r) => {
      if (filters.severity !== "all" && r.severity !== filters.severity) return false;
      if (filters.status !== "all" && r.status !== filters.status) return false;
      if (q) {
        const hay = `${r.id} ${r.cameraId} ${r.location}`.toLowerCase();
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

  const toggleExpand = useCallback((id: string) => {
    setExpanded((e) => (e?.id === id ? { id, closing: true } : { id, closing: false }));
  }, []);
  const collapse = useCallback(() => {
    setExpanded((e) => (e ? { ...e, closing: true } : e));
  }, []);
  const clearExpanded = useCallback(() => {
    setExpanded((e) => (e?.closing ? null : e));
  }, []);

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
      if (expanded && !expanded.closing) {
        collapse();
        return;
      }
      setSelected(new Set());
      (document.activeElement as HTMLElement | null)?.blur();
    },
  });

  const selectedIds = [...selected];
  const allShownSelected = sorted.length > 0 && sorted.every((r) => selected.has(r.id));

  return (
    <>
      <PageHeader
        title="Alert console"
        description="Perimeter-breach alerts raised by the AI pipeline, newest first"
      />

      <div className="flex-1 min-h-0 flex flex-col gap-3 px-5 pb-4">
        <SummaryStrip rows={rows} />
        {linkError && (
          <div role="alert" className="shrink-0 px-4 py-2 rounded-md border border-crit/35 bg-crit-wash text-ui text-crit-ink">
            {linkError}
          </div>
        )}

        <Card flat flush className="flex-1 min-h-0 overflow-hidden" bodyClassName="flex flex-col">
          <FilterBar
            filters={filters}
            setFilters={setFilters}
            count={sorted.length}
            total={rows.length}
            searchRef={searchRef}
            onRefresh={refresh}
          />

          {selectedIds.length > 0 && (
            <div
              data-testid="bulk-bar"
              className="min-h-11 shrink-0 px-4 py-1.5 flex items-center gap-3 bg-accent-wash border-b border-line"
            >
              <span data-testid="bulk-count" className="text-ui font-medium text-accent-ink tnum">
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
              <Button size="sm" onClick={() => toast(`Export started · ${selectedIds.length} rows → CSV`, "ok")}>
                Export
              </Button>
              <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setSelected(new Set())}>
                Clear selection <span className="text-ink-3 font-normal">Esc</span>
              </Button>
            </div>
          )}

          <div ref={bodyRef} className="flex-1 min-h-0 overflow-auto">
            <Table>
              <thead>
                <tr>
                  <Th width={40} className="pl-4 pr-0">
                    <Checkbox
                      aria-label="Select all shown"
                      checked={allShownSelected}
                      onChange={() => setSelected(allShownSelected ? new Set() : new Set(sorted.map((r) => r.id)))}
                    />
                  </Th>
                  {COLS.map((c) => (
                    <Th
                      key={c.key}
                      width={c.w}
                      align={c.align}
                      sortKey={c.key === "actions" ? undefined : c.key}
                      activeSortKey={key}
                      sortDir={dir}
                      onSort={toggle}
                    >
                      {c.label}
                    </Th>
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
                        message={
                          rows.length === 0
                            ? "No intrusion alerts from the AI pipeline yet."
                            : "No intrusion alerts match the current filters."
                        }
                      >
                        {rows.length > 0 && <Button onClick={() => setFilters(EMPTY)}>Clear filters</Button>}
                      </EmptyState>
                    </td>
                  </tr>
                ) : (
                  sorted.map((r, i) => {
                    const unack = r.status === "new";
                    const isSel = selected.has(r.id);
                    const isCursor = i === cursor;
                    const isOpen = expanded?.id === r.id;
                    return (
                      <Fragment key={r.id}>
                        <Tr
                          data-testid="alert-row"
                          data-row-index={i}
                          data-status={r.status}
                          data-cursor={isCursor || undefined}
                          data-selected={isSel || undefined}
                          data-expanded={isOpen || undefined}
                          aria-expanded={isOpen}
                          selected={isSel}
                          onClick={() => {
                            setCursor(i);
                            toggleExpand(r.id);
                          }}
                          className={cx(
                                                        isOpen && !isSel && "bg-hover",
                            isCursor && !isOpen && !isSel && !unack && "bg-hover",
                            r.live && "animate-rise",
                          )}
                        >
                          <Td className="relative pl-4 pr-0">
                            {unack && <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-crit" />}
                            <span onClick={(e) => e.stopPropagation()}>
                              <Checkbox
                                aria-label={`Select ${r.id}`}
                                checked={isSel}
                                onChange={() => toggleSel(r.id)}
                              />
                            </span>
                          </Td>
                          <Td mono className="text-ink-2">{hms(r.t)}</Td>
                          <Td mono className="text-ink">{r.id}</Td>
                          <Td mono className="text-ink-2">{r.cameraId}</Td>
                          <Td title={r.location} className={cx("max-w-0 truncate", unack ? "text-ink font-medium" : "text-ink-2")}>
                            {r.site?.cameraName ?? r.cameraId}
                            {(r.site?.postName || r.site?.companyName) && (
                              <span className="text-ink-3 font-normal">
                                {" · "}
                                {[r.site?.postName, r.site?.companyName].filter(Boolean).join(" · ")}
                              </span>
                            )}
                          </Td>
                          <Td>
                            <ClassTag cls={r.cls} />
                          </Td>
                          <Td align="right" mono className="text-ink-2">
                            {r.confidence.toFixed(1)}
                          </Td>
                          <Td>
                            <SeverityChip severity={r.severity} />
                          </Td>
                          <Td>
                            <StatusCell status={r.status} by={r.ackBy} />
                          </Td>
                          <Td align="right">
                            <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                                {unack && (
                                  <Button size="sm" title={`Acknowledge ${r.id}`} onClick={() => ack(r.id)}>
                                    Ack
                                  </Button>
                                )}
                                <Button
                                  size="sm"
                                  title={`Show ${r.cameraId} on the tactical map`}
                                  onClick={() =>
                                    router.push(`/map?alert=${encodeURIComponent(r.id)}&camera=${encodeURIComponent(r.cameraId)}`)
                                  }
                                >
                                  Map
                                </Button>
                                <Button
                                  size="sm"
                                  variant="danger"
                                  title={`Dispatch QRF for ${r.id}`}
                                  onClick={() => dispatch(r.id)}
                                >
                                  QRF
                                </Button>
                              </div>
                              <IconButton
                                size="sm"
                                data-testid="expand-toggle"
                                label={isOpen ? `Collapse ${r.id}` : `Expand ${r.id}`}
                                onClick={() => {
                                  setCursor(i);
                                  toggleExpand(r.id);
                                }}
                              >
                                <Icon name={isOpen ? "expand_less" : "expand_more"} size={18} />
                              </IconButton>
                            </div>
                          </Td>
                        </Tr>
                        {isOpen && (
                          <AlertDetailRow
                            alert={r}
                            colSpan={COLS.length + 1}
                            closing={expanded.closing}
                            onCollapse={collapse}
                            onClosed={clearExpanded}
                            onAck={() => ack(r.id)}
                            onDispatch={() => dispatch(r.id)}
                          />
                        )}
                      </Fragment>
                    );
                  })
                )}
              </tbody>
            </Table>
          </div>

          <div className="h-9 shrink-0 px-4 flex items-center justify-between border-t border-line text-caption text-ink-2">
            <span>
              Sorted by {COLS.find((c) => c.key === key)?.label ?? key} ·{" "}
              {dir === "asc" ? "ascending" : "descending"}
            </span>
            <span className="flex items-center gap-1.5">
              <StatusDot tone="ok" />
              Audit log recording
            </span>
          </div>
        </Card>
      </div>
    </>
  );
}
