"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import {
  MOCK_REPORTS,
  type ReportCategory,
  type ReportSeverity,
  type TacticalReport,
} from "@/lib/reports-data";
import { Button, MicroLabel, SeverityChip, StatusDot } from "../primitives";
import { useToast } from "../Toast";

type CategoryFilter = ReportCategory | "all";
type SeverityFilter = ReportSeverity | "all";

export function ReportsConsole() {
  const toast = useToast();
  const [reports] = useState<TacticalReport[]>(MOCK_REPORTS);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const [selectedReport, setSelectedReport] = useState<TacticalReport | null>(null);
  const [timeframe, setTimeframe] = useState<"24h" | "7d" | "30d">("24h");
  const [showPrintModal, setShowPrintModal] = useState(false);

  // Filtered reports
  const filteredReports = useMemo(() => {
    const q = search.trim().toLowerCase();
    return reports.filter((r) => {
      if (categoryFilter !== "all" && r.category !== categoryFilter) return false;
      if (severityFilter !== "all" && r.severity !== severityFilter) return false;
      if (q) {
        const hay = `${r.id} ${r.cameraId} ${r.cameraName} ${r.zone} ${r.summary} ${r.leadOfficer} ${r.findings} ${r.detectedPlate ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [reports, search, categoryFilter, severityFilter]);

  // KPIs
  const totalIncidents = reports.length;
  const highSeverity = reports.filter((r) => r.severity === "high").length;
  const investigatingCount = reports.filter((r) => r.status === "investigating").length;
  const resolvedRate = Math.round(
    (reports.filter((r) => r.status === "resolved").length / (reports.length || 1)) * 100
  );

  const exportCsv = () => {
    const headers = [
      "Report ID",
      "Date",
      "Time",
      "Category",
      "Severity",
      "Camera ID",
      "Camera Name",
      "Zone",
      "Target",
      "Detected Plate",
      "Model Conf",
      "Lead Officer",
      "Status",
      "Summary",
      "Action Taken",
      "Findings",
    ];

    const rows = filteredReports.map((r) => [
      r.id,
      r.date,
      r.time,
      `"${r.categoryLabel}"`,
      r.severity.toUpperCase(),
      r.cameraId,
      `"${r.cameraName}"`,
      r.zone,
      `"${r.targetClassification}"`,
      r.detectedPlate ?? "N/A",
      `${r.modelConfidence}%`,
      `"${r.leadOfficer}"`,
      r.status.toUpperCase(),
      `"${r.summary.replace(/"/g, '""')}"`,
      `"${r.actionTaken.replace(/"/g, '""')}"`,
      `"${r.findings.replace(/"/g, '""')}"`,
    ]);

    const csvContent =
      "data:text/csv;charset=utf-8," +
      [headers.join(","), ...rows.map((row) => row.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute(
      "download",
      `iscc-tactical-report-${new Date().toISOString().slice(0, 10)}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast(`Exported ${filteredReports.length} incident reports to CSV`, "ok");
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-g-bg text-g-text">
      {/* ------------------------------------------------------------- KPI Bar */}
      <div className="shrink-0 p-3 grid grid-cols-4 gap-2 bg-g-panel border-b border-g-border">
        <div className="p-3 bg-g-surface border border-g-border flex flex-col justify-between">
          <div className="flex items-center justify-between text-micro uppercase text-g-muted">
            <span>Total Incident Log</span>
            <Icon name="description" size={16} className="text-g-blue" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-data font-bold text-g-text">
              {totalIncidents}
            </span>
            <span className="text-micro text-g-muted">logged in shift</span>
          </div>
        </div>

        <div className="p-3 bg-g-surface border border-g-border flex flex-col justify-between">
          <div className="flex items-center justify-between text-micro uppercase text-g-muted">
            <span>High Severity Breaches</span>
            <Icon name="warning" size={16} className="text-g-red" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-data font-bold text-g-red">
              {highSeverity}
            </span>
            <span className="text-micro text-g-red">
              {investigatingCount > 0 ? `${investigatingCount} active investigation` : "All mitigated"}
            </span>
          </div>
        </div>

        <div className="p-3 bg-g-surface border border-g-border flex flex-col justify-between">
          <div className="flex items-center justify-between text-micro uppercase text-g-muted">
            <span>Resolution Rate</span>
            <Icon name="check_circle" size={16} className="text-g-green" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-data font-bold text-g-green">
              {resolvedRate}%
            </span>
            <span className="text-micro text-g-muted">closed / neutralized</span>
          </div>
        </div>

        <div className="p-3 bg-g-surface border border-g-border flex flex-col justify-between">
          <div className="flex items-center justify-between text-micro uppercase text-g-muted">
            <span>Avg QRF Intercept Time</span>
            <Icon name="timer" size={16} className="text-g-cyan" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-data font-bold text-g-cyan">
              38s
            </span>
            <span className="text-micro text-g-muted">target: &lt;60s</span>
          </div>
        </div>
      </div>

      {/* ----------------------------------------------------------- Filter Bar */}
      <div className="h-11 shrink-0 px-3 flex items-center gap-3 bg-g-panel border-b border-g-border">
        <div className="relative">
          <Icon
            name="search"
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-g-muted pointer-events-none"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search report ID, camera, summary, officer... (e.g. REP-01, Armoury)"
            className="h-8 w-80 pl-8 pr-2.5 bg-g-bg border border-g-border-strong rounded-[2px] text-ui text-g-text placeholder:text-g-muted focus:border-g-blue focus:outline-none"
          />
        </div>

        {/* Category Filters */}
        <div className="flex items-center gap-1 border-l border-g-border pl-3">
          {(
            [
              { key: "all", label: "All Incidents" },
              { key: "perimeter_breach", label: "Cordon Breach" },
              { key: "tripwire_violation", label: "Tripwires" },
              { key: "vehicle_anpr", label: "Vehicle ANPR" },
              { key: "wildlife_buffer", label: "Wildlife" },
            ] as { key: CategoryFilter; label: string }[]
          ).map((cat) => {
            const active = categoryFilter === cat.key;
            return (
              <button
                key={cat.key}
                onClick={() => setCategoryFilter(cat.key)}
                className={`h-7 px-2.5 rounded-[2px] text-micro uppercase font-medium transition-none ${
                  active
                    ? "bg-g-blue text-white"
                    : "text-g-text-2 bg-g-surface hover:bg-g-hover border border-g-border"
                }`}
              >
                {cat.label}
              </button>
            );
          })}
        </div>

        {/* Severity Filter */}
        <div className="flex items-center gap-2 border-l border-g-border pl-3">
          <MicroLabel>Severity</MicroLabel>
          <select
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value as SeverityFilter)}
            className="h-7 px-2 bg-g-bg border border-g-border-strong rounded-[2px] text-ui text-g-text focus:border-g-blue focus:outline-none"
          >
            <option value="all">All Severities</option>
            <option value="high">High Severity</option>
            <option value="med">Medium Severity</option>
            <option value="low">Low Severity</option>
          </select>
        </div>

        {/* Timeframe Selector */}
        <div className="flex items-center gap-1 border-l border-g-border pl-3">
          {(["24h", "7d", "30d"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTimeframe(t)}
              className={`h-7 px-2 text-micro uppercase rounded-[2px] font-mono ${
                timeframe === t
                  ? "bg-g-raised text-g-text border border-g-border-strong"
                  : "text-g-muted hover:text-g-text"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Action Buttons */}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-data font-data text-g-muted">
            {filteredReports.length} of {totalIncidents} records
          </span>
          <Button size="sm" onClick={() => setShowPrintModal(true)}>
            <Icon name="print" size={13} className="mr-1 inline-block" />
            Print Dossier
          </Button>
          <Button size="sm" onClick={exportCsv}>
            <Icon name="download" size={13} className="mr-1 inline-block" />
            Export CSV
          </Button>
        </div>
      </div>

      {/* ---------------------------------------------------- Main Table & Drawer */}
      <div className="flex-1 min-h-0 flex relative overflow-hidden">
        {/* Table View */}
        <div className="flex-1 min-h-0 overflow-auto">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 z-10 bg-g-panel">
              <tr className="h-8 border-b border-g-border text-left">
                <th className="px-3 text-micro uppercase tracking-wider text-g-muted w-[90px]">
                  Time
                </th>
                <th className="px-3 text-micro uppercase tracking-wider text-g-muted w-[140px]">
                  Report ID
                </th>
                <th className="px-3 text-micro uppercase tracking-wider text-g-muted w-[150px]">
                  Category
                </th>
                <th className="px-3 text-micro uppercase tracking-wider text-g-muted w-[160px]">
                  Camera & Zone
                </th>
                <th className="px-3 text-micro uppercase tracking-wider text-g-muted">
                  Incident Summary & Action
                </th>
                <th className="px-3 text-micro uppercase tracking-wider text-g-muted w-[80px]">
                  Severity
                </th>
                <th className="px-3 text-micro uppercase tracking-wider text-g-muted w-[130px]">
                  Lead Officer
                </th>
                <th className="px-3 text-micro uppercase tracking-wider text-g-muted w-[110px]">
                  Status
                </th>
                <th className="px-3 text-micro uppercase tracking-wider text-g-muted text-right w-[80px]">
                  Action
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-g-border">
              {filteredReports.length === 0 ? (
                <tr>
                  <td
                    colSpan={9}
                    className="p-12 text-center text-g-muted font-mono"
                  >
                    No incident reports match current search or filters.
                  </td>
                </tr>
              ) : (
                filteredReports.map((r) => {
                  const isSelected = selectedReport?.id === r.id;
                  return (
                    <tr
                      key={r.id}
                      onClick={() => setSelectedReport(r)}
                      className={`group h-12 cursor-pointer transition-none ${
                        isSelected
                          ? "bg-g-blue/15 border-l-2 border-l-g-blue"
                          : r.severity === "high"
                          ? "bg-g-red/5 hover:bg-g-red/10 border-l-2 border-l-g-red"
                          : "hover:bg-g-hover border-l-2 border-l-transparent"
                      }`}
                    >
                      {/* Time */}
                      <td className="px-3 text-data font-data text-g-text-2">
                        {r.time}
                      </td>

                      {/* ID */}
                      <td className="px-3">
                        <span className="font-mono text-ui text-g-text font-bold">
                          {r.id}
                        </span>
                      </td>

                      {/* Category */}
                      <td className="px-3">
                        <span className="text-micro px-2 py-0.5 rounded bg-g-surface border border-g-border text-g-cyan font-medium">
                          {r.categoryLabel}
                        </span>
                      </td>

                      {/* Camera & Zone */}
                      <td className="px-3">
                        <div className="text-ui text-g-text font-medium leading-tight">
                          {r.cameraId}
                        </div>
                        <div className="text-micro text-g-muted truncate max-w-[150px]">
                          {r.cameraName} · {r.zone}
                        </div>
                      </td>

                      {/* Summary */}
                      <td className="px-3">
                        <div className="text-ui text-g-text font-medium line-clamp-1 flex items-center gap-2">
                          <span>{r.summary}</span>
                          {r.detectedPlate && (
                            <span className="px-1.5 py-0.2 bg-amber-400 text-black font-mono text-[10px] font-bold rounded">
                              {r.detectedPlate}
                            </span>
                          )}
                        </div>
                        <div className="text-micro text-g-muted truncate max-w-[480px]">
                          {r.actionTaken}
                        </div>
                      </td>

                      {/* Severity */}
                      <td className="px-3">
                        <SeverityChip severity={r.severity} />
                      </td>

                      {/* Officer */}
                      <td className="px-3 text-ui text-g-text-2 truncate">
                        {r.leadOfficer}
                      </td>

                      {/* Status */}
                      <td className="px-3">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[2px] text-micro uppercase font-bold tracking-wider ${
                            r.status === "resolved"
                              ? "bg-g-green/15 text-g-green border border-g-green/30"
                              : r.status === "investigating"
                              ? "bg-g-red/20 text-g-red border border-g-red/40 animate-pulse"
                              : "bg-g-surface text-g-muted border border-g-border"
                          }`}
                        >
                          <StatusDot
                            tone={
                              r.status === "resolved"
                                ? "ok"
                                : r.status === "investigating"
                                ? "err"
                                : "idle"
                            }
                          />
                          {r.status}
                        </span>
                      </td>

                      {/* Action */}
                      <td className="px-3 text-right">
                        <Button
                          size="sm"
                          onClick={() => setSelectedReport(r)}
                        >
                          Dossier
                        </Button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* ---------------------------------------------- Report Details Drawer */}
        {selectedReport && (
          <div className="w-[440px] shrink-0 bg-g-panel border-l border-g-border flex flex-col z-20 shadow-2xl animate-g-in">
            {/* Drawer Header */}
            <div className="h-12 px-4 flex items-center justify-between border-b border-g-border bg-g-surface">
              <div className="flex items-center gap-2">
                <Icon name="description" size={16} className="text-g-blue" />
                <span className="text-ui font-bold text-g-text uppercase tracking-wide">
                  Incident Intelligence Dossier
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedReport(null)}
                className="w-7 h-7 flex items-center justify-center text-g-text-2 hover:text-g-text hover:bg-g-hover rounded"
              >
                <Icon name="close" size={16} />
              </button>
            </div>

            {/* Dossier Body */}
            <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
              {/* Classification Banner */}
              <div className="px-3 py-1.5 bg-g-red/10 border border-g-red/40 rounded text-center">
                <span className="text-micro font-bold tracking-widest text-g-red uppercase">
                  RESTRICTED // MILITARY WATCHFLOOR INCIDENT RECORD
                </span>
              </div>

              {/* Report Header Card */}
              <div className="p-3.5 bg-g-surface border border-g-border rounded space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-lg font-mono font-bold text-g-text">
                    {selectedReport.id}
                  </span>
                  <SeverityChip severity={selectedReport.severity} />
                </div>
                <div className="flex items-center justify-between text-micro text-g-muted">
                  <span>
                    Recorded: {selectedReport.date} at {selectedReport.time} HRS
                  </span>
                  <span className="text-g-cyan font-mono">
                    Model Conf: {selectedReport.modelConfidence}%
                  </span>
                </div>
              </div>

              {/* Camera & Target Info */}
              <div className="p-3 bg-g-surface border border-g-border rounded space-y-2">
                <MicroLabel>Location & Classification</MicroLabel>
                <div className="grid grid-cols-2 gap-2 text-ui">
                  <div>
                    <span className="text-micro text-g-muted block">Camera</span>
                    <span className="font-medium text-g-text">
                      {selectedReport.cameraId} · {selectedReport.cameraName}
                    </span>
                  </div>
                  <div>
                    <span className="text-micro text-g-muted block">Zone</span>
                    <span className="font-medium text-g-text">
                      {selectedReport.zone}
                    </span>
                  </div>
                  <div>
                    <span className="text-micro text-g-muted block">Target Class</span>
                    <span className="font-medium text-g-text">
                      {selectedReport.targetClassification}
                    </span>
                  </div>
                  <div>
                    <span className="text-micro text-g-muted block">Incident Status</span>
                    <span className="font-medium capitalize text-g-cyan">
                      {selectedReport.status}
                    </span>
                  </div>
                  {selectedReport.detectedPlate && (
                    <div className="col-span-2 pt-1">
                      <span className="text-micro text-g-muted block">Associated Plate</span>
                      <div className="mt-1 inline-flex items-center gap-2 px-2.5 py-1 bg-amber-400 text-black font-mono font-bold text-xs rounded border border-amber-500">
                        <span>{selectedReport.detectedPlate}</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Summary & Findings */}
              <div className="p-3 bg-g-surface border border-g-border rounded space-y-3">
                <div>
                  <MicroLabel>Incident Summary</MicroLabel>
                  <p className="text-ui text-g-text mt-1 leading-relaxed">
                    {selectedReport.summary}
                  </p>
                </div>

                <div>
                  <MicroLabel>Tactical Findings & Analysis</MicroLabel>
                  <p className="text-ui text-g-text-2 mt-1 leading-relaxed bg-g-bg p-2.5 rounded border border-g-border">
                    {selectedReport.findings}
                  </p>
                </div>

                <div>
                  <MicroLabel>Mitigation & Action Taken</MicroLabel>
                  <p className="text-ui text-g-green mt-1 leading-relaxed bg-g-green/5 p-2.5 rounded border border-g-green/20">
                    {selectedReport.actionTaken}
                  </p>
                </div>
              </div>

              {/* Sign-off Officer */}
              <div className="p-3 bg-g-surface border border-g-border rounded flex items-center justify-between">
                <div>
                  <MicroLabel>Reporting Duty Officer</MicroLabel>
                  <div className="text-ui font-medium text-g-text mt-0.5">
                    {selectedReport.leadOfficer}
                  </div>
                </div>
                <div className="text-right">
                  <MicroLabel>Audit Hash</MicroLabel>
                  <div className="text-micro font-mono text-g-muted mt-0.5">
                    #SH256-992F
                  </div>
                </div>
              </div>
            </div>

            {/* Drawer Footer */}
            <div className="p-3 border-t border-g-border bg-g-surface flex items-center justify-between">
              <Button
                size="sm"
                onClick={() => {
                  toast(`Report dossier [${selectedReport.id}] sent to printer`, "ok");
                  window.print();
                }}
              >
                <Icon name="print" size={14} className="mr-1 inline-block" />
                Print Dossier
              </Button>
              <Button
                size="sm"
                variant="primary"
                onClick={() =>
                  toast(
                    `Incident report [${selectedReport.id}] certified and archived`,
                    "ok"
                  )
                }
              >
                <Icon name="verified" size={14} className="mr-1 inline-block" />
                Certify & Archive
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* ------------------------------------------------------------- Status Bar */}
      <div className="h-7 shrink-0 px-3 flex items-center justify-between bg-g-panel border-t border-g-border">
        <MicroLabel>
          ISCC Integrated Security Control Center · Tactical Watchfloor Incident Log
        </MicroLabel>
        <span className="flex items-center gap-1.5 text-micro uppercase text-g-muted">
          <StatusDot tone="ok" />
          Shift Log Stream Nominal
        </span>
      </div>

      {/* ------------------------------------------------------ Print View Modal */}
      {showPrintModal && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-6">
          <div className="bg-g-panel border border-g-border-strong rounded-lg max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
            {/* Modal Bar */}
            <div className="h-12 px-4 bg-g-surface border-b border-g-border flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <Icon name="print" size={18} className="text-g-blue" />
                <span className="font-bold text-ui uppercase tracking-wide">
                  Tactical Shift Incident Briefing Dossier
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="primary" onClick={handlePrint}>
                  <Icon name="print" size={14} className="mr-1 inline-block" />
                  Print Now
                </Button>
                <Button size="sm" onClick={() => setShowPrintModal(false)}>
                  Close
                </Button>
              </div>
            </div>

            {/* Printable Content */}
            <div className="flex-1 overflow-y-auto p-8 bg-white text-black font-sans space-y-6">
              {/* Header */}
              <div className="border-b-2 border-black pb-4 flex items-center justify-between">
                <div>
                  <div className="text-xs font-mono font-bold tracking-widest text-red-700">
                    RESTRICTED // MILITARY INTELLIGENCE WATCHFLOOR
                  </div>
                  <h1 className="text-2xl font-bold uppercase tracking-tight mt-1 text-black">
                    Integrated Surveillance & Cordon Audit Report
                  </h1>
                  <p className="text-xs text-gray-600 mt-0.5">
                    Sector Cantonment Command · Automated Vision AI & ANPR Event Log
                  </p>
                </div>
                <div className="text-right text-xs font-mono text-gray-700">
                  <div>DATE: {new Date().toISOString().slice(0, 10)}</div>
                  <div>TIME: 14:35:00 HRS</div>
                  <div>OPERATOR: CAPT. A. VERMA</div>
                </div>
              </div>

              {/* Summary KPIs */}
              <div className="grid grid-cols-4 gap-4 p-3 bg-gray-100 border border-gray-300 rounded text-center">
                <div>
                  <div className="text-xs font-bold text-gray-500 uppercase">
                    Total Incidents
                  </div>
                  <div className="text-xl font-bold text-black">{totalIncidents}</div>
                </div>
                <div>
                  <div className="text-xs font-bold text-gray-500 uppercase">
                    High Breaches
                  </div>
                  <div className="text-xl font-bold text-red-600">{highSeverity}</div>
                </div>
                <div>
                  <div className="text-xs font-bold text-gray-500 uppercase">
                    Resolution Rate
                  </div>
                  <div className="text-xl font-bold text-green-700">{resolvedRate}%</div>
                </div>
                <div>
                  <div className="text-xs font-bold text-gray-500 uppercase">
                    Model Accuracy
                  </div>
                  <div className="text-xl font-bold text-blue-700">98.2%</div>
                </div>
              </div>

              {/* Table of Incidents */}
              <div>
                <h2 className="text-sm font-bold uppercase tracking-wide text-gray-800 mb-2 border-b border-gray-300 pb-1">
                  Incident Log Records ({filteredReports.length} Events)
                </h2>
                <table className="w-full text-xs border border-gray-300 border-collapse">
                  <thead>
                    <tr className="bg-gray-200 text-black border-b border-gray-300">
                      <th className="p-1.5 text-left">Time</th>
                      <th className="p-1.5 text-left">Report ID</th>
                      <th className="p-1.5 text-left">Camera</th>
                      <th className="p-1.5 text-left">Target / Plate</th>
                      <th className="p-1.5 text-left">Severity</th>
                      <th className="p-1.5 text-left">Summary & Finding</th>
                      <th className="p-1.5 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {filteredReports.map((r) => (
                      <tr key={r.id}>
                        <td className="p-1.5 font-mono">{r.time}</td>
                        <td className="p-1.5 font-mono font-bold">{r.id}</td>
                        <td className="p-1.5">{r.cameraId}</td>
                        <td className="p-1.5 font-mono">
                          {r.detectedPlate ? `[${r.detectedPlate}]` : r.targetClassification}
                        </td>
                        <td className="p-1.5 uppercase font-bold">
                          <span
                            className={
                              r.severity === "high"
                                ? "text-red-600"
                                : r.severity === "med"
                                ? "text-amber-600"
                                : "text-gray-600"
                            }
                          >
                            {r.severity}
                          </span>
                        </td>
                        <td className="p-1.5">{r.summary}</td>
                        <td className="p-1.5 uppercase font-bold text-green-700">
                          {r.status}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Signatures */}
              <div className="pt-8 border-t border-gray-300 grid grid-cols-2 gap-8 text-xs">
                <div>
                  <div className="font-bold text-gray-700 mb-6">
                    WATCHFLOOR COMMAND OFFICER:
                  </div>
                  <div className="border-b border-black w-48 mb-1" />
                  <div className="text-gray-600">Capt. A. Verma (Security In-Charge)</div>
                </div>
                <div className="text-right">
                  <div className="font-bold text-gray-700 mb-6">
                    BASE COMMANDING OFFICER SIGN-OFF:
                  </div>
                  <div className="border-b border-black w-48 ml-auto mb-1" />
                  <div className="text-gray-600">Col. S. K. Nair, Sena Medal</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
