"""Session references, ordered actions, bounded waits and cancellation."""

from __future__ import annotations

from collections import OrderedDict
import copy
import os
from pathlib import Path
import re
import tempfile
import threading
import time
import uuid

from . import DeskPilotError, PROTOCOL_VERSION, VERSION, bounds, number, platform_key, require

METHODS = (
    "capabilities", "schema", "doctor", "close", "interaction.begin", "interaction.status",
    "interaction.end", "interaction.cancel", "actions.batch", "workflow.run",
    "windows.list", "windows.find", "windows.info", "windows.activate", "observe",
    "ui.tree", "ui.find", "ui.find_all", "ui.get", "ui.invoke", "ui.click", "ui.set_value", "ui.select",
    "input.click", "input.double_click", "input.right_click", "input.type", "input.secret", "input.key", "input.hotkey", "input.scroll",
    "android.observe", "android.click", "android.set_value", "android.swipe",
    "screen.capture", "screen.capture_window", "screen.read_text", "messages.observe", "wait.window", "wait.element",
    "chrome.ensure", "chrome.targets", "chrome.attach", "chrome.navigate", "chrome.wait", "chrome.evaluate",
    "chrome.fill", "chrome.select", "chrome.click", "chrome.query",
)
UI_MUTATIONS = {"ui.invoke", "ui.click", "ui.set_value", "ui.select"}
ANDROID_MUTATIONS = {"android.click", "android.set_value", "android.swipe"}
CONTROL_TYPES = {
    "button": 50000, "calendar": 50001, "checkbox": 50002, "combobox": 50003,
    "edit": 50004, "hyperlink": 50005, "image": 50006, "listitem": 50007,
    "list": 50008, "menu": 50009, "menubar": 50010, "menuitem": 50011,
    "progressbar": 50012, "radiobutton": 50013, "scrollbar": 50014, "slider": 50015,
    "spinner": 50016, "statusbar": 50017, "tab": 50018, "tabitem": 50019,
    "text": 50020, "toolbar": 50021, "tooltip": 50022, "tree": 50023,
    "treeitem": 50024, "custom": 50025, "group": 50026, "thumb": 50027,
    "datagrid": 50028, "dataitem": 50029, "document": 50030, "splitbutton": 50031,
    "window": 50032, "pane": 50033, "header": 50034, "headeritem": 50035,
    "table": 50036, "titlebar": 50037, "separator": 50038,
}


def mutating(method: str, params: dict | None = None) -> bool:
    return (method.startswith("input.") or method in UI_MUTATIONS | ANDROID_MUTATIONS
            or method in {"chrome.fill", "chrome.select", "chrome.click", "chrome.navigate"}
            or method == "chrome.evaluate" and (params or {}).get("read_only") is not True)


def validate_flags(params: dict, *, references=False):
    for key in ("require_confirmation", "require_unique", "confirmed", "observed_password_focus", "allow_unobserved", "verify", "include_screenshot", "show_overlay",
                "restore_original_window", "show_action_trace", "visualize_actions", "horizontal", "read_only", "auto_start"):
        if key in params:
            value = params[key]
            require(type(value) is bool or references and isinstance(value, dict) and set(value) == {"$ref"},
                    "INVALID_ARGUMENT", f"{key} must be a boolean.")


def resolve_references(value, completed: dict):
    if isinstance(value, list):
        return [resolve_references(item, completed) for item in value]
    if not isinstance(value, dict):
        return value
    if set(value) == {"$ref"}:
        reference = value["$ref"]
        require(isinstance(reference, str) and len(reference) <= 512,
                "INVALID_REFERENCE", "A result reference must be a short string.")
        pieces = re.findall(r"([A-Za-z_][\w-]*)|\[(\d+)\]", reference)
        canonical = "".join(("." if index and name else "") + name if name else f"[{position}]"
                            for index, (name, position) in enumerate(pieces))
        require(canonical == reference and bool(pieces), "INVALID_REFERENCE", "Invalid result reference syntax.")
        current = completed
        try:
            for name, index in pieces:
                current = current[name] if name else current[int(index)]
        except (KeyError, IndexError, TypeError):
            raise DeskPilotError("INVALID_REFERENCE", "The referenced result is not available.") from None
        return copy.deepcopy(current)
    require("$ref" not in value, "INVALID_REFERENCE", "A result reference cannot contain other fields.")
    return {key: resolve_references(item, completed) for key, item in value.items()}


class Session:
    def __init__(self, *, desktop=None, browser=None, android_factory=None):
        self.id = "session_" + uuid.uuid4().hex
        self._tag = uuid.uuid4().hex[:10]
        self._desktop = desktop
        self._browser = browser
        self._windows = OrderedDict()
        self._elements = {}
        self._observations = {}
        self._android_observations = {}
        self._android_elements = {}
        self._android_factory = android_factory
        self._shots = OrderedDict()
        self._counter = 0
        self._cancelled = threading.Event()
        self._cancel_generation = 0
        self._active = False
        self._deadline = None
        self._lease = None
        self._lease_explicit = False
        self._original_foreground = None
        self._state_lock = threading.RLock()
        self._temporary = tempfile.TemporaryDirectory(prefix="deskpilot-")
        self._closed = False
        self._target = None
        self._dispatched = False
        self._activity_started = False

    @property
    def desktop(self):
        if self._desktop is None:
            from .platforms import create
            self._desktop = create()
        return self._desktop

    @property
    def browser(self):
        if self._browser is None:
            from .browser import Chrome
            self._browser = Chrome(self.checkpoint)
        return self._browser

    def _token(self, kind: str) -> str:
        self._counter += 1
        return f"{kind}_{self._tag}_{self._counter}"

    def checkpoint(self):
        if self._cancelled.is_set():
            raise DeskPilotError("CANCELLED", "The operation was cancelled.", outcome="unknown" if self._dispatched else "not_dispatched")
        if self._deadline is not None and time.monotonic() >= self._deadline:
            raise DeskPilotError("TIMEOUT", "The operation exceeded its time budget.", retryable=True,
                                 outcome="unknown" if self._dispatched else "not_dispatched")

    def request_cancel(self) -> dict:
        with self._state_lock:
            self._cancel_generation += 1
            self._cancelled.set()
            return {"status": "cancellation_requested" if self._active else "idle",
                    "session_id": self.id, "interaction_id": self._lease}

    @property
    def cancellation_generation(self):
        with self._state_lock:
            return self._cancel_generation

    def execute(self, method: str, params: dict | None = None, *, cancellation_generation=None):
        require(not self._closed or method == "close", "SESSION_CLOSED", "This session is closed.")
        require(method in METHODS, "UNKNOWN_METHOD", "The requested method is not supported.")
        require(isinstance(params or {}, dict), "INVALID_ARGUMENT", "params must be an object.")
        params = dict(params or {})
        if method == "interaction.cancel":
            return self.request_cancel()
        timeout = number(params.get("timeout_ms", 30000), "timeout_ms", minimum=0, maximum=3_600_000)
        with self._state_lock:
            require(cancellation_generation is None or cancellation_generation == self._cancel_generation or method == "close",
                    "CANCELLED", "This request was queued before cancellation and was not dispatched.")
            self._cancelled.clear()
            self._active = True
        self._dispatched = False
        self._activity_started = False
        self._deadline = time.monotonic() + timeout / 1000
        implicit = False
        try:
            if method == "input.secret" and params.get("target_kind") in ("native_password", "observed_opaque_password"):
                require(self._secret_capabilities()[params["target_kind"]]["implemented"], "UNSUPPORTED_PLATFORM",
                        "This platform backend does not implement native sensitive input.")
            if mutating(method, params):
                self._authorize(params)
                if not self._lease:
                    self._begin(params, explicit=False)
                    implicit = True
            result = self._dispatch(method, params)
            if isinstance(result, dict) and method != "close":
                result.setdefault("session_id", self.id)
            return result
        except DeskPilotError as exc:
            if exc.outcome == "unknown":
                self._invalidate()
            if exc.code == "CANCELLED" or self._cancelled.is_set():
                self._end(cancelled=True)
            raise
        except Exception as exc:
            if self._dispatched:
                self._invalidate()
            raise DeskPilotError("INTERNAL_ERROR", f"Operation failed ({type(exc).__name__}).",
                                 outcome="unknown" if self._dispatched else "not_dispatched") from None
        finally:
            if implicit and self._lease:
                self._end(restore=params.get("restore_original_window", True))
            if self._activity_started and self._desktop is not None:
                finish = getattr(self._desktop, "activity_done", None)
                if finish:
                    try:
                        finish()
                    except (DeskPilotError, OSError):
                        pass
                self._activity_started = False
            with self._state_lock:
                self._active = False
            self._deadline = None

    def _authorize(self, params: dict):
        require(not params.get("require_confirmation") or params.get("confirmed") is True,
                "NEED_USER_CONFIRMATION", "The caller requested explicit confirmation for this operation.")

    def _secret_capabilities(self):
        # Discovery must also work without initializing a native desktop.
        native = (callable(getattr(self._desktop, "type_secret", None)) if self._desktop is not None
                  else platform_key() == "windows-x64")
        return {"native_password": {"implemented": native},
                "observed_opaque_password": {"implemented": native},
                "android_password": {"implemented": True, "requires": "bound_local_emulator_and_focused_password_control"}}

    def _begin(self, params: dict, *, explicit=True) -> dict:
        require(not self._lease, "INTERACTION_ALREADY_ACTIVE", "An interaction is already active in this session.")
        self._lease = self._token("interaction")
        self._lease_explicit = explicit
        try:
            self._original_foreground = self.desktop.foreground()
        except DeskPilotError:
            self._original_foreground = None
        self._overlay_requested = bool(params.get("show_overlay", True))
        self._trace_requested = bool(params.get("show_action_trace", params.get("visualize_actions", False)))
        return {"interaction_id": self._lease, "status": "active", "session_id": self.id}

    def _end(self, *, cancelled=False, restore=True) -> dict:
        existed = bool(self._lease)
        restored = False
        self._activity_started = False
        if self._desktop is not None:
            try:
                self._desktop.activity(None, "Cancelled" if cancelled else "Ready", visible=False)
                if restore and self._original_foreground:
                    restored = self._desktop.restore(self._original_foreground)
            except (DeskPilotError, OSError):
                pass
        self._lease = None
        self._lease_explicit = False
        self._original_foreground = None
        if restored:
            self._invalidate()
        return {"status": "cancelled" if cancelled else "idle", "interaction_was_active": existed,
                "restored_original_window": restored, "session_id": self.id}

    def _activity(self, window: dict | None, method: str, params: dict, point=None):
        if params.get("show_overlay", getattr(self, "_overlay_requested", True)):
            try:
                trace = point if params.get("show_action_trace", getattr(self, "_trace_requested", False)) else None
                self.desktop.activity(window, str(params.get("action_label", method))[:120], visible=True, trace=trace)
                self._activity_started = True
            except (OSError, DeskPilotError):
                if params.get("overlay_required"):
                    raise DeskPilotError("OVERLAY_UNAVAILABLE", "The desktop activity indicator could not be shown.") from None

    def _invalidate(self, window_id=None):
        if window_id is None:
            self._observations.clear()
            self._elements.clear()
            self._android_observations.clear()
            self._android_elements.clear()
        else:
            self._observations.pop(window_id, None)
            self._elements = {key: item for key, item in self._elements.items() if item["window_id"] != window_id}
            self._android_observations.pop(window_id, None)
            self._android_elements = {key: item for key, item in self._android_elements.items() if item["window_id"] != window_id}
        for shot in self._shots.values():
            if window_id is None or shot["window_id"] == window_id:
                shot["current"] = False

    def _register(self, native: dict) -> tuple[str, dict]:
        for window_id, previous in self._windows.items():
            if previous["identity"] == native["identity"]:
                self._windows[window_id] = native
                return window_id, native
        window_id = self._token("window")
        self._windows[window_id] = native
        while len(self._windows) > 256:
            expired, _ = self._windows.popitem(last=False)
            self._invalidate(expired)
        return window_id, native

    def _public_window(self, window_id, native: dict) -> dict:
        return {"window_id": window_id, **{key: value for key, value in native.items() if key not in {"native", "identity"}}}

    def _window_matches(self, item: dict, params: dict) -> bool:
        title = str(params.get("title", params.get("title_contains", "")))
        exact = params.get("title_exact")
        process = str(params.get("process", params.get("process_name", params.get("app", "")))).lower().removesuffix(".exe")
        class_name = params.get("window_class_name", params.get("class_name", params.get("class")))
        return ((not title or title.casefold() in item.get("title", "").casefold())
                and (exact is None or str(exact).casefold() == item.get("title", "").casefold())
                and (not process or process == item.get("process", "").lower().removesuffix(".exe"))
                and ("pid" not in params or params["pid"] == item.get("pid"))
                and (class_name is None or str(class_name) == item.get("class_name")))

    def _find_windows(self, params: dict):
        return [self._register(item) for item in self.desktop.windows() if self._window_matches(item, params)]

    def _window(self, params: dict, *, activate=False):
        window_id = params.get("window_id")
        if window_id is not None:
            require(window_id in self._windows, "WINDOW_NOT_FOUND", "The window reference does not belong to this session.")
            previous = self._windows[window_id]
            item = self.desktop.window(previous["native"])
            require(item["identity"] == previous["identity"], "WINDOW_IDENTITY_MISMATCH", "The window identity changed.")
            require(self._window_matches(item, params), "WINDOW_IDENTITY_MISMATCH", "The current window does not match the requested selector.")
        elif any(key in params for key in ("title", "title_contains", "title_exact", "process", "process_name", "app", "pid", "window_class_name", "class_name", "class")):
            matches = self._find_windows(params)
            require(bool(matches), "WINDOW_NOT_FOUND", "No window matches the requested selector.", retryable=True)
            require(len(matches) == 1, "WINDOW_AMBIGUOUS", "More than one window matches; use an exact selector or window_id.", details={"count": len(matches)})
            window_id, item = matches[0]
        elif self._target and self._target in self._windows:
            window_id, item = self._window({"window_id": self._target}, activate=False)
        else:
            raise DeskPilotError("WINDOW_REQUIRED", "Supply a window reference or an unambiguous window selector.")
        if activate:
            item = self.desktop.activate(item, checkpoint=self.checkpoint)
        self._windows[window_id] = item
        self._target = window_id
        return window_id, item

    def _android_observe(self, params):
        from .android import AndroidBridge
        window_id, window = self._window(params, activate=True)
        limit = int(number(params.get("limit", 1000), "limit", minimum=1, maximum=5000))
        executable = self.desktop.process_path(window["pid"]) if hasattr(self.desktop, "process_path") else ""
        factory = self._android_factory or AndroidBridge
        bridge = factory(window, executable=executable, adb_path=params.get("adb_path"), checkpoint=self.checkpoint)
        nodes, truncated = bridge.observe(limit=limit)
        self._invalidate(window_id)
        observation_id = self._token("android_observation")
        self._android_observations[window_id] = {"id": observation_id, "identity": window["identity"],
                                                 "bounds": dict(window["bounds"]), "title": window.get("title", ""),
                                                 "bridge": bridge}
        public = []
        indexes = {node["path"]: index for index, node in enumerate(nodes)}
        for node in nodes:
            element_id = self._token("android_element")
            self._android_elements[element_id] = {"node": node, "window_id": window_id, "observation_id": observation_id}
            ancestors = [node["path"][:length] for length in range(len(node["path"]) - 1, 0, -1)]
            parent = next((indexes[path] for path in ancestors if path in indexes), None)
            public.append({**{key: value for key, value in node.items() if key != "path"},
                           "parent": parent, "element_id": element_id, "observation_id": observation_id})
        return {"window": self._public_window(window_id, window), "device_id": bridge.serial,
                "observation_id": observation_id, "elements": public, "count": len(public), "truncated": truncated}

    def _android_element(self, params):
        from .android import signature
        item = self._android_elements.get(params.get("element_id"))
        require(item is not None and item["observation_id"] == params.get("observation_id"),
                "STALE_OBSERVATION", "The Android control reference is no longer current; observe again.")
        window_id = item["window_id"]
        observation = self._android_observations.get(window_id)
        require(observation is not None and observation["id"] == item["observation_id"],
                "STALE_OBSERVATION", "The Android observation is no longer current.")
        require(params.get("window_id", window_id) == window_id, "WINDOW_IDENTITY_MISMATCH",
                "The Android control belongs to a different window.")
        _, window = self._window({"window_id": window_id}, activate=True)
        require(window["identity"] == observation["identity"] and window["bounds"] == observation["bounds"]
                and window.get("title", "") == observation["title"],
                "STALE_OBSERVATION", "The emulator window changed; observe again.")
        bridge = observation["bridge"]
        nodes, truncated = bridge.observe(limit=5000)
        matches = [node for node in nodes if node["path"] == item["node"]["path"]]
        require(not truncated and len(matches) == 1 and signature(matches[0]) == signature(item["node"]),
                "STALE_OBSERVATION", "The Android control changed; observe again.")
        # The guest hierarchy request can take seconds. Reconfirm the selected
        # host window immediately before input, without retrying any action.
        _, window = self._window({"window_id": window_id}, activate=True)
        require(window["identity"] == observation["identity"] and window["bounds"] == observation["bounds"]
                and window.get("title", "") == observation["title"],
                "STALE_OBSERVATION", "The emulator window changed; observe again.")
        return window_id, window, bridge, matches[0], nodes

    def _android_guard(self, window):
        self.checkpoint()
        current = self.desktop.window(window["native"])
        require(current["identity"] == window["identity"] and current["bounds"] == window["bounds"]
                and current.get("title", "") == window.get("title", ""),
                "STALE_OBSERVATION", "The emulator window changed during input.",
                outcome="unknown" if self._dispatched else "not_dispatched")
        foreground = self.desktop.foreground()
        details = {}
        if foreground and foreground != window["native"]:
            try:
                other = self.desktop.window(foreground)
                details = {"foreground_pid": other.get("pid"), "foreground_process": other.get("process")}
            except (DeskPilotError, OSError):
                pass
        require(foreground == window["native"], "WINDOW_NOT_FOREGROUND",
                "The selected emulator must remain in the foreground during input.",
                details=details, outcome="unknown" if self._dispatched else "not_dispatched")

    def _android_input_guard(self, window, bridge, node):
        from .android import signature
        self._android_guard(window)
        current, truncated = bridge.observe(limit=5000)
        matches = [value for value in current if value["path"] == node["path"]]
        require(not truncated and len(matches) == 1 and signature(matches[0]) == signature(node)
                and matches[0]["enabled"] and matches[0]["editable"] and matches[0]["focused"],
                "SENSITIVE_FOCUS_NOT_CONFIRMED" if node["password"] else "ANDROID_FOCUS_NOT_CONFIRMED",
                "The Android input target or focus changed; observe before any retry.",
                outcome="unknown" if self._dispatched else "not_dispatched")
        # A hierarchy read may take seconds; the host must still match afterwards.
        self._android_guard(window)

    def _android_mutation(self, method, params):
        from .android import key_events, signature
        events = None
        if method == "android.set_value":
            require(isinstance(params.get("value"), str), "INVALID_ARGUMENT", "value must be a string.")
            events = ["input keycombination 113 29", "input keyevent 67", *key_events(params["value"])]
        window_id, window, bridge, node, nodes = self._android_element(params)
        require(node["enabled"], "ELEMENT_NOT_ACTIONABLE", "The Android control is not enabled.")
        if method == "android.set_value":
            require(node["editable"] and not node["password"], "SENSITIVE_INPUT_BLOCKED",
                    "Use the authorized sensitive-input operation for password controls.")
            require(node["focused"], "ANDROID_FOCUS_NOT_CONFIRMED", "Focus the Android control and observe it again.")
        if method == "android.swipe":
            require(node["scrollable"], "ELEMENT_NOT_ACTIONABLE", "Choose a currently observed scrollable Android control.")
            def coordinate(value, name):
                require(isinstance(value, dict), "INVALID_ARGUMENT", f"{name} must be a point.")
                return (int(number(value.get("x"), f"{name}.x")), int(number(value.get("y"), f"{name}.y")))
            start, end = coordinate(params.get("start"), "start"), coordinate(params.get("end"), "end")
            duration = int(number(params.get("duration_ms", 400), "duration_ms", minimum=100, maximum=3000))
            area = node["bounds"]
            def inside(point):
                return (area["x"] <= point[0] < area["x"] + area["width"]
                        and area["y"] <= point[1] < area["y"] + area["height"])
            require(inside(start) and inside(end) and start != end, "INVALID_ARGUMENT",
                    "The swipe endpoints must be distinct points inside the selected scrollable control.")
            for x, y in (start, end):
                def blocks(other):
                    path = other["path"]
                    parent_of_target = node["path"][:len(path)] == path
                    area = other["bounds"]
                    return (other["clickable"] and not parent_of_target and area["x"] <= x < area["x"] + area["width"]
                            and area["y"] <= y < area["y"] + area["height"])
                require(not any(blocks(other) for other in nodes), "ANDROID_TARGET_OVERLAPPED",
                        "Another Android control overlaps a swipe endpoint; observe or reposition it before swiping.")
        self._activity(window, method, params)
        guard = lambda: self._android_guard(window)
        def dispatched():
            self._dispatched = True
        try:
            if method == "android.click":
                area = node["bounds"]
                x, y = area["x"] + area["width"] // 2, area["y"] + area["height"] // 2
                def unrelated(other):
                    left, right = node["path"], other["path"]
                    return left[:len(right)] != right and right[:len(left)] != left
                def covers(other):
                    bounds = other["bounds"]
                    return (bounds["x"] <= x < bounds["x"] + bounds["width"]
                            and bounds["y"] <= y < bounds["y"] + bounds["height"])
                require(not any(other["clickable"] and unrelated(other) and covers(other) for other in nodes),
                        "ANDROID_TARGET_OVERLAPPED", "Another Android control overlaps this target; observe or reposition it before clicking.")
                bridge.tap(x, y, guard, dispatched)
                verification = {"status": "not_checked"}
            elif method == "android.swipe":
                bridge.swipe(start, end, duration, guard, dispatched)
                verification = {"status": "not_checked"}
            else:
                bridge.send_keys(events, guard, dispatched,
                                 before_key=lambda: self._android_input_guard(window, bridge, node))
                current, truncated = bridge.observe(limit=5000)
                matches = [value for value in current if value["path"] == node["path"]]
                require(not truncated and len(matches) == 1 and signature(matches[0]) == signature(node)
                        and matches[0]["focused"] and matches[0]["text"] == params["value"],
                        "ANDROID_VALUE_NOT_VERIFIED", "The Android field value could not be confirmed; observe before any retry.",
                        outcome="unknown")
                verification = {"status": "matched", "method": "android_accessibility"}
        except DeskPilotError as error:
            if self._dispatched:
                error.outcome = "unknown"
            raise
        finally:
            if self._dispatched:
                self._invalidate(window_id)
        return {"dispatched": True, "verification": verification, "window": self._public_window(window_id, window)}

    def _android_secret(self, params):
        from .android import key_events
        from .secret import read_local_secret
        require(params.get("confirmed") is True and params.get("purpose") == "authorized_local_test",
                "SENSITIVE_INPUT_BLOCKED", "Sensitive input requires an authorized local test and explicit acknowledgement.")
        require(not any(key in params for key in ("text", "value", "secret", "password", "verify", "keyboard", "submit_point")),
                "INVALID_ARGUMENT", "Provide only a secret reference and a current Android password control.")
        window_id, window, bridge, node, _ = self._android_element(params)
        require(node["enabled"] and node["editable"] and node["password"] and node["focused"],
                "SENSITIVE_FOCUS_NOT_CONFIRMED", "Focus the Android password control and observe it again.")
        require(isinstance(params.get("expected_package"), str) and params["expected_package"] == node["package"],
                "ANDROID_DEVICE_MISMATCH", "Confirm the observed Android application package before sensitive input.")
        secret = read_local_secret(params.get("secret_ref"))
        try:
            events = key_events(secret)
            self._activity(window, "input.secret", params)
            def dispatched():
                self._dispatched = True
            bridge.send_keys(events, lambda: self._android_guard(window), dispatched,
                             before_key=lambda: self._android_input_guard(window, bridge, node))
            self._android_input_guard(window, bridge, node)
        except DeskPilotError as error:
            if self._dispatched:
                error.outcome = "unknown"
            raise
        finally:
            secret = None
            if self._dispatched:
                self._invalidate(window_id)
        return {"dispatched": True, "verification": "not_read", "submit_dispatched": False,
                "window": self._public_window(window_id, window)}

    def _observe(self, params: dict, *, find=False):
        # For a control search, class_name is an element filter. Window class
        # remains available through window_class_name (or the existing class alias).
        window_params = {key: value for key, value in params.items() if not (find and key == "class_name")}
        window_id, window = self._window(window_params, activate=True)
        self._activity(window, "Observe", params)
        depth = int(number(params.get("depth", params.get("max_depth", 8)), "depth", minimum=0, maximum=64))
        limit = int(number(params.get("limit", params.get("max_nodes", 500)), "limit", minimum=1, maximum=5000))
        scope = params.get("search_scope", "tree")
        require(scope in ("tree", "subtree") and (find or scope == "tree"),
                "INVALID_ARGUMENT", "search_scope must be tree, or subtree for a control search.")
        filters = {key: params[key] for key in ("name", "automation_id", "class_name", "name_contains", "enabled", "offscreen")
                   if key in params} if find else {}
        control_type = params.get("control_type", params.get("type")) if find else None
        if control_type is not None:
            filters["control_type"] = CONTROL_TYPES.get(str(control_type).lower().replace("controltype.", ""), control_type)
        if scope == "subtree":
            require("depth" not in params and "max_depth" not in params,
                    "INVALID_ARGUMENT", "subtree search does not accept a depth limit.")
            identifier = params.get("automation_id")
            require(isinstance(identifier, str) and bool(identifier), "INVALID_ARGUMENT",
                    "subtree search requires a non-empty exact automation_id.")
            require(hasattr(self.desktop, "find_exact_id"), "UNSUPPORTED_PLATFORM",
                    "subtree control search is not supported on this platform.")
            nodes, truncated = self.desktop.find_exact_id(window, identifier=identifier, limit=limit,
                                                          checkpoint=self.checkpoint)
        elif filters and hasattr(self.desktop, "find_tree"):
            nodes = self.desktop.find_tree(window, depth=depth, limit=limit, checkpoint=self.checkpoint, filters=filters)
            truncated = len(nodes) >= limit
        else:
            nodes = self.desktop.tree(window, depth=depth, limit=limit, checkpoint=self.checkpoint)
            truncated = len(nodes) >= limit
        self._invalidate(window_id)
        observation_id = self._token("observation")
        self._observations[window_id] = {"id": observation_id, "identity": window["identity"],
                                         "bounds": dict(window["bounds"]), "title": window.get("title", "")}
        public = []
        for node in nodes:
            if node.get("_filtered_out") or find and not self._element_matches(node, params):
                continue
            element_id = self._token("element")
            self._elements[element_id] = {"native": node["native"], "window_id": window_id,
                                          "observation_id": observation_id,
                                          "observed": copy.deepcopy({key: node.get(key) for key in ("name", "bounds", "control_type")})}
            item = {key: value for key, value in node.items() if key != "native"}
            item["element_id"] = element_id
            item["observation_id"] = observation_id
            public.append(item)
        result = {"window": self._public_window(window_id, window), "observation_id": observation_id,
                  "elements": public, "count": len(public), "truncated": truncated}
        if find and params.get("require_unique"):
            require(not truncated, "UI_AUTOMATION_INCOMPLETE", "The search was truncated; uniqueness cannot be established.",
                    details={"count": len(public), "truncated": True})
            require(len(public) == 1, "ELEMENT_NOT_FOUND" if not public else "ELEMENT_NOT_UNIQUE",
                    "The search must identify exactly one control.", retryable=not public, details={"count": len(public)})
        if getattr(self.desktop, "tree_backend", None):
            result["tree_backend"] = self.desktop.tree_backend
        return result

    def _element_matches(self, item: dict, params: dict) -> bool:
        for key in ("name", "automation_id", "class_name"):
            if key in params and str(item.get(key, "")) != str(params[key]):
                return False
        if "name_contains" in params and str(params["name_contains"]).casefold() not in item.get("name", "").casefold():
            return False
        control_type = params.get("control_type", params.get("type"))
        if control_type is not None:
            expected = CONTROL_TYPES.get(str(control_type).lower().replace("controltype.", ""), control_type)
            if item.get("control_type") != expected:
                return False
        for key in ("enabled", "offscreen"):
            if key in params and bool(item.get(key)) != bool(params[key]):
                return False
        return True

    def _element(self, params: dict):
        element_id = params.get("element_id")
        require(element_id in self._elements, "STALE_OBSERVATION", "The element reference is no longer current; observe again.")
        item = self._elements[element_id]
        require(params.get("observation_id") == item["observation_id"], "STALE_OBSERVATION", "Supply the element's owning observation_id.")
        window_id, window = self._window({"window_id": item["window_id"]}, activate=True)
        self._check_observation(window_id, window, params["observation_id"])
        return item["native"], window_id, window

    def _check_observation(self, window_id, window, observation_id):
        observed = self._observations.get(window_id)
        require(observed is not None and observed["id"] == observation_id
                and observed["identity"] == window["identity"] and observed["bounds"] == window["bounds"]
                and observed["title"] == window.get("title", ""),
                "STALE_OBSERVATION", "The observation no longer describes this window; observe again.")

    def _stable_control(self, native, window_id, observed, *, coordinate=False):
        first = self.desktop.element_info(native)
        self._cancelled.wait(0.05)
        self.checkpoint()
        second = self.desktop.element_info(native)
        _, current = self._window({"window_id": window_id})
        self._check_observation(window_id, current, self._observations[window_id]["id"])
        unchanged = (first["bounds"] == second["bounds"]
                     and first.get("name") == second.get("name")
                     and ("name" not in second or second["name"] == observed.get("name"))
                     and (not coordinate or second["bounds"] == observed.get("bounds")))
        if not unchanged:
            self._invalidate(window_id)
            raise DeskPilotError("STALE_OBSERVATION", "The observed control changed or moved; locate the target again.")
        require(second.get("enabled") and not second.get("offscreen"), "ELEMENT_NOT_ACTIONABLE",
                "The control is not enabled and visible.")
        return second

    def _coordinate_control(self, params, window_id, window, x, y, *, allow_container):
        absolute_x, absolute_y = window["bounds"]["x"] + x, window["bounds"]["y"] + y
        candidates = []
        for element_id, item in self._elements.items():
            if item["window_id"] != window_id or item["observation_id"] != params.get("observation_id"):
                continue
            area = item["observed"].get("bounds")
            if (area and area["x"] <= absolute_x < area["x"] + area["width"]
                    and area["y"] <= absolute_y < area["y"] + area["height"]
                    and (not params.get("element_id") or params["element_id"] == element_id)):
                candidates.append((area["width"] * area["height"], item))
        candidates.sort(key=lambda item: item[0])
        require(candidates and (len(candidates) == 1 or candidates[0][0] < candidates[1][0]),
                "COORDINATE_TARGET_REQUIRED", "Choose a unique observed control at this point, or use a current screenshot.")
        item = candidates[0][1]
        container = item["observed"].get("control_type") in (50008, 50009, 50010, 50021, 50023, 50025, 50026, 50028, 50030, 50032, 50033, 50036)
        require(not container or allow_container and params.get("element_id"),
                "COORDINATE_TARGET_REQUIRED", "Container scrolling requires its element_id; a coordinate click inside a container requires a screenshot.")
        self._stable_control(item["native"], window_id, item["observed"], coordinate=True)

    def _coordinate_frame(self, params, window_id, window, shot, x, y):
        from .screen import target_region_changed
        image = shot["image"]
        region = (bounds(params["target_region"]) if params.get("target_region") is not None else
                  {"x": max(0, x - 24), "y": max(0, y - 24),
                   "width": min(image.width, x + 25) - max(0, x - 24),
                   "height": min(image.height, y + 25) - max(0, y - 24)})
        require(0 <= region["x"] <= x < region["x"] + region["width"] <= image.width
                and 0 <= region["y"] <= y < region["y"] + region["height"] <= image.height,
                "INVALID_ARGUMENT", "target_region must contain the point and lie within its screenshot.")
        for sample in range(2):
            self.checkpoint()
            if sample:
                self._cancelled.wait(0.05)
                self.checkpoint()
            current_image, evidence = self.desktop.capture(window, checkpoint=self.checkpoint)
            _, current_window = self._window({"window_id": window_id})
            same_window = (current_window["identity"] == window["identity"] and current_window["bounds"] == window["bounds"]
                           and current_window.get("title", "") == window.get("title", ""))
            origin = evidence.get("origin", {"x": window["bounds"]["x"], "y": window["bounds"]["y"]})
            require(evidence.get("trusted") is True, "WINDOW_CAPTURE_UNTRUSTED", "The current target frame could not be trusted.")
            if (not same_window or origin != shot["origin"]
                    or evidence.get("capture_scope") != shot["evidence"].get("capture_scope")
                    or target_region_changed(image, current_image, region, self.checkpoint)):
                self._invalidate(window_id)
                raise DeskPilotError("STALE_OBSERVATION", "The target region changed; capture and locate the target again.",
                                     details={"target_region": region})

    def _coordinate(self, params: dict, *, activate=True, allow_container=False):
        window_id, window = self._window(params, activate=activate)
        shot = None
        if not params.get("allow_unobserved", False):
            if params.get("screenshot_id"):
                shot = self._shots.get(params["screenshot_id"])
                require(shot is not None and shot["current"] and shot["window_id"] == window_id
                        and shot["bounds"] == window["bounds"] and shot["title"] == window.get("title", ""),
                        "STALE_OBSERVATION", "The screenshot no longer describes this window.")
            else:
                self._check_observation(window_id, window, params.get("observation_id"))
        # Screenshot coordinates refer to the actual captured image. A Windows
        # compositor frame can start inside the invisible resize border, unlike
        # a full-window screen copy. Convert once to window-relative input.
        width = shot["image"].width if shot else window["bounds"]["width"]
        height = shot["image"].height if shot else window["bounds"]["height"]
        x = int(number(params.get("x"), "x", minimum=0, maximum=width - 1))
        y = int(number(params.get("y"), "y", minimum=0, maximum=height - 1))
        if shot:
            self._coordinate_frame(params, window_id, window, shot, x, y)
            x += shot["origin"]["x"] - window["bounds"]["x"]
            y += shot["origin"]["y"] - window["bounds"]["y"]
            require(0 <= x < window["bounds"]["width"] and 0 <= y < window["bounds"]["height"],
                    "WINDOW_CAPTURE_UNTRUSTED", "The screenshot coordinate is outside its target window.")
        elif not params.get("allow_unobserved", False):
            self._coordinate_control(params, window_id, window, x, y, allow_container=allow_container)
        target_content_only = bool(shot and shot["evidence"].get("capture_scope") == "target_window_only")
        return window_id, window, x, y, target_content_only

    def _capture(self, params: dict):
        window_id, window = self._window(params, activate=True)
        image, evidence = self.desktop.capture(window, checkpoint=self.checkpoint)
        require(evidence.get("trusted") is True, "WINDOW_CAPTURE_UNTRUSTED", "The backend could not establish capture ownership.")
        origin = evidence.get("origin", {"x": window["bounds"]["x"], "y": window["bounds"]["y"]})
        area = window["bounds"]
        require(isinstance(origin, dict) and type(origin.get("x")) is int and type(origin.get("y")) is int
                and area["x"] <= origin["x"] and area["y"] <= origin["y"]
                and origin["x"] + image.width <= area["x"] + area["width"]
                and origin["y"] + image.height <= area["y"] + area["height"],
                "WINDOW_CAPTURE_UNTRUSTED", "The screenshot geometry is outside its target window.")
        screenshot_id = self._token("screenshot")
        path = Path(params["path"]) if params.get("path") else Path(self._temporary.name) / f"{screenshot_id}.png"
        require(path.is_absolute(), "INVALID_ARGUMENT", "An explicit screenshot output path must be absolute.")
        require(path.parent.is_dir(), "OUTPUT_UNAVAILABLE", "The screenshot output directory does not exist.")
        try:
            path.write_bytes(image.png())
        except OSError:
            raise DeskPilotError("OUTPUT_UNAVAILABLE", "The screenshot output path is not writable.") from None
        self._shots[screenshot_id] = {"image": image, "path": path, "owned": not bool(params.get("path")),
                                     "window_id": window_id, "bounds": dict(window["bounds"]),
                                     "origin": dict(origin), "title": window.get("title", ""),
                                     "current": True, "evidence": evidence}
        for old_id, shot in self._shots.items():
            if old_id != screenshot_id and shot["window_id"] == window_id:
                shot["current"] = False
        while len(self._shots) > 24:
            _, expired = self._shots.popitem(last=False)
            if expired["owned"]:
                expired["path"].unlink(missing_ok=True)
        return {"window": self._public_window(window_id, window), "screenshot": {
            "screenshot_id": screenshot_id, "path": str(path), "mime_type": "image/png", "size": path.stat().st_size,
            "width": image.width, "height": image.height, "origin": origin, **evidence}}

    def _read_text(self, params: dict, *, messages=False):
        from .screen import Ocr
        if params.get("screenshot_id"):
            shot_id = params["screenshot_id"]
            shot = self._shots.get(shot_id)
            require(shot is not None and shot["current"], "STALE_OBSERVATION", "Use a current session-owned screenshot.")
            window_id, window = self._window({"window_id": shot["window_id"]}, activate=False)
            require(window["bounds"] == shot["bounds"] and window.get("title", "") == shot["title"],
                    "STALE_OBSERVATION", "The screenshot's window changed.")
            capture = {"window": self._public_window(window_id, window), "screenshot": {
                "screenshot_id": shot_id, "path": str(shot["path"]), "width": shot["image"].width,
                "height": shot["image"].height, "origin": shot["origin"], **shot["evidence"]}}
        else:
            capture = self._capture(params)
            shot_id = capture["screenshot"]["screenshot_id"]
            shot = self._shots[shot_id]
        if not hasattr(self, "_ocr"):
            self._ocr = Ocr()
        full = {"x": 0, "y": 0, "width": shot["image"].width, "height": shot["image"].height}

        def region(value):
            area = bounds(value)
            require(area["x"] >= 0 and area["y"] >= 0 and area["x"] + area["width"] <= full["width"]
                    and area["y"] + area["height"] <= full["height"], "INVALID_ARGUMENT", "The text region must be inside the screenshot.")
            return area

        selected = region(params.get("region", full))
        recognition = self._ocr.read(shot["image"].crop(selected), self.checkpoint, include_words=bool(params.get("include_words", False)))
        for block in recognition["blocks"]:
            block["bounds"]["x"] += selected["x"]
            block["bounds"]["y"] += selected["y"]
        recognition.update({"width": full["width"], "height": full["height"], "region": selected})
        result = {**capture, "recognition": recognition}
        if not messages:
            return result
        identity_region = region(params.get("identity_region", full))
        content_region = region(params.get("content_region", params.get("message_region", full)))

        def contained(block, region):
            area = block["bounds"]
            x, y = area["x"] + area["width"] / 2, area["y"] + area["height"] / 2
            return region["x"] <= x < region["x"] + region["width"] and region["y"] <= y < region["y"] + region["height"]

        identity = [item for item in recognition["blocks"] if contained(item, identity_region)]
        content = [item for item in recognition["blocks"] if contained(item, content_region)]
        observed_text = "\n".join(item["text"] for item in identity)
        expected = params.get("expected_identity", params.get("expected_context", []))
        expected = [expected] if isinstance(expected, str) else expected
        require(isinstance(expected, list) and all(isinstance(item, str) and bool(item.strip()) for item in expected),
                "INVALID_ARGUMENT", "expected_identity must contain nonempty strings.")
        mode = params.get("identity_match", "all")
        require(mode in {"all", "any"}, "INVALID_ARGUMENT", "identity_match must be all or any.")
        normalized = "".join(observed_text.split()).casefold()
        matched = [item for item in expected if "".join(item.split()).casefold() in normalized]
        require(not expected or (len(matched) == len(expected) if mode == "all" else bool(matched)),
                "CONTEXT_IDENTITY_MISMATCH", "The visible identity does not match the requested context.")
        candidates = []
        for index, item in enumerate(content):
            area = item["bounds"]
            center = (area["x"] + area["width"] / 2 - content_region["x"]) / content_region["width"]
            side = "left" if center < 0.4 else "right" if center > 0.6 else "center"
            candidates.append({"candidate_id": f"candidate_{index + 1}", "sequence": index + 1,
                               "text": item["text"], "bounds": area, "source_block_id": item["block_id"],
                               "side": side, "role_hint": {"left": "incoming", "right": "outgoing"}.get(side, "system_or_unknown"),
                               "confidence": item.get("confidence")})
        result.update({"context_identity": {"expected": expected, "matched": True if expected else None,
                                             "status": "matched" if expected else "not_requested", "matched_terms": matched,
                                             "match_mode": mode, "observed_text": observed_text, "region": identity_region},
                       "message_candidates": candidates, "message_region": content_region, "count": len(candidates)})
        return result

    def _wait(self, method: str, params: dict):
        interval = number(params.get("poll_ms", 100), "poll_ms", minimum=10, maximum=10000) / 1000
        stable = number(params.get("stable_ms", 0), "stable_ms", minimum=0, maximum=120000) / 1000
        require(not (method == "wait.element" and params.get("require_unique") and params.get("state") in {"absent", "hidden"}),
                "INVALID_ARGUMENT", "An absence wait cannot require a unique control.")
        first = None
        while True:
            self.checkpoint()
            try:
                if method == "wait.window":
                    matches = self._find_windows(params)
                    result = {"windows": [self._public_window(*item) for item in matches], "count": len(matches)}
                else:
                    result = self._observe(params, find=True)
                present = bool(result["count"])
                if method == "wait.element" and not present and result.get("truncated") and params.get("state") in {"absent", "hidden"}:
                    raise DeskPilotError("UI_AUTOMATION_INCOMPLETE", "The search was truncated; absence cannot be established.")
                desired = present if params.get("state", "present") not in {"absent", "hidden"} else not present
                if desired:
                    first = first or time.monotonic()
                    if time.monotonic() - first >= stable:
                        return result
                else:
                    first = None
            except DeskPilotError as exc:
                if exc.code not in {"WINDOW_NOT_FOUND", "ELEMENT_UNAVAILABLE", "ELEMENT_NOT_FOUND"}:
                    raise
                first = None
            self._cancelled.wait(interval)

    def _batch(self, params: dict, *, workflow=False):
        steps = params.get("steps", params.get("actions"))
        require(isinstance(steps, list) and 0 < len(steps) <= 32, "INVALID_BATCH", "A batch must contain 1 to 32 steps.")
        normalized, names = [], set()
        for index, step in enumerate(steps):
            require(isinstance(step, dict), "INVALID_BATCH", "Each batch step must be an object.")
            name = step.get("step_id", step.get("id", f"step_{index + 1}"))
            method = step.get("method", step.get("op"))
            arguments = step.get("params", step.get("parameters", {}))
            require(isinstance(name, str) and re.fullmatch(r"[A-Za-z_][\w-]*", name) and name not in names,
                    "INVALID_BATCH", "Step identifiers must be unique simple names.")
            require(method in METHODS and method not in {"close", "actions.batch", "workflow.run", "input.secret"}
                    and not method.startswith("interaction."), "INVALID_BATCH", "This method cannot run inside a batch.")
            require(isinstance(arguments, dict), "INVALID_BATCH", "Step params must be an object.")
            validate_flags(arguments, references=True)
            names.add(name)
            normalized.append((name, method, arguments))
        if any(mutating(method, arguments) for _, method, arguments in normalized):
            self._authorize(params)
        completed, results = {}, []
        mutation_occurred = False
        implicit = False
        if not self._lease:
            self._begin(params, explicit=False)
            implicit = True
        try:
            for name, method, arguments in normalized:
                self._dispatched = False
                parent_deadline = self._deadline
                try:
                    self.checkpoint()
                    arguments = resolve_references(arguments, completed)
                    if "timeout_ms" in arguments:
                        budget = number(arguments["timeout_ms"], "timeout_ms", minimum=0, maximum=3_600_000) / 1000
                        self._deadline = min(parent_deadline, time.monotonic() + budget)
                    if mutating(method, arguments):
                        self._authorize(arguments)
                    result = self._dispatch(method, arguments)
                    item = {"step_id": name, "ok": True, "result": result, "outcome": "completed"}
                except DeskPilotError as exc:
                    unknown = exc.outcome == "unknown"
                    if unknown:
                        self._invalidate()
                        exc.outcome = "unknown"
                    results.append({"step_id": name, "ok": False, "error": exc.body(), "outcome": exc.outcome})
                    status = "cancelled" if exc.code == "CANCELLED" else "unknown" if unknown else "partial" if len(results) > 1 else "not_started"
                    details = {"status": status, "steps": results, "failed_step_id": name,
                               "cause_code": exc.code, "quiescent": True, "remaining_steps": len(normalized) - len(results), "session_id": self.id}
                    code = "BATCH_OUTCOME_UNKNOWN" if unknown else "BATCH_STEP_FAILED" if len(results) > 1 and exc.code != "CANCELLED" else exc.code
                    raise DeskPilotError(code, str(exc), retryable=exc.retryable and not mutation_occurred,
                                         details=details, outcome="unknown" if unknown else exc.outcome) from None
                except Exception as exc:
                    unknown = self._dispatched and mutating(method, arguments)
                    self._invalidate()
                    failure = DeskPilotError("INTERNAL_ERROR", f"Operation failed ({type(exc).__name__}).", outcome="unknown" if unknown else "not_dispatched")
                    results.append({"step_id": name, "ok": False, "error": failure.body(), "outcome": failure.outcome})
                    raise DeskPilotError("BATCH_OUTCOME_UNKNOWN" if unknown else failure.code, str(failure),
                                         details={"status": "paused", "steps": results, "failed_step_id": name, "quiescent": True},
                                         outcome=failure.outcome) from None
                finally:
                    self._deadline = parent_deadline
                results.append(item)
                completed[name] = item
                mutation_occurred |= mutating(method, arguments)
            output = {"status": "completed", "steps": results, "quiescent": True, "session_id": self.id}
            if workflow:
                output["workflow"] = {"status": "completed", "step_count": len(results)}
            return output
        finally:
            if implicit:
                self._end(cancelled=self._cancelled.is_set(), restore=params.get("restore_original_window", True))

    def _dispatch(self, method: str, params: dict):
        params = {key.replace("-", "_"): value for key, value in params.items()}
        validate_flags(params)
        if method == "capabilities":
            return {"name": "DeskPilot", "version": VERSION, "protocol_version": PROTOCOL_VERSION,
                    "platform": platform_key(), "methods": list(METHODS), "session_id": self.id,
                    "batch_limit": 32, "references": "session_owned_short_lived", "business_policy": False,
                    "sensitive_input": self._secret_capabilities()}
        if method == "schema":
            selected = params.get("method")
            require(selected is None or selected in METHODS, "UNKNOWN_METHOD", "Unknown schema method.")
            return {"protocol_version": PROTOCOL_VERSION, "request": {"id": "string|number", "method": "string", "params": "object"},
                    **({"sensitive_input": self._secret_capabilities()} if selected in (None, "input.secret") else {}),
                    "methods": [{"method": item, "mutates": mutating(item),
                                 "reference": "screenshot_id for native/opaque; observation_id + element_id for Android" if item == "input.secret" else
                                              "observation_id + element_id" if item in UI_MUTATIONS | ANDROID_MUTATIONS | {"ui.get"} else
                                              "observation_id or screenshot_id for coordinate input" if item.startswith("input.") else None}
                                for item in ([selected] if selected else METHODS)]}
        if method == "doctor":
            from .screen import Ocr
            return {"version": VERSION, "platform": platform_key(), "session_id": self.id,
                    "process_id": os.getpid(), **self.desktop.doctor(), "desktop_text": Ocr.diagnose(),
                    "chrome": self.browser.diagnose(), "sensitive_input": self._secret_capabilities()}
        if method == "close":
            self.close()
            return {"status": "closed", "session_id": self.id}
        if method == "interaction.begin":
            return self._begin(params)
        if method == "interaction.end":
            return self._end(restore=params.get("restore_original_window", True))
        if method == "interaction.status":
            return {"status": "active" if self._lease else "idle", "interaction_id": self._lease, "session_id": self.id}
        if method in {"actions.batch", "workflow.run"}:
            return self._batch(params, workflow=method == "workflow.run")
        self.checkpoint()
        if method in {"windows.list", "windows.find"}:
            matches = self._find_windows({} if method == "windows.list" else params)
            return {"windows": [self._public_window(*item) for item in matches], "count": len(matches)}
        if method in {"windows.info", "windows.activate"}:
            return {"window": self._public_window(*self._window(params, activate=method.endswith("activate")))}
        if method in {"observe", "ui.tree", "ui.find", "ui.find_all"}:
            require(method == "observe" or not params.get("include_screenshot"), "INVALID_ARGUMENT",
                    "include_screenshot is only supported by observe.")
            result = self._observe(params, find=method in {"ui.find", "ui.find_all"})
            if method == "observe" and params.get("include_screenshot"):
                window_id = result["window"]["window_id"]
                capture = self._capture({"window_id": window_id})
                _, current = self._window({"window_id": window_id})
                self._check_observation(window_id, current, result["observation_id"])
                result["screenshot"] = capture["screenshot"]
            return result
        if method in {"wait.window", "wait.element"}:
            return self._wait(method, params)
        if method in {"screen.capture", "screen.capture_window"}:
            return self._capture(params)
        if method in {"screen.read_text", "messages.observe"}:
            return self._read_text(params, messages=method == "messages.observe")
        if method == "android.observe":
            return self._android_observe(params)
        if method in ANDROID_MUTATIONS:
            return self._android_mutation(method, params)
        if method == "ui.get" or method in UI_MUTATIONS:
            element, window_id, window = self._element(params)
            if method == "ui.get":
                return {"element": self.desktop.element_info(element), "window": self._public_window(window_id, window)}
            self._activity(window, method, params)
            verification = None
            if method == "ui.click":
                info = self._stable_control(element, window_id, self._elements[params["element_id"]]["observed"])
                area = info["bounds"]
                require(info["enabled"] and not info["offscreen"], "ELEMENT_NOT_ACTIONABLE", "The control is not enabled and visible.")
                self._activity(window, method, params, (area["x"] + area["width"] // 2 - window["bounds"]["x"],
                                                        area["y"] + area["height"] // 2 - window["bounds"]["y"]))
                self._dispatched = True
                self.desktop.click(window, area["x"] + area["width"] // 2 - window["bounds"]["x"],
                                   area["y"] + area["height"] // 2 - window["bounds"]["y"])
            elif method == "ui.invoke":
                self._dispatched = True
                self.desktop.invoke(element)
            elif method == "ui.set_value":
                require(isinstance(params.get("value"), str), "INVALID_ARGUMENT", "value must be a string.")
                newline_strategy = params.get("newline_strategy")
                require(newline_strategy is None or newline_strategy in ("unicode", "enter", "shift_enter"),
                        "INVALID_ARGUMENT", "Unknown newline input strategy.")
                self._dispatched = True
                verification = self.desktop.set_value(element, params["value"], checkpoint=self.checkpoint, window=window,
                                                      newline_strategy=newline_strategy)
            else:
                self._dispatched = True
                verification = self.desktop.select(element, params.get("value"), checkpoint=self.checkpoint)
            self._invalidate(window_id)
            result = {"dispatched": True, "window": self._public_window(window_id, window)}
            if verification is not None:
                result["verification"] = verification
            elif method in {"ui.click", "ui.invoke"}:
                result["verification"] = {"status": "not_checked"}
            if params.get("verify"):
                result["observation"] = self._observe({"window_id": window_id})
            return result
        if method.startswith("input."):
            if method == "input.secret":
                if params.get("target_kind") == "android_password":
                    return self._android_secret(params)
                return self._input_secret(params)
            if method in {"input.type", "input.key", "input.hotkey"}:
                window_id, window = self._window(params, activate=True)
                self._activity(window, method, params)
                if method == "input.type":
                    require(isinstance(params.get("text"), str), "INVALID_ARGUMENT", "text must be a string.")
                    require(len(params["text"]) <= 1_000_000, "INVALID_ARGUMENT", "The text is too large for one input request.")
                    self._dispatched = True
                    self.desktop.type_text(params["text"], self.checkpoint)
                else:
                    keys = params.get("keys", params.get("key", params.get("chord")))
                    keys = keys.split("+") if isinstance(keys, str) else keys
                    require(isinstance(keys, list) and 0 < len(keys) <= 16 and all(isinstance(key, str) for key in keys),
                            "INVALID_ARGUMENT", "Supply key names or a key chord.")
                    self._dispatched = True
                    self.desktop.key(keys)
            else:
                window_id, window, x, y, target_content_only = self._coordinate(params, allow_container=method == "input.scroll")
                self._activity(window, method, params, (x, y))
                if method == "input.scroll":
                    amount = int(number(params.get("amount"), "amount", minimum=-100000, maximum=100000))
                    self._dispatched = True
                    self.desktop.scroll(window, x, y, amount, horizontal=bool(params.get("horizontal", False)),
                                        target_content_only=target_content_only)
                else:
                    button = params.get("button", "right" if method.endswith("right_click") else "left")
                    require(button in {"left", "middle", "right"}, "INVALID_ARGUMENT", "Unknown mouse button.")
                    self._dispatched = True
                    self.desktop.click(window, x, y, button=button, count=2 if method.endswith("double_click") else 1,
                                       target_content_only=target_content_only)
            self._invalidate(window_id)
            return {"dispatched": True, "verification": {"status": "not_checked"},
                    "window": self._public_window(window_id, window)}
        if method.startswith("chrome."):
            self._dispatched = mutating(method, params)
            result = self.browser.call(method, params)
            if self._dispatched:
                self._invalidate()
            return result
        raise DeskPilotError("UNKNOWN_METHOD", "The requested method is not supported.")

    def _input_secret(self, params):
        require(params.get("confirmed") is True and params.get("purpose") == "authorized_local_test",
                "SENSITIVE_INPUT_BLOCKED", "Sensitive input requires an authorized local test and explicit acknowledgement.")
        require(not any(key in params for key in ("text", "value", "secret", "password", "verify")),
                "INVALID_ARGUMENT", "Provide a secret reference without a plaintext value or automatic verification.")
        kind = params.get("target_kind")
        require(kind in ("native_password", "observed_opaque_password"), "INVALID_ARGUMENT",
                "Choose a native password control or an observed opaque password control.")
        require(kind != "observed_opaque_password" or params.get("observed_password_focus") is True,
                "SENSITIVE_FOCUS_NOT_CONFIRMED", "Confirm the opaque password control and its focus from the current screen.")
        require(callable(getattr(self.desktop, "type_secret", None)), "UNSUPPORTED_PLATFORM",
                "Secure sensitive input is not supported by this platform backend.")
        window_id, window = self._window(params)
        require(self.desktop.foreground() == window["native"], "WINDOW_NOT_FOREGROUND",
                "The observed target itself must remain in the foreground before sensitive input.")
        shot = self._shots.get(params.get("screenshot_id"))
        require(shot is not None and shot["current"] and shot["window_id"] == window_id
                and shot["bounds"] == window["bounds"] and shot["title"] == window.get("title", ""),
                "STALE_OBSERVATION", "Use a current screenshot of the focused password control.")
        offset_x = shot["origin"]["x"] - window["bounds"]["x"]
        offset_y = shot["origin"]["y"] - window["bounds"]["y"]
        submit = params.get("submit_point")
        if submit is not None:
            require(isinstance(submit, list) and len(submit) == 2 and all(type(value) is int for value in submit)
                    and 0 <= submit[0] < shot["image"].width and 0 <= submit[1] < shot["image"].height,
                    "INVALID_ARGUMENT", "The explicitly observed submit point must lie within the screenshot.")
            submit = (submit[0] + offset_x, submit[1] + offset_y)
        from .secret import keyboard_sequence, read_local_secret
        secret = read_local_secret(params.get("secret_ref"))
        keyboard = params.get("keyboard")
        if keyboard is not None:
            require(kind == "observed_opaque_password", "INVALID_ARGUMENT",
                    "An on-screen keyboard requires an observed opaque password control.")
            sequence = keyboard_sequence(keyboard, secret, width=shot["image"].width, height=shot["image"].height,
                                         offset_x=offset_x, offset_y=offset_y)
        else:
            sequence = None
        self._activity(window, method="input.secret", params=params)
        self._dispatched = True
        target_content_only = shot["evidence"].get("capture_scope") == "target_window_only"

        def click_observed(point):
            self.checkpoint()
            current = self.desktop.window(window["native"])
            require(current["identity"] == window["identity"] and current["bounds"] == window["bounds"]
                    and current.get("title", "") == window.get("title", ""),
                    "STALE_OBSERVATION", "The target window changed during sensitive input.", outcome="unknown")
            require(self.desktop.foreground() == window["native"], "WINDOW_NOT_FOREGROUND",
                    "The target itself lost foreground during sensitive input.", outcome="unknown")
            try:
                self.desktop.click(window, *point, target_content_only=target_content_only)
            except DeskPilotError as exc:
                exc.outcome = "unknown"
                raise

        try:
            if sequence is None:
                self.desktop.type_secret(secret, self.checkpoint, window=window, target_kind=kind)
            else:
                for point in sequence:
                    click_observed(point)
                    self._cancelled.wait(0.12)
            if submit is not None:
                self._cancelled.wait(0.8)
                click_observed(submit)
        finally:
            secret = None
            sequence = None
        self._invalidate(window_id)
        return {"dispatched": True, "verification": "not_read", "submit_dispatched": submit is not None,
                "window": self._public_window(window_id, window)}

    def close(self):
        if self._closed:
            return
        self._end()
        if self._browser is not None:
            self._browser.close()
        if self._desktop is not None:
            self._desktop.close()
        if hasattr(self, "_ocr"):
            self._ocr.close()
        self._shots.clear()
        self._elements.clear()
        self._android_observations.clear()
        self._android_elements.clear()
        self._temporary.cleanup()
        self._closed = True
