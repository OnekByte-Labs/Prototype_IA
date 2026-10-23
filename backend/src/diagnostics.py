"""
Runtime diagnostics (GET /api/v1/diagnostics): what is actually running.

Answers "is anything decoding / inferring that shouldn't be?" from the real
process tree and runtime state — per-component CPU and RAM (/proc), GPU and
per-process VRAM (nvidia-smi), RTSP connections at the media server, decoders
and what they read, active pipelines, open browser streams and stage latencies.
"""

import os
import threading
import time
from pathlib import Path
from typing import Dict, List, Optional

HZ = os.sysconf("SC_CLK_TCK") if hasattr(os, "sysconf") else 100
PAGE = os.sysconf("SC_PAGE_SIZE") if hasattr(os, "sysconf") else 4096


def _proc_table() -> Dict[int, dict]:
    out = {}
    proc_dir = Path("/proc")
    if not proc_dir.exists():
        return out
    for d in proc_dir.iterdir():
        if not d.name.isdigit():
            continue
        try:
            stat = (d / "stat").read_text()
            cmd = (d / "cmdline").read_bytes().split(b"\0")
        except OSError:
            continue
        rest = stat[stat.rindex(")") + 2:].split()
        out[int(d.name)] = {"ppid": int(rest[1]), "cpu": int(rest[11]) + int(rest[12]),
                            "rss": int(rest[21]) * PAGE, "argv": [a.decode(errors="replace") for a in cmd if a]}
    return out


def _percentile(xs: List[float], p: float) -> Optional[float]:
    if not xs:
        return None
    xs = sorted(xs)
    return round(xs[min(len(xs) - 1, int(p * (len(xs) - 1) + 0.5))], 1)


class Diagnostics:
    def __init__(self, runtime):
        self.rt = runtime
        self._lock = threading.Lock()
        self._prev: Optional[tuple] = None          # (monotonic, {pid: cpu ticks})

    def _components(self) -> dict:
        me = os.getpid()
        table = _proc_table()
        children: Dict[int, List[int]] = {}
        for pid, p in table.items():
            children.setdefault(p["ppid"], []).append(pid)

        def descendants(pid: int) -> List[int]:
            out, stack = [], list(children.get(pid, []))
            while stack:
                c = stack.pop()
                out.append(c)
                stack.extend(children.get(c, []))
            return out

        workers = set(getattr(self.rt, "worker_pids", {}).values())
        groups = {"backend": [me], "workers": [], "decoders": [], "transcoders": [], "mediamtx": [], "other": []}
        decoder_inputs = []
        for pid in descendants(me):
            argv = table[pid]["argv"]
            exe = os.path.basename(argv[0]) if argv else ""
            if pid in workers:
                groups["workers"].append(pid)
            elif exe == "mediamtx":
                groups["mediamtx"].append(pid)
            elif exe == "ffmpeg" and any("nvenc" in a for a in argv):
                groups["transcoders"].append(pid)
            elif exe == "ffmpeg":
                groups["decoders"].append(pid)
                if "-i" in argv:
                    decoder_inputs.append(argv[argv.index("-i") + 1])
            else:
                groups["other"].append(pid)

        now = time.monotonic()
        ticks = {pid: table[pid]["cpu"] for g in groups.values() for pid in g if pid in table}
        with self._lock:
            prev, self._prev = self._prev, (now, ticks)
        out = {}
        for name, pids in groups.items():
            cpu = None
            if prev and now > prev[0]:
                dt = now - prev[0]
                cpu = round(sum(ticks[p] - prev[1].get(p, ticks[p]) for p in pids if p in ticks) / HZ / dt * 100, 1)
            out[name] = {"processes": len(pids), "cpu_pct_of_one_core": cpu,
                         "rss_mib": round(sum(table[p]["rss"] for p in pids if p in table) / 2 ** 20, 1),
                         "pids": pids}
        # Every decoder must read a live channel from the local media server
        local = [u for u in decoder_inputs if u.startswith("rtsp://127.0.0.1:")]
        return {"components": out, "decoder_inputs_live": len(local),
                "decoder_inputs_other": [u.split("?")[0] for u in decoder_inputs if u not in local]}

    def snapshot(self) -> dict:
        rt = self.rt
        comp = self._components()
        cams = list(rt.cams.values())
        sources = {}
        for h in rt.health.values():
            sources.update(h.get("sources") or {})
        decoding = sorted(s for s, v in sources.items() if v.get("decoding"))
        pipes = {}
        for h in rt.health.values():
            pipes.update({c["camera_id"]: c for c in (h.get("cameras") or {}).values()})
        media = rt.media.health() if rt.media is not None else {"paths": {}, "running": False}
        paths = media.get("paths") or {}
        upstream = [n for n, p in paths.items() if p.get("ready") and "transcode_of" not in p]
        webrtc = sum(sum(1 for t in (p.get("reader_types") or []) if t and "webrtc" in t.lower()) for p in paths.values())
        rtsp_readers = sum(sum(1 for t in (p.get("reader_types") or []) if t and "rtsp" in t.lower()) for p in paths.values())
        gpu = rt.admin.tele.gpu() if getattr(rt, "admin", None) is not None else {}
        g = (gpu.get("gpus") or [None])[0]
        vram_by_pid = {p["pid"]: p["used_mib"] for p in gpu.get("processes") or []}
        vram = {name: round(sum(vram_by_pid.get(pid, 0) or 0 for pid in c["pids"]), 0)
                for name, c in comp["components"].items()}
        lat = [c.get("latency_ms") for c in pipes.values() if c.get("latency_ms") is not None and c.get("mode") != "none"]
        queue = [c.get("queue_ms") for c in pipes.values() if c.get("queue_ms") is not None and c.get("mode") != "none"]
        infer = [(c.get("pipeline") or {}).get("avg_infer_ms") for c in pipes.values() if c.get("pipeline")]
        fps = [(sources.get(c.get("source_id")) or {}).get("fps") for c in pipes.values()
               if c.get("mode") != "none" and (sources.get(c.get("source_id")) or {}).get("decoding")]
        alerts = list(rt.alert_latencies)
        mem = {}
        try:
            for line in Path("/proc/meminfo").read_text().splitlines():
                k, v = line.split(":", 1)
                mem[k] = int(v.split()[0]) * 1024
        except OSError:
            pass
        load = os.getloadavg() if hasattr(os, "getloadavg") else None
        return {
            "at": time.time(),
            "mock_feeds": {"configured": 0, "decoders_reading_non_live_input": comp["decoder_inputs_other"],
                           "ok": not comp["decoder_inputs_other"]},
            "cameras": len(cams),
            "active_pipelines": sum(1 for c in cams if c["state"] == "running" and (c.get("active_mode") or "none") != "none"),
            "pipeline_states": {s: sum(1 for c in cams if c["state"] == s) for s in {c["state"] for c in cams}},
            "decoding_sources": len(decoding), "decoding": decoding,
            "idle_sources": sorted(s for s, v in sources.items() if not v.get("decoding")),
            "decoder_processes": comp["components"]["decoders"]["processes"],
            "transcoder_processes": comp["components"]["transcoders"]["processes"],
            "rtsp_upstream_connections": len(upstream),
            "media_server": {"running": media.get("running"), "paths_ready": len(upstream),
                             "rtsp_readers": rtsp_readers, "webrtc_sessions": webrtc,
                             "permanent_errors": {n: p.get("permanent_error") for n, p in paths.items()
                                                  if p.get("permanent_error")}},
            "browser_streams": {"mjpeg": getattr(rt.open_streams, "mjpeg", None), "sse": getattr(rt.open_streams, "sse", None),
                                "websocket_clients": len(rt.ws.clients)},
            "models_loaded": {f"worker_{i}": sorted((h.get("models") or {}).keys()) for i, h in rt.health.items()},
            "latency_ms": {
                "decode_to_pipeline_queue_p50": _percentile(queue, 0.5),
                "inference_avg_p50": _percentile([x for x in infer if x], 0.5),
                "decode_to_publish_p50": _percentile(lat, 0.5), "decode_to_publish_p95": _percentile(lat, 0.95),
                "alert_end_to_end_p50": _percentile(alerts, 0.5), "alert_end_to_end_p95": _percentile(alerts, 0.95),
                "alert_samples": len(alerts),
            },
            "pipeline_fps_avg": round(sum(fps) / len(fps), 1) if fps else None,
            "resources": {
                "components": {k: {kk: vv for kk, vv in v.items() if kk != "pids"} | {"vram_mib": vram.get(k)}
                               for k, v in comp["components"].items()},
                "gpu": {k: (g or {}).get(k) for k in ("name", "util_pct", "mem_used_mib", "mem_total_mib", "temp_c")},
                "ram": {"total_mib": round(mem.get("MemTotal", 0) / 2 ** 20), "available_mib": round(mem.get("MemAvailable", 0) / 2 ** 20)},
                "load_avg": [round(x, 2) for x in load] if load else None, "cpus": os.cpu_count(),
            },
            "note": "cpu_pct_of_one_core is measured between consecutive calls of this endpoint",
        }
