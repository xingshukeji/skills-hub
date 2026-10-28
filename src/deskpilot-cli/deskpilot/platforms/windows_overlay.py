"""Non-activating, click-through Win32 activity cue owned by the CLI process."""

from __future__ import annotations

import ctypes as C
from ctypes import wintypes as W
import queue
import threading
import time
import uuid

from .. import DeskPilotError


class ActivityOverlay:
    def __init__(self):
        self._commands = queue.Queue()
        self._wake = threading.Event()
        self._ready = threading.Event()
        self._error = None
        self._thread = threading.Thread(target=self._run, name="deskpilot-activity", daemon=True)
        self._thread.start()
        if not self._ready.wait(3) or self._error:
            raise DeskPilotError("OVERLAY_UNAVAILABLE", "The native activity window could not be created.")

    def _send(self, name, value=None, wait=False):
        acknowledged = threading.Event() if wait else None
        self._commands.put((name, value, acknowledged))
        self._wake.set()
        if acknowledged:
            acknowledged.wait(1)

    def update(self, area, label, trace=None):
        self._send("update", (area, label, trace))

    def finish(self, label):
        self._send("finish", label)

    def hide(self):
        self._send("hide", wait=True)

    def resume(self):
        self._send("resume")

    def close(self):
        self._send("close")
        self._thread.join(2)

    def _run(self):
        user = C.WinDLL("user32", use_last_error=True)
        gdi = C.WinDLL("gdi32", use_last_error=True)
        kernel = C.WinDLL("kernel32", use_last_error=True)
        callback_type = C.WINFUNCTYPE(C.c_ssize_t, W.HWND, W.UINT, W.WPARAM, W.LPARAM)

        class WNDCLASS(C.Structure):
            _fields_ = [("style", W.UINT), ("lpfnWndProc", callback_type), ("cbClsExtra", C.c_int),
                        ("cbWndExtra", C.c_int), ("hInstance", W.HINSTANCE), ("hIcon", W.HICON),
                        ("hCursor", W.HANDLE), ("hbrBackground", W.HBRUSH),
                        ("lpszMenuName", W.LPCWSTR), ("lpszClassName", W.LPCWSTR)]

        class RECT(C.Structure):
            _fields_ = [("left", W.LONG), ("top", W.LONG), ("right", W.LONG), ("bottom", W.LONG)]

        class PAINTSTRUCT(C.Structure):
            _fields_ = [("hdc", W.HDC), ("erase", W.BOOL), ("rcPaint", RECT), ("restore", W.BOOL),
                        ("inc_update", W.BOOL), ("reserved", C.c_byte * 32)]

        user.DefWindowProcW.restype = C.c_ssize_t
        user.DefWindowProcW.argtypes = [W.HWND, W.UINT, W.WPARAM, W.LPARAM]
        user.CreateWindowExW.restype = W.HWND
        user.CreateWindowExW.argtypes = [W.DWORD, W.LPCWSTR, W.LPCWSTR, W.DWORD, C.c_int, C.c_int,
                                       C.c_int, C.c_int, W.HWND, W.HMENU, W.HINSTANCE, C.c_void_p]
        user.BeginPaint.restype = W.HDC
        user.BeginPaint.argtypes = [W.HWND, C.POINTER(PAINTSTRUCT)]
        user.EndPaint.argtypes = [W.HWND, C.POINTER(PAINTSTRUCT)]
        user.GetClientRect.argtypes = [W.HWND, C.POINTER(RECT)]
        user.SetWindowPos.argtypes = [W.HWND, W.HWND, C.c_int, C.c_int, C.c_int, C.c_int, W.UINT]
        user.ShowWindow.argtypes = [W.HWND, C.c_int]
        user.InvalidateRect.argtypes = [W.HWND, C.c_void_p, W.BOOL]
        user.SetLayeredWindowAttributes.argtypes = [W.HWND, W.DWORD, W.BYTE, W.DWORD]
        user.DestroyWindow.argtypes = [W.HWND]
        user.UnregisterClassW.argtypes = [W.LPCWSTR, W.HINSTANCE]
        user.PeekMessageW.argtypes = [C.POINTER(W.MSG), W.HWND, W.UINT, W.UINT, W.UINT]
        user.TranslateMessage.argtypes = [C.POINTER(W.MSG)]
        user.DispatchMessageW.argtypes = [C.POINTER(W.MSG)]
        user.DispatchMessageW.restype = C.c_ssize_t
        user.FillRect.argtypes = [W.HDC, C.POINTER(RECT), W.HBRUSH]
        user.DrawTextW.argtypes = [W.HDC, W.LPCWSTR, C.c_int, C.POINTER(RECT), W.UINT]
        kernel.GetModuleHandleW.restype = W.HMODULE
        for name, restype, args in [
            ("CreateSolidBrush", W.HBRUSH, [W.DWORD]), ("CreatePen", W.HPEN, [C.c_int, C.c_int, W.DWORD]),
            ("SelectObject", W.HGDIOBJ, [W.HDC, W.HGDIOBJ]), ("DeleteObject", W.BOOL, [W.HGDIOBJ]),
            ("SetTextColor", W.DWORD, [W.HDC, W.DWORD]), ("SetBkMode", C.c_int, [W.HDC, C.c_int]),
            ("Rectangle", W.BOOL, [W.HDC, C.c_int, C.c_int, C.c_int, C.c_int]),
            ("Ellipse", W.BOOL, [W.HDC, C.c_int, C.c_int, C.c_int, C.c_int]),
            ("GetStockObject", W.HGDIOBJ, [C.c_int]),
        ]:
            function = getattr(gdi, name)
            function.restype, function.argtypes = restype, args
        state = {"area": None, "label": "Ready", "trace": None, "deadline": 0, "hidden": False, "seen": False}
        frame = panel = None
        color = 0x00E58E25
        transparent = 0x00010101
        brush = gdi.CreateSolidBrush(transparent)
        white = gdi.CreateSolidBrush(0x00FFFFFF)
        pen = gdi.CreatePen(0, 4, color)

        def paint(handle):
            painting = PAINTSTRUCT()
            dc = user.BeginPaint(handle, C.byref(painting))
            try:
                area = RECT()
                user.GetClientRect(handle, C.byref(area))
                user.FillRect(dc, C.byref(area), white if handle == panel else brush)
                previous_pen = gdi.SelectObject(dc, pen)
                previous_brush = gdi.SelectObject(dc, gdi.GetStockObject(5))  # NULL_BRUSH
                gdi.Rectangle(dc, 2, 2, area.right - 2, area.bottom - 2)
                if handle == frame and state["trace"]:
                    x, y = state["trace"]
                    gdi.Ellipse(dc, x - 14, y - 14, x + 14, y + 14)
                if handle == panel:
                    text_area = RECT(12, 8, area.right - 10, area.bottom - 5)
                    gdi.SetTextColor(dc, color)
                    gdi.SetBkMode(dc, 1)
                    user.DrawTextW(dc, "DeskPilot · " + state["label"], -1, C.byref(text_area), 0x20 | 0x8000)
                gdi.SelectObject(dc, previous_brush)
                gdi.SelectObject(dc, previous_pen)
            finally:
                user.EndPaint(handle, C.byref(painting))

        def procedure(handle, message, wparam, lparam):
            if message == 0x000F:
                paint(handle)
                return 0
            if message == 0x0084:  # HTTRANSPARENT
                return -1
            if message == 0x0021:  # MA_NOACTIVATE
                return 3
            return user.DefWindowProcW(handle, message, wparam, lparam)

        callback = callback_type(procedure)
        class_name = "DeskPilotActivity_" + uuid.uuid4().hex
        instance = kernel.GetModuleHandleW(None)
        window_class = WNDCLASS(0, callback, 0, 0, instance, None, None, None, None, class_name)
        try:
            user.RegisterClassW.argtypes = [C.POINTER(WNDCLASS)]
            if not user.RegisterClassW(C.byref(window_class)):
                raise OSError("RegisterClassW failed")
            style = 0x00080000 | 0x00000020 | 0x00000080 | 0x08000000 | 0x00000008
            frame = user.CreateWindowExW(style, class_name, "DeskPilot activity", 0x80000000, 0, 0, 1, 1, None, None, instance, None)
            panel = user.CreateWindowExW(style, class_name, "DeskPilot status", 0x80000000, 0, 0, 320, 40, None, None, instance, None)
            if not frame or not panel:
                raise OSError("CreateWindowExW failed")
            user.SetLayeredWindowAttributes(frame, transparent, 255, 1)
            user.SetLayeredWindowAttributes(panel, transparent, 235, 3)
            self._ready.set()
            running = True
            while running:
                acknowledgements = []
                while True:
                    try:
                        name, value, acknowledged = self._commands.get_nowait()
                    except queue.Empty:
                        break
                    if name == "update":
                        state.update(area=value[0], label=value[1], trace=value[2], deadline=time.monotonic() + 2, seen=True)
                    elif name == "finish":
                        state.update(area=None, label=value, trace=None)
                    elif name == "hide":
                        state["hidden"] = True
                    elif name == "resume":
                        state["hidden"] = False
                    elif name == "close":
                        running = False
                    if acknowledged:
                        acknowledgements.append(acknowledged)
                visible = state["seen"] and not state["hidden"] and running
                if visible:
                    left = user.GetSystemMetrics(76) + user.GetSystemMetrics(78) - 335
                    top = user.GetSystemMetrics(77) + 12
                    user.SetWindowPos(panel, W.HWND(-1), left, top, 320, 40, 0x0010 | 0x0040)
                    user.InvalidateRect(panel, None, True)
                else:
                    user.ShowWindow(panel, 0)
                area = state["area"]
                if visible and area and time.monotonic() < state["deadline"]:
                    user.SetWindowPos(frame, W.HWND(-1), area["x"], area["y"], area["width"], area["height"], 0x0010 | 0x0040)
                    user.InvalidateRect(frame, None, True)
                else:
                    user.ShowWindow(frame, 0)
                for acknowledged in acknowledgements:
                    acknowledged.set()
                message = W.MSG()
                while user.PeekMessageW(C.byref(message), None, 0, 0, 1):
                    user.TranslateMessage(C.byref(message))
                    user.DispatchMessageW(C.byref(message))
                self._wake.wait(0.05)
                self._wake.clear()
        except Exception as exc:
            self._error = type(exc).__name__
            self._ready.set()
        finally:
            for handle in (frame, panel):
                if handle:
                    user.DestroyWindow(handle)
            for value in (pen, white, brush):
                gdi.DeleteObject(value)
            user.UnregisterClassW(class_name, instance)
