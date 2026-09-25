"""
Video ingestion module — one reader thread per video file.

Responsibilities:
  - Loop the .mp4 when it ends
  - Read actual resolution/fps/codec via cv2 (no hardcoding)
  - Push (frame, frame_id, stream_id, loop_reset) onto a bounded queue
  - Emit loop_reset flag on wrap so the tracker can clear state
"""

import threading
import time
import logging
from queue import Full
from typing import Optional

import cv2
import numpy as np

logger = logging.getLogger(__name__)


class FramePacket:
    """Immutable data class for a single frame read from a video."""
    __slots__ = ("frame", "frame_id", "stream_id", "loop_reset", "timestamp")

    def __init__(
        self,
        frame: np.ndarray,
        frame_id: int,
        stream_id: str,
        loop_reset: bool = False,
        timestamp: float = 0.0,
    ):
        self.frame = frame
        self.frame_id = frame_id
        self.stream_id = stream_id
        self.loop_reset = loop_reset
        self.timestamp = timestamp


class VideoReader(threading.Thread):
    """
    Threaded video reader that loops a single .mp4 file indefinitely.

    On video wrap (last frame → frame 0), the first packet of the new loop
    carries ``loop_reset=True`` so downstream consumers (tracker, analytics)
    can clear per-stream state.
    """

    def __init__(
        self,
        stream_id: str,
        video_path: str,
        frame_queue,  # queue.Queue[FramePacket]
        target_fps: Optional[float] = None,
    ):
        super().__init__(daemon=True, name=f"reader-{stream_id}")
        self.stream_id = stream_id
        self.video_path = video_path
        self.frame_queue = frame_queue
        self._stop_event = threading.Event()
        self._target_fps = target_fps

        # Will be populated on first open
        self.native_fps: float = 0.0
        self.width: int = 0
        self.height: int = 0
        self.codec: str = ""
        self.total_frames: int = 0

    # ── public API ──────────────────────────────────────────────────

    def stop(self):
        self._stop_event.set()

    # ── internals ───────────────────────────────────────────────────

    def _open_capture(self) -> cv2.VideoCapture:
        cap = cv2.VideoCapture(self.video_path)
        if not cap.isOpened():
            raise RuntimeError(f"[{self.stream_id}] Cannot open {self.video_path}")

        self.native_fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
        self.width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        self.height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        self.total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        fourcc = int(cap.get(cv2.CAP_PROP_FOURCC))
        self.codec = "".join(chr((fourcc >> 8 * i) & 0xFF) for i in range(4))

        logger.info(
            "[%s] Opened %s — %dx%d @ %.1f fps, codec=%s, frames=%d",
            self.stream_id,
            self.video_path,
            self.width,
            self.height,
            self.native_fps,
            self.codec,
            self.total_frames,
        )
        return cap

    def run(self):
        frame_id = 0
        effective_fps = self._target_fps or self.native_fps
        cap: Optional[cv2.VideoCapture] = None

        try:
            cap = self._open_capture()
            # Re-read fps now that capture is open (if target wasn't overridden)
            if not self._target_fps:
                effective_fps = self.native_fps
            frame_interval = 1.0 / max(effective_fps, 1.0)

            while not self._stop_event.is_set():
                loop_start = time.monotonic()
                ret, frame = cap.read()

                if not ret:
                    # ── video ended → loop ──
                    logger.info("[%s] Video ended at frame %d, looping…", self.stream_id, frame_id)
                    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                    ret, frame = cap.read()
                    if not ret:
                        logger.error("[%s] Cannot read first frame after loop reset", self.stream_id)
                        time.sleep(1.0)
                        continue

                    packet = FramePacket(
                        frame=frame,
                        frame_id=frame_id,
                        stream_id=self.stream_id,
                        loop_reset=True,
                        timestamp=time.time(),
                    )
                    frame_id += 1
                else:
                    packet = FramePacket(
                        frame=frame,
                        frame_id=frame_id,
                        stream_id=self.stream_id,
                        loop_reset=False,
                        timestamp=time.time(),
                    )
                    frame_id += 1

                # Non-blocking put — drop frame if queue is full (backpressure)
                try:
                    self.frame_queue.put(packet, timeout=0.05)
                except Full:
                    pass  # Drop frame silently; consumer is too slow

                # Pace reads to target fps
                elapsed = time.monotonic() - loop_start
                sleep_time = frame_interval - elapsed
                if sleep_time > 0:
                    time.sleep(sleep_time)

        except Exception:
            logger.exception("[%s] Reader crashed", self.stream_id)
        finally:
            if cap is not None:
                cap.release()
            logger.info("[%s] Reader stopped", self.stream_id)
