"""
Shared ONNXRuntime session factory — makes sure every model lands on the GPU.

onnxruntime-gpu lists CUDAExecutionProvider as "available" even when the
CUDA/cuDNN shared libraries can't be found, and then silently falls back to
CPU at session creation. Installing ``onnxruntime-gpu[cuda,cudnn]`` ships
those libraries as pip wheels, but they must be preloaded before the first
session is created — that's what ``ort.preload_dlls()`` does.

When the TensorRT 10 libraries are installed (``tensorrt-cu13-libs``), fixed-
shape models are run through the TensorRT EP in FP16, which is ~2.5–3.5x
faster than the CUDA EP for the YOLO models. The first start builds the
engines (a few minutes); they are cached in ``backend/.trt_cache``.
Set ``USE_TENSORRT=0`` to skip TensorRT.
"""

import ctypes
import importlib.util
import logging
import os
import threading
import time
from pathlib import Path
from typing import Dict, Optional

import onnxruntime as ort

logger = logging.getLogger(__name__)

TRT_CACHE_DIR = Path(__file__).resolve().parents[2] / ".trt_cache"

_dlls_preloaded = False
_tensorrt_ok = False

# Concurrent Run() calls from many stream workers on the CUDA EP deadlock the
# sessions, and there is only one GPU to execute them anyway — so every GPU
# call is serialised. CPU work (decode, pre/post-processing, JPEG) around it
# still runs in parallel across the worker threads.
_gpu_lock = threading.Lock()

# PROFILE_GPU=1 logs average lock-wait / run time per model every 500 calls.
_PROFILE = os.environ.get("PROFILE_GPU", "0") == "1"


class _LockedSession:
    """InferenceSession proxy whose run() holds the process-wide GPU lock."""

    def __init__(self, session: ort.InferenceSession, tag: str = ""):
        self._session = session
        self._tag = tag
        self._stats = [0, 0.0, 0.0]  # calls, wait s, run s

    def run(self, *args, **kwargs):
        if not _PROFILE:
            with _gpu_lock:
                return self._session.run(*args, **kwargs)
        t0 = time.perf_counter()
        with _gpu_lock:
            t1 = time.perf_counter()
            out = self._session.run(*args, **kwargs)
        t2 = time.perf_counter()
        st = self._stats
        st[0] += 1; st[1] += t1 - t0; st[2] += t2 - t1
        if st[0] % 500 == 0:
            logger.info("[%s] GPU calls=%d avg wait=%.1fms avg run=%.1fms",
                        self._tag, st[0], st[1] / st[0] * 1000, st[2] / st[0] * 1000)
        return out

    def release(self) -> None:
        """Drop the underlying session so its GPU memory/engines are freed."""
        with _gpu_lock:
            self._session = None

    def __getattr__(self, name):
        if self.__dict__.get("_session") is None:
            raise RuntimeError(f"[{self._tag}] session used after release()")
        return getattr(self._session, name)


def _preload_tensorrt() -> bool:
    """Load the pip-installed TensorRT libs so ORT's TensorRT EP can find them."""
    spec = importlib.util.find_spec("tensorrt_libs")
    if spec is None or not spec.submodule_search_locations:
        return False
    lib_dir = Path(list(spec.submodule_search_locations)[0])
    try:
        for lib in ("libnvinfer.so.10", "libnvinfer_plugin.so.10", "libnvonnxparser.so.10"):
            ctypes.CDLL(str(lib_dir / lib), mode=ctypes.RTLD_GLOBAL)
    except OSError:
        logger.warning("TensorRT libs found but failed to load — using CUDA EP", exc_info=True)
        return False
    return True


_preload_lock = threading.Lock()


def _preload_gpu_dlls():
    global _dlls_preloaded, _tensorrt_ok
    if _dlls_preloaded:
        return
    # Several camera pipelines start concurrently: everyone must wait until the
    # libraries are actually loaded (the flag is only set once they are).
    with _preload_lock:
        if _dlls_preloaded:
            return
        available = ort.get_available_providers()
        if "CUDAExecutionProvider" in available and hasattr(ort, "preload_dlls"):
            try:
                ort.preload_dlls()
            except Exception:
                logger.warning("ort.preload_dlls() failed — relying on system CUDA/cuDNN", exc_info=True)
        if (
            "TensorrtExecutionProvider" in available
            and os.environ.get("USE_TENSORRT", "1") != "0"
        ):
            _tensorrt_ok = _preload_tensorrt()
        _dlls_preloaded = True


def ensure_gpu_runtime() -> None:
    """Preload the CUDA/cuDNN/TensorRT libraries. Must run before the first
    ONNX Runtime session of the process (including CPU-only helper sessions),
    or ORT caches a failed CUDA-provider load for the rest of the process."""
    _preload_gpu_dlls()


def create_session(
    model_path: str,
    tag: str,
    tensorrt: bool = True,
    free_dims: Optional[Dict[str, int]] = None,
) -> ort.InferenceSession:
    """
    Create an InferenceSession with the best provider available:
      TensorRT (FP16) → CUDA → DirectML → CPU

    ``free_dims`` pins symbolic dimensions (e.g. the TAO models' batch axis
    ``unk__150``) so TensorRT can build a static engine. Pass
    ``tensorrt=False`` for models TensorRT can't handle (dynamic shapes, LSTM).
    """
    _preload_gpu_dlls()

    available = ort.get_available_providers()
    providers = []
    if tensorrt and _tensorrt_ok:
        TRT_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        providers.append((
            "TensorrtExecutionProvider",
            {
                "device_id": 0,
                "trt_fp16_enable": True,
                "trt_engine_cache_enable": True,
                "trt_engine_cache_path": str(TRT_CACHE_DIR),
                "trt_timing_cache_enable": True,
                "trt_timing_cache_path": str(TRT_CACHE_DIR),
            },
        ))
        if not any(TRT_CACHE_DIR.glob("*.engine")):
            logger.info("[%s] Building TensorRT engine — first start only, takes a few minutes…", tag)
    if "CUDAExecutionProvider" in available:
        providers.append((
            "CUDAExecutionProvider",
            {
                "device_id": 0,
                "arena_extend_strategy": "kSameAsRequested",
                "cudnn_conv_algo_search": "HEURISTIC",
                "do_copy_in_default_stream": True,
            },
        ))
    if "DmlExecutionProvider" in available:
        providers.append("DmlExecutionProvider")
    providers.append("CPUExecutionProvider")

    opts = ort.SessionOptions()
    opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    for dim_name, value in (free_dims or {}).items():
        opts.add_free_dimension_override_by_name(dim_name, int(value))
    if len(providers) > 1:
        # The GPU does the math; ORT's default per-session CPU pool (one
        # spinning thread per core) just burns cores the stream workers need.
        opts.intra_op_num_threads = 1
        opts.inter_op_num_threads = 1
        opts.add_session_config_entry("session.intra_op.allow_spinning", "0")
        opts.add_session_config_entry("session.inter_op.allow_spinning", "0")

    session = ort.InferenceSession(str(model_path), sess_options=opts, providers=providers)
    active = session.get_providers()
    logger.info("[%s] Active providers: %s", tag, active)
    if active[0] == "CPUExecutionProvider":
        if "CUDAExecutionProvider" in available:
            if os.environ.get("ALLOW_CPU_FALLBACK", "0") != "1":
                # Fail loudly: the pipeline reports state=error instead of
                # silently running on CPU at a fraction of the speed.
                raise RuntimeError(f"{tag}: CUDA provider failed to load — refusing to run on CPU "
                                   "(set ALLOW_CPU_FALLBACK=1 to allow)")
            logger.warning("[%s] ⚠ CUDA is installed but the model is running on CPU", tag)
        return session
    return _LockedSession(session, tag)
