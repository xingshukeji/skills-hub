"""Windows desktop operations through Win32 and native UI Automation COM."""

from __future__ import annotations

import ctypes as C
from ctypes import wintypes as W
import os
from pathlib import Path
import sys
import threading
import time

from .. import DeskPilotError, require, resource_root

PTR = C.c_size_t
LRESULT = C.c_ssize_t
ULONG_PTR = C.c_size_t


class POINT(C.Structure):
    _fields_ = [("x", W.LONG), ("y", W.LONG)]


class RECT(C.Structure):
    _fields_ = [("left", W.LONG), ("top", W.LONG), ("right", W.LONG), ("bottom", W.LONG)]


class MOUSEINPUT(C.Structure):
    _fields_ = [("dx", W.LONG), ("dy", W.LONG), ("mouseData", W.DWORD),
                ("dwFlags", W.DWORD), ("time", W.DWORD), ("dwExtraInfo", ULONG_PTR)]


class KEYBDINPUT(C.Structure):
    _fields_ = [("wVk", W.WORD), ("wScan", W.WORD), ("dwFlags", W.DWORD),
                ("time", W.DWORD), ("dwExtraInfo", ULONG_PTR)]


class INPUTUNION(C.Union):
    _fields_ = [("mi", MOUSEINPUT), ("ki", KEYBDINPUT)]


class INPUT(C.Structure):
    _anonymous_ = ("data",)
    _fields_ = [("type", W.DWORD), ("data", INPUTUNION)]


class BITMAPINFOHEADER(C.Structure):
    _fields_ = [("biSize", W.DWORD), ("biWidth", W.LONG), ("biHeight", W.LONG),
                ("biPlanes", W.WORD), ("biBitCount", W.WORD), ("biCompression", W.DWORD),
                ("biSizeImage", W.DWORD), ("biXPelsPerMeter", W.LONG), ("biYPelsPerMeter", W.LONG),
                ("biClrUsed", W.DWORD), ("biClrImportant", W.DWORD)]


def rectangle(value) -> dict:
    return {"x": int(value.left), "y": int(value.top),
            "width": int(value.right - value.left), "height": int(value.bottom - value.top)}


class WindowsDesktop:
    name = "windows"

    def __init__(self):
        self.user = C.WinDLL("user32", use_last_error=True)
        self.kernel = C.WinDLL("kernel32", use_last_error=True)
        self.gdi = C.WinDLL("gdi32", use_last_error=True)
        self._uia = None
        self._uia_module = None
        self._overlay = None
        self._configure()
        try:
            self.user.SetProcessDpiAwarenessContext(C.c_void_p(-4))
        except AttributeError:
            self.user.SetProcessDPIAware()

    def _configure(self):
        definitions = {
            "GetForegroundWindow": (W.HWND, []), "IsWindow": (W.BOOL, [W.HWND]),
            "IsWindowVisible": (W.BOOL, [W.HWND]), "IsIconic": (W.BOOL, [W.HWND]),
            "GetWindowRect": (W.BOOL, [W.HWND, C.POINTER(RECT)]),
            "GetWindowThreadProcessId": (W.DWORD, [W.HWND, C.POINTER(W.DWORD)]),
            "GetWindowTextLengthW": (C.c_int, [W.HWND]),
            "GetWindowTextW": (C.c_int, [W.HWND, W.LPWSTR, C.c_int]),
            "GetClassNameW": (C.c_int, [W.HWND, W.LPWSTR, C.c_int]),
            "GetWindow": (W.HWND, [W.HWND, W.UINT]),
            "IsChild": (W.BOOL, [W.HWND, W.HWND]),
            "GetAncestor": (W.HWND, [W.HWND, W.UINT]),
            "WindowFromPoint": (W.HWND, [POINT]),
            "SetForegroundWindow": (W.BOOL, [W.HWND]),
            "ShowWindow": (W.BOOL, [W.HWND, C.c_int]),
            "GetDC": (W.HDC, [W.HWND]), "ReleaseDC": (C.c_int, [W.HWND, W.HDC]),
            "GetCursorPos": (W.BOOL, [C.POINTER(POINT)]),
            "SetCursorPos": (W.BOOL, [C.c_int, C.c_int]),
            "SendInput": (W.UINT, [W.UINT, C.POINTER(INPUT), C.c_int]),
            "GetSystemMetrics": (C.c_int, [C.c_int]),
        }
        for name, (restype, argtypes) in definitions.items():
            function = getattr(self.user, name)
            function.restype, function.argtypes = restype, argtypes
        self.kernel.OpenProcess.argtypes = [W.DWORD, W.BOOL, W.DWORD]
        self.kernel.OpenProcess.restype = W.HANDLE
        self.kernel.QueryFullProcessImageNameW.argtypes = [W.HANDLE, W.DWORD, W.LPWSTR, C.POINTER(W.DWORD)]
        self.kernel.CloseHandle.argtypes = [W.HANDLE]
        for name, restype, arguments in [
            ("CreateCompatibleDC", W.HDC, [W.HDC]),
            ("CreateCompatibleBitmap", W.HBITMAP, [W.HDC, C.c_int, C.c_int]),
            ("SelectObject", W.HGDIOBJ, [W.HDC, W.HGDIOBJ]),
            ("DeleteObject", W.BOOL, [W.HGDIOBJ]), ("DeleteDC", W.BOOL, [W.HDC]),
            ("BitBlt", W.BOOL, [W.HDC, C.c_int, C.c_int, C.c_int, C.c_int, W.HDC, C.c_int, C.c_int, W.DWORD]),
            ("GetDIBits", C.c_int, [W.HDC, W.HBITMAP, W.UINT, W.UINT, C.c_void_p, C.c_void_p, W.UINT]),
        ]:
            function = getattr(self.gdi, name)
            function.restype, function.argtypes = restype, arguments

    def _automation(self):
        if self._uia is None:
            vendor = resource_root() / "vendor" / "python"
            if str(vendor) not in sys.path:
                sys.path.insert(0, str(vendor))
            try:
                # One request worker owns COM objects and their lifetime.
                sys.coinit_flags = 0
                import comtypes.client
                comtypes.client.gen_dir = str(Path(os.environ.get("LOCALAPPDATA", Path.home())) / "DeskPilot" / "comtypes")
                Path(comtypes.client.gen_dir).mkdir(parents=True, exist_ok=True)
                module = comtypes.client.GetModule("UIAutomationCore.dll")
                automation = comtypes.client.CreateObject(getattr(module, "CUIAutomation8", module.CUIAutomation), interface=module.IUIAutomation)
                try:
                    timed = automation.QueryInterface(module.IUIAutomation2)
                    timed.ConnectionTimeout = 2000
                    timed.TransactionTimeout = 2000
                except Exception:
                    pass
                self._uia, self._uia_module = automation, module
            except Exception as exc:
                raise DeskPilotError("UI_AUTOMATION_UNAVAILABLE", f"Native UI Automation could not initialize ({type(exc).__name__}).") from None
        return self._uia

    def _process(self, pid: int) -> str:
        handle = self.kernel.OpenProcess(0x1000, False, pid)
        if not handle:
            return ""
        try:
            size = W.DWORD(32768)
            buffer = C.create_unicode_buffer(size.value)
            if self.kernel.QueryFullProcessImageNameW(handle, 0, buffer, C.byref(size)):
                return Path(buffer.value).stem
            return ""
        finally:
            self.kernel.CloseHandle(handle)

    def window(self, handle) -> dict:
        require(bool(self.user.IsWindow(handle)), "WINDOW_NOT_FOUND", "The window no longer exists.")
        area = RECT()
        require(bool(self.user.GetWindowRect(handle, C.byref(area))), "WINDOW_UNAVAILABLE", "Window geometry could not be read.")
        pid = W.DWORD()
        self.user.GetWindowThreadProcessId(handle, C.byref(pid))
        title = C.create_unicode_buffer(self.user.GetWindowTextLengthW(handle) + 1)
        self.user.GetWindowTextW(handle, title, len(title))
        class_name = C.create_unicode_buffer(256)
        self.user.GetClassNameW(handle, class_name, 256)
        return {"native": int(handle), "pid": pid.value, "process": self._process(pid.value),
                "title": title.value, "class_name": class_name.value, "bounds": rectangle(area),
                "minimized": bool(self.user.IsIconic(handle)), "visible": bool(self.user.IsWindowVisible(handle)),
                "identity": (int(handle), pid.value, class_name.value)}

    def windows(self) -> list[dict]:
        output = []
        callback_type = C.WINFUNCTYPE(W.BOOL, W.HWND, W.LPARAM)

        def visit(handle, _):
            if self.user.IsWindowVisible(handle) and self.user.GetWindow(handle, 4) == 0:
                try:
                    item = self.window(handle)
                    if item["pid"] != os.getpid() and item["bounds"]["width"] > 0 and item["bounds"]["height"] > 0:
                        output.append(item)
                except DeskPilotError:
                    pass
            elif self.user.IsWindowVisible(handle):
                try:
                    item = self.window(handle)
                    if item["pid"] != os.getpid():
                        output.append(item)
                except DeskPilotError:
                    pass
            return True

        self.user.EnumWindows.argtypes = [callback_type, W.LPARAM]
        self.user.EnumWindows(callback_type(visit), 0)
        return output

    def foreground(self):
        return self.user.GetForegroundWindow()

    def related(self, target, other) -> bool:
        if target == other or self.user.IsChild(target, other):
            return True
        seen = set()
        while other and other not in seen:
            seen.add(other)
            other = self.user.GetWindow(other, 4)
            if other == target:
                return True
        return False

    def activate(self, window: dict, *, checkpoint=lambda: None) -> dict:
        handle = window["native"]
        started = time.monotonic()
        before = self._window_diagnostic(self.foreground())
        if self.user.IsIconic(handle):
            self.user.ShowWindow(handle, 9)
        granted = bool(self.user.SetForegroundWindow(handle))
        evidence = {"set_foreground_returned": granted, "foreground_before": before, "uia_focus_attempted": False}
        for method in ("set_foreground_window", "uia_set_focus"):
            checkpoint()
            if method == "uia_set_focus":
                # A long-lived caller can lose Win32 foreground permission after the
                # user answers in another app. Use the documented accessibility focus
                # operation on the target root, never fake keys or input-thread tricks.
                evidence["uia_focus_attempted"] = True
                try:
                    self._automation().ElementFromHandle(handle).SetFocus()
                except Exception as exc:
                    evidence["uia_focus_error"] = exc.code if isinstance(exc, DeskPilotError) else type(exc).__name__
            for _ in range(10):
                checkpoint()
                foreground = self.foreground()
                if self.related(handle, foreground):
                    live = self.window(handle)
                    live["activation"] = {**evidence, "method": method,
                                          "foreground_after": self._window_diagnostic(foreground),
                                          "elapsed_ms": round((time.monotonic() - started) * 1000)}
                    return live
                time.sleep(0.025)
        raise DeskPilotError("WINDOW_ACTIVATION_FAILED", "The target is not foreground. Inspect the reported foreground window and resolve competing interaction before observing again.",
                             retryable=True, details={**evidence, "target": self._window_diagnostic(handle),
                                 "foreground_after": self._window_diagnostic(self.foreground()),
                                 "elapsed_ms": round((time.monotonic() - started) * 1000)})

    def _window_diagnostic(self, handle):
        if not handle:
            return None
        try:
            return {key: value for key, value in self.window(handle).items() if key not in {"native", "identity"}}
        except DeskPilotError:
            return {"available": False}

    def restore(self, handle) -> bool:
        if not handle or not self.user.IsWindow(handle):
            return False
        self.user.SetForegroundWindow(handle)
        return bool(self.related(handle, self.foreground()))

    def tree(self, window: dict, *, depth: int, limit: int, checkpoint) -> list[dict]:
        automation = self._automation()
        root = automation.ElementFromHandle(window["native"])
        walker = automation.ControlViewWalker
        result = []

        def visit(element, level, parent):
            checkpoint()
            if not element or len(result) >= limit:
                return
            try:
                area = element.CurrentBoundingRectangle
                is_password = bool(element.CurrentIsPassword)
                item = {"native": element, "name": "" if is_password else str(element.CurrentName or ""),
                        "automation_id": str(element.CurrentAutomationId or ""),
                        "control_type": int(element.CurrentControlType),
                        "class_name": str(element.CurrentClassName or ""),
                        "enabled": bool(element.CurrentIsEnabled), "offscreen": bool(element.CurrentIsOffscreen),
                        "has_keyboard_focus": bool(element.CurrentHasKeyboardFocus),
                        "is_password": is_password, "bounds": rectangle(area), "depth": level, "parent": parent}
            except Exception:
                return
            index = len(result)
            result.append(item)
            if level >= depth:
                return
            child = walker.GetFirstChildElement(element)
            while child and len(result) < limit:
                visit(child, level + 1, index)
                checkpoint()
                child = walker.GetNextSiblingElement(child)

        try:
            visit(root, 0, None)
        except DeskPilotError:
            raise
        except Exception as exc:
            raise DeskPilotError("UI_AUTOMATION_FAILED", f"The accessibility tree could not be read ({type(exc).__name__}).", retryable=True) from None
        return result

    def _pattern(self, element, pattern_id: int, interface: str):
        self._automation()
        try:
            return element.GetCurrentPattern(pattern_id).QueryInterface(getattr(self._uia_module, interface))
        except Exception:
            raise DeskPilotError("UI_PATTERN_UNAVAILABLE", "The requested control does not expose this operation.") from None

    def element_info(self, element) -> dict:
        try:
            is_password = bool(element.CurrentIsPassword)
            value = None
            if not is_password:
                try:
                    value = str(self._pattern(element, 10002, "IUIAutomationValuePattern").CurrentValue)
                except DeskPilotError:
                    pass
            return {"name": "" if is_password else str(element.CurrentName or ""),
                    "bounds": rectangle(element.CurrentBoundingRectangle),
                    "enabled": bool(element.CurrentIsEnabled), "offscreen": bool(element.CurrentIsOffscreen),
                    "has_keyboard_focus": bool(element.CurrentHasKeyboardFocus),
                    "is_password": is_password, "value": value}
        except Exception as exc:
            raise DeskPilotError("ELEMENT_UNAVAILABLE", f"The control no longer responds ({type(exc).__name__}).", retryable=True) from None

    def invoke(self, element):
        info = self.element_info(element)
        require(info["enabled"] and not info["offscreen"], "ELEMENT_NOT_ACTIONABLE", "The control is not enabled and visible.")
        self._pattern(element, 10000, "IUIAutomationInvokePattern").Invoke()

    def set_value(self, element, value: str, *, checkpoint=lambda: None):
        info = self.element_info(element)
        require(not info["is_password"], "SENSITIVE_INPUT_BLOCKED", "Password controls must be handled by the user.")
        require(info["enabled"] and not info["offscreen"], "ELEMENT_NOT_ACTIONABLE", "The control is not enabled and visible.")
        pattern = self._pattern(element, 10002, "IUIAutomationValuePattern")
        require(not pattern.CurrentIsReadOnly, "ELEMENT_READ_ONLY", "The control is read-only.")
        checkpoint()
        pattern.SetValue(value)
        # Chromium can acknowledge SetValue before its renderer/AX tree updates.
        # Dispatch exactly once; only poll reads, including the caller's cancel/budget.
        started = time.monotonic()
        deadline = started + 0.75
        matched_at = None
        reads = 0
        while True:
            checkpoint()
            # A control can change to a password field while the renderer updates.
            require(not element.CurrentIsPassword, "SENSITIVE_INPUT_BLOCKED",
                    "The control became sensitive during verification; ask the user to inspect it.", outcome="unknown")
            current = str(pattern.CurrentValue)
            reads += 1
            now = time.monotonic()
            if current == value:
                if matched_at is not None and now - matched_at >= 0.025:
                    return {"method": "uia_value", "matched": True, "read_attempts": reads,
                            "elapsed_ms": round((now - started) * 1000)}
                if matched_at is None:
                    matched_at = now
            else:
                matched_at = None
            if now >= deadline:
                raise DeskPilotError("VALUE_NOT_VERIFIED", "The requested value was not confirmed within the readback window. Observe the control again before deciding on another action.",
                                     outcome="unknown", details={"verification_ms": round((now - started) * 1000),
                                                                  "read_attempts": reads, "write_attempts": 1})
            time.sleep(min(0.025, deadline - now))

    def select(self, element, value=None, *, checkpoint=lambda: None):
        if value is None:
            self._pattern(element, 10010, "IUIAutomationSelectionItemPattern").Select()
            return
        return self.set_value(element, str(value), checkpoint=checkpoint)

    def sensitive_focused(self) -> bool:
        try:
            return bool(self._automation().GetFocusedElement().CurrentIsPassword)
        except DeskPilotError:
            return False

    def _send(self, events: list[INPUT]):
        buffer = (INPUT * len(events))(*events)
        sent = self.user.SendInput(len(events), buffer, C.sizeof(INPUT))
        require(sent == len(events), "INPUT_NOT_DELIVERED", "Windows did not accept all input events; check window privilege and desktop access.", outcome="unknown")

    def click(self, window: dict, x: int, y: int, *, button="left", count=1):
        require(self.related(window["native"], self.foreground()), "WINDOW_NOT_FOREGROUND", "The requested window is not in the foreground.")
        original = POINT()
        self.user.GetCursorPos(C.byref(original))
        location = POINT(window["bounds"]["x"] + x, window["bounds"]["y"] + y)
        require(self.related(window["native"], self.user.WindowFromPoint(location)),
                "POINT_OCCLUDED", "Another window covers the requested point.")
        self.user.SetCursorPos(location.x, location.y)
        try:
            down, up = {"left": (2, 4), "right": (8, 16), "middle": (32, 64)}[button]
            for index in range(count):
                self._send([INPUT(type=0, mi=MOUSEINPUT(dwFlags=down)), INPUT(type=0, mi=MOUSEINPUT(dwFlags=up))])
                if index + 1 < count:
                    time.sleep(0.04)
        finally:
            self.user.SetCursorPos(original.x, original.y)

    def type_text(self, text: str, checkpoint):
        require(not self.sensitive_focused(), "SENSITIVE_INPUT_BLOCKED", "Password controls must be handled by the user.")
        units = text.encode("utf-16-le")
        for index in range(0, len(units), 128):
            checkpoint()
            events = []
            for offset in range(index, min(index + 128, len(units)), 2):
                unit = int.from_bytes(units[offset:offset + 2], "little")
                events.extend([INPUT(type=1, ki=KEYBDINPUT(wScan=unit, dwFlags=4)),
                               INPUT(type=1, ki=KEYBDINPUT(wScan=unit, dwFlags=6))])
            self._send(events)

    def key(self, keys: list[str]):
        mapping = {"CTRL": 0x11, "CONTROL": 0x11, "MOD": 0x11, "PRIMARY": 0x11, "ALT": 0x12, "SHIFT": 0x10,
                   "WIN": 0x5B, "META": 0x5B, "ENTER": 0x0D, "RETURN": 0x0D,
                   "TAB": 9, "ESC": 0x1B, "ESCAPE": 0x1B, "BACKSPACE": 8,
                   "DELETE": 0x2E, "SPACE": 0x20, "LEFT": 0x25, "UP": 0x26,
                   "RIGHT": 0x27, "DOWN": 0x28, "HOME": 0x24, "END": 0x23,
                   "PAGEUP": 0x21, "PAGEDOWN": 0x22, "INSERT": 0x2D}
        codes = []
        for name in keys:
            name = name.upper()
            if name in mapping:
                codes.append(mapping[name])
            elif len(name) == 1 and name.isascii() and name.isalnum():
                codes.append(ord(name))
            elif name.startswith("F") and name[1:].isdigit() and 1 <= int(name[1:]) <= 24:
                codes.append(0x6F + int(name[1:]))
            else:
                raise DeskPilotError("INVALID_ARGUMENT", "Unknown key name.")
        down = []
        try:
            for code in codes:
                self._send([INPUT(type=1, ki=KEYBDINPUT(wVk=code))])
                down.append(code)
        finally:
            for code in reversed(down):
                self._send([INPUT(type=1, ki=KEYBDINPUT(wVk=code, dwFlags=2))])

    def scroll(self, window: dict, x: int, y: int, amount: int, horizontal=False):
        original = POINT()
        self.user.GetCursorPos(C.byref(original))
        point = POINT(window["bounds"]["x"] + x, window["bounds"]["y"] + y)
        require(self.related(window["native"], self.user.WindowFromPoint(point)), "POINT_OCCLUDED", "Another window covers the scroll point.")
        self.user.SetCursorPos(point.x, point.y)
        try:
            self._send([INPUT(type=0, mi=MOUSEINPUT(mouseData=W.DWORD(amount).value, dwFlags=0x1000 if horizontal else 0x0800))])
        finally:
            self.user.SetCursorPos(original.x, original.y)

    def capture(self, window: dict):
        from ..screen import Image
        live = self.window(window["native"])
        require(live["identity"] == window["identity"] and live["bounds"] == window["bounds"],
                "WINDOW_IDENTITY_MISMATCH", "The window changed before capture.")
        require(self.related(window["native"], self.foreground()), "WINDOW_CAPTURE_UNTRUSTED", "Foreground ownership could not be established.",
                details={"target": self._window_diagnostic(window["native"]), "foreground": self._window_diagnostic(self.foreground())})
        area = live["bounds"]
        require(not live["minimized"], "WINDOW_CAPTURE_UNTRUSTED", "The window is minimized.")
        width, height = area["width"], area["height"]
        require(0 < width * height <= 64_000_000, "WINDOW_CAPTURE_FAILED", "The capture size is outside the supported range.")
        if self._overlay:
            self._overlay.hide()
        try:
            self._capture_ownership(window)
            samples = []
            for fy in (0.15, 0.5, 0.85):
                for fx in (0.15, 0.5, 0.85):
                    point = POINT(area["x"] + int(width * fx), area["y"] + int(height * fy))
                    related = self.related(window["native"], self.user.WindowFromPoint(point))
                    samples.append({"x": point.x - area["x"], "y": point.y - area["y"], "owned": related})
            require(all(item["owned"] for item in samples), "WINDOW_CAPTURE_UNTRUSTED", "Another window covers part of the requested capture.", details={"ownership_samples": samples})
            screen = self.user.GetDC(None)
            memory = self.gdi.CreateCompatibleDC(screen)
            bitmap = self.gdi.CreateCompatibleBitmap(screen, width, height)
            require(bool(screen and memory and bitmap), "WINDOW_CAPTURE_FAILED", "A screen capture surface could not be allocated.")
            previous = self.gdi.SelectObject(memory, bitmap)
            try:
                require(bool(self.gdi.BitBlt(memory, 0, 0, width, height, screen, area["x"], area["y"], 0x00CC0020 | 0x40000000)),
                        "WINDOW_CAPTURE_FAILED", "Windows did not provide the screen pixels.")
                self.gdi.SelectObject(memory, previous)
                header = BITMAPINFOHEADER(C.sizeof(BITMAPINFOHEADER), width, -height, 1, 32, 0, width * height * 4, 0, 0, 0, 0)
                pixels = C.create_string_buffer(width * height * 4)
                require(self.gdi.GetDIBits(memory, bitmap, 0, height, pixels, C.byref(header), 0) == height,
                        "WINDOW_CAPTURE_FAILED", "Windows returned an incomplete screen image.")
                raw = pixels.raw
                rgb = bytearray(width * height * 3)
                rgb[0::3], rgb[1::3], rgb[2::3] = raw[2::4], raw[1::4], raw[0::4]
            finally:
                self.gdi.SelectObject(memory, previous)
                self.gdi.DeleteObject(bitmap)
                self.gdi.DeleteDC(memory)
                self.user.ReleaseDC(None, screen)
            after = self.window(window["native"])
            self._capture_ownership(after)
            require(after["identity"] == window["identity"] and after["bounds"] == window["bounds"] and self.related(window["native"], self.foreground()),
                    "WINDOW_CAPTURE_UNTRUSTED", "Window ownership changed during capture.")
            return Image(width, height, bytes(rgb)), {"trusted": True, "capture_layer": "verified_foreground_gdi",
                                                       "foreground_relation": "target_or_owned_window", "ownership_samples": samples}
        finally:
            if self._overlay:
                self._overlay.resume()

    def _capture_ownership(self, window):
        """Any unrelated window above the target can taint even a small capture area."""
        blockers = []
        found = False
        area = window["bounds"]
        callback_type = C.WINFUNCTYPE(W.BOOL, W.HWND, W.LPARAM)

        def visit(handle, _):
            nonlocal found
            if handle == window["native"]:
                found = True
                return False
            if not self.user.IsWindowVisible(handle) or self.user.IsIconic(handle) or self.related(window["native"], handle):
                return True
            rectangle_value = RECT()
            if not self.user.GetWindowRect(handle, C.byref(rectangle_value)):
                return True
            above = rectangle(rectangle_value)
            if (above["width"] > 0 and above["height"] > 0
                    and above["x"] < area["x"] + area["width"] and above["x"] + above["width"] > area["x"]
                    and above["y"] < area["y"] + area["height"] and above["y"] + above["height"] > area["y"]):
                blockers.append(int(handle))
            return True

        self.user.EnumWindows.argtypes = [callback_type, W.LPARAM]
        self.user.EnumWindows(callback_type(visit), 0)
        require(found and not blockers, "WINDOW_CAPTURE_UNTRUSTED", "The target is missing or an unrelated window overlaps its capture area.",
                details={"target_found": found, "overlapping_windows": len(blockers),
                         "blockers": [self._window_diagnostic(handle) for handle in blockers[:8]],
                         "blockers_truncated": len(blockers) > 8,
                         "recovery": "End the competing tool through its supported controls, then re-observe and capture. Do not ignore or force-close another tool's overlay."})

    def activity(self, window: dict | None, label: str, *, visible=True, trace=None):
        if visible:
            if self._overlay is None:
                from .windows_overlay import ActivityOverlay
                self._overlay = ActivityOverlay()
            self._overlay.update(window["bounds"] if window else None, label, trace)
        elif self._overlay:
            self._overlay.finish(label)

    def doctor(self) -> dict:
        interactive = bool(self.foreground())
        try:
            self._automation()
            ui = {"available": True, "backend": "windows_ui_automation"}
        except DeskPilotError as exc:
            ui = {"available": False, "error_code": exc.code}
        return {"interactive_desktop": interactive, "ui_automation": ui,
                "input": {"available": interactive, "backend": "SendInput"},
                "capture": {"available": interactive, "backend": "verified_foreground_gdi"},
                "virtual_screen": {"x": self.user.GetSystemMetrics(76), "y": self.user.GetSystemMetrics(77),
                                   "width": self.user.GetSystemMetrics(78), "height": self.user.GetSystemMetrics(79)}}

    def close(self):
        if self._overlay:
            self._overlay.close()
        self._uia = None
