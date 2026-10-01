"""
Elevation sampling from Terrarium-encoded DEM tiles (AWS Terrain Tiles format:
elevation_m = R*256 + G + B/256 - 32768).

Used only when the tactical map is (re-)seeded, to put synthetic posts on high
ground and aim their cameras downhill. Tiles come from ``local_dir`` first
(offline / air-gapped), then from ``url`` if one is configured; when neither is
available the seed falls back to terrain-agnostic placement.
"""

import logging
import math
import urllib.request
from pathlib import Path
from typing import Dict, Optional, Tuple

import cv2
import numpy as np

logger = logging.getLogger("terrain")


class DemSampler:
    def __init__(self, url: Optional[str] = None, zoom: int = 13, local_dir: Optional[Path] = None,
                 timeout_s: float = 6.0):
        self.url, self.zoom, self.local_dir, self.timeout_s = url, zoom, local_dir, timeout_s
        self._tiles: Dict[Tuple[int, int], Optional[np.ndarray]] = {}
        self.failed = 0

    def _load(self, x: int, y: int) -> Optional[np.ndarray]:
        key = (x, y)
        if key in self._tiles:
            return self._tiles[key]
        data = None
        if self.local_dir is not None:
            p = self.local_dir / str(self.zoom) / str(x) / f"{y}.png"
            if p.is_file():
                data = p.read_bytes()
        if data is None and self.url:
            try:
                with urllib.request.urlopen(self.url.format(z=self.zoom, x=x, y=y), timeout=self.timeout_s) as r:
                    data = r.read()
            except Exception as e:  # offline, blocked, …
                self.failed += 1
                logger.debug("DEM tile %s/%s/%s unavailable: %s", self.zoom, x, y, e)
        arr = None
        if data:
            img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
            if img is not None:
                b, g, r = img[..., 0].astype(np.float32), img[..., 1].astype(np.float32), img[..., 2].astype(np.float32)
                arr = r * 256.0 + g + b / 256.0 - 32768.0
        self._tiles[key] = arr
        return arr

    def elevation(self, lat: float, lon: float) -> Optional[float]:
        n = 2 ** self.zoom
        fx = (lon + 180.0) / 360.0 * n
        lr = math.radians(lat)
        fy = (1.0 - math.log(math.tan(lr) + 1.0 / math.cos(lr)) / math.pi) / 2.0 * n
        tx, ty = int(fx), int(fy)
        tile = self._load(tx, ty)
        if tile is None:
            return None
        h, w = tile.shape
        px = min(w - 1, max(0, int((fx - tx) * w)))
        py = min(h - 1, max(0, int((fy - ty) * h)))
        return float(tile[py, px])

    @property
    def available(self) -> bool:
        return any(t is not None for t in self._tiles.values())
