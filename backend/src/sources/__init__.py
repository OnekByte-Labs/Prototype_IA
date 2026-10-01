"""
Video sources: everything upstream of the detection pipelines.

    source_type   class                        frames from
    rtsp          sources.rtsp.LiveRTSPSource  an NVR channel via the media server (NVDEC)
    onvif         — reserved —                 ONVIF discovery → RTSP profile (not implemented)

There are no recorded / mock sources: cameras without a live NVR channel have
no video. A source is a thread with ``start()``, ``stop()`` and ``health()``
that pushes ``FramePacket`` objects into a sink (``sink.put(packet)``). The
pipeline manager starts a camera's source only while something consumes its
decoded frames (see pipelines/manager.py).
"""

SOURCE_TYPES = ("rtsp", "onvif")


def create_source(spec: dict, sink, target_fps: float):
    kind = spec.get("type", "rtsp")
    if kind == "rtsp":
        from src.sources.rtsp import LiveRTSPSource
        return LiveRTSPSource(spec, sink, target_fps)
    if kind == "onvif":
        raise NotImplementedError("ONVIF sources are not implemented yet — bind the camera to an NVR channel (rtsp)")
    raise ValueError(f"Unknown source type {kind!r} (expected one of {', '.join(SOURCE_TYPES)})")
