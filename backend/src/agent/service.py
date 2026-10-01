"""
Argus Agent: the Command Centre's assistant. A local model (Ollama,
qwen3.5:4b by default) answers operator questions by calling the situation
tools; it never sees operational data any other way.

    question ─▶ model ─▶ tool calls ─▶ SituationService (SQLite + live runtime)
             ◀─ answer ◀─ model reads the tool results ◀─┘

Grounding: every entity ID in an answer (CAM-…, INC-…, INCD-…, NVR) is checked
against the tool results of the turn and the conversation's earlier verified
sources; anything else is returned flagged ``verified: false``. A question
about operations answered without any tool call is retried once with a
reminder to fetch data first.

Conversations and messages are stored per user in the command-centre database.

GPU sharing: the detection pipeline has priority on the (6 GB) laptop GPU. The
model is unloaded when the backend starts, so the pipelines allocate first, and
when Argus loads it, only as many layers go to the GPU as fit in the free memory
minus ``gpu_reserve_mb`` (head-room for detection-mode switches); the rest run
on the CPU. ``keep_alive`` returns the memory when nobody is chatting.
"""

import json
import logging
import re
import subprocess
import threading
import time
import uuid
from typing import Iterator, List, Optional, Set

from src.situation import fmt_time

from .ollama import CancelToken, OllamaClient, OllamaError
from .tools import TOOLS, run_tool

logger = logging.getLogger("agent")

ENTITY_RE = re.compile(r"\b(INCD-\d{6}|INC-\d{6}|CAM-\d{2,3}|NVR-\d{2}|HIK-\d{2}|FILE-\d{2})\b")
OPS_RE = re.compile(r"\b(cam|camera|nvr|alert|incident|intrusion|breach|anomal|event|offline|online|degraded|fault|"
                    r"status|happen|going on|detect|vehicle|plate|person|people|today|yesterday|minute|hour|recent|"
                    r"active|situation|summary|summar|pipeline|recorder|zone|health|working|down)", re.I)
CHITCHAT_RE = re.compile(r"^\s*(hi|hello|hey|thanks|thank you|ok|okay|good (morning|evening|afternoon))\b[\s!.]*$", re.I)

DEFAULTS = {
    "ollama_url": "http://127.0.0.1:11434",
    "model": "qwen3.5:4b",
    "num_ctx": 16384,
    "temperature": 0.2,
    "think": False,
    "keep_alive": "10m",
    "gpu_reserve_mb": 800,
    "max_answer_tokens": 450,
    "max_tool_rounds": 4,
    "history_turns": 6,
    "request_timeout_s": 300,
}

SYSTEM_PROMPT = """You are Argus, the operations assistant of an Indian Army surveillance Command Centre. Operators ask you about the live state and recent history of cameras, NVRs, AI detection pipelines, alerts, incidents and detection events.

Each operator message starts with the current local time in brackets. Apply only the filters the operator asked for in the current question (e.g. do not restrict to intrusion alerts unless asked).

Rules:
1. Every operational fact must come from tool results. Before answering any question about cameras, NVRs, alerts, incidents, events or system status, call the right tool - even if a similar question was answered earlier, because the data changes.
2. Never invent or guess IDs, counts, times, names, causes or statuses. Use only what the tools returned. If the tools return nothing relevant or an error, say plainly that the information is not available.
3. Cite sources inline with the exact IDs and times from the tools: cameras (CAM-09), alerts (INC-000123), incidents (INCD-000042), NVRs (NVR-01, HIK-01).
4. Alert IDs look like INC-000123 (one detection). Incident IDs look like INCD-000042 (a group of alerts from one camera). Never mix them up.
5. Describe only what the data shows. If a time window has no alerts, say so and give the latest alert time the tool reports; do not call the area "quiet", "secure" or "idle" unless the data says so.
6. When explaining why a device is not working, state only the fault given in the tool data ("issue", "stream_reason", "pipeline error", NVR status) and when it started. Do not speculate about other causes.
7. Write in simple English for a busy operator: first a one or two sentence direct answer, then at most five short bullet points. Stay under 120 words unless the operator asks for detail. No tables. Keep times as the tools give them (local time). "status_since" is when a device changed to its current status; if it says unknown, say the status has held since monitoring began and do not present that time as when the fault started.
8. Questions unrelated to the Command Centre: reply briefly that you can only help with Command Centre operations."""

NUDGE = ("You answered without calling a tool. Operational answers must come from tool data: call the appropriate "
         "tool now, then answer only from its result.")


def _title(text: str) -> str:
    t = re.sub(r"\s+", " ", text).strip()
    return (t[:57] + "…") if len(t) > 58 else t or "New chat"


class AgentService:
    def __init__(self, db, situation, admin=None, cfg: Optional[dict] = None):
        self.db, self.situation, self.admin = db, situation, admin
        self.cfg = {**DEFAULTS, **(cfg or {})}
        self.client = OllamaClient(self.cfg["ollama_url"], timeout=float(self.cfg["request_timeout_s"]))
        self._gpu_lock = threading.Lock()
        self._num_gpu: Optional[int] = None        # layers on the GPU for the currently loaded model (None = all)

    # ── GPU sharing with the detection pipeline ──────────────────────

    def release_gpu(self) -> None:
        """Unload the model (backend start: detection pipelines allocate first)."""
        try:
            self.client.unload(self.cfg["model"])
            logger.info("Argus model %s unloaded from the GPU (detection pipelines start first)", self.cfg["model"])
        except OllamaError:
            pass                                    # Ollama not running: nothing is loaded

    @staticmethod
    def _gpu_free_mb() -> Optional[float]:
        try:
            out = subprocess.run(["nvidia-smi", "--query-gpu=memory.free", "--format=csv,noheader,nounits"],
                                 capture_output=True, text=True, timeout=3)
            return float(out.stdout.split()[0])
        except (OSError, ValueError, IndexError, subprocess.SubprocessError):
            return None

    def _gpu_layers(self) -> Optional[int]:
        """GPU layers for the model: decided when it loads, reused while it stays loaded
        (changing it would force a reload). None = no limit (everything fits)."""
        with self._gpu_lock:
            model = self.cfg["model"]
            try:
                loaded = any(m.get("name") == model or m.get("model") == model for m in self.client.loaded())
            except OllamaError:
                loaded = False
            if loaded:
                return self._num_gpu
            free = self._gpu_free_mb()
            if free is None:
                self._num_gpu = None
                return None
            try:
                info = self.client.info(model)
            except OllamaError:
                return None
            size_mb = (info["size"] or 0) / 2 ** 20
            layers = int(info["blocks"] or 32) + 2                       # + embeddings / output
            per_layer = size_mb / layers if size_mb else 100.0
            # measured on the RTX 3050: ~570 MiB fixed (CUDA context, graph, KV) + ~85 MiB per layer
            overhead = 450 + 128 * int(self.cfg["num_ctx"]) / 16384
            budget = free - float(self.cfg["gpu_reserve_mb"])
            if budget >= size_mb + overhead:
                self._num_gpu = None
            else:
                self._num_gpu = max(0, min(layers, int((budget - overhead) / per_layer)))
            logger.info("Argus model load: %.0f MiB GPU free, reserve %.0f MiB for detection → %s GPU layers",
                        free, float(self.cfg["gpu_reserve_mb"]),
                        "all" if self._num_gpu is None else f"{self._num_gpu}/{layers}")
            return self._num_gpu

    # ── health ───────────────────────────────────────────────────────

    def health(self) -> dict:
        model = self.cfg["model"]
        try:
            models = self.client.models()
        except OllamaError as e:
            return {"ok": False, "ollama": "unreachable", "model": model, "detail": str(e)}
        installed = model in models or f"{model}:latest" in models
        try:
            loaded = any(m.get("name") == model or m.get("model") == model for m in self.client.loaded())
        except OllamaError:
            loaded = False
        return {"ok": installed, "ollama": "up", "model": model, "model_installed": installed, "model_loaded": loaded,
                "detail": None if installed else f"Model {model} is not installed: run `ollama pull {model}`"}

    # ── conversations ────────────────────────────────────────────────

    def conversations(self, username: str, limit: int = 100) -> List[dict]:
        return self.db.query(
            "SELECT c.conversation_id, c.title, c.created_at, c.updated_at, "
            "(SELECT COUNT(*) FROM agent_messages m WHERE m.conversation_id=c.conversation_id) AS messages "
            "FROM agent_conversations c WHERE username=? ORDER BY updated_at DESC LIMIT ?", (username, limit))

    def _owned(self, cid: str, username: str) -> dict:
        c = self.db.query_one("SELECT * FROM agent_conversations WHERE conversation_id=? AND username=?",
                              (cid, username))
        if c is None:
            raise KeyError(cid)
        return c

    def messages(self, cid: str, username: str) -> dict:
        c = self._owned(cid, username)
        rows = self.db.query("SELECT id, role, content, tool_calls, sources, status, created_at, duration_ms "
                             "FROM agent_messages WHERE conversation_id=? ORDER BY id", (cid,))
        for r in rows:
            r["tool_calls"] = json.loads(r["tool_calls"]) if r["tool_calls"] else []
            r["sources"] = json.loads(r["sources"]) if r["sources"] else []
        return {**c, "messages": rows}

    def delete(self, cid: str, username: str) -> None:
        self._owned(cid, username)
        self.db.transaction(lambda conn: (
            conn.execute("DELETE FROM agent_messages WHERE conversation_id=?", (cid,)),
            conn.execute("DELETE FROM agent_conversations WHERE conversation_id=?", (cid,))))

    def _add_message(self, cid: str, role: str, content: str, tool_calls=None, sources=None,
                     status: str = "complete", duration_ms: Optional[float] = None) -> dict:
        now = time.time()
        mid = self.db.execute(
            "INSERT INTO agent_messages(conversation_id, role, content, tool_calls, sources, status, created_at, "
            "duration_ms) VALUES (?,?,?,?,?,?,?,?)",
            (cid, role, content, json.dumps(tool_calls) if tool_calls else None,
             json.dumps(sources) if sources else None, status, now, duration_ms))
        self.db.execute("UPDATE agent_conversations SET updated_at=? WHERE conversation_id=?", (now, cid))
        return {"id": mid, "role": role, "content": content, "tool_calls": tool_calls or [], "sources": sources or [],
                "status": status, "created_at": now, "duration_ms": duration_ms}

    # ── chat ─────────────────────────────────────────────────────────

    def _history(self, cid: str) -> tuple:
        """Earlier turns for the model + the IDs already verified in this conversation."""
        rows = self.db.query("SELECT role, content, sources, status FROM agent_messages WHERE conversation_id=? "
                             "ORDER BY id DESC LIMIT ?", (cid, int(self.cfg["history_turns"]) * 2))
        msgs, known = [], set()
        for r in reversed(rows):
            if r["role"] == "assistant":
                if r["status"] == "error" or not r["content"].strip():
                    continue
                known |= {s["id"] for s in json.loads(r["sources"] or "[]")
                          if s.get("kind") != "data" and s.get("verified")}
                msgs.append({"role": "assistant", "content": r["content"]})
            else:
                msgs.append({"role": "user", "content": r["content"]})
        return msgs, known

    def _payload(self, messages: list, tools: bool, num_gpu: Optional[int]) -> dict:
        p = {"model": self.cfg["model"], "messages": messages, "keep_alive": self.cfg["keep_alive"],
             "think": bool(self.cfg["think"]),
             "options": {"temperature": float(self.cfg["temperature"]), "num_ctx": int(self.cfg["num_ctx"])}}
        p["options"]["num_predict"] = int(self.cfg["max_answer_tokens"])
        if num_gpu is not None:
            p["options"]["num_gpu"] = num_gpu
        if tools:
            p["tools"] = TOOLS
        return p

    def chat(self, username: str, conversation_id: Optional[str], text: str, allowed: Optional[Set[str]],
             cancel: CancelToken) -> Iterator[dict]:
        """One operator turn. Yields stream events:
        start · thinking · tool_call · tool_result · delta · reset · done | error."""
        text = (text or "").strip()
        if not text:
            yield {"type": "error", "error": "Empty message"}
            return
        t0 = time.time()
        if conversation_id:
            conv = self._owned(conversation_id, username)
        else:
            conv = {"conversation_id": uuid.uuid4().hex[:16], "title": _title(text)}
            self.db.execute("INSERT INTO agent_conversations(conversation_id, username, title, created_at, updated_at) "
                            "VALUES (?,?,?,?,?)", (conv["conversation_id"], username, conv["title"], t0, t0))
        cid = conv["conversation_id"]
        history, known = self._history(cid)
        user_msg = self._add_message(cid, "user", text)
        yield {"type": "start", "conversation_id": cid, "title": conv["title"], "user_message": user_msg,
               "model": self.cfg["model"]}

        # The system prompt, tools and history stay byte-identical between turns so
        # Ollama reuses their cached prefix; the clock rides on the new question.
        now = time.strftime("%Y-%m-%d %H:%M %Z (UTC%z)")
        messages = [{"role": "system", "content": SYSTEM_PROMPT}, *history,
                    {"role": "user", "content": f"[{now}]\n{text}"}]
        tool_log: List[dict] = []
        corpus: List[str] = []           # serialized tool results of this turn (grounding)
        answer, status, error = "", "complete", None
        nudged = False
        rounds = int(self.cfg["max_tool_rounds"])
        try:
            num_gpu = self._gpu_layers()
            r = 0
            while r <= rounds:
                content, calls, thinking_sent = "", [], False
                for chunk in self.client.chat_stream(self._payload(messages, tools=r < rounds, num_gpu=num_gpu), cancel):
                    m = chunk.get("message") or {}
                    if m.get("thinking") and not thinking_sent:
                        thinking_sent = True
                        yield {"type": "thinking"}
                    if m.get("content"):
                        content += m["content"]
                        yield {"type": "delta", "text": m["content"]}
                    if m.get("tool_calls"):
                        calls.extend(m["tool_calls"])
                    if chunk.get("done"):
                        logger.info("Argus round %d: prompt %s tok in %.1fs, output %s tok in %.1fs", r,
                                    chunk.get("prompt_eval_count"), (chunk.get("prompt_eval_duration") or 0) / 1e9,
                                    chunk.get("eval_count"), (chunk.get("eval_duration") or 0) / 1e9)
                if cancel.is_set():
                    answer, status = content, "stopped"
                    break
                if calls:
                    if content:
                        yield {"type": "reset"}
                    messages.append({"role": "assistant", "content": content, "tool_calls": calls})
                    for call in calls:
                        fn = call.get("function") or {}
                        name = fn.get("name", "")
                        idx = len(tool_log)
                        yield {"type": "tool_call", "index": idx, "name": name, "arguments": fn.get("arguments") or {}}
                        res = run_tool(self.situation, name, fn.get("arguments"), allowed)
                        body = res["result"] if "result" in res else {"error": res["error"]}
                        serial = json.dumps(body, separators=(",", ":"), default=str)
                        corpus.append(serial)
                        entry = {"name": name, "arguments": res["args"], "ok": res["ok"], "ms": res["ms"],
                                 "at": time.time(), "as_of": body.get("as_of") if isinstance(body, dict) else None,
                                 "error": None if res["ok"] else (body.get("error") if isinstance(body, dict) else None)}
                        tool_log.append(entry)
                        yield {"type": "tool_result", "index": idx, **entry}
                        messages.append({"role": "tool", "tool_name": name, "content": serial})
                    r += 1
                    continue
                # An operational question must be answered from fresh tool data, even
                # when earlier turns covered something similar (small models skip it)
                if (not tool_log and not nudged and not CHITCHAT_RE.match(text)
                        and (OPS_RE.search(text) or self._needs_data(content, known, history))):
                    nudged = True
                    yield {"type": "reset"}
                    messages.append({"role": "assistant", "content": content})
                    messages.append({"role": "user", "content": NUDGE})
                    continue
                answer = content
                break
        except OllamaError as e:
            status, error = "error", str(e)
            logger.warning("Agent turn failed: %s", e)
        except KeyError as e:
            status, error = "error", f"Not found: {e}"
        except Exception as e:                         # never leave the operator with a hung stream
            logger.exception("Agent turn failed")
            status, error = "error", f"Agent failure: {e}"

        answer = re.sub(r"\n*\[Referenced:[^\]]*\]\s*$", "", answer).strip()
        if status == "error" and not answer:
            answer = ""
        sources = self._sources(answer, corpus, known, tool_log)
        msg = self._add_message(cid, "assistant", answer, tool_calls=tool_log, sources=sources, status=status,
                                duration_ms=round((time.time() - t0) * 1000))
        if error:
            msg["error"] = error
            yield {"type": "error", "error": error, "message": msg}
        else:
            yield {"type": "done", "message": msg}

    @staticmethod
    def _needs_data(answer: str, known: Set[str], history: list) -> bool:
        """An answer given without tools needs data if it states IDs or numbers
        that the conversation has not already established."""
        prior = " ".join(m["content"] for m in history)
        ids = set(ENTITY_RE.findall(answer))
        if ids - known:
            return True
        nums = set(re.findall(r"\b\d+\b", answer))
        return bool(nums - set(re.findall(r"\b\d+\b", prior))) or not history

    @staticmethod
    def _sources(answer: str, corpus: List[str], known: Set[str], tool_log: List[dict]) -> List[dict]:
        """Entities the answer cites (verified against the data) + the data calls themselves."""
        blob = "\n".join(corpus)
        out, seen = [], set()
        for eid in ENTITY_RE.findall(answer):
            if eid in seen:
                continue
            seen.add(eid)
            kind = ("incident" if eid.startswith("INCD-") else "alert" if eid.startswith("INC-") else
                    "camera" if eid.startswith("CAM-") else "nvr")
            out.append({"kind": kind, "id": eid, "verified": eid in blob or eid in known})
        for t in tool_log:
            out.append({"kind": "data", "id": t["name"], "arguments": t["arguments"], "ok": t["ok"],
                        "as_of": t.get("as_of") or fmt_time(t["at"])})
        return out
