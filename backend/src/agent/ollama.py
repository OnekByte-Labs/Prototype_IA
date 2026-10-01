"""
Minimal client for the local Ollama server (stdlib only: no extra Python
dependency, nothing leaves the machine).

  GET  /api/tags   installed models
  GET  /api/ps     models loaded in memory
  POST /api/chat   streamed chat with tool calling (NDJSON chunks)
"""

import json
import threading
import urllib.error
import urllib.request
from typing import Callable, Iterator, List, Optional


class OllamaError(RuntimeError):
    pass


class CancelToken:
    """Set by the API when the operator presses stop or disconnects; closes
    the in-flight Ollama response so generation stops immediately."""

    def __init__(self):
        self._event = threading.Event()
        self._closers: List[Callable[[], None]] = []
        self._lock = threading.Lock()

    def is_set(self) -> bool:
        return self._event.is_set()

    def on_cancel(self, fn: Callable[[], None]) -> None:
        with self._lock:
            if self._event.is_set():
                fn()
            else:
                self._closers.append(fn)

    def set(self) -> None:
        with self._lock:
            if self._event.is_set():
                return
            self._event.set()
            closers, self._closers = self._closers, []
        for fn in closers:
            try:
                fn()
            except Exception:
                pass


class OllamaClient:
    def __init__(self, url: str = "http://127.0.0.1:11434", timeout: float = 300.0):
        self.url = url.rstrip("/")
        self.timeout = timeout

    def _get(self, path: str, timeout: float = 3.0) -> dict:
        try:
            with urllib.request.urlopen(self.url + path, timeout=timeout) as r:
                return json.loads(r.read())
        except (urllib.error.URLError, OSError, ValueError) as e:
            raise OllamaError(f"Ollama is not reachable at {self.url} ({e})") from e

    def models(self) -> List[str]:
        return [m["name"] for m in self._get("/api/tags").get("models", [])]

    def loaded(self) -> List[dict]:
        return self._get("/api/ps").get("models", [])

    def info(self, model: str) -> dict:
        """Size on disk and transformer block count of an installed model."""
        size = next((m.get("size") for m in self._get("/api/tags").get("models", []) if m["name"] == model), None)
        req = urllib.request.Request(self.url + "/api/show", data=json.dumps({"model": model}).encode(),
                                     headers={"Content-Type": "application/json"}, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=5) as r:
                mi = json.loads(r.read()).get("model_info", {})
        except (urllib.error.URLError, OSError, ValueError) as e:
            raise OllamaError(f"Ollama is not reachable at {self.url} ({e})") from e
        blocks = next((v for k, v in mi.items() if k.endswith(".block_count") and ".vision." not in k), None)
        return {"size": size, "blocks": blocks}

    def unload(self, model: str) -> None:
        """Free the model's GPU memory now (keep_alive 0)."""
        req = urllib.request.Request(self.url + "/api/generate",
                                     data=json.dumps({"model": model, "keep_alive": 0}).encode(),
                                     headers={"Content-Type": "application/json"}, method="POST")
        try:
            urllib.request.urlopen(req, timeout=10).close()
        except (urllib.error.URLError, OSError) as e:
            raise OllamaError(f"Ollama is not reachable at {self.url} ({e})") from e

    def chat_stream(self, payload: dict, cancel: Optional[CancelToken] = None) -> Iterator[dict]:
        """Yields Ollama's streamed chat chunks until ``done`` (or cancellation)."""
        req = urllib.request.Request(self.url + "/api/chat", data=json.dumps({**payload, "stream": True}).encode(),
                                     headers={"Content-Type": "application/json"}, method="POST")
        try:
            resp = urllib.request.urlopen(req, timeout=self.timeout)
        except urllib.error.HTTPError as e:
            detail = e.read().decode(errors="replace")[:300]
            raise OllamaError(f"Ollama returned {e.code}: {detail}") from e
        except (urllib.error.URLError, OSError) as e:
            raise OllamaError(f"Ollama is not reachable at {self.url} ({e})") from e
        if cancel is not None:
            cancel.on_cancel(resp.close)
        try:
            for line in resp:
                if cancel is not None and cancel.is_set():
                    return
                line = line.strip()
                if not line:
                    continue
                chunk = json.loads(line)
                if chunk.get("error"):
                    raise OllamaError(str(chunk["error"]))
                yield chunk
                if chunk.get("done"):
                    return
        except (OSError, ValueError, AttributeError):
            if cancel is not None and cancel.is_set():
                return                      # the response was closed by stop
            raise
        finally:
            resp.close()
