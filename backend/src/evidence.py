"""
Alert evidence snapshots on disk.

The inference worker attaches the annotated frame that produced an alert
(restricted zone + red track box) to the event; the main process writes it
here and records the relative path in the event row, so
GET /api/v1/alerts/{id}/snapshot serves exactly the frame the alert fired on.

    backend/outputs/evidence/<YYYY-MM-DD>/<HHMMSSffffff>_<CAM-XX>_f<frame>.jpg

Retention is count-based (oldest files are pruned first); an alert whose file
was pruned reports its evidence as unavailable instead of showing another frame.
"""

import logging
import threading
from collections import deque
from datetime import datetime
from pathlib import Path
from typing import Optional

logger = logging.getLogger("evidence")


class EvidenceStore:
    def __init__(self, root: Path, max_files: int = 5000):
        self.root = root.resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.max_files = max(1, int(max_files))
        self._lock = threading.Lock()
        # Relative paths sort chronologically (day dir + time-of-day prefix)
        self._files = deque(sorted(str(p.relative_to(self.root)) for p in self.root.glob("*/*.jpg")))
        self._prune()
        logger.info("Evidence store %s: %d snapshots (retain %d)", self.root, len(self._files), self.max_files)

    def save(self, jpeg: bytes, camera_id: str, frame_id, timestamp_iso: str) -> Optional[str]:
        """Write one snapshot; returns its path relative to the store (or None on failure)."""
        try:
            ts = datetime.fromisoformat(timestamp_iso)
        except ValueError:
            ts = datetime.utcnow()
        rel = f"{ts:%Y-%m-%d}/{ts:%H%M%S%f}_{camera_id}_f{frame_id}.jpg"
        path = self.root / rel
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(jpeg)
        except OSError:
            logger.exception("Could not write evidence %s", path)
            return None
        with self._lock:
            self._files.append(rel)
            self._prune()
        return rel

    def path(self, rel: Optional[str]) -> Optional[Path]:
        """Absolute path of a stored snapshot, or None if it is missing / outside the store."""
        if not rel:
            return None
        p = (self.root / rel).resolve()
        if self.root not in p.parents or not p.is_file():
            return None
        return p

    def _prune(self) -> None:
        while len(self._files) > self.max_files:
            old = self.root / self._files.popleft()
            try:
                old.unlink(missing_ok=True)
                if old.parent != self.root and not any(old.parent.iterdir()):
                    old.parent.rmdir()
            except OSError:
                pass
