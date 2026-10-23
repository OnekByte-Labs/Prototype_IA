"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import {
  Badge,
  Button,
  Checkbox,
  Icon,
  IconButton,
  Input,
  PageHeader,
  Select,
  Stat,
  StatStrip,
  StatusIndicator,
  Table,
  Td,
  Th,
  Tr,
} from "@/components/ds";
import { PlateBadge } from "./PlateBadge";
import { AnprDetailRow } from "./AnprDetailRow";
import type { AnprLogRecord } from "@/app/api/v1/anpr/route";

interface ApiResponse {
  stats: {
    totalCaptures: number;
    uniquePlates: number;
    highConfidencePct: number;
    activeCameras: number;
    flaggedCount: number;
    filteredCount: number;
  };
  logs: AnprLogRecord[];
}

const fetcher = (url: string) => fetch(url).then((res) => res.json());

type SortKey = "time" | "plate" | "type" | "model" | "camera" | "location" | "confidence" | "status";

export function AnprConsole({
  initialPlate,
  initialCamera,
}: {
  initialPlate?: string;
  initialCamera?: string;
} = {}) {
  const router = useRouter();
  const searchRef = useRef<HTMLInputElement>(null);

  // Filters state
  const [q, setQ] = useState(initialPlate ?? "");
  const [selectedCamera, setSelectedCamera] = useState(initialCamera ?? "all");
  const [selectedType, setSelectedType] = useState("all");
  const [selectedConfidence, setSelectedConfidence] = useState("0");
  const [selectedStatus, setSelectedStatus] = useState("all");

  // Selection & inspection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [inspectedId, setInspectedId] = useState<string | null>(null);

  // Sorting state
  const [sortKey, setSortKey] = useState<SortKey>("time");
  const [sortDir, setSortDir] = useState<1 | -1>(-1); // default newest first

  // Fetch data
  const { data, mutate, isValidating } = useSWR<ApiResponse>("/api/v1/anpr", fetcher, {
    refreshInterval: 10000,
    revalidateOnFocus: false,
  });

  const allLogs = data?.logs ?? [];
  const stats = data?.stats;

  // Camera choices from logs
  const availableCameras = useMemo(() => {
    return Array.from(new Set(allLogs.map((l) => l.cameraId))).sort();
  }, [allLogs]);

  // Filtering
  const filteredLogs = useMemo(() => {
    let res = allLogs;
    if (selectedCamera !== "all") {
      res = res.filter((l) => l.cameraId === selectedCamera);
    }
    if (selectedType !== "all") {
      res = res.filter((l) => l.vehicleType.toLowerCase() === selectedType.toLowerCase());
    }
    if (parseFloat(selectedConfidence) > 0) {
      const min = parseFloat(selectedConfidence);
      res = res.filter((l) => l.confidence >= min);
    }
    if (selectedStatus !== "all") {
      res = res.filter((l) => l.status === selectedStatus);
    }
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      res = res.filter((l) => {
        const hay = `${l.id} ${l.plate} ${l.model} ${l.vehicleType} ${l.cameraId} ${l.cameraName} ${l.sector} ${l.zone} ${l.mgrs}`.toLowerCase();
        return hay.includes(needle);
      });
    }
    return res;
  }, [allLogs, selectedCamera, selectedType, selectedConfidence, selectedStatus, q]);

  // Sorting
  const sortedLogs = useMemo(() => {
    const list = [...filteredLogs];
    list.sort((a, b) => {
      let av: string | number = a.timestamp;
      let bv: string | number = b.timestamp;

      if (sortKey === "time") {
        av = new Date(a.timestamp).getTime();
        bv = new Date(b.timestamp).getTime();
      } else if (sortKey === "plate") {
        av = a.plate;
        bv = b.plate;
      } else if (sortKey === "type") {
        av = a.vehicleType;
        bv = b.vehicleType;
      } else if (sortKey === "model") {
        av = a.model;
        bv = b.model;
      } else if (sortKey === "camera") {
        av = a.cameraId;
        bv = b.cameraId;
      } else if (sortKey === "location") {
        av = a.sector;
        bv = b.sector;
      } else if (sortKey === "confidence") {
        av = a.confidence;
        bv = b.confidence;
      } else if (sortKey === "status") {
        av = a.status;
        bv = b.status;
      }

      const diff = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
      return diff * sortDir;
    });
    return list;
  }, [filteredLogs, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 1 ? -1 : 1));
    } else {
      setSortKey(key);
      setSortDir(-1);
    }
  };

  const isDirty =
    q !== "" ||
    selectedCamera !== "all" ||
    selectedType !== "all" ||
    selectedConfidence !== "0" ||
    selectedStatus !== "all";

  const clearFilters = () => {
    setQ("");
    setSelectedCamera("all");
    setSelectedType("all");
    setSelectedConfidence("0");
    setSelectedStatus("all");
  };

  // Keyboard shortcut '/' to search
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement !== searchRef.current) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Export to CSV
  const exportCsv = () => {
    const headers = [
      "ID",
      "Timestamp",
      "Plate",
      "Vehicle Type",
      "Model",
      "Camera ID",
      "Camera Name",
      "Sector",
      "Zone",
      "MGRS",
      "Confidence",
      "Status",
    ];
    const rows = sortedLogs.map((l) => [
      l.id,
      l.timestamp,
      `"${l.plate}"`,
      l.vehicleType,
      `"${l.model}"`,
      l.cameraId,
      `"${l.cameraName}"`,
      `"${l.sector}"`,
      `"${l.zone}"`,
      `"${l.mgrs}"`,
      l.confidence,
      l.status,
    ]);
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `anpr_fleet_logs_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === sortedLogs.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(sortedLogs.map((l) => l.id)));
    }
  };

  const toggleSelectRow = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      {/* 1. Page Header */}
      <PageHeader
        title="ANPR console"
        description="Automated number plate recognition across tactical cameras, newest first"
      />

      {/* 2. Stat Strip (matching AlertConsole) */}
      <StatStrip>
        <Stat label="Plate reads" value={stats?.totalCaptures ?? allLogs.length} />
        <Stat label="Unique vehicles" value={stats?.uniquePlates ?? 0} />
        <Stat label="High confidence" value={`${stats?.highConfidencePct ?? 0}%`} />
        <Stat label="Cameras" value={stats?.activeCameras ?? availableCameras.length} />
        <Stat label="Latest read" value="< 5s ago" />
      </StatStrip>

      {/* 3. Filter Bar (matching AlertConsole) */}
      <div className="min-h-14 shrink-0 px-4 py-2 flex flex-wrap items-center gap-2 border-b border-line">
        <div className="relative">
          <Icon
            name="search"
            size={16}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none"
          />
          <Input
            ref={searchRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search plate, model, camera, post…  ( / )"
            aria-label="Search ANPR logs"
            className="w-72 pl-8"
          />
        </div>

        <Select
          aria-label="Camera"
          value={selectedCamera}
          onChange={(e) => setSelectedCamera(e.target.value)}
        >
          <option value="all">All cameras</option>
          {availableCameras.map((cid) => (
            <option key={cid} value={cid}>
              {cid}
            </option>
          ))}
        </Select>

        <Select
          aria-label="Vehicle type"
          value={selectedType}
          onChange={(e) => setSelectedType(e.target.value)}
        >
          <option value="all">All vehicle types</option>
          <option value="car">Car</option>
          <option value="truck">Truck</option>
          <option value="bus">Bus</option>
          <option value="taxi">Taxi</option>
          <option value="auto">Auto</option>
          <option value="motorcycle">Motorcycle</option>
        </Select>

        <Select
          aria-label="Confidence"
          value={selectedConfidence}
          onChange={(e) => setSelectedConfidence(e.target.value)}
        >
          <option value="0">All confidence</option>
          <option value="0.9">High (≥ 90%)</option>
          <option value="0.75">Medium (≥ 75%)</option>
          <option value="0.35">Valid (≥ 35%)</option>
        </Select>

        <Select
          aria-label="Status"
          value={selectedStatus}
          onChange={(e) => setSelectedStatus(e.target.value)}
        >
          <option value="all">All statuses</option>
          <option value="VERIFIED">Verified</option>
          <option value="MULTI_SIGHTING">Multi-sighting</option>
          <option value="FLAGGED">Flagged</option>
          <option value="WATCHLIST">Watchlist</option>
        </Select>

        {isDirty && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            Clear all
          </Button>
        )}

        <div className="ml-auto flex items-center gap-2">
          <Badge tone="accent">
            <Icon name="badge" size={13} />
            ANPR logs only
          </Badge>
          <span className="text-ui text-ink-2 tnum">
            {sortedLogs.length === allLogs.length
              ? `${allLogs.length} plate reads`
              : `${sortedLogs.length} of ${allLogs.length} plate reads`}
          </span>
          <IconButton label="Re-poll ANPR logs" onClick={() => void mutate()}>
            <Icon name="refresh" size={18} className={isValidating ? "animate-spin" : ""} />
          </IconButton>
        </div>
      </div>

      {/* 4. Table view */}
      <div className="flex-1 min-h-0 overflow-auto">
        <Table>
          <thead>
            <tr>
              <Th width={40} className="text-center">
                <Checkbox
                  checked={sortedLogs.length > 0 && selectedIds.size === sortedLogs.length}
                  onChange={toggleSelectAll}
                  aria-label="Select all"
                />
              </Th>
              <Th
                width={90}
                sortKey="time"
                activeSortKey={sortKey}
                sortDir={sortDir === 1 ? "asc" : "desc"}
                onSort={() => toggleSort("time")}
              >
                Time
              </Th>
              <Th
                width={185}
                sortKey="plate"
                activeSortKey={sortKey}
                sortDir={sortDir === 1 ? "asc" : "desc"}
                onSort={() => toggleSort("plate")}
              >
                Plate number
              </Th>
              <Th
                width={85}
                sortKey="type"
                activeSortKey={sortKey}
                sortDir={sortDir === 1 ? "asc" : "desc"}
                onSort={() => toggleSort("type")}
              >
                Class
              </Th>
              <Th
                width={140}
                sortKey="model"
                activeSortKey={sortKey}
                sortDir={sortDir === 1 ? "asc" : "desc"}
                onSort={() => toggleSort("model")}
              >
                Model
              </Th>
              <Th
                width={95}
                sortKey="camera"
                activeSortKey={sortKey}
                sortDir={sortDir === 1 ? "asc" : "desc"}
                onSort={() => toggleSort("camera")}
              >
                Camera
              </Th>
              <Th
                sortKey="location"
                activeSortKey={sortKey}
                sortDir={sortDir === 1 ? "asc" : "desc"}
                onSort={() => toggleSort("location")}
              >
                Location / post
              </Th>
              <Th
                width={80}
                align="right"
                sortKey="confidence"
                activeSortKey={sortKey}
                sortDir={sortDir === 1 ? "asc" : "desc"}
                onSort={() => toggleSort("confidence")}
              >
                Conf.
              </Th>
              <Th
                width={110}
                sortKey="status"
                activeSortKey={sortKey}
                sortDir={sortDir === 1 ? "asc" : "desc"}
                onSort={() => toggleSort("status")}
              >
                Status
              </Th>
              <Th width={120} align="right"></Th>
            </tr>
          </thead>
          <tbody>
            {sortedLogs.length === 0 ? (
              <tr>
                <td colSpan={10} className="p-12 text-center text-ui text-ink-2">
                  No license plate reads match the current filters.
                </td>
              </tr>
            ) : (
              sortedLogs.map((log) => {
                const isSelected = selectedIds.has(log.id);
                const isInspected = inspectedId === log.id;
                const dateObj = new Date(log.timestamp);
                const timeString = isNaN(dateObj.getTime())
                  ? log.timestamp
                  : `${String(dateObj.getUTCHours()).padStart(2, "0")}:${String(dateObj.getUTCMinutes()).padStart(2, "0")}:${String(dateObj.getUTCSeconds()).padStart(2, "0")}`;

                // Class colors matching reference palette
                const classColor = {
                  Car: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
                  Truck: "text-blue-400 bg-blue-500/10 border-blue-500/20",
                  Bus: "text-purple-400 bg-purple-500/10 border-purple-500/20",
                  Taxi: "text-amber-400 bg-amber-500/10 border-amber-500/20",
                  Auto: "text-amber-400 bg-amber-500/10 border-amber-500/20",
                  Motorcycle: "text-cyan-400 bg-cyan-500/10 border-cyan-500/20",
                }[log.vehicleType] ?? "text-white bg-white/10 border-white/20";

                return (
                  <Fragment key={log.id}>
                    <Tr
                      selected={isInspected}
                      onClick={() => setInspectedId((curr) => (curr === log.id ? null : log.id))}
                      className="cursor-pointer"
                    >
                      <Td className="text-center">
                        <div onClick={(e: React.MouseEvent) => e.stopPropagation()}>
                          <Checkbox
                            checked={isSelected}
                            onChange={(e) => toggleSelectRow(log.id, e as unknown as React.MouseEvent)}
                            aria-label={`Select ${log.plate}`}
                          />
                        </div>
                      </Td>
                      <Td mono className="text-ink">
                        {timeString}
                      </Td>
                      <Td>
                        <div className="flex items-center gap-2">
                          {log.carCropUrl && (
                            <img
                              src={log.carCropUrl}
                              alt={log.plate}
                              className="w-9 h-6 object-cover rounded border border-line bg-black shrink-0 shadow-sm"
                              title="Verified vehicle crop"
                            />
                          )}
                          <PlateBadge
                            plate={log.plate}
                            size="sm"
                            isCommercial={log.vehicleType === "Truck" || log.vehicleType === "Taxi" || log.vehicleType === "Auto"}
                          />
                        </div>
                      </Td>
                      <Td>
                        <span className={`px-1.5 py-0.5 rounded text-[11px] font-semibold border ${classColor}`}>
                          {log.vehicleType}
                        </span>
                      </Td>
                      <Td className="text-ink truncate max-w-[140px]" title={log.model}>
                        {log.model}
                      </Td>
                      <Td mono className="text-ink-2">
                        {log.cameraId}
                      </Td>
                      <Td className="text-ink-2 truncate max-w-[240px]" title={`${log.cameraName} · ${log.sector}`}>
                        <span className="text-ink font-medium">{log.cameraName}</span> · {log.sector}
                      </Td>
                      <Td align="right" mono className="text-ink font-data tnum">
                        {(log.confidence * 100).toFixed(1)}%
                      </Td>
                      <Td>
                        {log.status === "FLAGGED" ? (
                          <StatusIndicator tone="crit">Flagged</StatusIndicator>
                        ) : log.status === "WATCHLIST" ? (
                          <StatusIndicator tone="warn">Watchlist</StatusIndicator>
                        ) : log.status === "MULTI_SIGHTING" ? (
                          <StatusIndicator tone="accent">Sighted ×{log.sightingsCount}</StatusIndicator>
                        ) : (
                          <StatusIndicator tone="ok">Verified</StatusIndicator>
                        )}
                      </Td>
                      <Td align="right">
                        <div
                          className="flex items-center justify-end gap-1.5"
                          onClick={(e: React.MouseEvent) => e.stopPropagation()}
                        >
                          <Button
                            size="sm"
                            variant={isInspected ? "primary" : "default"}
                            onClick={() => setInspectedId((curr) => (curr === log.id ? null : log.id))}
                          >
                            {isInspected ? "Close" : "Inspect"}
                          </Button>
                        </div>
                      </Td>
                    </Tr>

                    {isInspected && (
                      <AnprDetailRow
                        record={log}
                        allLogs={allLogs}
                        onFilterPlate={(p) => setQ(p)}
                        onClose={() => setInspectedId(null)}
                      />
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </Table>
      </div>

      {/* 5. Footer Bar (matching AlertConsole) */}
      <div className="min-h-9 shrink-0 px-4 py-1.5 border-t border-line flex items-center justify-between text-caption text-ink-3">
        <div className="flex items-center gap-3">
          <span>
            Sorted by {sortKey === "time" ? "Time" : sortKey} - {sortDir === 1 ? "ascending" : "descending"}
          </span>
          <span>·</span>
          <span>
            {selectedIds.size > 0
              ? `${selectedIds.size} of ${sortedLogs.length} selected`
              : `${sortedLogs.length} total displayed`}
          </span>
          {selectedIds.size > 0 && (
            <Button size="sm" onClick={() => setSelectedIds(new Set())}>
              Deselect all
            </Button>
          )}
        </div>

        <div className="flex items-center gap-4">
          <Button size="sm" onClick={exportCsv} title="Export current filtered view to CSV">
            <Icon name="download" size={14} /> Export CSV
          </Button>
          <span className="flex items-center gap-1.5 text-ok-ink">
            <span className="w-1.5 h-1.5 rounded-full bg-ok-ink" />
            Audit log recording
          </span>
        </div>
      </div>
    </div>
  );
}
