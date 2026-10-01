"""
NVR / camera integration probes (real network I/O, stdlib only).

  tcp_probe      TCP connect to host:port (connection health + latency)
  rtsp_probe     RTSP OPTIONS handshake (server reachable and speaks RTSP)
  onvif_probe    ONVIF GetSystemDateAndTime (unauthenticated by the ONVIF spec)
  ws_discovery   ONVIF WS-Discovery multicast probe on the local segment

Credentials are kept in a 0600 secrets file next to the database and are
never returned by the API (write-only).
"""

import json
import os
import re
import socket
import struct
import threading
import time
import uuid
from pathlib import Path
from typing import Dict, List, Optional
from urllib import request as urlrequest

BACKEND = Path(__file__).resolve().parents[2]
SECRETS_PATH = BACKEND / "data" / "secrets.json"
PROTOCOLS = ("onvif", "rtsp", "vendor_sdk", "none")
DEFAULT_PORTS = {"onvif": 80, "rtsp": 554, "vendor_sdk": 8000}


class SecretStore:
    def __init__(self, path: Path = SECRETS_PATH):
        self.path = path
        self._lock = threading.Lock()

    def _read(self) -> dict:
        try:
            return json.loads(self.path.read_text())
        except (OSError, ValueError):
            return {}

    def set(self, key: str, value: Optional[str]) -> None:
        with self._lock:
            data = self._read()
            if value:
                data[key] = value
            else:
                data.pop(key, None)
            self.path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.path.with_suffix(".tmp")
            fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "w") as f:
                json.dump(data, f)
            os.replace(tmp, self.path)
            os.chmod(self.path, 0o600)

    def has(self, key: str) -> bool:
        with self._lock:
            return key in self._read()

    def get(self, key: str) -> Optional[str]:
        with self._lock:
            return self._read().get(key)

    def status(self) -> dict:
        exists = self.path.exists()
        mode = oct(self.path.stat().st_mode & 0o777) if exists else None
        with self._lock:
            n = len(self._read())
        return {"path": str(self.path), "exists": exists, "mode": mode, "entries": n,
                "permissions_ok": (not exists) or mode == "0o600", "encrypted_at_rest": False}


def tcp_probe(host: str, port: int, timeout: float) -> dict:
    t0 = time.perf_counter()
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return {"ok": True, "latency_ms": round((time.perf_counter() - t0) * 1000, 1)}
    except OSError as e:
        return {"ok": False, "error": str(e) or e.__class__.__name__,
                "latency_ms": round((time.perf_counter() - t0) * 1000, 1)}


def rtsp_probe(host: str, port: int, path: str, timeout: float, username: Optional[str] = None) -> dict:
    url = f"rtsp://{host}:{port}/{path.lstrip('/')}"
    t0 = time.perf_counter()
    try:
        with socket.create_connection((host, port), timeout=timeout) as s:
            s.settimeout(timeout)
            s.sendall(f"OPTIONS {url} RTSP/1.0\r\nCSeq: 1\r\nUser-Agent: ISCC-admin-probe\r\n\r\n".encode())
            data = s.recv(2048).decode(errors="replace")
    except OSError as e:
        return {"ok": False, "url": url, "error": str(e) or e.__class__.__name__}
    ms = round((time.perf_counter() - t0) * 1000, 1)
    m = re.match(r"RTSP/1\.\d (\d{3}) ?(.*)", data)
    if not m:
        return {"ok": False, "url": url, "latency_ms": ms, "error": "no RTSP response"}
    code = int(m.group(1))
    public = re.search(r"Public:\s*(.+)", data)
    return {"ok": code in (200, 401), "url": url, "latency_ms": ms, "status": code, "reason": m.group(2).strip(),
            "methods": public.group(1).strip() if public else None,
            "auth_required": code == 401}


ONVIF_TIME = ('<?xml version="1.0" encoding="UTF-8"?><s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope">'
              '<s:Body><GetSystemDateAndTime xmlns="http://www.onvif.org/ver10/device/wsdl"/></s:Body></s:Envelope>')


def onvif_probe(host: str, port: int, timeout: float) -> dict:
    url = f"http://{host}:{port}/onvif/device_service"
    req = urlrequest.Request(url, data=ONVIF_TIME.encode(), method="POST",
                             headers={"Content-Type": "application/soap+xml; charset=utf-8"})
    t0 = time.perf_counter()
    try:
        with urlrequest.urlopen(req, timeout=timeout) as r:
            body = r.read(8192).decode(errors="replace")
            code = r.status
    except urlrequest.HTTPError as e:
        body, code = e.read(4096).decode(errors="replace"), e.code
    except OSError as e:
        return {"ok": False, "url": url, "error": str(getattr(e, "reason", e))}
    ms = round((time.perf_counter() - t0) * 1000, 1)
    ok = "GetSystemDateAndTimeResponse" in body
    return {"ok": ok, "url": url, "latency_ms": ms, "http_status": code,
            "error": None if ok else "endpoint did not answer as an ONVIF device service"}


def ws_discovery(timeout: float) -> List[dict]:
    """Send an ONVIF WS-Discovery Probe to 239.255.255.250:3702 and collect replies."""
    mid = f"uuid:{uuid.uuid4()}"
    probe = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<e:Envelope xmlns:e="http://www.w3.org/2003/05/soap-envelope" '
        'xmlns:w="http://schemas.xmlsoap.org/ws/2004/08/addressing" '
        'xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery" '
        'xmlns:dn="http://www.onvif.org/ver10/network/wsdl">'
        f'<e:Header><w:MessageID>{mid}</w:MessageID>'
        '<w:To>urn:schemas-xmlsoap-org:ws:2005:04:discovery</w:To>'
        '<w:Action>http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</w:Action></e:Header>'
        '<e:Body><d:Probe><d:Types>dn:NetworkVideoTransmitter</d:Types></d:Probe></e:Body></e:Envelope>')
    found: Dict[str, dict] = {}
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
    try:
        sock.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, struct.pack("b", 2))
        sock.settimeout(0.5)
        sock.sendto(probe.encode(), ("239.255.255.250", 3702))
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            try:
                data, addr = sock.recvfrom(65535)
            except socket.timeout:
                continue
            text = data.decode(errors="replace")
            xaddrs = re.search(r"<[^>]*XAddrs>([^<]+)<", text)
            scopes = re.search(r"<[^>]*Scopes>([^<]+)<", text)
            found[addr[0]] = {"ip": addr[0], "xaddrs": xaddrs.group(1).split() if xaddrs else [],
                              "scopes": scopes.group(1).split() if scopes else []}
    except OSError as e:
        return [{"error": str(e)}]
    finally:
        sock.close()
    return list(found.values())
