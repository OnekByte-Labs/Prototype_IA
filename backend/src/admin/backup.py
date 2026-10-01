"""
Backup & restore (backend/backups/<id>/).

  config    configuration versions + active config, custom roles, device
            registry metadata, NVR integration settings (no secrets) and the
            YAML configuration files.
            Restore → applies the backed-up configuration as a NEW version
            (audited, reversible by rollback) and restores device metadata and
            integration settings.
  database  consistent online copy of command_center.db (cameras, modes,
            geometry, hierarchy, NVRs, events, feedback).
            Restore → a safety backup of the current database is taken first,
            then the copy is restored online and the running pipelines are
            re-synchronized with it.
  audit     export of the hash-chained audit log. The audit trail is
            append-only, so it is never restored; a backup can be verified
            against the live chain (proves the live log was not rewritten).
"""

import hashlib
import json
import shutil
import time
from pathlib import Path
from typing import Optional

from .auth import AuthError, Principal
from .store import GENESIS

BACKEND = Path(__file__).resolve().parents[2]
BACKUP_DIR = BACKEND / "backups"
KINDS = ("config", "database", "audit")


def _sha(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def create_backup(svc, p: Optional[Principal], kind: str, note: str = "") -> dict:
    if kind not in KINDS:
        raise ValueError(f"kind must be one of {', '.join(KINDS)}")
    bid = time.strftime("%Y%m%dT%H%M%S") + f"-{kind}"
    d = BACKUP_DIR / bid
    d.mkdir(parents=True, exist_ok=False)
    who = p.username if p else "system"
    try:
        if kind == "config":
            main = d / "config.json"
            data = {
                "format": "iscc-config-backup/1", "created_at": time.time(), "created_by": who,
                "active_version": svc.active()["version"],
                "active": svc.cfg,
                "versions": [dict(r) | {"doc": json.loads(r["doc"])} for r in
                             svc.store.q("SELECT * FROM config_versions ORDER BY version")],
                "roles": [r for r in svc.roles() if not r["builtin"]],
                "devices": [{k: dv[k] for k in ("camera_id", "name", "ip", "model", "firmware", "stream_url",
                                                "stream_protocol", "nvr_channel")} for dv in svc.db.devices()],
                "nvr_integrations": {k: {f: v.get(f) for f in ("protocol", "vendor", "host", "port", "username",
                                                              "rtsp_path", "channels")}
                                     for k, v in svc.db.nvr_integrations().items()},
            }
            main.write_text(json.dumps(data, indent=1, default=str))
            cfgd = d / "configs"
            cfgd.mkdir()
            for f in (BACKEND / "configs").glob("*.yaml"):
                shutil.copy2(f, cfgd / f.name)
        elif kind == "database":
            main = d / "command_center.db"
            svc.db.backup_to(main)
        else:
            main = d / "audit.jsonl"
            rows = svc.store.q("SELECT * FROM audit ORDER BY id")
            with open(main, "w") as f:
                for r in rows:
                    f.write(json.dumps(r) + "\n")
        size = sum(x.stat().st_size for x in d.rglob("*") if x.is_file())
        digest = _sha(main)
        (d / "manifest.json").write_text(json.dumps({"id": bid, "kind": kind, "created_at": time.time(),
                                                      "created_by": who, "main": main.name, "sha256": digest,
                                                      "note": note}, indent=1))
        svc.store.x("INSERT INTO backups(id, created_at, author, kind, path, size_bytes, sha256, status, detail) "
                    "VALUES (?,?,?,?,?,?,?, 'ok', ?)", (bid, time.time(), who, kind, str(d), size, digest, note[:200]))
        svc.audit(p, "backup.create", f"backup:{bid}", new={"kind": kind, "size_bytes": size, "sha256": digest[:16]},
                  detail=note or None)
    except Exception as e:
        shutil.rmtree(d, ignore_errors=True)
        svc.store.x("INSERT INTO backups(id, created_at, author, kind, path, status, detail) VALUES (?,?,?,?,?, 'failed', ?)",
                    (bid, time.time(), who, kind, str(d), str(e)[:200]))
        svc.audit(p, "backup.create", f"backup:{bid}", result="failed", detail=str(e)[:200])
        raise
    svc.publish("backup", id=bid)
    return svc.store.one("SELECT * FROM backups WHERE id=?", (bid,))


def list_backups(svc) -> list:
    out = []
    for b in svc.store.q("SELECT * FROM backups ORDER BY created_at DESC"):
        b["present"] = Path(b["path"]).exists()
        out.append(b)
    return out


def _load(svc, bid: str):
    b = svc.store.one("SELECT * FROM backups WHERE id=?", (bid,))
    if b is None or b["status"] != "ok":
        raise KeyError(bid)
    d = Path(b["path"])
    man = json.loads((d / "manifest.json").read_text())
    main = d / man["main"]
    if not main.exists() or _sha(main) != b["sha256"]:
        raise ValueError(f"Backup {bid} failed its integrity check (file missing or modified)")
    return b, main


def verify_backup(svc, bid: str) -> dict:
    b, main = _load(svc, bid)
    res = {"id": bid, "kind": b["kind"], "sha256_ok": True}
    if b["kind"] == "audit":
        live = {r["id"]: r["hash"] for r in svc.store.q("SELECT id, hash FROM audit")}
        prev = GENESIS
        n = mism = 0
        for line in main.read_text().splitlines():
            r = json.loads(line)
            n += 1
            if r["prev_hash"] != prev or live.get(r["id"]) != r["hash"]:
                mism += 1
            prev = r["hash"]
        res.update({"entries": n, "matches_live_chain": mism == 0, "mismatches": mism})
    return res


def restore_backup(svc, p: Principal, bid: str, confirm: bool = False) -> dict:
    svc.require(p, "backup.manage", global_scope=True, resource=f"backup:{bid}")
    b, main = _load(svc, bid)
    if b["kind"] == "audit":
        raise ValueError("The audit trail is append-only and is never restored — use Verify instead")
    if b["kind"] == "config":
        data = json.loads(main.read_text())
        preview = svc.preview_config(data["active"])
        if not confirm:
            return {"preview": preview, "restores": ["configuration", "custom roles", "device metadata",
                                                     "NVR integration settings"]}
        res = {"config": None}
        try:
            res["config"] = svc.apply_config(p, data["active"], f"Restore from backup {bid}", kind="restore")
        except ValueError as e:
            res["config"] = {"skipped": str(e)}
        for r in data.get("roles", []):
            svc.save_role(p, r)
        for dv in data.get("devices", []):
            try:
                svc.db.update_device(dv["camera_id"], {k: v for k, v in dv.items() if k != "camera_id"}, p.username)
            except KeyError:
                pass
        for nid, integ in (data.get("nvr_integrations") or {}).items():
            svc.db.upsert_nvr_integration(nid, integ, p.username)
    else:
        if not confirm:
            return {"preview": {"notes": ["A safety backup of the current database is taken first.",
                                          "Camera modes, zones/lines, hierarchy, NVRs, device metadata, events and "
                                          "feedback revert to the backup; running pipelines are re-synchronized.",
                                          "Users, sessions, audit and configuration versions are NOT affected."],
                                "backup": b}}
        safety = create_backup(svc, p, "database", note=f"automatic safety copy before restoring {bid}")
        try:
            svc.db.restore_from(main)
        except Exception as e:
            svc.audit(p, "backup.restore", f"backup:{bid}", result="failed", detail=str(e)[:200])
            raise
        res = {"safety_backup": safety["id"], "resync": svc.runtime.resync_from_db()}
        if svc.map is not None:
            svc.map.after_restore()
    svc.store.x("UPDATE backups SET restored_at=?, restored_by=? WHERE id=?", (time.time(), p.username, bid))
    svc.audit(p, "backup.restore", f"backup:{bid}", new={"kind": b["kind"]}, detail=json.dumps(res, default=str)[:300])
    svc.publish("backup", id=bid)
    svc.publish("config", version=svc.active()["version"])
    return {"restored": bid, **res}


def delete_backup(svc, p: Optional[Principal], bid: str) -> None:
    b = svc.store.one("SELECT * FROM backups WHERE id=?", (bid,))
    if b is None:
        raise KeyError(bid)
    shutil.rmtree(b["path"], ignore_errors=True)
    svc.store.x("UPDATE backups SET status='deleted' WHERE id=?", (bid,))
    svc.audit(p, "backup.delete", f"backup:{bid}", prev={"kind": b["kind"]})
    svc.publish("backup", id=bid)


def prune_backups(svc, keep: int) -> int:
    n = 0
    for kind in KINDS:
        rows = svc.store.q("SELECT id FROM backups WHERE kind=? AND status='ok' ORDER BY created_at DESC", (kind,))
        for r in rows[keep:]:
            delete_backup(svc, None, r["id"])
            n += 1
    return n


def backup_guard(svc, p: Principal) -> None:
    svc.require(p, "backup.manage", global_scope=True, resource="backups")
    if not p:
        raise AuthError(401, "Not signed in")
