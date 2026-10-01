"""The unit every video source hands to the pipeline manager."""

import numpy as np


class FramePacket:
    """One decoded frame of a live source."""
    __slots__ = ("frame", "frame_id", "stream_id", "loop_reset", "timestamp",
                 "video_time_sec", "coord_scale", "cache")

    def __init__(
        self,
        frame: np.ndarray,
        frame_id: int,
        stream_id: str,
        loop_reset: bool = False,
        timestamp: float = 0.0,
        video_time_sec: float = 0.0,
        coord_scale: float = 1.0,
    ):
        self.frame = frame
        self.frame_id = frame_id
        self.stream_id = stream_id
        # discontinuity (reconnect): pipelines drop tracker identities
        self.loop_reset = loop_reset
        # wall-clock time the frame left the decoder (latency measurements start here)
        self.timestamp = timestamp
        self.video_time_sec = video_time_sec
        # native pixels per processed pixel (1.0 = frame is native resolution)
        self.coord_scale = coord_scale
        # Per-frame products shared by every camera on this source (display
        # downscale, raw JPEG) so they're computed once, not once per camera.
        self.cache: dict = {}
