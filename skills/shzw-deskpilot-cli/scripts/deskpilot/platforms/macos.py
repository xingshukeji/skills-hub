"""macOS Accessibility and Quartz operations, with no PyObjC dependency."""

from __future__ import annotations

import ctypes as C
import os
from pathlib import Path
import subprocess
import tempfile
import time

from .. import DeskPilotError, require


class Point(C.Structure):
    _fields_ = [("x", C.c_double), ("y", C.c_double)]


class Size(C.Structure):
    _fields_ = [("width", C.c_double), ("height", C.c_double)]


class Rect(C.Structure):
    _fields_ = [("origin", Point), ("size", Size)]


class ObjC:
    def __init__(self):
        self.library = C.CDLL("/usr/lib/libobjc.A.dylib")
        self.library.objc_getClass.argtypes = [C.c_char_p]
        self.library.objc_getClass.restype = C.c_void_p
        self.library.sel_registerName.argtypes = [C.c_char_p]
        self.library.sel_registerName.restype = C.c_void_p
        self._functions = {}

    def cls(self, name):
        return self.library.objc_getClass(name.encode("ascii"))

    def send(self, receiver, name, restype=C.c_void_p, types=(), args=()):
        key = (restype, types)
        if key not in self._functions:
            self._functions[key] = C.CFUNCTYPE(restype, C.c_void_p, C.c_void_p, *types)(
                C.cast(self.library.objc_msgSend, C.c_void_p).value)
        return self._functions[key](receiver, self.library.sel_registerName(name.encode("ascii")), *args)


class AXRef:
    def __init__(self, api, pointer, *, retain=False):
        self.api, self.pointer = api, pointer
        if retain and pointer:
            api.cf.CFRetain(pointer)

    def __del__(self):
        if self.pointer:
            self.api.cf.CFRelease(self.pointer)
            self.pointer = None


ROLES = {"AXButton": 50000, "AXCheckBox": 50002, "AXComboBox": 50003, "AXTextField": 50004,
         "AXTextArea": 50004, "AXLink": 50005, "AXImage": 50006, "AXRow": 50029,
         "AXList": 50008, "AXMenu": 50009, "AXMenuBar": 50010, "AXMenuItem": 50011,
         "AXProgressIndicator": 50012, "AXRadioButton": 50013, "AXScrollBar": 50014,
         "AXSlider": 50015, "AXTabGroup": 50018, "AXStaticText": 50020, "AXToolbar": 50021,
         "AXOutline": 50023, "AXGroup": 50026, "AXTable": 50036, "AXWebArea": 50030,
         "AXWindow": 50032, "AXScrollArea": 50033, "AXPopUpButton": 50003}


class MacDesktop:
    name = "macos"

    def __init__(self):
        self.cf = C.CDLL("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation")
        self.ax = C.CDLL("/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices")
        self.cg = C.CDLL("/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics")
        self.appkit = C.CDLL("/System/Library/Frameworks/AppKit.framework/AppKit")
        self.objc = ObjC()
        self._pool = self.objc.send(self.objc.send(self.objc.cls("NSAutoreleasePool"), "alloc"), "init")
        self._overlay = None
        self._configure()

    def _configure(self):
        signatures = {
            "CFRetain": (C.c_void_p, [C.c_void_p]), "CFRelease": (None, [C.c_void_p]),
            "CFGetTypeID": (C.c_ulong, [C.c_void_p]),
            "CFStringCreateWithCString": (C.c_void_p, [C.c_void_p, C.c_char_p, C.c_uint32]),
            "CFStringGetLength": (C.c_long, [C.c_void_p]),
            "CFStringGetMaximumSizeForEncoding": (C.c_long, [C.c_long, C.c_uint32]),
            "CFStringGetCString": (C.c_bool, [C.c_void_p, C.c_char_p, C.c_long, C.c_uint32]),
            "CFArrayGetCount": (C.c_long, [C.c_void_p]),
            "CFArrayGetValueAtIndex": (C.c_void_p, [C.c_void_p, C.c_long]),
            "CFDictionaryGetValue": (C.c_void_p, [C.c_void_p, C.c_void_p]),
            "CFNumberGetValue": (C.c_bool, [C.c_void_p, C.c_int, C.c_void_p]),
            "CFBooleanGetValue": (C.c_bool, [C.c_void_p]),
        }
        for name, (result, arguments) in signatures.items():
            function = getattr(self.cf, name)
            function.restype, function.argtypes = result, arguments
        for name in ("CFStringGetTypeID", "CFNumberGetTypeID", "CFBooleanGetTypeID", "CFArrayGetTypeID"):
            getattr(self.cf, name).restype = C.c_ulong
        for name, result, arguments in [
            ("AXIsProcessTrusted", C.c_bool, []),
            ("AXUIElementCreateApplication", C.c_void_p, [C.c_int]),
            ("AXUIElementCreateSystemWide", C.c_void_p, []),
            ("AXUIElementCopyAttributeValue", C.c_int, [C.c_void_p, C.c_void_p, C.POINTER(C.c_void_p)]),
            ("AXUIElementSetAttributeValue", C.c_int, [C.c_void_p, C.c_void_p, C.c_void_p]),
            ("AXUIElementIsAttributeSettable", C.c_int, [C.c_void_p, C.c_void_p, C.POINTER(C.c_bool)]),
            ("AXUIElementPerformAction", C.c_int, [C.c_void_p, C.c_void_p]),
            ("AXUIElementSetMessagingTimeout", C.c_int, [C.c_void_p, C.c_float]),
            ("AXValueGetValue", C.c_bool, [C.c_void_p, C.c_int, C.c_void_p]),
        ]:
            function = getattr(self.ax, name)
            function.restype, function.argtypes = result, arguments
        for name, result, arguments in [
            ("CGWindowListCopyWindowInfo", C.c_void_p, [C.c_uint32, C.c_uint32]),
            ("CGRectMakeWithDictionaryRepresentation", C.c_bool, [C.c_void_p, C.POINTER(Rect)]),
            ("CGPreflightScreenCaptureAccess", C.c_bool, []),
            ("CGPreflightPostEventAccess", C.c_bool, []),
            ("CGEventCreate", C.c_void_p, [C.c_void_p]), ("CGEventGetLocation", Point, [C.c_void_p]),
            ("CGEventCreateMouseEvent", C.c_void_p, [C.c_void_p, C.c_uint32, Point, C.c_uint32]),
            ("CGEventCreateKeyboardEvent", C.c_void_p, [C.c_void_p, C.c_uint16, C.c_bool]),
            ("CGEventKeyboardSetUnicodeString", None, [C.c_void_p, C.c_ulong, C.POINTER(C.c_uint16)]),
            ("CGEventSetFlags", None, [C.c_void_p, C.c_uint64]),
            ("CGEventSetIntegerValueField", None, [C.c_void_p, C.c_uint32, C.c_int64]),
            ("CGEventPost", None, [C.c_uint32, C.c_void_p]),
            ("CGEventCreateScrollWheelEvent", C.c_void_p, [C.c_void_p, C.c_uint32, C.c_uint32, C.c_int32, C.c_int32]),
        ]:
            function = getattr(self.cg, name)
            function.restype, function.argtypes = result, arguments

    def string(self, value):
        return self.cf.CFStringCreateWithCString(None, str(value).encode("utf-8"), 0x08000100)

    def _value(self, pointer):
        if not pointer:
            return None
        kind = self.cf.CFGetTypeID(pointer)
        if kind == self.cf.CFStringGetTypeID():
            size = self.cf.CFStringGetMaximumSizeForEncoding(self.cf.CFStringGetLength(pointer), 0x08000100) + 1
            buffer = C.create_string_buffer(size)
            if self.cf.CFStringGetCString(pointer, buffer, size, 0x08000100):
                return buffer.value.decode("utf-8")
        elif kind == self.cf.CFNumberGetTypeID():
            number = C.c_double()
            self.cf.CFNumberGetValue(pointer, 13, C.byref(number))
            return number.value
        elif kind == self.cf.CFBooleanGetTypeID():
            return bool(self.cf.CFBooleanGetValue(pointer))
        return None

    def _dictionary(self, pointer, key):
        name = self.string(key)
        try:
            return self.cf.CFDictionaryGetValue(pointer, name)
        finally:
            self.cf.CFRelease(name)

    def _copy(self, element, attribute):
        element = element.pointer if isinstance(element, AXRef) else element
        name, value = self.string(attribute), C.c_void_p()
        try:
            status = self.ax.AXUIElementCopyAttributeValue(element, name, C.byref(value))
        finally:
            self.cf.CFRelease(name)
        return value.value if status == 0 else None

    def _read(self, element, attribute, default=None):
        value = self._copy(element, attribute)
        if not value:
            return default
        try:
            converted = self._value(value)
            return default if converted is None else converted
        finally:
            self.cf.CFRelease(value)

    def _children(self, element, attribute="AXChildren"):
        value = self._copy(element, attribute)
        if not value:
            return []
        try:
            if self.cf.CFGetTypeID(value) != self.cf.CFArrayGetTypeID():
                return []
            return [AXRef(self, self.cf.CFArrayGetValueAtIndex(value, index), retain=True)
                    for index in range(self.cf.CFArrayGetCount(value))]
        finally:
            self.cf.CFRelease(value)

    def _bounds(self, element):
        position, size = self._copy(element, "AXPosition"), self._copy(element, "AXSize")
        point, dimensions = Point(), Size()
        try:
            if not position or not size or not self.ax.AXValueGetValue(position, 1, C.byref(point)) or not self.ax.AXValueGetValue(size, 2, C.byref(dimensions)):
                return {"x": 0, "y": 0, "width": 0, "height": 0}
            return {"x": round(point.x), "y": round(point.y), "width": round(dimensions.width), "height": round(dimensions.height)}
        finally:
            if position:
                self.cf.CFRelease(position)
            if size:
                self.cf.CFRelease(size)

    def _trusted(self):
        require(bool(self.ax.AXIsProcessTrusted()), "ACCESSIBILITY_PERMISSION_REQUIRED", "Grant macOS Accessibility access to the calling Python/client application.")

    def windows(self):
        array = self.cg.CGWindowListCopyWindowInfo(0, 0)
        require(bool(array), "DESKTOP_UNAVAILABLE", "The macOS window server is unavailable.")
        result = []
        try:
            for index in range(self.cf.CFArrayGetCount(array)):
                item = self.cf.CFArrayGetValueAtIndex(array, index)
                layer = self._value(self._dictionary(item, "kCGWindowLayer"))
                pid = int(self._value(self._dictionary(item, "kCGWindowOwnerPID")) or 0)
                if layer != 0 or pid == os.getpid():
                    continue
                number = int(self._value(self._dictionary(item, "kCGWindowNumber")) or 0)
                area = Rect()
                native_bounds = self._dictionary(item, "kCGWindowBounds")
                if not native_bounds or not self.cg.CGRectMakeWithDictionaryRepresentation(native_bounds, C.byref(area)):
                    continue
                bounds = {"x": round(area.origin.x), "y": round(area.origin.y), "width": round(area.size.width), "height": round(area.size.height)}
                if bounds["width"] <= 0 or bounds["height"] <= 0:
                    continue
                visible = bool(self._value(self._dictionary(item, "kCGWindowIsOnscreen")))
                result.append({"native": number, "identity": (number, pid), "pid": pid,
                               "title": self._value(self._dictionary(item, "kCGWindowName")) or "",
                               "process": self._value(self._dictionary(item, "kCGWindowOwnerName")) or "",
                               "class_name": "AXWindow", "bounds": bounds, "visible": visible, "minimized": not visible})
        finally:
            self.cf.CFRelease(array)
        return result

    def window(self, native):
        matches = [item for item in self.windows() if item["native"] == native]
        require(len(matches) == 1, "WINDOW_NOT_FOUND", "The macOS window no longer exists.")
        return matches[0]

    def foreground(self):
        return next((item["native"] for item in self.windows() if item["visible"]), None)

    def _window_ax(self, window):
        self._trusted()
        app = AXRef(self, self.ax.AXUIElementCreateApplication(window["pid"]))
        self.ax.AXUIElementSetMessagingTimeout(app.pointer, 2)
        matches = []
        for candidate in self._children(app, "AXWindows"):
            number = self._read(candidate, "AXWindowNumber")
            if number is not None and int(number) == window["native"]:
                return candidate
            area = self._bounds(candidate)
            same_bounds = all(abs(area[key] - window["bounds"][key]) <= 2 for key in area)
            title = self._read(candidate, "AXTitle", "")
            if same_bounds and (not window["title"] or title == window["title"]):
                matches.append(candidate)
        require(len(matches) == 1, "WINDOW_IDENTITY_MISMATCH", "The window-server ID could not be uniquely bound to an accessibility window.")
        return matches[0]

    def _action(self, element, action):
        name = self.string(action)
        try:
            status = self.ax.AXUIElementPerformAction(element.pointer, name)
        finally:
            self.cf.CFRelease(name)
        require(status == 0, "UI_PATTERN_UNAVAILABLE", "The application did not perform the requested accessibility action.",
                details={"ax_error": status}, outcome="unknown")

    def activate(self, window, *, checkpoint=lambda: None):
        ax_window = self._window_ax(window)
        app = self.objc.send(self.objc.cls("NSRunningApplication"), "runningApplicationWithProcessIdentifier:",
                             types=(C.c_int,), args=(window["pid"],))
        require(bool(app), "WINDOW_NOT_FOUND", "The owning application is no longer running.")
        self.objc.send(app, "activateWithOptions:", C.c_bool, (C.c_ulong,), (2,))
        if window["minimized"]:
            name = self.string("AXMinimized")
            try:
                false = C.c_void_p.in_dll(self.cf, "kCFBooleanFalse").value
                self.ax.AXUIElementSetAttributeValue(ax_window.pointer, name, false)
            finally:
                self.cf.CFRelease(name)
        self._action(ax_window, "AXRaise")
        for _ in range(20):
            if self.foreground() == window["native"]:
                return self.window(window["native"])
            time.sleep(0.025)
        raise DeskPilotError("WINDOW_ACTIVATION_FAILED", "The requested macOS window did not become foreground.", retryable=True)

    def restore(self, native):
        try:
            self.activate(self.window(native))
            return True
        except DeskPilotError:
            return False

    def tree(self, window, *, depth, limit, checkpoint):
        root = self._window_ax(window)
        result = []

        def visit(element, level, parent):
            checkpoint()
            if len(result) >= limit:
                return
            info = self.element_info(element)
            role = self._read(element, "AXRole", "")
            index = len(result)
            result.append({"native": element, **info, "control_type": ROLES.get(role, 50025),
                           "automation_id": self._read(element, "AXIdentifier", ""), "class_name": role,
                           "depth": level, "parent": parent})
            if level < depth:
                for child in self._children(element):
                    if len(result) >= limit:
                        break
                    visit(child, level + 1, index)

        visit(root, 0, None)
        return result

    def element_info(self, element):
        self._trusted()
        role, subrole = self._read(element, "AXRole", ""), self._read(element, "AXSubrole", "")
        secure = role == "AXSecureTextField" or subrole == "AXSecureTextField" or bool(self._read(element, "AXProtectedContent", False))
        area = self._bounds(element)
        return {"name": "" if secure else self._read(element, "AXTitle", self._read(element, "AXDescription", "")),
                "value": None if secure else self._read(element, "AXValue"), "is_password": secure,
                "enabled": bool(self._read(element, "AXEnabled", True)),
                "offscreen": not area["width"] or not area["height"], "bounds": area}

    def invoke(self, element):
        info = self.element_info(element)
        require(info["enabled"] and not info["offscreen"], "ELEMENT_NOT_ACTIONABLE", "The control is not enabled and visible.")
        self._action(element, "AXPress")

    def set_value(self, element, value, *, checkpoint=lambda: None, window=None, newline_strategy=None):
        info = self.element_info(element)
        require(not info["is_password"], "SENSITIVE_INPUT_BLOCKED", "Password controls must be handled by the user.")
        name, string, settable = self.string("AXValue"), self.string(value), C.c_bool()
        try:
            status = self.ax.AXUIElementIsAttributeSettable(element.pointer, name, C.byref(settable))
            require(status == 0 and settable.value, "ELEMENT_READ_ONLY", "The application does not expose a writable control value.")
            status = self.ax.AXUIElementSetAttributeValue(element.pointer, name, string)
            require(status == 0, "UI_ACTION_FAILED", "The application did not acknowledge the requested value.", outcome="unknown")
        finally:
            self.cf.CFRelease(name)
            self.cf.CFRelease(string)
        require(self._read(element, "AXValue") == value, "VALUE_NOT_VERIFIED", "The control value could not be verified.", outcome="unknown")

    def select(self, element, value=None, *, checkpoint=lambda: None):
        if value is not None:
            self.set_value(element, str(value), checkpoint=checkpoint)
        else:
            self.invoke(element)

    def sensitive_focused(self):
        root = AXRef(self, self.ax.AXUIElementCreateSystemWide())
        focused = self._copy(root, "AXFocusedUIElement")
        return bool(focused and self.element_info(AXRef(self, focused))["is_password"])

    def _input_access(self):
        self._trusted()
        require(bool(self.cg.CGPreflightPostEventAccess()), "INPUT_PERMISSION_REQUIRED", "macOS has not granted event-posting access to this client.")

    def _post(self, event):
        require(bool(event), "INPUT_NOT_DELIVERED", "Quartz could not create an input event.")
        try:
            self.cg.CGEventPost(0, event)
        finally:
            self.cf.CFRelease(event)

    def _pointer(self):
        event = self.cg.CGEventCreate(None)
        require(bool(event), "INPUT_UNAVAILABLE", "The current pointer location is unavailable.")
        try:
            return self.cg.CGEventGetLocation(event)
        finally:
            self.cf.CFRelease(event)

    def click(self, window, x, y, *, button="left", count=1, target_content_only=False):
        self._input_access()
        require(self.foreground() == window["native"], "WINDOW_NOT_FOREGROUND", "The requested window is not foreground.")
        point, original = Point(window["bounds"]["x"] + x, window["bounds"]["y"] + y), self._pointer()
        code, down, up = {"left": (0, 1, 2), "right": (1, 3, 4), "middle": (2, 25, 26)}[button]
        try:
            self._post(self.cg.CGEventCreateMouseEvent(None, 5, point, code))
            for index in range(count):
                for kind in (down, up):
                    event = self.cg.CGEventCreateMouseEvent(None, kind, point, code)
                    self.cg.CGEventSetIntegerValueField(event, 1, index + 1)
                    self._post(event)
        finally:
            self._post(self.cg.CGEventCreateMouseEvent(None, 5, original, 0))

    def type_text(self, text, checkpoint):
        self._input_access()
        require(not self.sensitive_focused(), "SENSITIVE_INPUT_BLOCKED", "Password controls must be handled by the user.")
        encoded = text.encode("utf-16-le")
        for offset in range(0, len(encoded), 40):
            checkpoint()
            segment = encoded[offset:offset + 40]
            data = (C.c_uint16 * (len(segment) // 2)).from_buffer_copy(segment)
            for down in (True, False):
                event = self.cg.CGEventCreateKeyboardEvent(None, 0, down)
                self.cg.CGEventKeyboardSetUnicodeString(event, len(data), data)
                self._post(event)

    def key(self, keys):
        self._input_access()
        mapping = {"A": 0, "S": 1, "D": 2, "F": 3, "H": 4, "G": 5, "Z": 6, "X": 7, "C": 8, "V": 9,
                   "B": 11, "Q": 12, "W": 13, "E": 14, "R": 15, "Y": 16, "T": 17, "1": 18, "2": 19,
                   "3": 20, "4": 21, "6": 22, "5": 23, "9": 25, "7": 26, "8": 28, "0": 29,
                   "O": 31, "U": 32, "I": 34, "P": 35, "L": 37, "J": 38, "K": 40, "N": 45, "M": 46,
                   "ENTER": 36, "RETURN": 36, "TAB": 48, "SPACE": 49, "BACKSPACE": 51, "ESC": 53, "ESCAPE": 53,
                   "META": 55, "CMD": 55, "COMMAND": 55, "MOD": 55, "PRIMARY": 55, "SHIFT": 56, "ALT": 58,
                   "OPTION": 58, "CTRL": 59, "CONTROL": 59, "DELETE": 117, "HOME": 115, "END": 119,
                   "PAGEUP": 116, "PAGEDOWN": 121, "LEFT": 123, "RIGHT": 124, "DOWN": 125, "UP": 126,
                   "F1": 122, "F2": 120, "F3": 99, "F4": 118, "F5": 96, "F6": 97, "F7": 98, "F8": 100,
                   "F9": 101, "F10": 109, "F11": 103, "F12": 111}
        codes = []
        for name in keys:
            require(name.upper() in mapping, "INVALID_ARGUMENT", "Unknown macOS key name.")
            codes.append(mapping[name.upper()])
        flags = {55: 1 << 20, 56: 1 << 17, 58: 1 << 19, 59: 1 << 18}
        pressed, mask = [], 0
        try:
            for code in codes:
                mask |= flags.get(code, 0)
                event = self.cg.CGEventCreateKeyboardEvent(None, code, True)
                self.cg.CGEventSetFlags(event, mask)
                self._post(event)
                pressed.append(code)
        finally:
            for code in reversed(pressed):
                mask &= ~flags.get(code, 0)
                event = self.cg.CGEventCreateKeyboardEvent(None, code, False)
                self.cg.CGEventSetFlags(event, mask)
                self._post(event)

    def scroll(self, window, x, y, amount, horizontal=False, *, target_content_only=False):
        self._input_access()
        original = self._pointer()
        try:
            self._post(self.cg.CGEventCreateMouseEvent(None, 5, Point(window["bounds"]["x"] + x, window["bounds"]["y"] + y), 0))
            delta = round(amount / 120 * 3)
            self._post(self.cg.CGEventCreateScrollWheelEvent(None, 1, 2 if horizontal else 1, 0 if horizontal else delta, delta if horizontal else 0))
        finally:
            self._post(self.cg.CGEventCreateMouseEvent(None, 5, original, 0))

    def capture(self, window, *, checkpoint=lambda: None):
        checkpoint()
        from ..screen import Image
        require(bool(self.cg.CGPreflightScreenCaptureAccess()), "SCREEN_RECORDING_PERMISSION_REQUIRED", "Grant macOS Screen Recording access to the calling Python/client application.")
        before = self.window(window["native"])
        require(before["identity"] == window["identity"] and before["bounds"] == window["bounds"],
                "WINDOW_IDENTITY_MISMATCH", "The target window changed before capture.")
        with tempfile.TemporaryDirectory(prefix="deskpilot-capture-") as temporary:
            path = Path(temporary) / "frame.png"
            try:
                result = subprocess.run(["/usr/sbin/screencapture", "-x", "-o", "-l", str(window["native"]), str(path)],
                                        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=15)
            except (OSError, subprocess.TimeoutExpired):
                raise DeskPilotError("WINDOW_CAPTURE_FAILED", "The system window-capture operation did not complete.") from None
            require(result.returncode == 0 and path.is_file(), "WINDOW_CAPTURE_FAILED", "The system did not provide the requested window image.")
            image = Image.open(path)
            if (image.width, image.height) != (before["bounds"]["width"], before["bounds"]["height"]):
                image = image.resize(before["bounds"]["width"], before["bounds"]["height"])
        after = self.window(window["native"])
        require(after["identity"] == before["identity"] and after["bounds"] == before["bounds"],
                "WINDOW_CAPTURE_UNTRUSTED", "The target window changed during capture.")
        return image, {"trusted": True, "capture_layer": "macos_window_server_id", "foreground_relation": "target" if self.foreground() == window["native"] else "background_window_capture"}

    def activity(self, window, label, *, visible=True, trace=None):
        if self._overlay is None and visible:
            from .macos_overlay import MacOverlay
            self._overlay = MacOverlay()
        if self._overlay:
            self._overlay.update(window["bounds"] if window and visible else None, label, trace)

    def doctor(self):
        trusted = bool(self.ax.AXIsProcessTrusted())
        capture = bool(self.cg.CGPreflightScreenCaptureAccess())
        post = bool(self.cg.CGPreflightPostEventAccess())
        return {"interactive_desktop": bool(self.windows()),
                "ui_automation": {"available": trusted, "backend": "macos_accessibility", "permission": "granted" if trusted else "required"},
                "input": {"available": trusted and post, "backend": "quartz_events"},
                "capture": {"available": capture, "backend": "system_screencapture_window_id"}}

    def close(self):
        if self._overlay:
            self._overlay.close()
            self._overlay = None
        if self._pool:
            self.objc.send(self._pool, "drain", None)
            self._pool = None
