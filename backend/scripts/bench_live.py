#!/usr/bin/env python3
"""
Live-system resource sampler (read-only): CPU / RAM per component, GPU
utilization / VRAM, pipeline fps and latency, RTSP decoders and media-server
connections — averaged over a window.

    backend/venv/bin/python backend/scripts/bench_live.py --seconds 30 [--label "4 cams"] [--json out.json]

Components are found from the process tree: the backend main process
(run_live.py), its inference workers, ffmpeg decoders / transcoders and
MediaMTX. Pipeline figures come from GET /api/v1/pipelines/health and
/api/v1/diagnostics (no authentication needed for these read-only endpoints).
"""

import argparse
import json
import os
import subprocess
import time
import urllib.request
from pathlib import Path

HZ = os.sysconf("SC_CLK_TCK")
PAGE = os.sysconf("SC_PAGE_SIZE")


def procs():
    out = {}
    for d in Path("/proc").iterdir():
        if not d.name.isdigit():
            continue
        try:
            stat = (d / "stat").read_text()
            cmd = (d / "cmdline").read_bytes().replace(b"\0", b" ").decode(errors="replace").strip()
        except OSError:
            continue
        rest = stat[stat.rindex(")") + 2:].split()
        out[int(d.name)] = {"ppid": int(rest[1]), "cpu": int(rest[11]) + int(rest[12]),
                            "rss": int(rest[21]) * PAGE, "cmd": cmd}
    return out


def classify(ps):
    main = [p for p, v in ps.items() if "run_live.py" in v["cmd"] and "python" in v["cmd"].split(" ")[0]
            and "multiprocessing" not in v["cmd"]]
    groups = {"backend": set(main), "workers": set(), "decoders": set(), "transcoders": set(), "mediamtx": set(),
              "other_python_children": set()}
    for pid, v in ps.items():
        anc, seen = v["ppid"], 0
        root = None
        while anc and seen < 8:
            if anc in groups["backend"]:
                root = anc
                break
            anc = ps.get(anc, {}).get("ppid")
            seen += 1
        if root is None or pid in groups["backend"]:
            continue
        c = v["cmd"]
        if "mediamtx" in c:
            groups["mediamtx"].add(pid)
        elif c.startswith("ffmpeg") and "nvenc" in c:
            groups["transcoders"].add(pid)
        elif c.startswith("ffmpeg"):
            groups["decoders"].add(pid)
        elif "multiprocessing" in c or "spawn_main" in c:
            groups["workers"].add(pid)
        elif "python" in c:
            groups["other_python_children"].add(pid)
    return groups


def sys_cpu():
    f = Path("/proc/stat").read_text().split("\n")[0].split()[1:]
    v = list(map(int, f))
    return sum(v), v[3] + v[4]


def gpu():
    try:
        r = subprocess.run(["nvidia-smi", "--query-gpu=utilization.gpu,memory.used,memory.total,utilization.decoder,utilization.encoder",
                            "--format=csv,noheader,nounits"], capture_output=True, text=True, timeout=5)
        u, m, t, dec, enc = [float(x) for x in r.stdout.strip().split(",")]
        return {"util": u, "vram_mib": m, "vram_total_mib": t, "nvdec": dec, "nvenc": enc}
    except Exception:
        return {}


def get(url):
    try:
        with urllib.request.urlopen(url, timeout=3) as r:
            return json.load(r)
    except Exception:
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seconds", type=float, default=30)
    ap.add_argument("--api", default="http://127.0.0.1:5556")
    ap.add_argument("--label", default="")
    ap.add_argument("--json")
    a = ap.parse_args()

    ps0 = procs()
    groups = classify(ps0)
    t0, (tot0, idle0) = time.monotonic(), sys_cpu()
    gpus, fps_s, lat_s, inf_s = [], [], [], []
    end = t0 + a.seconds
    while time.monotonic() < end:
        g = gpu()
        if g:
            gpus.append(g)
        h = get(f"{a.api}/api/v1/pipelines/health") or {}
        for c in (h.get("cameras") or {}).values():
            p = c.get("pipeline") or {}
            if c.get("mode") not in (None, "none") and p:
                fps_s.append(p.get("fps_now", p.get("fps")) or 0)
                if c.get("latency_ms") is not None:
                    lat_s.append(c["latency_ms"])
                inf_s.append(p.get("avg_infer_ms") or 0)
        time.sleep(2)
    ps1 = procs()
    dt = time.monotonic() - t0
    tot1, idle1 = sys_cpu()
    ncpu = os.cpu_count()
    comp = {}
    for name, pids in groups.items():
        pids |= {p for p, v in ps1.items() if any(v["ppid"] == q for q in pids) and name in ("decoders",)}
        cpu = sum(ps1[p]["cpu"] - ps0[p]["cpu"] for p in pids if p in ps1 and p in ps0) / HZ / dt * 100
        rss = sum(ps1[p]["rss"] for p in pids if p in ps1)
        comp[name] = {"processes": sum(1 for p in pids if p in ps1), "cpu_pct_of_one_core": round(cpu, 1),
                      "rss_mib": round(rss / 2 ** 20, 1)}
    # re-classify at the end: decoders are started / stopped at runtime
    g_end = classify(ps1)
    comp["decoders"]["processes"] = len(g_end["decoders"])
    comp["transcoders"]["processes"] = len(g_end["transcoders"])
    diag = get(f"{a.api}/api/v1/diagnostics") or {}
    avg = lambda xs: round(sum(xs) / len(xs), 1) if xs else None
    res = {
        "label": a.label, "window_s": round(dt, 1),
        "system_cpu_pct": round(100 * (1 - (idle1 - idle0) / max(1, tot1 - tot0)), 1), "cpus": ncpu,
        "components": comp,
        "total_backend_cpu_pct_of_one_core": round(sum(c["cpu_pct_of_one_core"] for c in comp.values()), 1),
        "total_backend_rss_mib": round(sum(c["rss_mib"] for c in comp.values()), 1),
        "gpu_util_pct": avg([g["util"] for g in gpus]), "nvdec_util_pct": avg([g["nvdec"] for g in gpus]),
        "nvenc_util_pct": avg([g["nvenc"] for g in gpus]),
        "vram_mib": avg([g["vram_mib"] for g in gpus]),
        "pipeline_fps_avg": avg(fps_s), "pipeline_latency_ms_avg": avg(lat_s), "infer_ms_avg": avg(inf_s),
        "active_pipelines": diag.get("active_pipelines"), "decoding_sources": diag.get("decoding_sources"),
        "rtsp_upstream_connections": diag.get("rtsp_upstream_connections"),
    }
    print(json.dumps(res, indent=1))
    if a.json:
        Path(a.json).write_text(json.dumps(res, indent=1))


if __name__ == "__main__":
    main()
