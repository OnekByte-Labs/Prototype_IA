"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { Icon } from "@/components/ui/Icon";
import { useToast } from "../Toast";
import { Button, MicroLabel, StatusDot } from "../primitives";
import { NVRS } from "@/lib/gotham/model";

/* ------------------------------------------------------------------ types */

export type Role = "ADMIN" | "SUPERVISOR" | "OPERATOR" | "MAINTENANCE" | "VIEWER";
export type Clearance = "TS//SCI" | "SECRET" | "CONFIDENTIAL";
export type UserStatus = "ACTIVE [ONLINE]" | "STANDBY" | "OFFLINE" | "REVOKED";

export interface AdminUser {
  serviceNo: string;
  name: string;
  role: Role;
  clearance: Clearance;
  status: UserStatus;
  station: string;
  lastLogin: string;
  icon?: string;
}

export interface AuditRecord {
  id: string;
  timestamp: string;
  operator: string;
  action: string;
  target: string;
  severity: "info" | "warn" | "crit";
  hash: string;
}

export type AdminTab =
  | "users"
  | "ai_models"
  | "escalation"
  | "storage"
  | "rbac"
  | "audit";

/* ------------------------------------------------------------------ seed data */

const INITIAL_USERS: AdminUser[] = [
  {
    serviceNo: "IC-78492X",
    name: "CAPT. ARJUN VERMA",
    role: "ADMIN",
    clearance: "TS//SCI",
    status: "ACTIVE [ONLINE]",
    station: "TERMINAL 01 (HQ CORE)",
    lastLogin: "14:32:08Z TODAY",
    icon: "verified_user",
  },
  {
    serviceNo: "IC-65120B",
    name: "MAJ. HELENA VANCE",
    role: "SUPERVISOR",
    clearance: "TS//SCI",
    status: "ACTIVE [ONLINE]",
    station: "TERMINAL 02 (WATCHFLOOR)",
    lastLogin: "13:45:12Z TODAY",
    icon: "military_tech",
  },
  {
    serviceNo: "IC-99214D",
    name: "HAV. RAJESH SINGH",
    role: "OPERATOR",
    clearance: "SECRET",
    status: "ACTIVE [ONLINE]",
    station: "TERMINAL 03 (PERIMETER E)",
    lastLogin: "08:00:21Z TODAY",
    icon: "person",
  },
  {
    serviceNo: "IC-88402P",
    name: "SUB. MANOJ KUMAR",
    role: "OPERATOR",
    clearance: "SECRET",
    status: "OFFLINE",
    station: "TERMINAL 04 (PERIMETER W)",
    lastLogin: "YESTERDAY 22:15Z",
    icon: "person",
  },
  {
    serviceNo: "CIV-33019M",
    name: "ENG. DAVID CHEN",
    role: "MAINTENANCE",
    clearance: "CONFIDENTIAL",
    status: "STANDBY",
    station: "DEPOT WORKSHOP 02",
    lastLogin: "18 SEP 09:30Z",
    icon: "engineering",
  },
  {
    serviceNo: "CIV-11048K",
    name: "AUD. SARAH JENKINS",
    role: "VIEWER",
    clearance: "SECRET",
    status: "OFFLINE",
    station: "REMOTE AUDIT CONSOLE",
    lastLogin: "16 SEP 16:20Z",
    icon: "visibility",
  },
];

const INITIAL_AUDIT_LOG: AuditRecord[] = [
  {
    id: "AUD-9941",
    timestamp: "14:41:20Z",
    operator: "CAPT. ARJUN VERMA",
    action: "STIG_BASELINE_VERIFIED",
    target: "ENCLAVE_SECURITY_CONTROLLER",
    severity: "info",
    hash: "0x89AC..412F",
  },
  {
    id: "AUD-9940",
    timestamp: "14:32:08Z",
    operator: "CAPT. ARJUN VERMA",
    action: "SESSION_ESTABLISHED_MFA",
    target: "TERMINAL_01",
    severity: "info",
    hash: "0x129B..E47A",
  },
  {
    id: "AUD-9939",
    timestamp: "13:58:14Z",
    operator: "MAJ. HELENA VANCE",
    action: "PERIMETER_CORDON_CALIBRATED",
    target: "CAM-05_ARMOURY_SECTOR_4",
    severity: "warn",
    hash: "0xFE32..9901",
  },
  {
    id: "AUD-9938",
    timestamp: "12:15:00Z",
    operator: "SYSTEM_DAEMON",
    action: "ARCHIVE_STORAGE_PRUNE",
    target: "NVR-03_COLD_POOL",
    severity: "info",
    hash: "0x334D..77BA",
  },
];

/* ------------------------------------------------------------------ component */

export function AdminConsole() {
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<AdminTab>("users");

  // Users state
  const [users, setUsers] = useState<AdminUser[]>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("gotham_admin_users");
        if (saved) return JSON.parse(saved);
      } catch {}
    }
    return INITIAL_USERS;
  });

  const [auditLog, setAuditLog] = useState<AuditRecord[]>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("gotham_admin_audit_log");
        if (saved) return JSON.parse(saved);
      } catch {}
    }
    return INITIAL_AUDIT_LOG;
  });

  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");

  // Modals state
  const [isAddUserOpen, setIsAddUserOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);

  // Form state for add user
  const [newUserNo, setNewUserNo] = useState("");
  const [newUserName, setNewUserName] = useState("");
  const [newUserRole, setNewUserRole] = useState<Role>("OPERATOR");
  const [newUserClearance, setNewUserClearance] = useState<Clearance>("SECRET");
  const [newUserStation, setNewUserStation] = useState("TERMINAL 05");

  // AI Model Settings State
  const [intrusionConfidence, setIntrusionConfidence] = useState(75);
  const [tripwireBuffer, setTripwireBuffer] = useState(15);
  const [nmsOverlap, setNmsOverlap] = useState(45);
  const [ocrConfidence, setOcrConfidence] = useState(80);
  const [nightBoost, setNightBoost] = useState(true);

  // Storage Settings State
  const [retentionDays, setRetentionDays] = useState(90);
  const [autoPurge, setAutoPurge] = useState(true);

  // RBAC Matrix State
  const [rbacMatrix, setRbacMatrix] = useState<Record<string, boolean[]>>({
    "Acknowledge Level 1-2 Incidents": [true, true, true, false, false],
    "Dispatch Quick Reaction Force (QRF)": [true, true, true, false, false],
    "Calibrate Intrusion & Tripwire Boundaries": [true, true, false, false, false],
    "Modify AI Model Weights & Thresholds": [true, true, false, false, false],
    "Administer Operators & Clearances": [true, false, false, false, false],
    "Export Forensic Evidence & CSV Logs": [true, true, true, false, true],
    "Wipe & Purge NVR Surveillance Archives": [true, false, false, false, false],
  });

  // Save users & audit log to local storage
  useEffect(() => {
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem("gotham_admin_users", JSON.stringify(users));
      } catch {}
    }
  }, [users]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem("gotham_admin_audit_log", JSON.stringify(auditLog));
      } catch {}
    }
  }, [auditLog]);

  const recordAuditEvent = useCallback((action: string, target: string, severity: "info" | "warn" | "crit" = "info") => {
    const newRecord: AuditRecord = {
      id: `AUD-${Math.floor(1000 + Math.random() * 9000)}`,
      timestamp: new Date().toISOString().substring(11, 19) + "Z",
      operator: "CAPT. ARJUN VERMA",
      action,
      target,
      severity,
      hash: "0x" + Math.random().toString(16).substring(2, 6).toUpperCase() + ".." + Math.random().toString(16).substring(2, 6).toUpperCase(),
    };
    setAuditLog((prev) => [newRecord, ...prev]);
  }, []);

  // Filtered users
  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      if (roleFilter !== "ALL" && u.role !== roleFilter) return false;
      if (statusFilter !== "ALL" && u.status !== statusFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          u.name.toLowerCase().includes(q) ||
          u.serviceNo.toLowerCase().includes(q) ||
          u.station.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [users, roleFilter, statusFilter, searchQuery]);

  // Handle Add User
  const handleAddUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserName.trim()) {
      toast("Operator name is required", "err");
      return;
    }
    const finalNo = newUserNo.trim() || `IC-${Math.floor(10000 + Math.random() * 90000)}X`;
    const created: AdminUser = {
      serviceNo: finalNo,
      name: newUserName.trim().toUpperCase(),
      role: newUserRole,
      clearance: newUserClearance,
      status: "ACTIVE [ONLINE]",
      station: newUserStation.trim().toUpperCase() || "WATCHFLOOR WORKSTATION",
      lastLogin: "JUST REGISTERED",
      icon: newUserRole === "ADMIN" ? "verified_user" : newUserRole === "SUPERVISOR" ? "military_tech" : "person",
    };

    setUsers((prev) => [created, ...prev]);
    recordAuditEvent("OPERATOR_REGISTERED", `${finalNo}_${created.name}`, "info");
    toast(`Operator ${created.name} registered with ${created.clearance} clearance`, "ok");
    setIsAddUserOpen(false);
    setNewUserName("");
    setNewUserNo("");
  };

  // Toggle user revoke/restore
  const toggleUserStatus = (serviceNo: string) => {
    setUsers((prev) =>
      prev.map((u) => {
        if (u.serviceNo === serviceNo) {
          const nextStatus: UserStatus = u.status === "REVOKED" ? "ACTIVE [ONLINE]" : "REVOKED";
          recordAuditEvent(
            nextStatus === "REVOKED" ? "ACCESS_REVOKED" : "ACCESS_RESTORED",
            `${u.serviceNo}_${u.name}`,
            nextStatus === "REVOKED" ? "crit" : "warn"
          );
          toast(
            nextStatus === "REVOKED"
              ? `Access revoked for ${u.name} (${u.serviceNo})`
              : `Access credentials restored for ${u.name}`,
            nextStatus === "REVOKED" ? "err" : "ok"
          );
          return { ...u, status: nextStatus };
        }
        return u;
      })
    );
  };

  // Handle Edit User
  const handleSaveEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    setUsers((prev) =>
      prev.map((u) => (u.serviceNo === editingUser.serviceNo ? editingUser : u))
    );
    recordAuditEvent("OPERATOR_UPDATED", `${editingUser.serviceNo}_${editingUser.role}`, "info");
    toast(`Updated permissions for ${editingUser.name}`, "ok");
    setEditingUser(null);
  };

  // Export Users CSV
  const exportUsersCsv = () => {
    const headers = ["Service Number", "Name", "Role", "Clearance", "Status", "Station", "Last Login"];
    const rows = filteredUsers.map((u) => [
      u.serviceNo,
      u.name,
      u.role,
      u.clearance,
      u.status,
      u.station,
      u.lastLogin,
    ]);
    const csvContent = [headers.join(","), ...rows.map((r) => r.map((c) => `"${c}"`).join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `ISCC_Operators_Manifest_${new Date().toISOString().substring(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast(`Exported ${filteredUsers.length} operator records to CSV`, "ok");
  };

  // Export Audit CSV
  const exportAuditCsv = () => {
    const headers = ["Record ID", "Timestamp", "Operator", "Action", "Target", "Severity", "Hash"];
    const rows = auditLog.map((a) => [a.id, a.timestamp, a.operator, a.action, a.target, a.severity, a.hash]);
    const csvContent = [headers.join(","), ...rows.map((r) => r.map((c) => `"${c}"`).join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `ISCC_Audit_Trail_${new Date().toISOString().substring(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast(`Exported ${auditLog.length} audit records to CSV`, "ok");
  };

  return (
    <div className="flex-1 min-h-0 flex bg-g-bg text-g-text overflow-hidden select-none">
      {/* ------------------------------------------------------------- Left Directory Rail */}
      <aside className="w-64 bg-g-panel border-r border-g-border flex flex-col justify-between shrink-0">
        <div className="flex flex-col min-h-0">
          <div className="h-10 px-3 border-b border-g-border flex items-center justify-between bg-g-surface">
            <span className="text-micro uppercase font-bold tracking-wider text-g-muted">
              Admin Directory
            </span>
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-[2px] bg-emerald-950/60 text-emerald-400 border border-emerald-900/50 uppercase font-semibold">
              DISA STIG L4
            </span>
          </div>

          <nav className="p-2 space-y-1 overflow-y-auto">
            {[
              { id: "users" as AdminTab, label: "Operators & Access", icon: "group", count: `${users.filter(u => u.status !== 'REVOKED').length} Active` },
              { id: "ai_models" as AdminTab, label: "AI Models & Inference", icon: "policy", count: "4 Engines" },
              { id: "escalation" as AdminTab, label: "Escalation Protocols", icon: "crisis_alert", count: "DEFCON P1-P3" },
              { id: "storage" as AdminTab, label: "Storage & Recorders", icon: "dns", count: "4 NVRs" },
              { id: "rbac" as AdminTab, label: "RBAC Permissions", icon: "verified_user", count: "NIST 800-53" },
              { id: "audit" as AdminTab, label: "Audit Trail & Integrity", icon: "terminal", count: `${auditLog.length} Logs` },
            ].map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`w-full flex items-center justify-between px-2.5 py-2 rounded-[2px] text-ui uppercase font-medium transition-colors text-left border-l-2 ${
                    active
                      ? "bg-g-raised border-g-blue text-g-blue"
                      : "border-transparent text-g-text-2 hover:bg-g-hover hover:text-g-text"
                  }`}
                >
                  <div className="flex items-center gap-2 truncate">
                    <Icon name={tab.icon} size={16} className={active ? "text-g-blue" : "text-g-muted"} />
                    <span className="truncate">{tab.label}</span>
                  </div>
                  <span
                    className={`text-[9px] font-mono px-1.5 py-0.5 rounded-[2px] shrink-0 ${
                      active
                        ? "bg-g-blue/20 text-g-blue border border-g-blue/40"
                        : "bg-g-surface text-g-muted border border-g-border"
                    }`}
                  >
                    {tab.count}
                  </span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Enclave Security Status Card */}
        <div className="p-3 border-t border-g-border bg-g-surface space-y-2">
          <div className="flex items-center justify-between text-micro text-g-muted uppercase tracking-wider">
            <span className="font-bold">Enclave Security</span>
            <span className="flex items-center gap-1 text-g-green">
              <span className="w-1.5 h-1.5 rounded-full bg-g-green animate-pulse" />
              <span>ARMED</span>
            </span>
          </div>

          <div className="p-2 rounded-[2px] bg-g-bg border border-g-border space-y-1.5 font-mono text-[9px]">
            <div className="flex items-center justify-between">
              <span className="text-g-muted uppercase">HARDWARE HSM:</span>
              <span className="text-emerald-400 font-bold">LOCKED & READY</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-g-muted uppercase">ZERO-TRUST:</span>
              <span className="text-g-blue font-bold">STRICT ENFORCED</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-g-muted uppercase">FIPS 140-3:</span>
              <span className="text-g-text font-bold">CERTIFIED</span>
            </div>
            <div className="pt-1 border-t border-g-border flex items-center justify-between text-g-muted">
              <span>CRYPTO CORE:</span>
              <span className="text-g-cyan">AES-256-GCM</span>
            </div>
          </div>
        </div>
      </aside>

      {/* ------------------------------------------------------------- Center Content Area */}
      <main className="flex-1 min-w-0 flex flex-col min-h-0 overflow-hidden bg-g-bg">
        {/* ========================================================= TAB: USERS & OPERATORS */}
        {activeTab === "users" && (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            {/* Action Bar */}
            <div className="p-3 bg-g-panel border-b border-g-border flex flex-wrap items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-2">
                <span className="text-base font-data font-bold text-g-text">
                  Operator Manifest & Clearances
                </span>
                <span className="text-micro font-mono text-g-muted px-2 py-0.5 bg-g-surface rounded border border-g-border">
                  {filteredUsers.length} of {users.length} Operators
                </span>
              </div>

              <div className="flex items-center gap-2">
                <Button size="sm" onClick={() => setIsAddUserOpen(true)}>
                  <Icon name="person_add" size={13} className="mr-1 inline-block" />
                  + Add Operator
                </Button>
                <Button size="sm" onClick={exportUsersCsv} title="Export Manifest to CSV">
                  <Icon name="download" size={13} className="mr-1 inline-block" />
                  Export CSV
                </Button>
              </div>
            </div>

            {/* Filter Bar */}
            <div className="p-2.5 bg-g-surface border-b border-g-border flex flex-wrap items-center gap-3 shrink-0">
              <div className="relative flex-1 min-w-[200px] max-w-sm">
                <Icon
                  name="search"
                  size={14}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-g-muted pointer-events-none"
                />
                <input
                  type="text"
                  placeholder="Search service number, name, station..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full h-7 pl-8 pr-2 bg-g-bg border border-g-border rounded-[2px] text-ui text-g-text placeholder:text-g-muted focus:border-g-blue focus:outline-none"
                />
              </div>

              <div className="flex items-center gap-2">
                <MicroLabel>Role</MicroLabel>
                <select
                  value={roleFilter}
                  onChange={(e) => setRoleFilter(e.target.value)}
                  className="h-7 px-2 bg-g-bg border border-g-border rounded-[2px] text-ui text-g-text focus:border-g-blue focus:outline-none uppercase font-mono text-[11px]"
                >
                  <option value="ALL">All Roles</option>
                  <option value="ADMIN">ADMIN</option>
                  <option value="SUPERVISOR">SUPERVISOR</option>
                  <option value="OPERATOR">OPERATOR</option>
                  <option value="MAINTENANCE">MAINTENANCE</option>
                  <option value="VIEWER">VIEWER</option>
                </select>
              </div>

              <div className="flex items-center gap-2">
                <MicroLabel>Status</MicroLabel>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="h-7 px-2 bg-g-bg border border-g-border rounded-[2px] text-ui text-g-text focus:border-g-blue focus:outline-none uppercase font-mono text-[11px]"
                >
                  <option value="ALL">All Status</option>
                  <option value="ACTIVE [ONLINE]">ACTIVE</option>
                  <option value="STANDBY">STANDBY</option>
                  <option value="OFFLINE">OFFLINE</option>
                  <option value="REVOKED">REVOKED</option>
                </select>
              </div>
            </div>

            {/* Users Table */}
            <div className="flex-1 min-h-0 overflow-auto">
              <table className="w-full border-collapse text-left">
                <thead className="sticky top-0 z-10 bg-g-panel border-b border-g-border text-micro uppercase tracking-wider text-g-muted">
                  <tr className="h-8">
                    <th className="px-3 w-[120px]">Service No</th>
                    <th className="px-3">Operator Name</th>
                    <th className="px-3 w-[120px]">Role</th>
                    <th className="px-3 w-[110px]">Clearance</th>
                    <th className="px-3 w-[140px]">Status</th>
                    <th className="px-3">Assigned Station</th>
                    <th className="px-3 w-[140px]">Last Login</th>
                    <th className="px-3 text-right w-[140px]">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-g-border font-mono text-ui">
                  {filteredUsers.map((u) => {
                    const isRevoked = u.status === "REVOKED";
                    return (
                      <tr
                        key={u.serviceNo}
                        className={`h-11 transition-colors hover:bg-g-hover ${
                          isRevoked ? "bg-red-950/20 text-g-muted" : ""
                        }`}
                      >
                        <td className="px-3 font-bold text-g-cyan">{u.serviceNo}</td>
                        <td className="px-3 font-sans font-medium text-g-text flex items-center gap-2 py-3">
                          <Icon name={u.icon || "person"} size={16} className="text-g-muted" />
                          <span className={isRevoked ? "line-through text-g-muted" : ""}>{u.name}</span>
                        </td>
                        <td className="px-3">
                          <span
                            className={`px-1.5 py-0.5 rounded-[2px] text-[10px] font-bold ${
                              u.role === "ADMIN"
                                ? "bg-purple-950/60 text-purple-300 border border-purple-800/50"
                                : u.role === "SUPERVISOR"
                                ? "bg-sky-950/60 text-sky-300 border border-sky-800/50"
                                : u.role === "OPERATOR"
                                ? "bg-emerald-950/60 text-emerald-300 border border-emerald-800/50"
                                : "bg-g-surface text-g-muted border border-g-border"
                            }`}
                          >
                            {u.role}
                          </span>
                        </td>
                        <td className="px-3">
                          <span
                            className={`text-[10px] font-bold ${
                              u.clearance === "TS//SCI"
                                ? "text-amber-400"
                                : u.clearance === "SECRET"
                                ? "text-g-blue"
                                : "text-g-muted"
                            }`}
                          >
                            {u.clearance}
                          </span>
                        </td>
                        <td className="px-3">
                          <span
                            className={`inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded-[2px] text-[10px] border ${
                              u.status === "ACTIVE [ONLINE]"
                                ? "bg-emerald-950/60 text-emerald-300 border-emerald-900/50"
                                : u.status === "STANDBY"
                                ? "bg-amber-950/60 text-amber-300 border-amber-900/50"
                                : u.status === "REVOKED"
                                ? "bg-red-950/60 text-red-300 border-red-900/50 font-bold"
                                : "bg-g-surface text-g-muted border-g-border"
                            }`}
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                u.status === "ACTIVE [ONLINE]"
                                  ? "bg-emerald-400"
                                  : u.status === "STANDBY"
                                  ? "bg-amber-400"
                                  : u.status === "REVOKED"
                                  ? "bg-red-500"
                                  : "bg-g-muted"
                              }`}
                            />
                            {u.status}
                          </span>
                        </td>
                        <td className="px-3 text-g-text-2 text-micro truncate max-w-[200px]">{u.station}</td>
                        <td className="px-3 text-g-muted text-micro">{u.lastLogin}</td>
                        <td className="px-3 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setEditingUser(u)}
                              className="px-2 py-0.5 bg-g-surface hover:bg-g-hover text-g-text text-[10px] font-mono rounded border border-g-border uppercase"
                            >
                              EDIT
                            </button>
                            <button
                              type="button"
                              onClick={() => toggleUserStatus(u.serviceNo)}
                              className={`px-2 py-0.5 text-[10px] font-mono rounded border uppercase transition-colors ${
                                isRevoked
                                  ? "bg-emerald-950/60 text-emerald-300 border-emerald-800 hover:bg-emerald-900/60"
                                  : "bg-red-950/60 text-red-300 border-red-800 hover:bg-red-900/60"
                              }`}
                            >
                              {isRevoked ? "RESTORE" : "REVOKE"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ========================================================= TAB: AI MODELS */}
        {activeTab === "ai_models" && (
          <div className="flex-1 p-4 overflow-y-auto space-y-4">
            <div>
              <h2 className="text-lg font-bold font-data text-g-text">Computer Vision & Inference Registry</h2>
              <p className="text-micro uppercase text-g-muted">
                Fine-tuned edge neural models powering perimeter cordon detection, tripwire line crossing, and OCR.
              </p>
            </div>

            {/* Model Status Cards */}
            <div className="grid grid-cols-4 gap-3">
              {[
                { name: "YOLOv11x Cordon Intrusion", type: "Intrusion Detection", fps: "60 FPS", latency: "14.2 ms", status: "ONLINE", conf: "94.8%" },
                { name: "ByteTrack Association", type: "Tripwire Line Tracker", fps: "60 FPS", latency: "2.8 ms", status: "ONLINE", conf: "99.1%" },
                { name: "FastPlateOCR Engine", type: "ANPR / Plate Parser", fps: "45 FPS", latency: "18.5 ms", status: "ONLINE", conf: "97.8%" },
                { name: "ResNet50 Vehicle Re-ID", type: "Cross-Camera Correlation", fps: "30 FPS", latency: "24.0 ms", status: "ONLINE", conf: "92.4%" },
              ].map((m) => (
                <div key={m.name} className="p-3 bg-g-panel border border-g-border rounded-[2px] space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono font-bold text-g-blue uppercase">{m.type}</span>
                    <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-emerald-950 text-emerald-400 border border-emerald-900">
                      {m.status}
                    </span>
                  </div>
                  <div className="text-ui font-bold text-g-text">{m.name}</div>
                  <div className="grid grid-cols-3 gap-1 pt-2 border-t border-g-border font-mono text-[9px]">
                    <div>
                      <span className="text-g-muted block">FPS</span>
                      <span className="text-g-text">{m.fps}</span>
                    </div>
                    <div>
                      <span className="text-g-muted block">LATENCY</span>
                      <span className="text-g-cyan">{m.latency}</span>
                    </div>
                    <div>
                      <span className="text-g-muted block">CONF</span>
                      <span className="text-emerald-400">{m.conf}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Model Runtime Sensitivity Controls */}
            <div className="p-4 bg-g-panel border border-g-border rounded-[2px] space-y-4">
              <div className="flex items-center justify-between border-b border-g-border pb-2">
                <MicroLabel>Global Inference Sensitivity Calibration</MicroLabel>
                <span className="text-micro text-g-muted">Active Profile: DAYLIGHT WATCHFLOOR OPTIMAL</span>
              </div>

              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-ui">
                    <span className="font-bold">Perimeter Intrusion Confidence Threshold</span>
                    <span className="font-mono text-g-blue font-bold">{intrusionConfidence}%</span>
                  </div>
                  <input
                    type="range"
                    min={50}
                    max={95}
                    value={intrusionConfidence}
                    onChange={(e) => setIntrusionConfidence(Number(e.target.value))}
                    className="w-full accent-blue-500"
                  />
                  <p className="text-micro text-g-muted">
                    Objects detected below this score inside restricted polygon sectors are filtered to eliminate false alarms.
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-ui">
                    <span className="font-bold">Tripwire Line Crossing Buffer</span>
                    <span className="font-mono text-g-cyan font-bold">{tripwireBuffer} px</span>
                  </div>
                  <input
                    type="range"
                    min={5}
                    max={30}
                    value={tripwireBuffer}
                    onChange={(e) => setTripwireBuffer(Number(e.target.value))}
                    className="w-full accent-blue-500"
                  />
                  <p className="text-micro text-g-muted">
                    Distance threshold in canvas coordinates for triggering line crossing intrusion counts.
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-ui">
                    <span className="font-bold">Non-Maximum Suppression (NMS) Overlap</span>
                    <span className="font-mono text-g-blue font-bold">0.{nmsOverlap} IoU</span>
                  </div>
                  <input
                    type="range"
                    min={20}
                    max={70}
                    value={nmsOverlap}
                    onChange={(e) => setNmsOverlap(Number(e.target.value))}
                    className="w-full accent-blue-500"
                  />
                  <p className="text-micro text-g-muted">
                    Bounding box overlap suppression threshold for handling overlapping personnel in dense sectors.
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-ui">
                    <span className="font-bold">FastPlateOCR Acceptance Threshold</span>
                    <span className="font-mono text-g-amber font-bold">{ocrConfidence}%</span>
                  </div>
                  <input
                    type="range"
                    min={60}
                    max={95}
                    value={ocrConfidence}
                    onChange={(e) => setOcrConfidence(Number(e.target.value))}
                    className="w-full accent-amber-500"
                  />
                  <p className="text-micro text-g-muted">
                    License plates parsed below this score require human officer manual confirmation.
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-between pt-3 border-t border-g-border">
                <label className="flex items-center gap-2 cursor-pointer text-ui">
                  <input
                    type="checkbox"
                    checked={nightBoost}
                    onChange={(e) => setNightBoost(e.target.checked)}
                    className="g-check"
                  />
                  <span>Enable Low-Light Nightfall Adaptive Contrast Boost</span>
                </label>

                <Button
                  onClick={() => {
                    recordAuditEvent("MODEL_THRESHOLDS_APPLIED", `INT_${intrusionConfidence}_OCR_${ocrConfidence}`, "info");
                    toast("Inference parameters applied live across all edge cameras", "ok");
                  }}
                >
                  Save & Deploy Parameters
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================= TAB: ESCALATION */}
        {activeTab === "escalation" && (
          <div className="flex-1 p-4 overflow-y-auto space-y-4">
            <div>
              <h2 className="text-lg font-bold font-data text-g-text">Automated Escalation Protocols</h2>
              <p className="text-micro uppercase text-g-muted">
                DEFCON-aligned automated notification chains, siren triggers, and QRF dispatch rules.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {[
                {
                  priority: "P1",
                  title: "RULE ESC-01 [HIGH SEVERITY BREACH]",
                  tone: "text-red-400 bg-red-950/40 border-red-900/60",
                  condition: "HIGH severity alert unacknowledged for > 5 min",
                  action: "Auto-escalate to Shift Commander; at > 15 min dispatch QRF Team Alpha & trigger Sector siren.",
                },
                {
                  priority: "P2",
                  title: "RULE ESC-02 [PERIMETER CORDON INTRUSION]",
                  tone: "text-amber-400 bg-amber-950/40 border-amber-900/60",
                  condition: "Tripwire/Cordon dual-sensor breach unacknowledged for > 2 min",
                  action: "Auto-slave nearest PTZ turret, lock down vehicle entry gate, broadcast alert to patrol unit.",
                },
                {
                  priority: "P3",
                  title: "RULE ESC-03 [CARRIER / LINK LOSS]",
                  tone: "text-blue-400 bg-blue-950/40 border-blue-900/60",
                  condition: "Camera video carrier dropped for > 30 seconds",
                  action: "Switch recorder to secondary mesh gateway; alert Duty Engineer Chen.",
                },
                {
                  priority: "P4",
                  title: "RULE ESC-04 [BLACKOUT / POWER TRANSIENT]",
                  tone: "text-purple-400 bg-purple-950/40 border-purple-900/60",
                  condition: "UPS backup runtime dropped below 45 minutes",
                  action: "Spin up auxiliary diesel generator; prioritize perimeter surveillance feeds.",
                },
              ].map((r) => (
                <div key={r.title} className={`p-4 rounded-[2px] border ${r.tone} space-y-2`}>
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-bold text-xs">{r.title}</span>
                    <span className="font-mono px-1.5 py-0.5 rounded bg-black/40 text-[10px] font-bold">
                      ACTIVE
                    </span>
                  </div>
                  <div className="text-ui text-g-text">
                    <span className="text-g-muted block text-micro uppercase">Condition:</span>
                    {r.condition}
                  </div>
                  <div className="text-ui text-g-text">
                    <span className="text-g-muted block text-micro uppercase">Automated Action:</span>
                    {r.action}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ========================================================= TAB: STORAGE */}
        {activeTab === "storage" && (
          <div className="flex-1 p-4 overflow-y-auto space-y-4">
            <div>
              <h2 className="text-lg font-bold font-data text-g-text">Network Video Recorders (NVR) & Storage Matrix</h2>
              <p className="text-micro uppercase text-g-muted">
                Disk allocation, footage retention policies, and cold-storage offload pools.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {NVRS.map((nvr) => {
                const pct = Math.round((nvr.usedTb / nvr.totalTb) * 100);
                const fault = nvr.state === "fault";
                return (
                  <div key={nvr.id} className="p-4 bg-g-panel border border-g-border rounded-[2px] space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <StatusDot tone={fault ? "err" : "ok"} />
                        <span className="font-mono font-bold text-g-text">{nvr.id} · {nvr.name}</span>
                      </div>
                      <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${fault ? "bg-red-950 text-red-400 border border-red-900" : "bg-emerald-950 text-emerald-400 border border-emerald-900"}`}>
                        {fault ? "STORAGE WARN (92%)" : "NOMINAL"}
                      </span>
                    </div>

                    <div className="space-y-1">
                      <div className="flex justify-between text-micro text-g-muted font-mono">
                        <span>{nvr.usedTb} TB / {nvr.totalTb} TB</span>
                        <span>{pct}% Allocated</span>
                      </div>
                      <div className="h-2 bg-g-bg border border-g-border rounded-[1px] overflow-hidden">
                        <div
                          className={`h-full ${pct >= 90 ? "bg-g-red" : pct >= 70 ? "bg-g-amber" : "bg-g-green"}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2 pt-2 border-t border-g-border font-mono text-[10px]">
                      <div>
                        <span className="text-g-muted block">ONLINE CAMS</span>
                        <span className="text-g-text font-bold">{nvr.camsOk}/{nvr.cams}</span>
                      </div>
                      <div>
                        <span className="text-g-muted block">TEMP</span>
                        <span className="text-g-cyan font-bold">{nvr.tempC}°C</span>
                      </div>
                      <div>
                        <span className="text-g-muted block">RETENTION</span>
                        <span className="text-g-text font-bold">90 DAYS</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Retention Settings */}
            <div className="p-4 bg-g-panel border border-g-border rounded-[2px] space-y-4">
              <MicroLabel>Archival & Purge Policy</MicroLabel>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <span className="text-ui font-bold block">Surveillance Footage Retention Duration</span>
                  <div className="flex items-center gap-2">
                    {[30, 60, 90, 180, 365].map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setRetentionDays(d)}
                        className={`h-7 px-3 rounded-[2px] font-mono text-[11px] font-bold border transition-colors ${
                          retentionDays === d
                            ? "bg-g-blue text-white border-g-blue"
                            : "bg-g-surface border-g-border text-g-muted hover:text-g-text"
                        }`}
                      >
                        {d} DAYS
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <span className="text-ui font-bold block">Automated Space Reclamation</span>
                  <label className="flex items-center gap-2 cursor-pointer text-ui">
                    <input
                      type="checkbox"
                      checked={autoPurge}
                      onChange={(e) => setAutoPurge(e.target.checked)}
                      className="g-check"
                    />
                    <span>Automatically prune non-incident frames when recorder hits 90%</span>
                  </label>
                </div>
              </div>

              <div className="pt-3 border-t border-g-border flex justify-end">
                <Button
                  onClick={() => {
                    recordAuditEvent("RETENTION_POLICY_COMMITTED", `${retentionDays}_DAYS`, "info");
                    toast(`Retention policy set to ${retentionDays} days with auto-purge`, "ok");
                  }}
                >
                  Commit Storage Policy
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================= TAB: RBAC */}
        {activeTab === "rbac" && (
          <div className="flex-1 p-4 overflow-y-auto space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold font-data text-g-text">
                  Role-Based Access Control (NIST SP 800-53)
                </h2>
                <p className="text-micro uppercase text-g-muted">
                  Mandatory Access Control (MAC) permissions matrix applied across operator sessions.
                </p>
              </div>
              <Button
                onClick={() => {
                  recordAuditEvent("RBAC_MATRIX_SAVED", "ALL_ROLES", "info");
                  toast("RBAC permissions matrix successfully saved & enforced", "ok");
                }}
              >
                Save Matrix Changes
              </Button>
            </div>

            <div className="border border-g-border rounded-[2px] bg-g-panel overflow-hidden">
              <table className="w-full text-left border-collapse">
                <thead className="bg-g-surface border-b border-g-border text-micro uppercase tracking-wider text-g-muted">
                  <tr className="h-9">
                    <th className="px-3">Capability & Operation Descriptor</th>
                    {["ADMIN", "SUPERVISOR", "OPERATOR", "MAINTENANCE", "VIEWER"].map((col) => (
                      <th key={col} className="px-3 text-center w-28 font-mono">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-g-border font-mono text-ui">
                  {Object.entries(rbacMatrix).map(([capability, flags]) => (
                    <tr key={capability} className="hover:bg-g-hover">
                      <td className="px-3 py-2 font-sans font-medium text-g-text">{capability}</td>
                      {flags.map((on, i) => (
                        <td key={i} className="px-3 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setRbacMatrix((prev) => {
                                const cur = [...(prev[capability] || [])];
                                cur[i] = checked;
                                return { ...prev, [capability]: cur };
                              });
                            }}
                            className="g-check"
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ========================================================= TAB: AUDIT */}
        {activeTab === "audit" && (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <div className="p-3 bg-g-panel border-b border-g-border flex items-center justify-between shrink-0">
              <div>
                <h2 className="text-base font-bold font-data text-g-text">Cryptographic Audit Trail</h2>
                <p className="text-micro uppercase text-g-muted">
                  Immutable chronological ledger of all console administrative operations.
                </p>
              </div>
              <Button size="sm" onClick={exportAuditCsv}>
                <Icon name="download" size={13} className="mr-1 inline-block" />
                Export Audit Log
              </Button>
            </div>

            <div className="flex-1 min-h-0 overflow-auto">
              <table className="w-full border-collapse text-left font-mono text-ui">
                <thead className="sticky top-0 z-10 bg-g-panel border-b border-g-border text-micro uppercase tracking-wider text-g-muted">
                  <tr className="h-8">
                    <th className="px-3 w-[110px]">Record ID</th>
                    <th className="px-3 w-[110px]">Timestamp</th>
                    <th className="px-3 w-[200px]">Operator</th>
                    <th className="px-3">Operation / Event</th>
                    <th className="px-3">Target Entity</th>
                    <th className="px-3 w-[90px]">Severity</th>
                    <th className="px-3 text-right w-[140px]">SHA-256 Digest</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-g-border">
                  {auditLog.map((log) => (
                    <tr key={log.id} className="h-10 hover:bg-g-hover">
                      <td className="px-3 font-bold text-g-cyan">{log.id}</td>
                      <td className="px-3 text-g-muted">{log.timestamp}</td>
                      <td className="px-3 font-sans font-medium text-g-text">{log.operator}</td>
                      <td className="px-3 text-g-blue font-bold">{log.action}</td>
                      <td className="px-3 text-g-text-2">{log.target}</td>
                      <td className="px-3">
                        <span
                          className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                            log.severity === "crit"
                              ? "bg-red-950 text-red-400 border border-red-900"
                              : log.severity === "warn"
                              ? "bg-amber-950 text-amber-400 border border-amber-900"
                              : "bg-blue-950 text-blue-400 border border-blue-900"
                          }`}
                        >
                          {log.severity.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-3 text-right text-g-muted">{log.hash}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      {/* ------------------------------------------------------------- Modal: Add Operator */}
      {isAddUserOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="bg-g-panel border border-g-border rounded-[4px] w-full max-w-md overflow-hidden animate-g-in">
            <header className="h-10 px-4 bg-g-surface border-b border-g-border flex items-center justify-between">
              <span className="font-data font-bold text-ui text-g-text uppercase tracking-wider">
                Register New Operator Credential
              </span>
              <button
                type="button"
                onClick={() => setIsAddUserOpen(false)}
                className="text-g-muted hover:text-g-text"
              >
                <Icon name="close" size={16} />
              </button>
            </header>

            <form onSubmit={handleAddUser} className="p-4 space-y-3 font-sans">
              <div>
                <label className="text-micro uppercase text-g-muted block mb-1">Service Number / ID</label>
                <input
                  type="text"
                  placeholder="e.g. IC-77401X"
                  value={newUserNo}
                  onChange={(e) => setNewUserNo(e.target.value)}
                  className="w-full h-8 px-2.5 bg-g-bg border border-g-border rounded-[2px] text-ui text-g-text font-mono focus:border-g-blue focus:outline-none"
                />
              </div>

              <div>
                <label className="text-micro uppercase text-g-muted block mb-1">Full Name & Rank</label>
                <input
                  type="text"
                  placeholder="e.g. LT. SUNIL SHARMA"
                  value={newUserName}
                  onChange={(e) => setNewUserName(e.target.value)}
                  required
                  className="w-full h-8 px-2.5 bg-g-bg border border-g-border rounded-[2px] text-ui text-g-text focus:border-g-blue focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-micro uppercase text-g-muted block mb-1">Assigned Role</label>
                  <select
                    value={newUserRole}
                    onChange={(e) => setNewUserRole(e.target.value as Role)}
                    className="w-full h-8 px-2 bg-g-bg border border-g-border rounded-[2px] text-ui text-g-text font-mono focus:border-g-blue focus:outline-none"
                  >
                    <option value="ADMIN">ADMIN</option>
                    <option value="SUPERVISOR">SUPERVISOR</option>
                    <option value="OPERATOR">OPERATOR</option>
                    <option value="MAINTENANCE">MAINTENANCE</option>
                    <option value="VIEWER">VIEWER</option>
                  </select>
                </div>

                <div>
                  <label className="text-micro uppercase text-g-muted block mb-1">Security Clearance</label>
                  <select
                    value={newUserClearance}
                    onChange={(e) => setNewUserClearance(e.target.value as Clearance)}
                    className="w-full h-8 px-2 bg-g-bg border border-g-border rounded-[2px] text-ui text-g-text font-mono focus:border-g-blue focus:outline-none"
                  >
                    <option value="TS//SCI">TS//SCI</option>
                    <option value="SECRET">SECRET</option>
                    <option value="CONFIDENTIAL">CONFIDENTIAL</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-micro uppercase text-g-muted block mb-1">Assigned Watchfloor Station</label>
                <input
                  type="text"
                  placeholder="e.g. TERMINAL 05 (SECTOR 2)"
                  value={newUserStation}
                  onChange={(e) => setNewUserStation(e.target.value)}
                  className="w-full h-8 px-2.5 bg-g-bg border border-g-border rounded-[2px] text-ui text-g-text focus:border-g-blue focus:outline-none"
                />
              </div>

              <div className="pt-3 border-t border-g-border flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setIsAddUserOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit">
                  Enroll Operator
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- Modal: Edit Operator */}
      {editingUser && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="bg-g-panel border border-g-border rounded-[4px] w-full max-w-md overflow-hidden animate-g-in">
            <header className="h-10 px-4 bg-g-surface border-b border-g-border flex items-center justify-between">
              <span className="font-data font-bold text-ui text-g-text uppercase tracking-wider">
                Edit Permissions: {editingUser.name}
              </span>
              <button
                type="button"
                onClick={() => setEditingUser(null)}
                className="text-g-muted hover:text-g-text"
              >
                <Icon name="close" size={16} />
              </button>
            </header>

            <form onSubmit={handleSaveEdit} className="p-4 space-y-3 font-sans">
              <div>
                <label className="text-micro uppercase text-g-muted block mb-1">Service Number</label>
                <input
                  type="text"
                  disabled
                  value={editingUser.serviceNo}
                  className="w-full h-8 px-2.5 bg-g-bg/50 border border-g-border rounded-[2px] text-ui text-g-muted font-mono cursor-not-allowed"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-micro uppercase text-g-muted block mb-1">Role</label>
                  <select
                    value={editingUser.role}
                    onChange={(e) => setEditingUser({ ...editingUser, role: e.target.value as Role })}
                    className="w-full h-8 px-2 bg-g-bg border border-g-border rounded-[2px] text-ui text-g-text font-mono focus:border-g-blue focus:outline-none"
                  >
                    <option value="ADMIN">ADMIN</option>
                    <option value="SUPERVISOR">SUPERVISOR</option>
                    <option value="OPERATOR">OPERATOR</option>
                    <option value="MAINTENANCE">MAINTENANCE</option>
                    <option value="VIEWER">VIEWER</option>
                  </select>
                </div>

                <div>
                  <label className="text-micro uppercase text-g-muted block mb-1">Clearance Level</label>
                  <select
                    value={editingUser.clearance}
                    onChange={(e) => setEditingUser({ ...editingUser, clearance: e.target.value as Clearance })}
                    className="w-full h-8 px-2 bg-g-bg border border-g-border rounded-[2px] text-ui text-g-text font-mono focus:border-g-blue focus:outline-none"
                  >
                    <option value="TS//SCI">TS//SCI</option>
                    <option value="SECRET">SECRET</option>
                    <option value="CONFIDENTIAL">CONFIDENTIAL</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-micro uppercase text-g-muted block mb-1">Station</label>
                <input
                  type="text"
                  value={editingUser.station}
                  onChange={(e) => setEditingUser({ ...editingUser, station: e.target.value })}
                  className="w-full h-8 px-2.5 bg-g-bg border border-g-border rounded-[2px] text-ui text-g-text focus:border-g-blue focus:outline-none"
                />
              </div>

              <div className="pt-3 border-t border-g-border flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setEditingUser(null)}>
                  Cancel
                </Button>
                <Button type="submit">
                  Save Changes
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
