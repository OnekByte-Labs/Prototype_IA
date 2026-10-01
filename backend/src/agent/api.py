"""
/api/agent — Argus Agent.

  POST   /api/agent/chat                    {"conversation_id"?: str, "message": str}
                                            → application/x-ndjson stream of turn events
                                              (start, thinking, tool_call, tool_result, delta, reset, done | error)
                                            Closing the connection stops generation (the partial answer is kept).
  GET    /api/agent/health                  Ollama reachable / model installed / loaded
  GET    /api/agent/conversations           the signed-in user's conversations
  GET    /api/agent/conversations/{id}      one conversation with its messages
  DELETE /api/agent/conversations/{id}
"""

import asyncio
import json
import threading
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from .ollama import CancelToken


class ChatRequest(BaseModel):
    message: str
    conversation_id: Optional[str] = None


def build_agent_router(agent, admin=None) -> APIRouter:
    r = APIRouter(prefix="/api/agent")

    def who(request: Request):
        """(username, allowed camera ids | None)."""
        if admin is None:
            return "operator", None
        from src.admin.api import principal
        from src.admin.auth import AuthError
        try:
            p = principal(admin, request)
        except AuthError as e:
            raise HTTPException(e.status, str(e))
        return p.username, admin.scoped_camera_ids(p)

    @r.get("/health")
    def health():
        return agent.health()

    @r.get("/conversations")
    def conversations(request: Request):
        user, _ = who(request)
        return {"conversations": agent.conversations(user)}

    @r.get("/conversations/{cid}")
    def conversation(cid: str, request: Request):
        user, _ = who(request)
        try:
            return agent.messages(cid, user)
        except KeyError:
            raise HTTPException(404, "Conversation not found")

    @r.delete("/conversations/{cid}", status_code=204)
    def delete(cid: str, request: Request):
        user, _ = who(request)
        try:
            agent.delete(cid, user)
        except KeyError:
            raise HTTPException(404, "Conversation not found")

    @r.post("/chat")
    async def chat(body: ChatRequest, request: Request):
        user, allowed = who(request)
        if not body.message.strip():
            raise HTTPException(422, "Message is empty")
        if len(body.message) > 4000:
            raise HTTPException(422, "Message is too long (4000 characters max)")
        if body.conversation_id:
            try:
                agent._owned(body.conversation_id, user)
            except KeyError:
                raise HTTPException(404, "Conversation not found")
        loop = asyncio.get_running_loop()
        q: asyncio.Queue = asyncio.Queue()
        cancel = CancelToken()

        def worker():
            try:
                for ev in agent.chat(user, body.conversation_id, body.message, allowed, cancel):
                    loop.call_soon_threadsafe(q.put_nowait, ev)
            except Exception as e:                          # pragma: no cover - chat() reports its own errors
                loop.call_soon_threadsafe(q.put_nowait, {"type": "error", "error": str(e)})
            finally:
                loop.call_soon_threadsafe(q.put_nowait, None)

        threading.Thread(target=worker, daemon=True, name="agent-turn").start()

        async def stream():
            try:
                while True:
                    try:
                        ev = await asyncio.wait_for(q.get(), timeout=10.0)
                    except asyncio.TimeoutError:
                        if await request.is_disconnected():
                            return
                        yield '{"type":"ping"}\n'               # keeps proxies from timing out a slow model load
                        continue
                    if ev is None:
                        return
                    yield json.dumps(ev, default=str) + "\n"
            finally:
                cancel.set()            # operator pressed stop / navigated away: stop generating

        return StreamingResponse(stream(), media_type="application/x-ndjson",
                                 headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})

    return r
