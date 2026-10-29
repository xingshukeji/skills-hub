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
        self.dwm = C.WinDLL("dwmapi", use_last_error=True)
        self._uia = None
        self._uia_module = None
        self.tree_backend = None
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
            "GetWindowDisplayAffinity": (W.BOOL, [W.HWND, C.POINTER(W.DWORD)]),
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
        self.dwm.DwmGetWindowAttribute.restype = C.c_long
        self.dwm.DwmGetWindowAttribute.argtypes = [W.HWND, W.DWORD, C.c_void_p, W.DWORD]
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

    def process_path(self, pid: int) -> str:
        handle = self.kernel.OpenProcess(0x1000, False, pid)
        if not handle:
            return ""
        try:
            size = W.DWORD(32768)
            buffer = C.create_unicode_buffer(size.value)
            if self.kernel.QueryFullProcessImageNameW(handle, 0, buffer, C.byref(size)):
                return buffer.value
            return ""
        finally:
            self.kernel.CloseHandle(handle)

    def _process(self, pid: int) -> str:
        path = self.process_path(pid)
        return Path(path).stem if path else ""

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

    @staticmethod
    def _tree_item(element, level, parent):
        area = element.CurrentBoundingRectangle
        is_password = bool(element.CurrentIsPassword)
        return {"native": element, "name": "" if is_password else str(element.CurrentName or ""),
                "automation_id": str(element.CurrentAutomationId or ""),
                "control_type": int(element.CurrentControlType),
                "class_name": str(element.CurrentClassName or ""),
                "enabled": bool(element.CurrentIsEnabled), "offscreen": bool(element.CurrentIsOffscreen),
                "has_keyboard_focus": bool(element.CurrentHasKeyboardFocus),
                "is_password": is_password, "bounds": rectangle(area), "depth": level, "parent": parent}

    def find_exact_id(self, window: dict, *, identifier: str, limit: int, checkpoint):
        """Search the control-view subtree without fetching every unrelated node."""
        automation = self._automation()
        checkpoint()
        try:
            root = automation.ElementFromHandle(window["native"])
            condition = automation.CreatePropertyCondition(self._uia_module.UIA_AutomationIdPropertyId, identifier)
            matches = root.FindAll(7, condition)  # TreeScope_Subtree, including the root.
            nodes = []
            truncated = False
            for position in range(matches.Length):
                checkpoint()
                element = matches.GetElement(position)
                # The regular walker uses the control view, but always includes
                # the root. Query the ID first, then apply that view to matches.
                if not bool(element.CurrentIsControlElement) and not automation.CompareElements(root, element):
                    continue
                if len(nodes) >= limit:
                    truncated = True
                    break
                item = self._tree_item(element, None, None)
                require(item["automation_id"] == identifier, "UI_AUTOMATION_INCOMPLETE",
                        "A matching control changed while the search was in progress.")
                nodes.append(item)
            checkpoint()
        except DeskPilotError:
            raise
        except Exception as exc:
            raise DeskPilotError("UI_AUTOMATION_INCOMPLETE", f"The exact control search could not complete ({type(exc).__name__}).",
                                 retryable=True) from None
        self.tree_backend = "uia_control_view_exact_id"
        return nodes, truncated

    def find_tree(self, window: dict, *, depth: int, limit: int, checkpoint, filters: dict) -> list[dict]:
        return self.tree(window, depth=depth, limit=limit, checkpoint=checkpoint, filters=filters)

    def tree(self, window: dict, *, depth: int, limit: int, checkpoint, filters=None) -> list[dict]:
        automation = self._automation()
        root = automation.ElementFromHandle(window["native"])
        walker = automation.ControlViewWalker
        result = []

        def matches(element):
            # Search still visits the same bounded control tree in the same order.
            # Avoid fetching every property for nodes that cannot match.
            for key, attr in (("automation_id", "CurrentAutomationId"), ("class_name", "CurrentClassName")):
                if key in filters and str(getattr(element, attr) or "") != str(filters[key]):
                    return False
            if "control_type" in filters and int(element.CurrentControlType) != filters["control_type"]:
                return False
            for key, attr in (("enabled", "CurrentIsEnabled"), ("offscreen", "CurrentIsOffscreen")):
                if key in filters and bool(getattr(element, attr)) != bool(filters[key]):
                    return False
            if "name" in filters or "name_contains" in filters:
                name = "" if bool(element.CurrentIsPassword) else str(element.CurrentName or "")
                if "name" in filters and name != str(filters["name"]):
                    return False
                if "name_contains" in filters and str(filters["name_contains"]).casefold() not in name.casefold():
                    return False
            return True

        def append(element, level, parent):
            checkpoint()
            try:
                if filters and not matches(element):
                    # Preserve visited-node indices and the traversal limit, including
                    # ancestors of matching children, without publishing this node.
                    index = len(result)
                    result.append({"_filtered_out": True})
                    return index
                item = self._tree_item(element, level, parent)
            except Exception:
                return None
            index = len(result)
            result.append(item)
            return index

        def visit(element, level, parent):
            if not element or len(result) >= limit:
                return
            index = append(element, level, parent)
            if index is None:
                return
            if level >= depth:
                return
            child = walker.GetFirstChildElement(element)
            while child and len(result) < limit:
                visit(child, level + 1, index)
                checkpoint()
                child = walker.GetNextSiblingElement(child)

        self.tree_backend = "uia_control_view_walker"
        try:
            visit(root, 0, None)
        except DeskPilotError:
            raise
        except Exception as exc:
            hresult = exc.args[0] if exc.args and isinstance(exc.args[0], int) else None
            if hresult is not None and hresult & 0xffffffff == 0x80070057:
                # Some standard multiline Edit providers reject TreeWalker
                # traversal even though their raw children are accessible.
                # Rebuild from the raw tree, promoting non-control containers.
                result.clear()
                self.tree_backend = "uia_raw_tree_fallback"
                try:
                    condition = automation.CreateTrueCondition()
                    visited = 0

                    def visit_raw(element, level, parent, raw_depth=0, force=False):
                        nonlocal visited
                        if not element or len(result) >= limit:
                            return
                        checkpoint()
                        visited += 1
                        require(raw_depth <= 64 and visited <= min(50_000, max(1_000, limit * 50)),
                                "UI_AUTOMATION_INCOMPLETE", "The accessibility tree exceeded the bounded recovery search.")
                        control = force or bool(element.CurrentIsControlElement)
                        if control:
                            index = append(element, level, parent)
                            if index is None or level >= depth:
                                return
                            next_level, next_parent = level + 1, index
                        else:
                            next_level, next_parent = level, parent
                        children = element.FindAll(2, condition)  # TreeScope_Children, raw view
                        for position in range(children.Length):
                            if len(result) >= limit:
                                break
                            visit_raw(children.GetElement(position), next_level, next_parent, raw_depth + 1)

                    visit_raw(root, 0, None, force=True)
                    return result
                except DeskPilotError:
                    raise
                except Exception as fallback_error:
                    fallback_hresult = fallback_error.args[0] if fallback_error.args and isinstance(fallback_error.args[0], int) else None
                    details = {"hresult": f"0x{fallback_hresult & 0xffffffff:08X}"} if fallback_hresult is not None else None
                    raise DeskPilotError("UI_AUTOMATION_FAILED", "The accessibility tree could not be recovered from the raw view.",
                                         retryable=True, details=details) from None
            details = {"hresult": f"0x{hresult & 0xffffffff:08X}"} if hresult is not None else None
            suffix = f" {details['hresult']}" if details else ""
            raise DeskPilotError("UI_AUTOMATION_FAILED", f"The accessibility tree could not be read ({type(exc).__name__}{suffix}).",
                                 retryable=True, details=details) from None
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
            value_source = None
            if not is_password:
                try:
                    value = str(self._pattern(element, 10002, "IUIAutomationValuePattern").CurrentValue)
                    value_source = "uia_value"
                except DeskPilotError:
                    if int(element.CurrentControlType) in (50004, 50030) and bool(element.CurrentIsKeyboardFocusable):
                        try:
                            candidate = self._pattern(element, 10014, "IUIAutomationTextPattern").DocumentRange.GetText(1_000_001)
                            if isinstance(candidate, str) and len(candidate) <= 1_000_000:
                                value, value_source = candidate, "uia_text"
                        except Exception:
                            pass
            return {"name": "" if is_password else str(element.CurrentName or ""),
                    "bounds": rectangle(element.CurrentBoundingRectangle),
                    "enabled": bool(element.CurrentIsEnabled), "offscreen": bool(element.CurrentIsOffscreen),
                    "has_keyboard_focus": bool(element.CurrentHasKeyboardFocus),
                    "is_password": is_password, "value": value, "value_source": value_source}
        except Exception as exc:
            raise DeskPilotError("ELEMENT_UNAVAILABLE", f"The control no longer responds ({type(exc).__name__}).", retryable=True) from None

    def invoke(self, element):
        info = self.element_info(element)
        require(info["enabled"] and not info["offscreen"], "ELEMENT_NOT_ACTIONABLE", "The control is not enabled and visible.")
        self._pattern(element, 10000, "IUIAutomationInvokePattern").Invoke()

    def set_value(self, element, value: str, *, checkpoint=lambda: None, window=None, newline_strategy=None):
        info = self.element_info(element)
        require(not info["is_password"], "SENSITIVE_INPUT_BLOCKED", "Password controls must be handled by the user.")
        require(info["enabled"] and not info["offscreen"], "ELEMENT_NOT_ACTIONABLE", "The control is not enabled and visible.")
        try:
            pattern = self._pattern(element, 10002, "IUIAutomationValuePattern")
        except DeskPilotError as error:
            if error.code != "UI_PATTERN_UNAVAILABLE" or window is None:
                raise
            return self._replace_text_pattern(element, value, window, checkpoint=checkpoint,
                                              newline_strategy=newline_strategy)
        require(not pattern.CurrentIsReadOnly, "ELEMENT_READ_ONLY", "The control is read-only.")
        checkpoint()
        pattern.SetValue(value)
        # Chromium can acknowledge SetValue before its renderer/AX tree updates.
        # Dispatch exactly once; only poll reads, including the caller's cancel/budget.
        return self._confirm_value(element, value, lambda: str(pattern.CurrentValue), "uia_value", checkpoint)

    def _confirm_value(self, element, value, read, method, checkpoint):
        started = time.monotonic()
        deadline = started + 0.75
        matched_at = None
        reads = 0
        while True:
            checkpoint()
            # A control can change to a password field while the renderer updates.
            require(not element.CurrentIsPassword, "SENSITIVE_INPUT_BLOCKED",
                    "The control became sensitive during verification; ask the user to inspect it.", outcome="unknown")
            current = read()
            reads += 1
            now = time.monotonic()
            # Native multiline keyboard input may represent LF as CRLF.
            # Preserve exact ValuePattern comparison for existing consumers.
            matches = current == value
            if method == "uia_text_keyboard":
                normalize = lambda text: text.replace("\r\n", "\n").replace("\r", "\n")
                matches = normalize(current) == normalize(value)
            if matches:
                if matched_at is not None and now - matched_at >= 0.025:
                    return {"method": method, "matched": True, "read_attempts": reads,
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

    def _replace_text_pattern(self, element, value, window, *, checkpoint, newline_strategy=None):
        require(int(element.CurrentControlType) in (50004, 50030) and bool(element.CurrentIsKeyboardFocusable),
                "UI_PATTERN_UNAVAILABLE", "The control does not expose a supported editable text surface.")
        require(len(value) <= 1_000_000, "INVALID_ARGUMENT", "The text is too large for one input request.")
        require(not any(char in value for char in "\r\n") or newline_strategy in ("unicode", "enter", "shift_enter"),
                "TEXT_INPUT_STRATEGY_REQUIRED", "The text-only control needs an explicit, verified newline input strategy before typing.")
        pattern = self._pattern(element, 10014, "IUIAutomationTextPattern")
        try:
            readonly = pattern.DocumentRange.GetAttributeValue(40015)  # UIA_IsReadOnlyAttributeId
        except Exception:
            raise DeskPilotError("UI_PATTERN_UNAVAILABLE", "The text control did not expose its editability.") from None
        require(type(readonly) in (bool, int) and readonly == 0, "ELEMENT_READ_ONLY",
                "The text control is read-only or its editability is unknown.")

        def guard(dispatched=False):
            checkpoint()
            outcome = "unknown" if dispatched else "not_dispatched"
            require(self.related(window["native"], self.foreground()), "WINDOW_NOT_FOREGROUND",
                    "The target window lost foreground during text input.", outcome=outcome)
            require(not element.CurrentIsPassword, "SENSITIVE_INPUT_BLOCKED",
                    "The control became sensitive during text input.", outcome=outcome)
            require(bool(element.CurrentHasKeyboardFocus), "FOCUS_NOT_CONFIRMED",
                    "The requested control did not retain keyboard focus.", outcome=outcome)

        checkpoint()
        try:
            element.SetFocus()
        except Exception:
            raise DeskPilotError("FOCUS_NOT_CONFIRMED", "The text control could not receive keyboard focus.") from None
        for attempt in range(10):
            checkpoint()
            if bool(element.CurrentHasKeyboardFocus):
                break
            if attempt < 9:
                time.sleep(0.025)
        guard()
        # This branch is entered only before a ValuePattern write was attempted.
        # Once any keyboard event is sent, all failures remain outcome=unknown.
        self.key(["CTRL", "A"])
        guard(dispatched=True)
        if value:
            if newline_strategy in ("enter", "shift_enter") and any(char in value for char in "\r\n"):
                lines = value.replace("\r\n", "\n").replace("\r", "\n").split("\n")
                for index, line in enumerate(lines):
                    if index:
                        guard(dispatched=True)
                        self.key(["SHIFT", "ENTER"] if newline_strategy == "shift_enter" else ["ENTER"])
                    if line:
                        self.type_text(line, lambda: guard(dispatched=True))
            else:
                self.type_text(value, lambda: guard(dispatched=True))
        else:
            self.key(["DELETE"])
        guard(dispatched=True)

        def read():
            result = pattern.DocumentRange.GetText(1_000_001)
            require(isinstance(result, str) and len(result) <= 1_000_000, "VALUE_NOT_VERIFIED",
                    "The text control did not expose a bounded value.", outcome="unknown")
            return result

        return self._confirm_value(element, value, read, "uia_text_keyboard", checkpoint)

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

    def _point_owned(self, window, point, *, target_content_only=False):
        if target_content_only:
            # WindowFromPoint intentionally skips click-through layered windows.
            # A target-only capture does not show them, so also check every
            # visible top-level window above the target at the requested point.
            # Only our own indicator may be hidden for this check.
            if self._overlay:
                self._overlay.hide()
            try:
                state = {"found": False, "blocked": False}
                callback_type = C.WINFUNCTYPE(W.BOOL, W.HWND, W.LPARAM)

                def visit(handle, _):
                    if handle == window["native"]:
                        state["found"] = True
                        return False
                    if not self.user.IsWindowVisible(handle) or self.user.IsIconic(handle):
                        return True
                    area = RECT()
                    if not self.user.GetWindowRect(handle, C.byref(area)):
                        state["blocked"] = True
                        return False
                    if area.left <= point.x < area.right and area.top <= point.y < area.bottom:
                        state["blocked"] = True
                        return False
                    return True

                self.user.EnumWindows.argtypes = [callback_type, W.LPARAM]
                self.user.EnumWindows(callback_type(visit), 0)
                require(state["found"] and not state["blocked"], "POINT_OCCLUDED",
                        "The requested point is covered by a window not shown in the observation, or its ownership could not be verified.")
                hit = self.user.WindowFromPoint(point)
                owned = hit == window["native"] or self.user.IsChild(window["native"], hit)
            finally:
                if self._overlay:
                    self._overlay.resume()
        else:
            owned = self.related(window["native"], self.user.WindowFromPoint(point))
        require(owned, "POINT_OCCLUDED", "The requested point is covered by a window not shown in the observation.")

    def click(self, window: dict, x: int, y: int, *, button="left", count=1, target_content_only=False):
        require(self.related(window["native"], self.foreground()), "WINDOW_NOT_FOREGROUND", "The requested window is not in the foreground.")
        original = POINT()
        self.user.GetCursorPos(C.byref(original))
        location = POINT(window["bounds"]["x"] + x, window["bounds"]["y"] + y)
        self._point_owned(window, location, target_content_only=target_content_only)
        self.user.SetCursorPos(location.x, location.y)
        try:
            down, up = {"left": (2, 4), "right": (8, 16), "middle": (32, 64)}[button]
            for index in range(count):
                self._send([INPUT(type=0, mi=MOUSEINPUT(dwFlags=down)), INPUT(type=0, mi=MOUSEINPUT(dwFlags=up))])
                if index + 1 < count:
                    time.sleep(0.04)
            # A native host may resolve a queued click against the current
            # pointer location after SendInput returns.
            time.sleep(0.1)
        finally:
            current = POINT()
            if self.user.GetCursorPos(C.byref(current)) and current.x == location.x and current.y == location.y:
                self.user.SetCursorPos(original.x, original.y)

    def type_text(self, text: str, checkpoint):
        require(not self.sensitive_focused(), "SENSITIVE_INPUT_BLOCKED", "Password controls must be handled by the user.")
        self._type_unicode(text, checkpoint)

    def _type_unicode(self, text: str, checkpoint):
        units = text.encode("utf-16-le")
        for index in range(0, len(units), 128):
            checkpoint()
            events = []
            for offset in range(index, min(index + 128, len(units)), 2):
                unit = int.from_bytes(units[offset:offset + 2], "little")
                events.extend([INPUT(type=1, ki=KEYBDINPUT(wScan=unit, dwFlags=4)),
                               INPUT(type=1, ki=KEYBDINPUT(wScan=unit, dwFlags=6))])
            self._send(events)

    def type_secret(self, text, checkpoint, *, window, target_kind):
        def guard():
            checkpoint()
            require(window["native"] == self.foreground(), "WINDOW_NOT_FOREGROUND",
                    "The target itself lost foreground during sensitive input.", outcome="unknown")
            if target_kind == "native_password":
                try:
                    focused = self._automation().GetFocusedElement()
                    valid = (bool(focused.CurrentIsPassword) and bool(focused.CurrentIsEnabled)
                             and not bool(focused.CurrentIsOffscreen) and int(focused.CurrentProcessId) == window["pid"])
                except Exception:
                    valid = False
                require(valid, "SENSITIVE_FOCUS_NOT_CONFIRMED",
                        "The focused native password control could not be confirmed.", outcome="unknown")
        guard()
        self._type_unicode(text, guard)

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

    def scroll(self, window: dict, x: int, y: int, amount: int, horizontal=False, *, target_content_only=False):
        require(self.related(window["native"], self.foreground()), "WINDOW_NOT_FOREGROUND", "The requested window is not in the foreground.")
        original = POINT()
        self.user.GetCursorPos(C.byref(original))
        point = POINT(window["bounds"]["x"] + x, window["bounds"]["y"] + y)
        self._point_owned(window, point, target_content_only=target_content_only)
        self.user.SetCursorPos(point.x, point.y)
        try:
            self._send([INPUT(type=0, mi=MOUSEINPUT(mouseData=W.DWORD(amount).value, dwFlags=0x1000 if horizontal else 0x0800))])
            # Some native hosts consume the wheel asynchronously and resolve it
            # using the current cursor position, not the position at SendInput.
            # Keep the pointer at the selected target briefly; callers still
            # need to observe whether the application actually scrolled.
            time.sleep(0.1)
        finally:
            current = POINT()
            if self.user.GetCursorPos(C.byref(current)) and current.x == point.x and current.y == point.y:
                self.user.SetCursorPos(original.x, original.y)

    def capture(self, window: dict, *, checkpoint=lambda: None):
        checkpoint()
        try:
            return self._capture_screen(window)
        except DeskPilotError as screen_error:
            # A screen copy must still reject every overlapping window. An
            # independently captured HWND frame can safely show the target's
            # own pixels, but does not show the covering window or popups.
            details = screen_error.details
            if not (screen_error.code == "WINDOW_CAPTURE_UNTRUSTED" and details.get("target_found")
                    and details.get("overlapping_windows", 0) > 0):
                raise
            checkpoint()
            if self._overlay:
                self._overlay.hide()
            try:
                return self._capture_window_frame(window, checkpoint=checkpoint, initial_overlap=details)
            except DeskPilotError as frame_error:
                if frame_error.code in {"CANCELLED", "TIMEOUT"}:
                    raise
                screen_error.details["window_capture"] = {"code": frame_error.code, "message": str(frame_error)}
                raise screen_error from None
            finally:
                if self._overlay:
                    self._overlay.resume()

    def _frame_bounds(self, window):
        area = RECT()
        status = self.dwm.DwmGetWindowAttribute(window["native"], 9, C.byref(area), C.sizeof(area))
        require(status == 0, "WINDOW_CAPTURE_BACKEND_UNAVAILABLE", "Windows did not expose the target frame geometry.")
        return rectangle(area)

    def _capture_allowed(self, window):
        affinity = W.DWORD()
        require(bool(self.user.GetWindowDisplayAffinity(window["native"], C.byref(affinity))),
                "WINDOW_CAPTURE_BACKEND_UNAVAILABLE", "The target's capture protection could not be checked.")
        require(affinity.value == 0, "WINDOW_CAPTURE_PROTECTED", "The target has a system capture protection setting.")

    def _capture_window_frame(self, window, *, checkpoint, initial_overlap):
        from .windows_capture import capture_window

        before = self.window(window["native"])
        require(before["identity"] == window["identity"] and before["bounds"] == window["bounds"]
                and before["title"] == window["title"] and before["visible"] and not before["minimized"]
                and self.related(before["native"], self.foreground()),
                "WINDOW_CAPTURE_UNTRUSTED", "The target changed or is no longer foreground.")
        self._capture_allowed(before)
        frame_bounds = self._frame_bounds(before)
        checkpoint()
        image = capture_window(before["native"], checkpoint=checkpoint)
        after = self.window(window["native"])
        require(after["identity"] == before["identity"] and after["bounds"] == before["bounds"]
                and after["title"] == before["title"] and after["visible"] and not after["minimized"]
                and self.related(after["native"], self.foreground()),
                "WINDOW_CAPTURE_UNTRUSTED", "The target changed during window capture.")
        self._capture_allowed(after)
        require(self._frame_bounds(after) == frame_bounds and image.width == frame_bounds["width"]
                and image.height == frame_bounds["height"],
                "WINDOW_CAPTURE_UNTRUSTED", "The window frame geometry changed or could not be mapped to its pixels.")
        try:
            overlap = self._capture_ownership(after)
        except DeskPilotError as error:
            require(error.code == "WINDOW_CAPTURE_UNTRUSTED" and error.details.get("target_found"),
                    "WINDOW_CAPTURE_UNTRUSTED", "The target's screen position could not be confirmed.")
            overlap = error.details
        return image, {"trusted": True, "capture_layer": "windows_graphics_capture",
                       "capture_scope": "target_window_only", "foreground_relation": "target_or_owned_window",
                       "origin": {"x": frame_bounds["x"], "y": frame_bounds["y"]},
                       "separate_popup_windows_included": False,
                       "overlapping_windows": overlap.get("overlapping_windows", 0),
                       "blockers": overlap.get("blockers", []),
                       "blockers_truncated": overlap.get("blockers_truncated", False),
                       "separate_owned_windows": overlap.get("separate_owned_windows", []),
                       "separate_owned_windows_truncated": overlap.get("separate_owned_windows_truncated", False),
                       "overlap_observed_before_capture": initial_overlap.get("overlapping_windows", 0)}

    def _capture_screen(self, window: dict):
        from ..screen import Image
        live = self.window(window["native"])
        require(live["identity"] == window["identity"] and live["bounds"] == window["bounds"],
                "WINDOW_IDENTITY_MISMATCH", "The window changed before capture.")
        require(self.related(window["native"], self.foreground()), "WINDOW_CAPTURE_UNTRUSTED", "Foreground ownership could not be established.",
                details={"target": self._window_diagnostic(window["native"]), "foreground": self._window_diagnostic(self.foreground())})
        area = live["bounds"]
        require(not live["minimized"], "WINDOW_CAPTURE_UNTRUSTED", "The window is minimized.")
        self._capture_allowed(live)
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
            self._capture_allowed(after)
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
        owned = []
        found = False
        area = window["bounds"]
        callback_type = C.WINFUNCTYPE(W.BOOL, W.HWND, W.LPARAM)

        def visit(handle, _):
            nonlocal found
            if handle == window["native"]:
                found = True
                return False
            if not self.user.IsWindowVisible(handle) or self.user.IsIconic(handle):
                return True
            if self.related(window["native"], handle):
                owned.append(int(handle))
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
        details = {"target_found": found, "overlapping_windows": len(blockers),
                   "blockers": [self._window_diagnostic(handle) for handle in blockers[:8]],
                   "blockers_truncated": len(blockers) > 8,
                   "separate_owned_windows": [self._window_diagnostic(handle) for handle in owned[:8]],
                   "separate_owned_windows_truncated": len(owned) > 8,
                   "recovery": "End the competing tool through its supported controls, then re-observe and capture. Do not ignore or force-close another tool's overlay."}
        require(found and not blockers, "WINDOW_CAPTURE_UNTRUSTED", "The target is missing or an unrelated window overlaps its capture area.", details=details)
        return details

    def activity(self, window: dict | None, label: str, *, visible=True, trace=None):
        if visible:
            if self._overlay is None:
                from .windows_overlay import ActivityOverlay
                self._overlay = ActivityOverlay()
            self._overlay.update(window["bounds"] if window else None, label, trace)
        elif self._overlay:
            self._overlay.finish(label)

    def activity_done(self):
        overlay = getattr(self, "_overlay", None)
        if overlay:
            overlay.finish("Ready")

    def doctor(self) -> dict:
        interactive = bool(self.foreground())
        try:
            self._automation()
            ui = {"available": True, "backend": "windows_ui_automation"}
        except DeskPilotError as exc:
            ui = {"available": False, "error_code": exc.code}
        return {"interactive_desktop": interactive, "ui_automation": ui,
                "input": {"available": interactive, "backend": "SendInput"},
                "capture": {"available": interactive, "backend": "verified_foreground_gdi",
                            "window_capture_fallback": {
                                "backend": "windows_graphics_capture",
                                "bundled": (resource_root() / "vendor" / "windows-x64" / "python" /
                                            "deskpilot_wgc" / "windows_capture.pyd").is_file(),
                                "availability": "verified_at_capture"}},
                "virtual_screen": {"x": self.user.GetSystemMetrics(76), "y": self.user.GetSystemMetrics(77),
                                   "width": self.user.GetSystemMetrics(78), "height": self.user.GetSystemMetrics(79)}}

    def close(self):
        if self._overlay:
            self._overlay.close()
        self._uia = None
