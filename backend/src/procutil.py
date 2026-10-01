"""
Process-lifetime helpers so worker processes and ffmpeg decoders never outlive
the pipeline (an orphaned worker keeps holding GPU memory and compute).
"""

import ctypes
import os
import signal
import sys

_PR_SET_PDEATHSIG = 1


def die_with_parent(sig: int = signal.SIGTERM) -> None:
    """Ask the Linux kernel to send ``sig`` to this process when its parent
    dies (no-op on other platforms). Safe to use as a Popen ``preexec_fn``."""
    if not sys.platform.startswith("linux"):
        return
    try:
        ctypes.CDLL("libc.so.6", use_errno=True).prctl(_PR_SET_PDEATHSIG, int(sig), 0, 0, 0)
    except OSError:
        pass


def sigterm_as_keyboard_interrupt() -> None:
    """Make SIGTERM (``kill``, closing a terminal, service stop) run the same
    clean shutdown path as Ctrl+C."""
    state = {"hits": 0}

    def _handler(signum, frame):
        state["hits"] += 1
        if state["hits"] > 1:
            os._exit(1)  # already shutting down and asked again — don't hang
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, _handler)
