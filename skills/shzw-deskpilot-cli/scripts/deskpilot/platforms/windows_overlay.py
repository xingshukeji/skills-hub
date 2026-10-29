"""Non-activating Windows activity cue with a dismissible status panel."""

from __future__ import annotations

import ctypes as C
from ctypes import wintypes as W
import queue
import threading
import time
import uuid

from .. import DeskPilotError


def _status_text(label):
    """Keep the common action names understandable while preserving custom labels."""
    text = " ".join(str(label).split())[:120]
    actions = {
        "Observe": "Observing", "ui.click": "Clicking", "ui.invoke": "Selecting",
        "ui.set_value": "Entering text", "ui.select": "Selecting", "input.click": "Clicking",
        "input.double_click": "Clicking", "input.right_click": "Clicking", "input.type": "Typing",
        "input.secret": "Entering text", "input.key": "Pressing keys", "input.hotkey": "Pressing keys",
        "input.scroll": "Scrolling", "android.click": "Clicking", "android.set_value": "Entering text",
        "android.swipe": "Scrolling",
    }
    return actions.get(text, "Working" if not text or text.startswith(("ui.", "input.", "android.")) else text)


class ActivityOverlay:
    def __init__(self):
        self._commands = queue.Queue()
        self._wake = threading.Event()
        self._ready = threading.Event()
        self._dismissed = threading.Event()
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
        if self._dismissed.is_set():
            raise DeskPilotError("OVERLAY_DISMISSED", "The user closed the desktop activity indicator.")
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

        class TRACKMOUSEEVENT(C.Structure):
            _fields_ = [("size", W.DWORD), ("flags", W.DWORD), ("window", W.HWND), ("hover_time", W.DWORD)]

        user.DefWindowProcW.restype = C.c_ssize_t
        user.DefWindowProcW.argtypes = [W.HWND, W.UINT, W.WPARAM, W.LPARAM]
        user.CallWindowProcW.restype = C.c_ssize_t
        user.CallWindowProcW.argtypes = [C.c_void_p, W.HWND, W.UINT, W.WPARAM, W.LPARAM]
        user.SetWindowLongPtrW.restype = C.c_void_p
        user.SetWindowLongPtrW.argtypes = [W.HWND, C.c_int, C.c_void_p]
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
        user.SystemParametersInfoW.argtypes = [W.UINT, W.UINT, C.c_void_p, W.UINT]
        user.TrackMouseEvent.argtypes = [C.POINTER(TRACKMOUSEEVENT)]
        user.SetCapture.argtypes = [W.HWND]
        user.ReleaseCapture.argtypes = []
        kernel.GetModuleHandleW.restype = W.HMODULE
        for name, restype, args in [
            ("CreateSolidBrush", W.HBRUSH, [W.DWORD]), ("CreatePen", W.HPEN, [C.c_int, C.c_int, W.DWORD]),
            ("CreateFontW", W.HANDLE, [C.c_int, C.c_int, C.c_int, C.c_int, C.c_int, W.DWORD, W.DWORD, W.DWORD,
                                       W.DWORD, W.DWORD, W.DWORD, W.DWORD, W.DWORD, W.LPCWSTR]),
            ("SelectObject", W.HGDIOBJ, [W.HDC, W.HGDIOBJ]), ("DeleteObject", W.BOOL, [W.HGDIOBJ]),
            ("SetTextColor", W.DWORD, [W.HDC, W.DWORD]), ("SetBkMode", C.c_int, [W.HDC, C.c_int]),
            ("Rectangle", W.BOOL, [W.HDC, C.c_int, C.c_int, C.c_int, C.c_int]),
            ("RoundRect", W.BOOL, [W.HDC, C.c_int, C.c_int, C.c_int, C.c_int, C.c_int, C.c_int]),
            ("Ellipse", W.BOOL, [W.HDC, C.c_int, C.c_int, C.c_int, C.c_int]),
            ("MoveToEx", W.BOOL, [W.HDC, C.c_int, C.c_int, C.c_void_p]),
            ("LineTo", W.BOOL, [W.HDC, C.c_int, C.c_int]),
            ("GetStockObject", W.HGDIOBJ, [C.c_int]),
        ]:
            function = getattr(gdi, name)
            function.restype, function.argtypes = restype, args

        try:
            user.GetDpiForSystem.restype = W.UINT
            scale = max(1.0, user.GetDpiForSystem() / 96.0)
        except AttributeError:
            scale = 1.0
        px = lambda value: round(value * scale)
        width, height, button_size = px(264), px(44), px(32)
        state = {"area": None, "label": "Ready", "trace": None, "deadline": 0,
                 "hidden": False, "seen": False, "hover": False, "pressed": False}
        frame = panel = button = None
        original_button_proc = None
        transparent = 0x00010101
        background = 0x00262626
        transparent_brush = gdi.CreateSolidBrush(transparent)
        panel_brush = gdi.CreateSolidBrush(background)
        hover_brush = gdi.CreateSolidBrush(0x00454545)
        ready_brush = gdi.CreateSolidBrush(0x0078C594)
        active_brush = gdi.CreateSolidBrush(0x00E7AB72)
        frame_pen = gdi.CreatePen(0, max(2, px(3)), 0x00E58E25)
        panel_pen = gdi.CreatePen(0, 1, 0x00414141)
        close_pen = gdi.CreatePen(0, max(1, px(2)), 0x00DDDDDD)
        brand_font = gdi.CreateFontW(-px(14), 0, 0, 0, 600, 0, 0, 0, 1, 0, 0, 5, 0, "Segoe UI")
        status_font = gdi.CreateFontW(-px(14), 0, 0, 0, 400, 0, 0, 0, 1, 0, 0, 5, 0, "Segoe UI")

        def paint(handle):
            painting = PAINTSTRUCT()
            dc = user.BeginPaint(handle, C.byref(painting))
            try:
                area = RECT()
                user.GetClientRect(handle, C.byref(area))
                if handle == frame:
                    user.FillRect(dc, C.byref(area), transparent_brush)
                    old_pen = gdi.SelectObject(dc, frame_pen)
                    old_brush = gdi.SelectObject(dc, gdi.GetStockObject(5))
                    gdi.Rectangle(dc, px(2), px(2), area.right - px(2), area.bottom - px(2))
                    if state["trace"]:
                        x, y = state["trace"]
                        gdi.Ellipse(dc, x - px(14), y - px(14), x + px(14), y + px(14))
                    gdi.SelectObject(dc, old_brush)
                    gdi.SelectObject(dc, old_pen)
                elif handle == panel:
                    user.FillRect(dc, C.byref(area), transparent_brush)
                    old_pen = gdi.SelectObject(dc, panel_pen)
                    old_brush = gdi.SelectObject(dc, panel_brush)
                    gdi.RoundRect(dc, 0, 0, area.right, area.bottom, px(16), px(16))
                    dot = ready_brush if state["label"] == "Ready" else active_brush
                    gdi.SelectObject(dc, dot)
                    gdi.SelectObject(dc, gdi.GetStockObject(8))  # NULL_PEN
                    gdi.Ellipse(dc, px(15), px(19), px(21), px(25))
                    gdi.SetBkMode(dc, 1)
                    gdi.SetTextColor(dc, 0x00F6F6F6)
                    old_font = gdi.SelectObject(dc, brand_font)
                    brand_area = RECT(px(29), 0, px(97), area.bottom)
                    user.DrawTextW(dc, "DeskPilot", -1, C.byref(brand_area), 0x20 | 0x04 | 0x800 | 0x8000)
                    gdi.SelectObject(dc, status_font)
                    gdi.SetTextColor(dc, 0x00C8C8C8)
                    status_area = RECT(px(101), 0, area.right - px(42), area.bottom)
                    user.DrawTextW(dc, _status_text(state["label"]), -1, C.byref(status_area), 0x20 | 0x04 | 0x800 | 0x8000)
                    gdi.SelectObject(dc, old_font)
                    gdi.SelectObject(dc, old_brush)
                    gdi.SelectObject(dc, old_pen)
                else:
                    user.FillRect(dc, C.byref(area), panel_brush)
                    if state["hover"] or state["pressed"]:
                        old_pen = gdi.SelectObject(dc, gdi.GetStockObject(8))
                        old_brush = gdi.SelectObject(dc, hover_brush)
                        gdi.RoundRect(dc, 0, 0, area.right, area.bottom, px(8), px(8))
                        gdi.SelectObject(dc, old_brush)
                        gdi.SelectObject(dc, old_pen)
                    old_pen = gdi.SelectObject(dc, close_pen)
                    mid_x, mid_y, radius = area.right // 2, area.bottom // 2, px(5)
                    gdi.MoveToEx(dc, mid_x - radius, mid_y - radius, None)
                    gdi.LineTo(dc, mid_x + radius, mid_y + radius)
                    gdi.MoveToEx(dc, mid_x + radius, mid_y - radius, None)
                    gdi.LineTo(dc, mid_x - radius, mid_y + radius)
                    gdi.SelectObject(dc, old_pen)
            finally:
                user.EndPaint(handle, C.byref(painting))

        def dismiss():
            self._dismissed.set()
            for handle in (frame, panel, button):
                if handle:
                    user.ShowWindow(handle, 0)
            self._wake.set()

        def procedure(handle, message, wparam, lparam):
            if message == 0x000F:  # WM_PAINT
                paint(handle)
                return 0
            if message == 0x0014:  # WM_ERASEBKGND
                return 1
            if message == 0x0084:  # HTTRANSPARENT: the cue never intercepts the target
                return -1
            if message == 0x0021:  # MA_NOACTIVATE
                return 3
            return user.DefWindowProcW(handle, message, wparam, lparam)

        def button_procedure(handle, message, wparam, lparam):
            if message == 0x000F:
                paint(handle)
                return 0
            if message == 0x0014:
                return 1
            if message == 0x0021:
                return 3
            if message == 0x0200:  # WM_MOUSEMOVE
                if not state["hover"]:
                    state["hover"] = True
                    tracking = TRACKMOUSEEVENT(C.sizeof(TRACKMOUSEEVENT), 2, handle, 0)
                    user.TrackMouseEvent(C.byref(tracking))
                    user.InvalidateRect(handle, None, False)
                return 0
            if message == 0x02A3:  # WM_MOUSELEAVE
                state["hover"] = False
                user.InvalidateRect(handle, None, False)
                return 0
            if message == 0x0201:  # WM_LBUTTONDOWN
                state["pressed"] = True
                user.SetCapture(handle)
                user.InvalidateRect(handle, None, False)
                return 0
            if message == 0x0202:  # WM_LBUTTONUP
                was_pressed = state["pressed"]
                state["pressed"] = False
                user.ReleaseCapture()
                x, y = C.c_short(lparam & 0xFFFF).value, C.c_short((lparam >> 16) & 0xFFFF).value
                if was_pressed and 0 <= x < button_size and 0 <= y < button_size:
                    dismiss()
                else:
                    user.InvalidateRect(handle, None, False)
                return 0
            if message == 0x0215:  # WM_CAPTURECHANGED
                state["pressed"] = False
                user.InvalidateRect(handle, None, False)
                return 0
            if message == 0x00F5:  # BM_CLICK, including accessible button invocation
                dismiss()
                return 0
            return user.CallWindowProcW(original_button_proc, handle, message, wparam, lparam)

        callback = callback_type(procedure)
        button_callback = callback_type(button_procedure)
        class_name = "DeskPilotActivity_" + uuid.uuid4().hex
        instance = kernel.GetModuleHandleW(None)
        window_class = WNDCLASS(0, callback, 0, 0, instance, None, None, None, None, class_name)
        try:
            user.RegisterClassW.argtypes = [C.POINTER(WNDCLASS)]
            if not user.RegisterClassW(C.byref(window_class)):
                raise OSError("RegisterClassW failed")
            passive_style = 0x00080000 | 0x00000020 | 0x00000080 | 0x08000000 | 0x00000008
            frame = user.CreateWindowExW(passive_style, class_name, "DeskPilot activity", 0x80000000, 0, 0, 1, 1, None, None, instance, None)
            panel = user.CreateWindowExW(passive_style, class_name, "DeskPilot status", 0x80000000, 0, 0, width, height, None, None, instance, None)
            # A real native button keeps its accessible name and button role; only this small area accepts input.
            button_style = 0x00000080 | 0x08000000 | 0x00000008
            button = user.CreateWindowExW(button_style, "BUTTON", "Close DeskPilot status", 0x80000000,
                                          0, 0, button_size, button_size, None, None, instance, None)
            if not frame or not panel or not button:
                raise OSError("CreateWindowExW failed")
            original_button_proc = user.SetWindowLongPtrW(button, -4, C.cast(button_callback, C.c_void_p))
            if not original_button_proc:
                raise OSError("Button subclass failed")
            user.SetLayeredWindowAttributes(frame, transparent, 255, 1)
            user.SetLayeredWindowAttributes(panel, transparent, 255, 1)
            self._ready.set()
            running = True
            panel_position = frame_position = None
            dirty = True
            while running:
                acknowledgements = []
                while True:
                    try:
                        name, value, acknowledged = self._commands.get_nowait()
                    except queue.Empty:
                        break
                    if name == "update":
                        state.update(area=value[0], label=value[1], trace=value[2], deadline=time.monotonic() + 2, seen=True)
                        dirty = True
                    elif name == "finish":
                        state.update(area=None, label=value, trace=None)
                        dirty = True
                    elif name == "hide":
                        state["hidden"] = True
                    elif name == "resume":
                        state["hidden"] = False
                    elif name == "close":
                        running = False
                    if acknowledged:
                        acknowledgements.append(acknowledged)
                visible = state["seen"] and not state["hidden"] and not self._dismissed.is_set() and running
                if visible:
                    work = RECT()
                    if not user.SystemParametersInfoW(0x0030, 0, C.byref(work), 0):
                        work = RECT(0, 0, user.GetSystemMetrics(0), user.GetSystemMetrics(1))
                    position = (max(work.left, work.right - width - px(16)), work.top + px(12))
                    if panel_position != position:
                        left, top = position
                        user.SetWindowPos(panel, W.HWND(-1), left, top, width, height, 0x0010 | 0x0040)
                        user.SetWindowPos(button, W.HWND(-1), left + width - button_size - px(6),
                                          top + (height - button_size) // 2, button_size, button_size, 0x0010 | 0x0040)
                        panel_position = position
                        dirty = True
                    if dirty:
                        user.InvalidateRect(panel, None, False)
                elif panel_position is not None:
                    user.ShowWindow(panel, 0)
                    user.ShowWindow(button, 0)
                    panel_position = None
                area = state["area"]
                if visible and area and time.monotonic() < state["deadline"]:
                    position = (area["x"], area["y"], area["width"], area["height"])
                    if frame_position != position:
                        user.SetWindowPos(frame, W.HWND(-1), *position, 0x0010 | 0x0040)
                        frame_position = position
                        dirty = True
                    if dirty:
                        user.InvalidateRect(frame, None, False)
                elif frame_position is not None:
                    user.ShowWindow(frame, 0)
                    frame_position = None
                dirty = False
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
            for handle in (button, frame, panel):
                if handle:
                    user.DestroyWindow(handle)
            for value in (status_font, brand_font, close_pen, panel_pen, frame_pen, active_brush,
                          ready_brush, hover_brush, panel_brush, transparent_brush):
                if value:
                    gdi.DeleteObject(value)
            user.UnregisterClassW(class_name, instance)
