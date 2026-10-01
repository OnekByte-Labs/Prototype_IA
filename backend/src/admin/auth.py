"""
Authentication and role-based access control.

  * Passwords: scrypt (stdlib), per-user salt.
  * Sessions: random bearer token (only its SHA-256 is stored), absolute TTL +
    idle timeout from the active security policy; revocable.
  * Lockout: after N consecutive failures the account locks for M minutes.
  * RBAC: a role is a set of permissions; a user additionally has a scope
    (battalion = everything, company = that company, post = that post) that
    limits which cameras/units their camera-level permissions reach.
"""

import hashlib
import hmac
import json
import logging
import os
import secrets
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Set

from .store import AdminStore

logger = logging.getLogger("admin.auth")

PERMISSIONS: Dict[str, str] = {
    "admin.view": "Open the administration console (read-only views)",
    "users.manage": "Create, edit, disable users; reset passwords",
    "roles.manage": "Create and edit custom roles",
    "sessions.manage": "View and revoke other users' sessions",
    "hierarchy.manage": "Edit battalion / company / post hierarchy and camera assignment",
    "devices.manage": "Edit camera and NVR registry metadata",
    "detection.manage": "Change detection modes / AI model assignment, zones and schedules",
    "config.manage": "Apply and roll back system configuration",
    "security.manage": "Change authentication and access policy",
    "integrations.manage": "Configure and probe NVR / ONVIF / RTSP integrations",
    "backup.manage": "Create backups and restore",
    "audit.view": "Read and verify the audit log",
    "alerts.feedback": "Mark alerts as confirmed / false alarm",
    "feedback.review": "Review the model improvement queue",
}

BUILTIN_ROLES = {
    "administrator": ("Administrator", "Full system administration", sorted(PERMISSIONS)),
    "supervisor": ("Supervisor", "Watch supervisor: detection rules, feedback review, audit",
                   ["admin.view", "detection.manage", "alerts.feedback", "feedback.review", "audit.view"]),
    "operator": ("Operator", "Watchfloor operator", ["alerts.feedback"]),
    "maintenance": ("Maintenance", "Device and integration maintenance",
                    ["admin.view", "devices.manage", "integrations.manage"]),
    "auditor": ("Auditor", "Read-only oversight", ["admin.view", "audit.view"]),
}

SCRYPT = {"n": 2 ** 14, "r": 8, "p": 1}


def hash_password(pw: str) -> str:
    salt = secrets.token_bytes(16)
    h = hashlib.scrypt(pw.encode(), salt=salt, dklen=32, **SCRYPT)
    return f"scrypt${SCRYPT['n']}${SCRYPT['r']}${SCRYPT['p']}${salt.hex()}${h.hex()}"


def verify_password(pw: str, stored: str) -> bool:
    try:
        _, n, r, p, salt, h = stored.split("$")
        got = hashlib.scrypt(pw.encode(), salt=bytes.fromhex(salt), dklen=32, n=int(n), r=int(r), p=int(p))
        return hmac.compare_digest(got.hex(), h)
    except (ValueError, TypeError):
        return False


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class AuthError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


@dataclass
class Principal:
    user_id: int
    username: str
    display_name: str
    role: str
    permissions: Set[str]
    scope_type: str
    scope_id: Optional[str]
    session_id: str
    must_change_password: bool
    ip: Optional[str] = None
    extra: dict = field(default_factory=dict)

    def can(self, perm: str) -> bool:
        return perm in self.permissions

    def public(self) -> dict:
        return {"id": self.user_id, "username": self.username, "display_name": self.display_name,
                "role": self.role, "permissions": sorted(self.permissions), "scope_type": self.scope_type,
                "scope_id": self.scope_id, "session_id": self.session_id,
                "must_change_password": self.must_change_password}


class AuthService:
    def __init__(self, store: AdminStore, policy_getter, bootstrap_file: Path):
        self.store = store
        self.policy = policy_getter          # () -> security policy dict (active config)
        self._seed_roles()
        self._bootstrap(bootstrap_file)

    # ── setup ────────────────────────────────────────────────────────

    def _seed_roles(self) -> None:
        now = time.time()
        for name, (label, desc, perms) in BUILTIN_ROLES.items():
            self.store.x(
                "INSERT INTO roles(name, label, description, permissions, builtin, updated_at) VALUES (?,?,?,?,1,?) "
                "ON CONFLICT(name) DO UPDATE SET label=excluded.label, description=excluded.description, "
                "permissions=excluded.permissions, builtin=1",
                (name, label, desc, json.dumps(perms), now))

    def _bootstrap(self, path: Path) -> None:
        """First start: create the initial administrator. Its password comes
        from ADMIN_BOOTSTRAP_PASSWORD or is generated and written once to a
        0600 file; it must be changed at first login."""
        if self.store.one("SELECT 1 AS x FROM users LIMIT 1"):
            return
        pw = os.environ.get("ADMIN_BOOTSTRAP_PASSWORD") or secrets.token_urlsafe(12)
        now = time.time()
        self.store.x(
            "INSERT INTO users(username, display_name, role, scope_type, status, must_change_password, "
            "password_hash, created_at, updated_at) VALUES ('admin', 'System Administrator', 'administrator', "
            "'battalion', 'active', 1, ?, ?, ?)", (hash_password(pw), now, now))
        if not os.environ.get("ADMIN_BOOTSTRAP_PASSWORD"):
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(f"username: admin\npassword: {pw}\n(must be changed at first login; delete this file)\n")
            os.chmod(path, 0o600)
            logger.warning("Bootstrap administrator created — credentials written to %s", path)
        self.store.audit("system", "user.bootstrap", "user:admin", new={"role": "administrator"})

    # ── roles ────────────────────────────────────────────────────────

    def role_permissions(self, role: str) -> Set[str]:
        r = self.store.one("SELECT permissions FROM roles WHERE name=?", (role,))
        return set(json.loads(r["permissions"])) if r else set()

    # ── login / sessions ─────────────────────────────────────────────

    def login(self, username: str, password: str, ip: Optional[str], ua: Optional[str]) -> dict:
        pol = self.policy()
        now = time.time()
        u = self.store.one("SELECT * FROM users WHERE username=?", (username.strip(),))

        def fail(reason: str, status=401, msg="Invalid username or password"):
            self.store.x("INSERT INTO login_attempts(ts, username, ip, success, reason) VALUES (?,?,?,?,?)",
                         (now, username[:64], ip, 0, reason))
            self.store.audit(username[:64] or "?", "auth.login", f"user:{username[:64]}", result="failed",
                             detail=reason, ip=ip, user_id=u["id"] if u else None)
            raise AuthError(status, msg)

        if u is None:
            verify_password(password, hash_password("x"))    # constant-ish time
            fail("unknown user")
        if u["status"] != "active":
            fail("account disabled", 403, "Account is disabled")
        if u["locked_until"] and u["locked_until"] > now:
            fail("account locked", 423, f"Account locked until {time.strftime('%H:%M:%S', time.localtime(u['locked_until']))}")
        if not verify_password(password, u["password_hash"]):
            n = u["failed_count"] + 1
            locked = now + pol["lockout_minutes"] * 60 if n >= pol["lockout_threshold"] else None
            self.store.x("UPDATE users SET failed_count=?, locked_until=? WHERE id=?",
                         (0 if locked else n, locked, u["id"]))
            if locked:
                self.store.audit("system", "user.lock", f"user:{u['username']}",
                                 new={"locked_until": locked}, detail=f"{n} failed logins", ip=ip)
            fail("bad password")

        token = secrets.token_urlsafe(32)
        sid = secrets.token_hex(8)
        ttl = pol["session_ttl_hours"] * 3600
        self.store.x(
            "INSERT INTO sessions(id, token_hash, user_id, created_at, last_seen, expires_at, ip, user_agent) "
            "VALUES (?,?,?,?,?,?,?,?)", (sid, _token_hash(token), u["id"], now, now, now + ttl, ip, (ua or "")[:200]))
        self.store.x("UPDATE users SET failed_count=0, locked_until=NULL, last_login_at=?, last_login_ip=? WHERE id=?",
                     (now, ip, u["id"]))
        self.store.x("INSERT INTO login_attempts(ts, username, ip, success, reason) VALUES (?,?,?,1,NULL)",
                     (now, u["username"], ip))
        self.store.audit(u["username"], "auth.login", f"session:{sid}", result="success", ip=ip, user_id=u["id"])
        return {"token": token, "expires_at": now + ttl, "principal": self.principal_for(u, sid, ip).public()}

    def principal_for(self, u: dict, sid: str, ip: Optional[str]) -> Principal:
        return Principal(user_id=u["id"], username=u["username"], display_name=u["display_name"], role=u["role"],
                         permissions=self.role_permissions(u["role"]), scope_type=u["scope_type"],
                         scope_id=u["scope_id"], session_id=sid, must_change_password=bool(u["must_change_password"]),
                         ip=ip)

    def authenticate(self, token: Optional[str], ip: Optional[str] = None) -> Principal:
        if not token:
            raise AuthError(401, "Not signed in")
        now = time.time()
        s = self.store.one("SELECT * FROM sessions WHERE token_hash=?", (_token_hash(token),))
        if s is None or s["revoked_at"]:
            raise AuthError(401, "Session ended — sign in again")
        idle = self.policy()["idle_timeout_minutes"] * 60
        if s["expires_at"] < now or now - s["last_seen"] > idle:
            self.store.x("UPDATE sessions SET revoked_at=?, revoke_reason=? WHERE id=?",
                         (now, "expired" if s["expires_at"] < now else "idle timeout", s["id"]))
            raise AuthError(401, "Session expired — sign in again")
        u = self.store.one("SELECT * FROM users WHERE id=?", (s["user_id"],))
        if u is None or u["status"] != "active":
            raise AuthError(401, "Account is disabled")
        if now - s["last_seen"] > 15:
            self.store.x("UPDATE sessions SET last_seen=? WHERE id=?", (now, s["id"]))
        return self.principal_for(u, s["id"], ip)

    def logout(self, p: Principal) -> None:
        self.store.x("UPDATE sessions SET revoked_at=?, revoked_by=?, revoke_reason='logout' WHERE id=?",
                     (time.time(), p.username, p.session_id))

    def revoke(self, sid: str, by: str, reason: str) -> Optional[dict]:
        s = self.store.one("SELECT * FROM sessions WHERE id=?", (sid,))
        if s is None or s["revoked_at"]:
            return None
        self.store.x("UPDATE sessions SET revoked_at=?, revoked_by=?, revoke_reason=? WHERE id=?",
                     (time.time(), by, reason, sid))
        return s

    def revoke_user_sessions(self, user_id: int, by: str, reason: str, except_sid: Optional[str] = None) -> int:
        return self.store.x("UPDATE sessions SET revoked_at=?, revoked_by=?, revoke_reason=? "
                            "WHERE user_id=? AND revoked_at IS NULL AND id != ?",
                            (time.time(), by, reason, user_id, except_sid or "")).rowcount

    def active_sessions(self) -> List[dict]:
        now = time.time()
        idle = self.policy()["idle_timeout_minutes"] * 60
        return self.store.q(
            "SELECT s.id, s.user_id, u.username, u.display_name, u.role, s.created_at, s.last_seen, s.expires_at, "
            "s.ip, s.user_agent FROM sessions s JOIN users u ON u.id = s.user_id "
            "WHERE s.revoked_at IS NULL AND s.expires_at > ? AND s.last_seen > ? ORDER BY s.last_seen DESC",
            (now, now - idle))

    def verify_current(self, p: "Principal", password: str) -> None:
        """Re-authenticate the session's own user (terminal unlock); failures count toward lockout."""
        pol = self.policy()
        u = self.store.one("SELECT * FROM users WHERE id=?", (p.user_id,))
        now = time.time()
        if u["locked_until"] and u["locked_until"] > now:
            raise AuthError(423, "Account locked")
        if verify_password(password, u["password_hash"]):
            self.store.x("UPDATE users SET failed_count=0 WHERE id=?", (u["id"],))
            self.store.audit(p.username, "auth.unlock", f"session:{p.session_id}", ip=p.ip, user_id=p.user_id)
            return
        n = u["failed_count"] + 1
        locked = now + pol["lockout_minutes"] * 60 if n >= pol["lockout_threshold"] else None
        self.store.x("UPDATE users SET failed_count=?, locked_until=? WHERE id=?", (0 if locked else n, locked, u["id"]))
        self.store.x("INSERT INTO login_attempts(ts, username, ip, success, reason) VALUES (?,?,?,0,'unlock: bad password')",
                     (now, p.username, p.ip))
        self.store.audit(p.username, "auth.unlock", f"session:{p.session_id}", result="failed", ip=p.ip,
                         user_id=p.user_id, detail="bad password")
        if locked:
            self.revoke_user_sessions(u["id"], "system", "locked after failed unlocks")
            raise AuthError(423, "Account locked after repeated failures")
        raise AuthError(401, "Incorrect password")

    # ── passwords ────────────────────────────────────────────────────

    def check_password_policy(self, pw: str) -> None:
        n = self.policy()["password_min_length"]
        if len(pw) < n:
            raise AuthError(422, f"Password must be at least {n} characters")
        classes = sum(any(f(c) for c in pw) for f in (str.islower, str.isupper, str.isdigit,
                                                       lambda c: not c.isalnum()))
        if classes < 3:
            raise AuthError(422, "Password needs 3 of: lowercase, uppercase, digit, symbol")

    def change_password(self, p: Principal, current: str, new: str) -> None:
        u = self.store.one("SELECT * FROM users WHERE id=?", (p.user_id,))
        if not verify_password(current, u["password_hash"]):
            self.store.audit(p.username, "user.password.change", f"user:{p.username}", result="failed",
                             detail="current password wrong", ip=p.ip, user_id=p.user_id)
            raise AuthError(403, "Current password is incorrect")
        if current == new:
            raise AuthError(422, "The new password must differ from the current one")
        self.check_password_policy(new)
        self.store.x("UPDATE users SET password_hash=?, must_change_password=0, password_changed_at=?, updated_at=? "
                     "WHERE id=?", (hash_password(new), time.time(), time.time(), p.user_id))
        n = self.revoke_user_sessions(p.user_id, p.username, "password changed", except_sid=p.session_id)
        self.store.audit(p.username, "user.password.change", f"user:{p.username}", ip=p.ip, user_id=p.user_id,
                         detail=f"{n} other sessions revoked")
