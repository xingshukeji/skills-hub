"""Linux AT-SPI and X11 backend. Wayland capabilities are reported separately."""

from __future__ import annotations

import ctypes as C
import ctypes.util
from contextlib import contextmanager
import os
from pathlib import Path
import time

from .. import DeskPilotError, require


class Rectangle(C.Structure):
    _fields_ = [(name, C.c_int) for name in ("x", "y", "width", "height")]


class TextRange(C.Structure):
    _fields_ = [("start", C.c_int), ("end", C.c_int)]


class XAttributes(C.Structure):
    _fields_ = [(name, C.c_int) for name in ("x", "y", "width", "height", "border_width", "depth")]
    _fields_ += [("visual", C.c_void_p), ("root", C.c_ulong), ("class_", C.c_int),
                ("bit_gravity", C.c_int), ("win_gravity", C.c_int), ("backing_store", C.c_int),
                ("backing_planes", C.c_ulong), ("backing_pixel", C.c_ulong), ("save_under", C.c_int),
                ("colormap", C.c_ulong), ("map_installed", C.c_int), ("map_state", C.c_int),
                ("all_event_masks", C.c_long), ("your_event_mask", C.c_long),
                ("do_not_propagate_mask", C.c_long), ("override_redirect", C.c_int), ("screen", C.c_void_p)]


class XSetAttributes(C.Structure):
    _fields_ = [("background_pixmap", C.c_ulong), ("background_pixel", C.c_ulong),
                ("border_pixmap", C.c_ulong), ("border_pixel", C.c_ulong),
                ("bit_gravity", C.c_int), ("win_gravity", C.c_int), ("backing_store", C.c_int),
                ("backing_planes", C.c_ulong), ("backing_pixel", C.c_ulong), ("save_under", C.c_int),
                ("event_mask", C.c_long), ("do_not_propagate_mask", C.c_long),
                ("override_redirect", C.c_int), ("colormap", C.c_ulong), ("cursor", C.c_ulong)]


class XRectangle(C.Structure):
    _fields_ = [("x", C.c_short), ("y", C.c_short), ("width", C.c_ushort), ("height", C.c_ushort)]


class XImage(C.Structure):
    _fields_ = [(name, C.c_int) for name in ("width", "height", "xoffset", "format")]
    _fields_ += [("data", C.c_void_p)]
    _fields_ += [(name, C.c_int) for name in ("byte_order", "bitmap_unit", "bitmap_bit_order", "bitmap_pad", "depth", "bytes_per_line", "bits_per_pixel")]
    _fields_ += [(name, C.c_ulong) for name in ("red_mask", "green_mask", "blue_mask")]


class ClientData(C.Union):
    _fields_ = [("b", C.c_char * 20), ("s", C.c_short * 10), ("l", C.c_long * 5)]


class ClientMessage(C.Structure):
    _fields_ = [("type", C.c_int), ("serial", C.c_ulong), ("send_event", C.c_int),
                ("display", C.c_void_p), ("window", C.c_ulong), ("message_type", C.c_ulong),
                ("format", C.c_int), ("data", ClientData)]


class XEvent(C.Union):
    _fields_ = [("client", ClientMessage), ("pad", C.c_long * 24)]


class NativeRef:
    def __init__(self, api, pointer):
        self.api, self.pointer = api, pointer

    def __del__(self):
        if self.pointer:
            self.api.gobject.g_object_unref(self.pointer)
            self.pointer = None


ROLE_TYPES = {"push button": 50000, "check box": 50002, "combo box": 50003,
              "entry": 50004, "text": 50004, "password text": 50004, "link": 50005,
              "image": 50006, "list item": 50007, "list": 50008, "menu": 50009,
              "menu bar": 50010, "menu item": 50011, "check menu item": 50011,
              "progress bar": 50012, "radio button": 50013, "scroll bar": 50014,
              "slider": 50015, "spin button": 50016, "status bar": 50017,
              "page tab list": 50018, "page tab": 50019, "label": 50020,
              "tool bar": 50021, "tool tip": 50022, "tree": 50023,
              "tree item": 50024, "panel": 50026, "table cell": 50029,
              "document web": 50030, "document frame": 50030, "frame": 50032,
              "dialog": 50032, "window": 50032, "scroll pane": 50033, "table": 50036}


def load(name):
    location = C.util.find_library(name)
    require(bool(location), "SYSTEM_DEPENDENCY_MISSING", f"The system library {name} is unavailable.")
    try:
        return C.CDLL(location)
    except OSError:
        raise DeskPilotError("SYSTEM_DEPENDENCY_MISSING", f"The system library {name} could not load.") from None


class LinuxDesktop:
    name = "linux"

    def __init__(self):
        self.wayland = bool(os.environ.get("WAYLAND_DISPLAY") or os.environ.get("XDG_SESSION_TYPE") == "wayland")
        self.display = None
        self.atspi = None
        self._x_error = 0
        self._overlay = []
        self._overlay_gc = None
        self._overlay_text = b"DeskPilot"
        self._shape = None
        self._activity_error = None
        self._atspi_error = None
        self._x11_error = None
        try:
            self._configure_atspi()
        except DeskPilotError as exc:
            self._atspi_error = exc
        if not self.wayland:
            try:
                self._configure_x11()
            except DeskPilotError as exc:
                self._x11_error = exc

    def _configure_atspi(self):
        self.atspi, self.gobject, self.glib = load("atspi"), load("gobject-2.0"), load("glib-2.0")
        self.gobject.g_object_unref.argtypes = [C.c_void_p]
        self.glib.g_free.argtypes = [C.c_void_p]
        self.glib.g_error_free.argtypes = [C.c_void_p]
        signatures = {
            "atspi_init": (C.c_int, []), "atspi_exit": (C.c_int, []),
            "atspi_get_desktop": (C.c_void_p, [C.c_int]),
            "atspi_accessible_get_child_count": (C.c_int, [C.c_void_p, C.POINTER(C.c_void_p)]),
            "atspi_accessible_get_child_at_index": (C.c_void_p, [C.c_void_p, C.c_int, C.POINTER(C.c_void_p)]),
            "atspi_accessible_get_parent": (C.c_void_p, [C.c_void_p, C.POINTER(C.c_void_p)]),
            "atspi_accessible_get_index_in_parent": (C.c_int, [C.c_void_p, C.POINTER(C.c_void_p)]),
            "atspi_accessible_get_process_id": (C.c_uint, [C.c_void_p, C.POINTER(C.c_void_p)]),
            "atspi_accessible_get_state_set": (C.c_void_p, [C.c_void_p]),
            "atspi_accessible_clear_cache": (None, [C.c_void_p]),
            "atspi_state_set_contains": (C.c_int, [C.c_void_p, C.c_int]),
            "atspi_component_get_extents": (C.POINTER(Rectangle), [C.c_void_p, C.c_int, C.POINTER(C.c_void_p)]),
            "atspi_component_grab_focus": (C.c_int, [C.c_void_p, C.POINTER(C.c_void_p)]),
            "atspi_action_get_n_actions": (C.c_int, [C.c_void_p, C.POINTER(C.c_void_p)]),
            "atspi_action_do_action": (C.c_int, [C.c_void_p, C.c_int, C.POINTER(C.c_void_p)]),
            "atspi_editable_text_set_text_contents": (C.c_int, [C.c_void_p, C.c_char_p, C.POINTER(C.c_void_p)]),
            "atspi_editable_text_insert_text": (C.c_int, [C.c_void_p, C.c_int, C.c_char_p, C.c_int, C.POINTER(C.c_void_p)]),
            "atspi_text_get_text": (C.c_void_p, [C.c_void_p, C.c_int, C.c_int, C.POINTER(C.c_void_p)]),
            "atspi_text_get_caret_offset": (C.c_int, [C.c_void_p, C.POINTER(C.c_void_p)]),
            "atspi_text_get_n_selections": (C.c_int, [C.c_void_p, C.POINTER(C.c_void_p)]),
            "atspi_text_get_selection": (C.POINTER(TextRange), [C.c_void_p, C.c_int, C.POINTER(C.c_void_p)]),
            "atspi_editable_text_delete_text": (C.c_int, [C.c_void_p, C.c_int, C.c_int, C.POINTER(C.c_void_p)]),
            "atspi_selection_select_child": (C.c_int, [C.c_void_p, C.c_int, C.POINTER(C.c_void_p)]),
        }
        for name in ("name", "role_name", "accessible_id"):
            signatures["atspi_accessible_get_" + name] = (C.c_void_p, [C.c_void_p, C.POINTER(C.c_void_p)])
        for name in ("component", "action", "editable_text", "text", "selection"):
            signatures["atspi_accessible_get_" + name + "_iface"] = (C.c_void_p, [C.c_void_p])
        for name, (result, args) in signatures.items():
            function = getattr(self.atspi, name)
            function.restype, function.argtypes = result, args
        require(self.atspi.atspi_init() in (0, 1), "ACCESSIBILITY_UNAVAILABLE", "The AT-SPI accessibility bus could not initialize.")

    def _configure_x11(self):
        self.x = load("X11")
        pointer, window = C.c_void_p, C.c_ulong
        signatures = {
            "XOpenDisplay": (pointer, [C.c_char_p]), "XCloseDisplay": (C.c_int, [pointer]),
            "XDefaultRootWindow": (window, [pointer]), "XFree": (C.c_int, [pointer]),
            "XInternAtom": (C.c_ulong, [pointer, C.c_char_p, C.c_int]),
            "XGetWindowAttributes": (C.c_int, [pointer, window, C.POINTER(XAttributes)]),
            "XTranslateCoordinates": (C.c_int, [pointer, window, window, C.c_int, C.c_int, C.POINTER(C.c_int), C.POINTER(C.c_int), C.POINTER(window)]),
            "XGetWindowProperty": (C.c_int, [pointer, window, C.c_ulong, C.c_long, C.c_long, C.c_int, C.c_ulong, C.POINTER(C.c_ulong), C.POINTER(C.c_int), C.POINTER(C.c_ulong), C.POINTER(C.c_ulong), C.POINTER(pointer)]),
            "XQueryTree": (C.c_int, [pointer, window, C.POINTER(window), C.POINTER(window), C.POINTER(C.POINTER(window)), C.POINTER(C.c_uint)]),
            "XSendEvent": (C.c_int, [pointer, window, C.c_int, C.c_long, C.POINTER(XEvent)]),
            "XSync": (C.c_int, [pointer, C.c_int]), "XFlush": (C.c_int, [pointer]),
            "XGetImage": (C.POINTER(XImage), [pointer, window, C.c_int, C.c_int, C.c_uint, C.c_uint, C.c_ulong, C.c_int]),
            "XDestroyImage": (C.c_int, [C.POINTER(XImage)]),
            "XStringToKeysym": (C.c_ulong, [C.c_char_p]),
            "XKeysymToKeycode": (C.c_ubyte, [pointer, C.c_ulong]),
            "XQueryPointer": (C.c_int, [pointer, window, C.POINTER(window), C.POINTER(window), *([C.POINTER(C.c_int)] * 4), C.POINTER(C.c_uint)]),
            "XCreateSimpleWindow": (window, [pointer, window, C.c_int, C.c_int, C.c_uint, C.c_uint, C.c_uint, C.c_ulong, C.c_ulong]),
            "XMapRaised": (C.c_int, [pointer, window]), "XUnmapWindow": (C.c_int, [pointer, window]),
            "XDestroyWindow": (C.c_int, [pointer, window]),
            "XMoveResizeWindow": (C.c_int, [pointer, window, C.c_int, C.c_int, C.c_uint, C.c_uint]),
            "XChangeProperty": (C.c_int, [pointer, window, C.c_ulong, C.c_ulong, C.c_int, C.c_int, pointer, C.c_int]),
            "XChangeWindowAttributes": (C.c_int, [pointer, window, C.c_ulong, C.POINTER(XSetAttributes)]),
            "XCreateGC": (pointer, [pointer, window, C.c_ulong, pointer]),
            "XFreeGC": (C.c_int, [pointer, pointer]),
            "XSetForeground": (C.c_int, [pointer, pointer, C.c_ulong]),
            "XClearWindow": (C.c_int, [pointer, window]),
            "XDrawString": (C.c_int, [pointer, window, pointer, C.c_int, C.c_int, C.c_char_p, C.c_int]),
        }
        for name, (result, args) in signatures.items():
            function = getattr(self.x, name)
            function.restype, function.argtypes = result, args
        self._error_handler = C.CFUNCTYPE(C.c_int, pointer, pointer)(lambda *_: setattr(self, "_x_error", 1) or 0)
        self.x.XSetErrorHandler.argtypes, self.x.XSetErrorHandler.restype = [pointer], pointer
        self._previous_handler = self.x.XSetErrorHandler(self._error_handler)
        self.display = self.x.XOpenDisplay(None)
        require(bool(self.display), "DESKTOP_UNAVAILABLE", "No accessible X11 display is available.")
        self.root = self.x.XDefaultRootWindow(self.display)
        try:
            self.xtest = load("Xtst")
            for name, args in (("XTestFakeKeyEvent", [pointer, C.c_uint, C.c_int, C.c_ulong]),
                               ("XTestFakeButtonEvent", [pointer, C.c_uint, C.c_int, C.c_ulong]),
                               ("XTestFakeMotionEvent", [pointer, C.c_int, C.c_int, C.c_int, C.c_ulong])):
                getattr(self.xtest, name).argtypes, getattr(self.xtest, name).restype = args, C.c_int
        except DeskPilotError:
            self.xtest = None
        try:
            self._shape = load("Xext")
            self._shape.XShapeQueryVersion.argtypes = [pointer, C.POINTER(C.c_int), C.POINTER(C.c_int)]
            self._shape.XShapeQueryVersion.restype = C.c_int
            self._shape.XShapeCombineRectangles.argtypes = [pointer, window, C.c_int, C.c_int, C.c_int,
                                                          C.POINTER(XRectangle), C.c_int, C.c_int, C.c_int]
            self._shape.XShapeCombineRectangles.restype = None
            major, minor = C.c_int(), C.c_int()
            require(bool(self._shape.XShapeQueryVersion(self.display, C.byref(major), C.byref(minor)))
                    and (major.value, minor.value) >= (1, 1), "OVERLAY_UNAVAILABLE",
                    "X11 Shape 1.1 input regions are required for click-through activity cues.")
        except DeskPilotError as exc:
            self._activity_error = exc

    def _x11(self):
        require(not self.wayland, "WAYLAND_PORTAL_REQUIRED", "Wayland desktop capture and synthetic input require a portal session; this backend does not yet implement that session. CDP remains available.")
        if self._x11_error:
            raise self._x11_error
        require(bool(self.display), "DESKTOP_UNAVAILABLE", "The X11 desktop is unavailable.")

    def _access(self):
        if self._atspi_error:
            raise self._atspi_error

    def _call(self, name, *args):
        error = C.c_void_p()
        result = getattr(self.atspi, "atspi_" + name)(*args, C.byref(error))
        if error.value:
            self.glib.g_error_free(error)
            raise DeskPilotError("ELEMENT_UNAVAILABLE", "The accessibility object could not complete the operation.")
        return result

    def _string(self, name, *args):
        pointer = self._call(name, *args)
        if not pointer:
            return ""
        try:
            return C.string_at(pointer).decode("utf-8", "replace")
        finally:
            self.glib.g_free(pointer)

    def _interface(self, element, name):
        value = getattr(self.atspi, "atspi_accessible_get_" + name + "_iface")(element.pointer)
        return NativeRef(self, value) if value else None

    def _children(self, element):
        count = self._call("accessible_get_child_count", element.pointer)
        return [NativeRef(self, self._call("accessible_get_child_at_index", element.pointer, index)) for index in range(min(count, 5000))]

    def _atom(self, name):
        return self.x.XInternAtom(self.display, name.encode("ascii"), False)

    def _property(self, native, name):
        actual, count, remaining = C.c_ulong(), C.c_ulong(), C.c_ulong()
        form, data = C.c_int(), C.c_void_p()
        status = self.x.XGetWindowProperty(self.display, native, self._atom(name), 0, 65536, False, 0,
                                          C.byref(actual), C.byref(form), C.byref(count), C.byref(remaining), C.byref(data))
        if status or not data.value:
            return []
        try:
            if form.value == 8:
                return C.string_at(data, count.value).decode("utf-8", "replace").rstrip("\x00")
            if form.value == 32:
                return list(C.cast(data, C.POINTER(C.c_ulong))[:count.value])
            return []
        finally:
            self.x.XFree(data)

    def _geometry(self, native):
        attributes = XAttributes()
        require(bool(self.x.XGetWindowAttributes(self.display, native, C.byref(attributes))) and attributes.map_state == 2,
                "WINDOW_UNAVAILABLE", "The X11 window is no longer visible.")
        x, y, child = C.c_int(), C.c_int(), C.c_ulong()
        require(bool(self.x.XTranslateCoordinates(self.display, native, self.root, 0, 0, C.byref(x), C.byref(y), C.byref(child))),
                "WINDOW_UNAVAILABLE", "The X11 window geometry is unavailable.")
        return {"x": x.value, "y": y.value, "width": attributes.width, "height": attributes.height}

    def _window(self, native):
        area = self._geometry(native)
        pids = self._property(native, "_NET_WM_PID")
        pid = pids[0] if pids else 0
        try:
            created = (Path("/proc") / str(pid) / "stat").read_text().rpartition(")")[2].split()[19]
            process = (Path("/proc") / str(pid) / "comm").read_text().strip()
        except (OSError, IndexError):
            created, process = "", ""
        title = self._property(native, "_NET_WM_NAME") or self._property(native, "WM_NAME") or ""
        return {"native": int(native), "identity": (int(native), pid, created), "title": title,
                "pid": pid, "process": process, "class_name": str(self._property(native, "WM_CLASS")).replace("\x00", "/"),
                "bounds": area, "foreground": self.foreground() == native}

    def windows(self):
        self._x11()
        result = []
        for native in self._property(self.root, "_NET_CLIENT_LIST_STACKING") or self._property(self.root, "_NET_CLIENT_LIST"):
            try:
                result.append(self._window(native))
            except DeskPilotError:
                continue
        return result

    def window(self, native):
        self._x11()
        return self._window(native)

    def foreground(self):
        self._x11()
        active = self._property(self.root, "_NET_ACTIVE_WINDOW")
        return active[0] if active else None

    def activate(self, window, *, checkpoint=lambda: None):
        self._x11()
        event = XEvent()
        event.client.type, event.client.display, event.client.window = 33, self.display, window["native"]
        event.client.message_type, event.client.format = self._atom("_NET_ACTIVE_WINDOW"), 32
        event.client.data.l[0], event.client.data.l[1] = 2, 0
        self.x.XSendEvent(self.display, self.root, False, (1 << 20) | (1 << 19), C.byref(event))
        self.x.XFlush(self.display)
        for _ in range(25):
            if self.foreground() == window["native"]:
                return self.window(window["native"])
            time.sleep(0.02)
        raise DeskPilotError("WINDOW_ACTIVATION_FAILED", "The window manager did not grant foreground activation.")

    def restore(self, native):
        try:
            self.activate(self.window(native))
            return True
        except DeskPilotError:
            return False

    def _accessible_window(self, window):
        self._access()
        desktop = NativeRef(self, self.atspi.atspi_get_desktop(0))
        require(bool(desktop.pointer), "ACCESSIBILITY_UNAVAILABLE", "The AT-SPI desktop is unavailable.")
        candidates = []
        for application in self._children(desktop):
            if self._call("accessible_get_process_id", application.pointer) != window["pid"]:
                continue
            for item in self._children(application):
                info = self.element_info(item)
                if info["name"] == window["title"] or info["bounds"] == window["bounds"]:
                    candidates.append(item)
        require(len(candidates) == 1, "ACCESSIBILITY_WINDOW_UNAVAILABLE", "The native window could not be uniquely bound to an AT-SPI window.")
        return candidates[0]

    def element_info(self, element):
        self._access()
        require(bool(element.pointer), "ELEMENT_UNAVAILABLE", "The accessibility element has expired.")
        role = self._string("accessible_get_role_name", element.pointer)
        state = NativeRef(self, self.atspi.atspi_accessible_get_state_set(element.pointer))
        enabled = bool(state.pointer and self.atspi.atspi_state_set_contains(state.pointer, 8))
        showing = bool(state.pointer and self.atspi.atspi_state_set_contains(state.pointer, 25))
        component = self._interface(element, "component")
        area = {"x": 0, "y": 0, "width": 0, "height": 0}
        if component:
            rectangle = self._call("component_get_extents", component.pointer, 0)
            if rectangle:
                area = {name: getattr(rectangle.contents, name) for name in area}
                self.glib.g_free(rectangle)
        password = role == "password text"
        text, value = self._interface(element, "text"), None
        if text and not password:
            value = self._string("text_get_text", text.pointer, 0, 4096)
        return {"name": self._string("accessible_get_name", element.pointer), "class_name": role,
                "automation_id": self._string("accessible_get_accessible_id", element.pointer),
                "control_type": ROLE_TYPES.get(role, 50025), "enabled": enabled, "offscreen": not showing,
                "is_password": password, "value": value, "bounds": area}

    def tree(self, window, *, depth, limit, checkpoint):
        root = self._accessible_window(window)
        self.atspi.atspi_accessible_clear_cache(root.pointer)
        pending = [(root, 0)]
        result = []
        while pending and len(result) < limit:
            checkpoint()
            item, level = pending.pop()
            try:
                result.append({**self.element_info(item), "native": item, "depth": level})
                if level < depth:
                    pending.extend((child, level + 1) for child in reversed(self._children(item)))
            except DeskPilotError:
                if not result:
                    raise
        return result

    def invoke(self, element):
        info = self.element_info(element)
        require(info["enabled"] and not info["offscreen"], "ELEMENT_NOT_ACTIONABLE", "The control is not enabled and visible.")
        action = self._interface(element, "action")
        require(action is not None and self._call("action_get_n_actions", action.pointer) > 0,
                "PATTERN_UNSUPPORTED", "The control has no AT-SPI action.")
        require(bool(self._call("action_do_action", action.pointer, 0)), "ACTION_FAILED", "The control rejected its default action.", outcome="unknown")

    def set_value(self, element, value, *, checkpoint=lambda: None, window=None, newline_strategy=None):
        info = self.element_info(element)
        require(not info["is_password"], "SENSITIVE_INPUT_BLOCKED", "Password controls must be handled by the user.")
        edit = self._interface(element, "editable_text")
        require(info["enabled"] and edit is not None, "PATTERN_UNSUPPORTED", "The control does not expose editable text.")
        require(bool(self._call("editable_text_set_text_contents", edit.pointer, value.encode("utf-8"))),
                "ACTION_FAILED", "The control rejected the value.", outcome="unknown")

    def select(self, element, value=None, *, checkpoint=lambda: None):
        if value is None:
            parent = NativeRef(self, self._call("accessible_get_parent", element.pointer))
            selection = self._interface(parent, "selection") if parent.pointer else None
            index = self._call("accessible_get_index_in_parent", element.pointer)
        else:
            selection = self._interface(element, "selection")
            choices = [(index, item) for index, item in enumerate(self._children(element)) if self.element_info(item)["name"] == str(value)]
            require(len(choices) == 1, "ELEMENT_AMBIGUOUS", "Selection requires exactly one matching option.")
            index = choices[0][0]
        require(selection is not None, "PATTERN_UNSUPPORTED", "The control does not expose AT-SPI selection.")
        require(bool(self._call("selection_select_child", selection.pointer, index)), "ACTION_FAILED", "The selection was rejected.", outcome="unknown")

    def _input(self):
        self._x11()
        require(self.xtest is not None, "SYSTEM_DEPENDENCY_MISSING", "XTest synthetic input is unavailable.")

    def _pointer(self):
        root, child, mask = C.c_ulong(), C.c_ulong(), C.c_uint()
        rx, ry, wx, wy = C.c_int(), C.c_int(), C.c_int(), C.c_int()
        self.x.XQueryPointer(self.display, self.root, C.byref(root), C.byref(child), C.byref(rx), C.byref(ry), C.byref(wx), C.byref(wy), C.byref(mask))
        return rx.value, ry.value

    @contextmanager
    def _without_activity(self):
        visible = []
        for item in self._overlay:
            attributes = XAttributes()
            if self.x.XGetWindowAttributes(self.display, item, C.byref(attributes)) and attributes.map_state == 2:
                visible.append(item)
                self.x.XUnmapWindow(self.display, item)
        self.x.XSync(self.display, False)
        try:
            yield
        finally:
            for item in visible:
                self.x.XMapRaised(self.display, item)
            if len(self._overlay) > 4 and self._overlay[4] in visible:
                self._paint_status()
            self.x.XFlush(self.display)

    def _point_owned(self, window, x, y):
        with self._without_activity():
            self._point_owned_visible(window, x, y)

    def _point_owned_visible(self, window, x, y):
        current = self.root
        for _ in range(32):
            if current == window["native"]:
                return
            local_x, local_y, child = C.c_int(), C.c_int(), C.c_ulong()
            valid = self.x.XTranslateCoordinates(self.display, self.root, current,
                                                window["bounds"]["x"] + x, window["bounds"]["y"] + y,
                                                C.byref(local_x), C.byref(local_y), C.byref(child))
            if not valid or not child.value or child.value == current:
                break
            current = child.value
        raise DeskPilotError("INPUT_TARGET_MISMATCH", "Another X11 window covers the requested input point.")

    def click(self, window, x, y, *, button="left", count=1, target_content_only=False):
        self._input()
        require(self.foreground() == window["native"], "WINDOW_NOT_FOREGROUND", "The requested window is not foreground.")
        self._point_owned(window, x, y)
        original = self._pointer()
        code = {"left": 1, "middle": 2, "right": 3}[button]
        try:
            self.xtest.XTestFakeMotionEvent(self.display, -1, window["bounds"]["x"] + x, window["bounds"]["y"] + y, 0)
            for _ in range(count):
                for down in (True, False):
                    self.xtest.XTestFakeButtonEvent(self.display, code, down, 0)
        finally:
            self.xtest.XTestFakeMotionEvent(self.display, -1, *original, 0)
            self.x.XSync(self.display, False)

    def type_text(self, text, checkpoint):
        self._x11()
        window = self.window(self.foreground())
        focused = [item for item in self.tree(window, depth=32, limit=5000, checkpoint=checkpoint)
                   if self._focused(item["native"])]
        require(len(focused) == 1, "FOCUSED_CONTROL_UNAVAILABLE", "Use ui.set_value or focus one accessible editable control before typing.")
        element = focused[0]["native"]
        require(not focused[0]["is_password"], "SENSITIVE_INPUT_BLOCKED", "Password controls must be handled by the user.")
        edit, text_iface = self._interface(element, "editable_text"), self._interface(element, "text")
        require(edit is not None and text_iface is not None, "PATTERN_UNSUPPORTED", "The focused control has no AT-SPI editable text interface.")
        offset = self._call("text_get_caret_offset", text_iface.pointer)
        selections = self._call("text_get_n_selections", text_iface.pointer)
        require(selections <= 1, "TEXT_SELECTION_AMBIGUOUS", "The control has multiple text selections; use ui.set_value.")
        if selections == 1:
            selected = self._call("text_get_selection", text_iface.pointer, 0)
            require(bool(selected), "ELEMENT_UNAVAILABLE", "The current text selection is unavailable.")
            try:
                offset, end = selected.contents.start, selected.contents.end
            finally:
                self.glib.g_free(selected)
            checkpoint()
            require(bool(self._call("editable_text_delete_text", edit.pointer, offset, end)),
                    "ACTION_FAILED", "The focused control rejected replacing its selection.", outcome="unknown")
        checkpoint()
        require(bool(self._call("editable_text_insert_text", edit.pointer, offset, text.encode("utf-8"), len(text.encode("utf-8")))),
                "ACTION_FAILED", "The focused control rejected text insertion.", outcome="unknown")

    def _focused(self, element):
        state = NativeRef(self, self.atspi.atspi_accessible_get_state_set(element.pointer))
        return bool(state.pointer and self.atspi.atspi_state_set_contains(state.pointer, 12))

    def key(self, keys):
        self._input()
        names = {"CTRL": "Control_L", "CONTROL": "Control_L", "SHIFT": "Shift_L", "ALT": "Alt_L",
                 "META": "Super_L", "MOD": "Control_L", "PRIMARY": "Control_L", "ENTER": "Return",
                 "ESC": "Escape", "BACKSPACE": "BackSpace", "DELETE": "Delete", "SPACE": "space",
                 "PAGEUP": "Prior", "PAGEDOWN": "Next", "LEFT": "Left", "RIGHT": "Right", "UP": "Up", "DOWN": "Down",
                 "TAB": "Tab", "HOME": "Home", "END": "End"}
        codes = [self.x.XKeysymToKeycode(self.display, self.x.XStringToKeysym(names.get(key.upper(), key).encode("ascii"))) for key in keys]
        require(all(codes), "INVALID_ARGUMENT", "A key is not present in the current X11 keymap.")
        pressed = []
        try:
            for code in codes:
                self.xtest.XTestFakeKeyEvent(self.display, code, True, 0)
                pressed.append(code)
        finally:
            for code in reversed(pressed):
                self.xtest.XTestFakeKeyEvent(self.display, code, False, 0)
            self.x.XSync(self.display, False)

    def scroll(self, window, x, y, amount, horizontal=False, *, target_content_only=False):
        self._input()
        require(self.foreground() == window["native"], "WINDOW_NOT_FOREGROUND", "The requested window is not foreground.")
        self._point_owned(window, x, y)
        original = self._pointer()
        try:
            self.xtest.XTestFakeMotionEvent(self.display, -1, window["bounds"]["x"] + x, window["bounds"]["y"] + y, 0)
            button = (6 if amount > 0 else 7) if horizontal else (4 if amount > 0 else 5)
            for _ in range(max(1, abs(round(amount / 120)))):
                for down in (True, False):
                    self.xtest.XTestFakeButtonEvent(self.display, button, down, 0)
        finally:
            self.xtest.XTestFakeMotionEvent(self.display, -1, *original, 0)
            self.x.XSync(self.display, False)

    def _unobscured(self, window):
        root, parent, children, count = C.c_ulong(), C.c_ulong(), C.POINTER(C.c_ulong)(), C.c_uint()
        native = window["native"]
        for _ in range(16):
            self.x.XQueryTree(self.display, native, C.byref(root), C.byref(parent), C.byref(children), C.byref(count))
            if children:
                self.x.XFree(children)
            if parent.value == self.root:
                break
            require(parent.value != 0, "WINDOW_CAPTURE_UNTRUSTED", "The window's stacking position is unavailable.")
            native = parent.value
        self.x.XQueryTree(self.display, self.root, C.byref(root), C.byref(parent), C.byref(children), C.byref(count))
        try:
            stacking = list(children[:count.value]) if children else []
        finally:
            if children:
                self.x.XFree(children)
        require(native in stacking, "WINDOW_CAPTURE_UNTRUSTED", "The window's stacking position is unavailable.")
        area = window["bounds"]
        screen = self._geometry(self.root)
        require(area["x"] >= 0 and area["y"] >= 0 and area["x"] + area["width"] <= screen["width"] and area["y"] + area["height"] <= screen["height"],
                "WINDOW_CAPTURE_UNTRUSTED", "The target is partly outside the visible screen.")
        for other in stacking[stacking.index(native) + 1:]:
            if other in self._overlay:
                continue
            try:
                above = self._geometry(other)
            except DeskPilotError:
                continue
            require(not (above["x"] < area["x"] + area["width"] and above["x"] + above["width"] > area["x"]
                         and above["y"] < area["y"] + area["height"] and above["y"] + above["height"] > area["y"]),
                    "WINDOW_CAPTURE_UNTRUSTED", "Another visible X11 window covers the requested capture.")

    def capture(self, window, *, checkpoint=lambda: None):
        checkpoint()
        self._x11()
        with self._without_activity():
            return self._capture_visible(window)

    def _capture_visible(self, window):
        from ..screen import Image
        before = self.window(window["native"])
        require(before["identity"] == window["identity"] and before["bounds"] == window["bounds"] and before["foreground"],
                "WINDOW_CAPTURE_UNTRUSTED", "The target changed or is not foreground.")
        self._unobscured(before)
        area = before["bounds"]
        self._x_error = 0
        image = self.x.XGetImage(self.display, window["native"], 0, 0, area["width"], area["height"], C.c_ulong(-1).value, 2)
        self.x.XSync(self.display, False)
        require(bool(image) and not self._x_error, "WINDOW_CAPTURE_FAILED", "The X11 server did not provide a complete image.")
        try:
            frame = image.contents
            require(frame.bits_per_pixel == 32 and (frame.red_mask, frame.green_mask, frame.blue_mask) == (0xFF0000, 0xFF00, 0xFF),
                    "CAPTURE_FORMAT_UNSUPPORTED", "This X11 visual is not a supported 32-bit RGB visual.")
            raw = C.string_at(frame.data, frame.bytes_per_line * frame.height)
            rgb = bytearray()
            for row in range(frame.height):
                pixels = raw[row * frame.bytes_per_line:row * frame.bytes_per_line + frame.width * 4]
                for offset in range(0, len(pixels), 4):
                    rgb.extend((pixels[offset + 2], pixels[offset + 1], pixels[offset]) if frame.byte_order == 0 else pixels[offset + 1:offset + 4])
            result = Image(frame.width, frame.height, bytes(rgb))
        finally:
            self.x.XDestroyImage(image)
        after = self.window(window["native"])
        self._unobscured(after)
        require(after["identity"] == before["identity"] and after["bounds"] == before["bounds"] and after["foreground"],
                "WINDOW_CAPTURE_UNTRUSTED", "The target changed during capture.")
        return result, {"trusted": True, "capture_layer": "x11_verified_unobscured_window", "foreground_relation": "target"}

    def activity(self, window, label, *, visible=True, trace=None):
        self._x11()
        if not visible or not window:
            for item in self._overlay:
                self.x.XUnmapWindow(self.display, item)
            self.x.XFlush(self.display)
            return
        if self._activity_error:
            raise self._activity_error
        area = window["bounds"]
        rectangles = [(area["x"] - 3, area["y"] - 3, area["width"] + 6, 3),
                      (area["x"] - 3, area["y"] + area["height"], area["width"] + 6, 3),
                      (area["x"] - 3, area["y"], 3, area["height"]),
                      (area["x"] + area["width"], area["y"], 3, area["height"])]
        if not self._overlay:
            self._x_error = 0
            try:
                for index in range(6):
                    color = 0x111827 if index == 4 else 0x3080FF
                    item = self.x.XCreateSimpleWindow(self.display, self.root, 0, 0, 1, 1, 0, color, color)
                    require(bool(item), "OVERLAY_UNAVAILABLE", "The X11 activity surface could not be created.")
                    self._overlay.append(item)
                    pid = (C.c_ulong * 1)(os.getpid())
                    self.x.XChangeProperty(self.display, item, self._atom("_NET_WM_PID"), 6, 32, 0, pid, 1)
                    attributes = XSetAttributes(override_redirect=1, backing_store=2, save_under=1)
                    self.x.XChangeWindowAttributes(self.display, item, (1 << 9) | (1 << 6) | (1 << 10), C.byref(attributes))
                    # ShapeInput=2 with an empty region keeps every cue out of input targeting.
                    self._shape.XShapeCombineRectangles(self.display, item, 2, 0, 0, None, 0, 0, 0)
                self._overlay_gc = self.x.XCreateGC(self.display, self._overlay[4], 0, None)
                require(bool(self._overlay_gc), "OVERLAY_UNAVAILABLE", "The X11 status panel could not draw text.")
                marker = (XRectangle * 2)(XRectangle(0, 7, 19, 3), XRectangle(7, 0, 3, 19))
                self._shape.XShapeCombineRectangles(self.display, self._overlay[5], 0, 0, 0, marker, 2, 0, 0)
                self.x.XSync(self.display, False)
                require(not self._x_error, "OVERLAY_UNAVAILABLE", "The X11 server rejected activity window attributes.")
            except Exception:
                for item in self._overlay:
                    self.x.XDestroyWindow(self.display, item)
                self._overlay.clear()
                if self._overlay_gc:
                    self.x.XFreeGC(self.display, self._overlay_gc)
                    self._overlay_gc = None
                raise
        for item, rectangle in zip(self._overlay[:4], rectangles):
            self.x.XMoveResizeWindow(self.display, item, *rectangle)
            self.x.XMapRaised(self.display, item)
        screen = self._geometry(self.root)
        panel = self._overlay[4]
        self.x.XMoveResizeWindow(self.display, panel, max(0, screen["width"] - 335), 12, 320, 40)
        self.x.XMapRaised(self.display, panel)
        actions = {"ui.click": "Clicking", "ui.invoke": "Activating control", "ui.set_value": "Entering text",
                   "ui.select": "Selecting", "input.type": "Typing", "input.key": "Pressing keys",
                   "input.hotkey": "Pressing keys", "input.scroll": "Scrolling", "Observe": "Observing"}
        status = actions.get(str(label), str(label)[:48] if str(label).isascii() else "Working")
        self._overlay_text = ("DeskPilot  " + status).encode("ascii")
        self._paint_status()
        if trace is not None:
            self.x.XMoveResizeWindow(self.display, self._overlay[5], area["x"] + int(trace[0]) - 9,
                                    area["y"] + int(trace[1]) - 9, 19, 19)
            self.x.XMapRaised(self.display, self._overlay[5])
        else:
            self.x.XUnmapWindow(self.display, self._overlay[5])
        self.x.XFlush(self.display)

    def _paint_status(self):
        panel = self._overlay[4]
        self.x.XClearWindow(self.display, panel)
        self.x.XSetForeground(self.display, self._overlay_gc, 0xF9FAFB)
        self.x.XDrawString(self.display, panel, self._overlay_gc, 12, 25, self._overlay_text, len(self._overlay_text))

    def doctor(self):
        access = self._atspi_error is None
        x11 = bool(self.display) and not self.wayland
        activity = x11 and self._activity_error is None
        return {"interactive_desktop": x11, "desktop_session": "wayland" if self.wayland else "x11",
                "ui_automation": {"available": access and x11, "backend": "atspi", "code": self._atspi_error.code if self._atspi_error else None},
                "input": {"available": x11 and self.xtest is not None, "backend": "xtest_and_atspi" if x11 else "wayland_portal_unimplemented"},
                "capture": {"available": x11, "backend": "x11_unobscured" if x11 else "wayland_portal_unimplemented"},
                "activity": {"available": activity, "action_trace": activity, "status_panel": activity,
                             "input_transparent": activity, "backend": "x11_shape_activity",
                             "code": self._activity_error.code if self._activity_error else None},
                "code": "WAYLAND_PORTAL_REQUIRED" if self.wayland else self._x11_error.code if self._x11_error else None}

    def close(self):
        if self.display:
            for item in self._overlay:
                self.x.XDestroyWindow(self.display, item)
            self._overlay.clear()
            if self._overlay_gc:
                self.x.XFreeGC(self.display, self._overlay_gc)
                self._overlay_gc = None
            self.x.XCloseDisplay(self.display)
            self.display = None
        if hasattr(self, "_previous_handler"):
            self.x.XSetErrorHandler(self._previous_handler)
        if self.atspi and self._atspi_error is None:
            self.atspi.atspi_exit()
