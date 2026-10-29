"""Bounded, HWND-specific Windows Graphics Capture of an owned window frame."""

from __future__ import annotations

import importlib.util
from functools import lru_cache
import threading
import time

from .. import DeskPilotError, require, resource_root
from ..screen import Image, pillow


_startup_slot = threading.BoundedSemaphore(1)


@lru_cache(maxsize=1)
def _native_capture_class():
    path = resource_root() / "vendor" / "windows-x64" / "python" / "deskpilot_wgc" / "windows_capture.pyd"
    require(path.is_file(), "WINDOW_CAPTURE_BACKEND_UNAVAILABLE", "The bundled window capture backend is missing.")
    try:
        spec = importlib.util.spec_from_file_location("deskpilot_wgc.windows_capture", path)
        if spec is None or spec.loader is None:
            raise ImportError("native capture module could not be resolved")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        native = module.NativeWindowsCapture
    except (AttributeError, ImportError, OSError) as exc:
        raise DeskPilotError("WINDOW_CAPTURE_BACKEND_UNAVAILABLE", f"The window capture backend could not load ({type(exc).__name__}).") from None
    return native


def _start_capture(capture, checkpoint, deadline):
    """Bound startup even when the Windows graphics driver does not respond."""
    require(_startup_slot.acquire(blocking=False), "WINDOW_CAPTURE_BACKEND_UNAVAILABLE",
            "A previous window capture is still starting or stopping.")
    state, lock, finished = {}, threading.Lock(), threading.Event()

    def start():
        control = None
        try:
            control = capture.start_free_threaded()
            with lock:
                abandoned = state.get("abandoned", False)
                if not abandoned:
                    state["control"] = control
            if abandoned:
                control.stop()
        except Exception as exc:
            with lock:
                state["error"] = type(exc).__name__
        finally:
            _startup_slot.release()
            finished.set()

    try:
        threading.Thread(target=start, name="deskpilot-window-capture-start", daemon=True).start()
    except Exception:
        _startup_slot.release()
        raise DeskPilotError("WINDOW_CAPTURE_BACKEND_UNAVAILABLE", "The window capture worker could not start.") from None
    try:
        while not finished.wait(0.025):
            checkpoint()
            require(time.monotonic() < deadline, "WINDOW_CAPTURE_BACKEND_UNAVAILABLE",
                    "The window capture backend did not start in time.")
        checkpoint()
        if "error" in state:
            raise DeskPilotError("WINDOW_CAPTURE_BACKEND_UNAVAILABLE",
                                 f"The system could not start window capture ({state['error']}).")
        require("control" in state, "WINDOW_CAPTURE_BACKEND_UNAVAILABLE", "The window capture backend did not start.")
        return state["control"]
    except BaseException:
        with lock:
            state["abandoned"] = True
            control = state.pop("control", None)
        if control is not None:
            try:
                control.stop()
            except Exception:
                pass
        raise


def capture_window(handle: int, *, checkpoint=lambda: None, timeout_seconds=3.0):
    """Return the target window pixels without importing numpy or OpenCV.

    The fixed ABI3 extension is pinned in the Skill manifest. The official
    extension exposes a mapped BGRA frame; copy it before its callback returns.
    Coordinates and window identity are verified by the caller.
    """
    native_capture = _native_capture_class()

    arrived = threading.Event()
    result = {}

    def on_frame(frame, buffer_length, width, height, stop, _timestamp):
        try:
            stride = int(frame.bytes_per_row)
            require(frame.color_format == "bgra8" and 0 < width * height <= 64_000_000 and stride >= width * 4
                    and buffer_length == stride * height and buffer_length <= 300_000_000,
                    "WINDOW_CAPTURE_FAILED", "The window frame has unsupported dimensions.")
            view = frame.buffer_view()
            try:
                require(view.nbytes == buffer_length, "WINDOW_CAPTURE_FAILED", "The window frame is incomplete.")
                # Decode directly from the mapped frame, respecting row pitch;
                # avoid several full-frame BGRA copies on large displays.
                converted = pillow().frombuffer("RGB", (width, height), view, "raw", "BGRX", stride, 1)
                try:
                    result["image"] = Image(width, height, converted.tobytes())
                finally:
                    converted.close()
            finally:
                view.release()
        except Exception as exc:
            result["error"] = exc if isinstance(exc, DeskPilotError) else DeskPilotError(
                "WINDOW_CAPTURE_FAILED", f"The window frame could not be read ({type(exc).__name__}).")
        finally:
            stop[0] = True
            arrived.set()

    def on_closed():
        result.setdefault("error", DeskPilotError("WINDOW_CAPTURE_FAILED", "The target window closed during capture."))
        arrived.set()

    checkpoint()
    try:
        capture = native_capture(on_frame, on_closed, cursor_capture=False, window_hwnd=handle)
    except Exception as exc:
        raise DeskPilotError("WINDOW_CAPTURE_BACKEND_UNAVAILABLE", f"The system could not start window capture ({type(exc).__name__}).") from None
    deadline = time.monotonic() + timeout_seconds
    control = _start_capture(capture, checkpoint, deadline)

    try:
        while not arrived.wait(0.025):
            checkpoint()
            require(not control.is_finished(), "WINDOW_CAPTURE_FAILED", "Window capture ended before a frame arrived.")
            require(time.monotonic() < deadline, "WINDOW_CAPTURE_FAILED", "Window capture did not provide a frame in time.")
        checkpoint()
        if "error" in result:
            raise result["error"]
        require("image" in result, "WINDOW_CAPTURE_FAILED", "The system did not provide a window frame.")
        image = result["image"]
    except BaseException:
        try:
            control.stop()
        except Exception:
            pass
        raise
    try:
        control.stop()
    except Exception as exc:
        raise DeskPilotError("WINDOW_CAPTURE_FAILED", f"The window capture session could not be closed ({type(exc).__name__}).") from None
    return image
