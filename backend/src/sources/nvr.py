"""
NVR configuration and credential handling (backend only).

A ``type: file`` entry is not a recorder: it maps channel numbers to local video
files (``files:``) that the media server loops as a live RTSP stream, so a
file is ingested, analysed and shown exactly like an NVR channel. It has no
host or credentials.

Credentials never live in source, YAML, the database or API responses: an NVR
entry in streams.yaml only names the ENVIRONMENT VARIABLES that hold its host,
port, username and password. Every NVR has its own variables (CPPLUS_NVR_*,
HIKVISION_NVR_*); ``load_nvrs`` refuses a configuration where two NVRs would
read the same variable, so credentials can never be shared between NVRs. ``load_env_file`` fills those from the project
root ``.env`` (without overriding variables already set by the service
manager). The credentialed RTSP URL is built only to hand the media server
its upstream source (through the child process environment, never a file),
and every log line that could echo it goes through ``redact``.
"""

import logging
import os
import re
import urllib.parse
from pathlib import Path
from typing import Dict, List, Optional

PROJECT_ROOT = Path(__file__).resolve().parents[3]
FILE_TYPE = "file"

logger = logging.getLogger("sources.nvr")

_URL_USERINFO = re.compile(r"(rtsps?://)[^/@\s]+@", re.IGNORECASE)
_SECRETS: set = set()


def load_env_file(path: Path) -> int:
    """KEY=VALUE lines from ``path`` into os.environ (existing variables win).
    Returns how many variables were set; values are never logged."""
    if not path.is_file():
        return 0
    n = 0
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        key, value = line.split("=", 1)
        key, value = key.strip(), value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        if key and key not in os.environ:
            os.environ[key] = value
            n += 1
    return n


def register_secret(value: Optional[str]) -> None:
    """Remember a secret so ``redact`` strips it (raw and URL-encoded)."""
    if value and len(value) >= 3:
        _SECRETS.add(value)
        _SECRETS.add(urllib.parse.quote(value, safe=""))


def redact(text: str) -> str:
    """Remove URL userinfo and every registered secret from ``text``."""
    if not text:
        return text
    text = _URL_USERINFO.sub(r"\1***@", text)
    for s in sorted(_SECRETS, key=len, reverse=True):
        text = text.replace(s, "***")
    return text


class NvrConfig:
    """One NVR from streams.yaml ``nvrs:`` (connection details resolved from env)."""

    def __init__(self, cfg: dict):
        self.nvr_id: str = cfg["id"]
        self.name: str = cfg.get("name", self.nvr_id)
        self.vendor: str = cfg.get("vendor", "")
        # Explicit source type: cameras name it too and the backend refuses a mismatch
        self.type: str = cfg.get("type") or ""
        if not self.type:
            raise ValueError(f"NVR {self.nvr_id}: streams.yaml needs an explicit `type` (e.g. cpplus, hikvision)")
        env = cfg.get("env") or {}
        self._env = {k: env.get(k) for k in ("host", "port", "username", "password")}
        self.host: str = os.environ.get(self._env["host"] or "", "") or cfg.get("host", "")
        self.port: int = int(os.environ.get(self._env["port"] or "", "") or cfg.get("port", 554))
        self._username: str = os.environ.get(self._env["username"] or "", "")
        self._password: str = os.environ.get(self._env["password"] or "", "")
        self.rtsp_path: str = cfg.get("rtsp_path", "/cam/realmonitor?channel={channel}&subtype={subtype}")
        self.channels: int = int(cfg.get("channels", 0))
        # type "file": channel → local video file (relative paths resolve from the project root)
        self.files: Dict[int, Path] = {}
        for ch, f in (cfg.get("files") or {}).items():
            path = Path(str(f)).expanduser()
            self.files[int(ch)] = path if path.is_absolute() else PROJECT_ROOT / path
        if self.type == FILE_TYPE and not self.channels:
            self.channels = max(self.files, default=0)
        register_secret(self._username)
        register_secret(self._password)

    @property
    def is_file(self) -> bool:
        return self.type == FILE_TYPE

    @property
    def configured(self) -> bool:
        """Host AND credentials present. An NVR with missing credentials is never
        contacted: retrying with none can lock the account out of the device.
        A file source is configured when its video files exist."""
        if self.is_file:
            return bool(self.files) and all(f.is_file() for f in self.files.values())
        return bool(self.host) and not self.missing()

    def missing(self) -> List[str]:
        """Environment variables this NVR needs but that are unset (names only)."""
        out = []
        for field in ("host", "username", "password"):
            var = self._env.get(field)
            if var and not os.environ.get(var):
                out.append(var)
        return out

    def rtsp_url(self, channel: int, subtype: int) -> str:
        """Credentialed upstream URL. Only ever passed to the media server's
        environment — never logged, stored or returned by the API."""
        # {stream}: Hikvision stream index — 1 = main (subtype 0), 2 = sub (subtype 1)
        path = self.rtsp_path.format(channel=channel, subtype=subtype, stream=2 if subtype == 1 else 1)
        auth = ""
        if self._username:
            auth = urllib.parse.quote(self._username, safe="")
            if self._password:
                auth += ":" + urllib.parse.quote(self._password, safe="")
            auth += "@"
        return f"rtsp://{auth}{self.host}:{self.port}{path if path.startswith('/') else '/' + path}"

    def public(self) -> dict:
        """Safe description for the API (no username / password)."""
        return {"nvr_id": self.nvr_id, "name": self.name, "vendor": self.vendor, "type": self.type, "host": self.host,
                "port": self.port, "channels": self.channels,
                "credentials_configured": bool(self._username and self._password) or self.is_file}


def load_nvrs(streams_cfg: dict) -> Dict[str, NvrConfig]:
    nvrs = {}
    var_owner: Dict[str, str] = {}
    for cfg in streams_cfg.get("nvrs") or []:
        nvr = NvrConfig(cfg)
        if nvr.nvr_id in nvrs:
            raise ValueError(f"NVR id {nvr.nvr_id} is defined twice in streams.yaml")
        for var in filter(None, nvr._env.values()):
            if var in var_owner:
                raise ValueError(f"{nvr.nvr_id} and {var_owner[var]} both read environment variable {var} — "
                                 "every NVR needs its own credentials")
            var_owner[var] = nvr.nvr_id
        nvrs[nvr.nvr_id] = nvr
        missing = nvr.missing()
        if nvr.is_file:
            absent = [str(f) for f in nvr.files.values() if not f.is_file()]
            if absent:
                logger.warning("File source %s: video file(s) not found: %s — its cameras stay offline", nvr.nvr_id, ", ".join(absent))
            else:
                logger.info("File source %s: %d looping video file(s)", nvr.nvr_id, len(nvr.files))
        elif missing:
            logger.warning("NVR %s (%s): environment variable(s) not set: %s — its cameras stay offline until they are set",
                           nvr.nvr_id, nvr.type, ", ".join(missing))
        else:
            logger.info("NVR %s: %s:%d, %d channels (credentials from environment)",
                        nvr.nvr_id, nvr.host, nvr.port, nvr.channels)
    return nvrs


def validate_camera_bindings(cameras: List[dict], nvrs: Dict[str, NvrConfig]) -> None:
    """Every camera must name its NVR *and* that NVR's source type (cameras.yaml
    ``nvr`` / ``nvr_type``), and the two must agree with streams.yaml. Raises
    ``ValueError`` listing every problem — a camera is never silently bound to
    the wrong host or credentials."""
    problems = []
    for c in cameras:
        if not c.get("nvr") and not c.get("channel"):
            continue                               # unbound camera: no video source by design
        nvr = nvrs.get(c.get("nvr") or "")
        if nvr is None:
            problems.append(f"{c['id']}: unknown NVR {c.get('nvr')!r}")
        elif not c.get("nvr_type"):
            problems.append(f"{c['id']}: `nvr_type` is required (NVR {nvr.nvr_id} is type {nvr.type})")
        elif c["nvr_type"] != nvr.type:
            problems.append(f"{c['id']}: nvr_type {c['nvr_type']!r} does not match NVR {nvr.nvr_id} (type {nvr.type})")
    if problems:
        raise ValueError("cameras.yaml NVR binding errors:\n  " + "\n  ".join(problems))
