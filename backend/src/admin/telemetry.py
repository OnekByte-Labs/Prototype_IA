"""
Host telemetry from the machine the command center runs on (stdlib only):
GPU (nvidia-smi), CPU / memory / uptime (/proc), network links
(/sys/class/net counters, rates between samples) and storage volumes.
"""

import os
import platform
import shutil
import subprocess
import threading
import time
from pathlib import Path
from typing import Dict, List, Optional

BACKEND = Path(__file__).resolve().parents[2]


def _num(v: str) -> Optional[float]:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


class Telemetry:
    def __init__(self):
        self._lock = threading.Lock()
        self._net_prev: Dict[str, tuple] = {}
        self._gpu_cache = (0.0, None)

    # ── GPU ──────────────────────────────────────────────────────────

    def gpu(self, max_age: float = 1.5) -> dict:
        with self._lock:
            ts, cached = self._gpu_cache
            if cached is not None and time.monotonic() - ts < max_age:
                return cached
        out = self._query_gpu()
        with self._lock:
            self._gpu_cache = (time.monotonic(), out)
        return out

    @staticmethod
    def _query_gpu() -> dict:
        smi = shutil.which("nvidia-smi")
        if not smi:
            return {"available": False, "error": "nvidia-smi not found", "gpus": [], "processes": []}
        fields = ("index,name,uuid,utilization.gpu,utilization.memory,memory.used,memory.total,temperature.gpu,"
                  "power.draw,power.limit,clocks.sm,clocks.max.sm,driver_version,pstate")
        try:
            r = subprocess.run([smi, f"--query-gpu={fields}", "--format=csv,noheader,nounits"],
                               capture_output=True, text=True, timeout=5)
            p = subprocess.run([smi, "--query-compute-apps=pid,gpu_uuid,used_memory,process_name",
                                "--format=csv,noheader,nounits"], capture_output=True, text=True, timeout=5)
        except (OSError, subprocess.TimeoutExpired) as e:
            return {"available": False, "error": str(e), "gpus": [], "processes": []}
        if r.returncode != 0:
            return {"available": False, "error": (r.stderr or r.stdout).strip()[:200], "gpus": [], "processes": []}
        gpus = []
        for line in r.stdout.strip().splitlines():
            v = [x.strip() for x in line.split(",")]
            if len(v) < 14:
                continue
            gpus.append({"index": int(v[0]), "name": v[1], "uuid": v[2], "util_pct": _num(v[3]),
                         "mem_util_pct": _num(v[4]), "mem_used_mib": _num(v[5]), "mem_total_mib": _num(v[6]),
                         "temp_c": _num(v[7]), "power_w": _num(v[8]), "power_limit_w": _num(v[9]),
                         "sm_clock_mhz": _num(v[10]), "sm_clock_max_mhz": _num(v[11]), "driver": v[12],
                         "pstate": v[13]})
        procs = []
        for line in (p.stdout or "").strip().splitlines():
            v = [x.strip() for x in line.split(",")]
            if len(v) >= 3 and v[0].isdigit():
                procs.append({"pid": int(v[0]), "gpu_uuid": v[1], "used_mib": _num(v[2]),
                              "name": v[3] if len(v) > 3 else ""})
        return {"available": True, "gpus": gpus, "processes": procs, "sampled_at": time.time()}

    # ── host ─────────────────────────────────────────────────────────

    @staticmethod
    def host() -> dict:
        nodename = os.uname().nodename if hasattr(os, "uname") else platform.node()
        release = os.uname().release if hasattr(os, "uname") else platform.release()
        out: dict = {"hostname": nodename, "kernel": release, "cpus": os.cpu_count()}
        try:
            if hasattr(os, "getloadavg"):
                l1, l5, l15 = os.getloadavg()
                out["load"] = [round(l1, 2), round(l5, 2), round(l15, 2)]
            else:
                out["load"] = None
        except OSError:
            out["load"] = None
        try:
            mem = {}
            for line in Path("/proc/meminfo").read_text().splitlines():
                k, v = line.split(":", 1)
                mem[k] = int(v.split()[0]) * 1024
            out["mem_total"] = mem.get("MemTotal")
            out["mem_available"] = mem.get("MemAvailable")
        except OSError:
            pass
        try:
            out["uptime_s"] = float(Path("/proc/uptime").read_text().split()[0])
        except OSError:
            pass
        return out

    @staticmethod
    def process_alive(pid: int) -> bool:
        try:
            os.kill(pid, 0)
            return True
        except OSError:
            return False

    # ── network ──────────────────────────────────────────────────────

    def network(self) -> List[dict]:
        root = Path("/sys/class/net")
        now = time.monotonic()
        out = []
        if not root.exists():
            return out

        def rd(p: Path) -> Optional[str]:
            try:
                return p.read_text().strip()
            except OSError:
                return None

        for dev in sorted(root.iterdir()):
            st = dev / "statistics"
            c = {k: int(rd(st / k) or 0) for k in ("rx_bytes", "tx_bytes", "rx_packets", "tx_packets", "rx_errors",
                                                    "tx_errors", "rx_dropped", "tx_dropped")}
            speed = rd(dev / "speed")
            row = {"name": dev.name, "operstate": rd(dev / "operstate"), "mtu": int(rd(dev / "mtu") or 0),
                   "speed_mbps": int(speed) if speed and speed.lstrip("-").isdigit() and int(speed) > 0 else None,
                   "mac": rd(dev / "address"), "virtual": not (dev / "device").exists(), **c}
            with self._lock:
                prev = self._net_prev.get(dev.name)
                self._net_prev[dev.name] = (now, c)
            if prev and now - prev[0] > 0.2:
                dt = now - prev[0]
                p = prev[1]
                row["rx_bps"] = max(0, (c["rx_bytes"] - p["rx_bytes"]) * 8 / dt)
                row["tx_bps"] = max(0, (c["tx_bytes"] - p["tx_bytes"]) * 8 / dt)
                pk = (c["rx_packets"] - p["rx_packets"]) + (c["tx_packets"] - p["tx_packets"])
                bad = sum(c[k] - p[k] for k in ("rx_errors", "tx_errors", "rx_dropped", "tx_dropped"))
                row["loss_pct_window"] = round(100 * bad / (pk + bad), 3) if pk + bad > 0 else 0.0
                row["window_s"] = round(dt, 1)
            total = c["rx_packets"] + c["tx_packets"]
            bad_total = c["rx_errors"] + c["tx_errors"] + c["rx_dropped"] + c["tx_dropped"]
            row["loss_pct_total"] = round(100 * bad_total / (total + bad_total), 4) if total + bad_total else 0.0
            out.append(row)
        return out

    # ── storage ──────────────────────────────────────────────────────

    @staticmethod
    def dir_size(p: Path) -> int:
        if p.is_file():
            return p.stat().st_size
        if not p.is_dir():
            return 0
        total = 0
        for root, _, files in os.walk(p):
            for f in files:
                try:
                    total += os.stat(os.path.join(root, f)).st_size
                except OSError:
                    pass
        return total

    def storage(self) -> dict:
        outputs = BACKEND / "outputs"
        du = shutil.disk_usage(outputs if outputs.exists() else BACKEND)
        data = BACKEND / "data"
        return {
            "volume": {"path": str(outputs), "total_bytes": du.total, "used_bytes": du.used, "free_bytes": du.free},
            "components": {
                "evidence": self.dir_size(outputs / "evidence"),
                "event_log": self.dir_size(outputs / "events.jsonl"),
                "operational_db": sum(self.dir_size(p) for p in data.glob("command_center.db*")),
                "admin_db": sum(self.dir_size(p) for p in data.glob("admin.db*")),
                "backups": self.dir_size(BACKEND / "backups"),
                "training_candidates": self.dir_size(outputs / "training_candidates"),
            },
        }
