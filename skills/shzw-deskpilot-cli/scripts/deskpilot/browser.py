"""Chrome DevTools operations using the Python standard library."""

from __future__ import annotations

import base64
from collections import deque
import hashlib
import json
import os
from pathlib import Path
import queue
import secrets
import shutil
import socket
import ssl
import struct
import subprocess
import sys
import threading
import time
from urllib.parse import quote, urlsplit
from urllib.request import Request, urlopen

from . import DeskPilotError, number, require


class WebSocket:
    """A masked RFC 6455 client, with one reader and correlated CDP replies."""

    def __init__(self, url: str, checkpoint):
        parsed = urlsplit(url)
        require(parsed.scheme in {"ws", "wss"} and bool(parsed.hostname), "CHROME_ENDPOINT_INVALID", "A browser WebSocket URL is required.")
        port = parsed.port or (443 if parsed.scheme == "wss" else 80)
        try:
            self.socket = socket.create_connection((parsed.hostname, port), timeout=10)
            if parsed.scheme == "wss":
                self.socket = ssl.create_default_context().wrap_socket(self.socket, server_hostname=parsed.hostname)
            host = parsed.netloc
            path = parsed.path or "/"
            if parsed.query:
                path += "?" + parsed.query
            key = base64.b64encode(secrets.token_bytes(16)).decode("ascii")
            self.socket.sendall((f"GET {path} HTTP/1.1\r\nHost: {host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n").encode("ascii"))
            received = bytearray()
            while b"\r\n\r\n" not in received:
                chunk = self.socket.recv(4096)
                require(bool(chunk) and len(received) < 65536, "CHROME_CONNECTION_FAILED", "The browser did not complete the WebSocket handshake.")
                received.extend(chunk)
            header, remaining = bytes(received).split(b"\r\n\r\n", 1)
            lines = header.decode("iso-8859-1").split("\r\n")
            fields = {key.strip().lower(): value.strip() for line in lines[1:] if ":" in line for key, value in [line.split(":", 1)]}
            expected = base64.b64encode(hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest()).decode()
            require(lines[0].split(" ", 2)[1] == "101" and fields.get("sec-websocket-accept") == expected,
                    "CHROME_CONNECTION_FAILED", "The browser returned an invalid WebSocket handshake.")
            self.socket.settimeout(0.5)
        except DeskPilotError:
            if hasattr(self, "socket"):
                self.socket.close()
            raise
        except (OSError, ValueError, IndexError):
            if hasattr(self, "socket"):
                self.socket.close()
            raise DeskPilotError("CHROME_CONNECTION_FAILED", "The browser WebSocket could not be connected.", retryable=True) from None
        self._buffer = bytearray(remaining)
        self._checkpoint = checkpoint
        self._closed = threading.Event()
        self._lock = threading.Lock()
        self._send_lock = threading.Lock()
        self._pending = {}
        self._counter = 0
        self.events = deque(maxlen=256)
        self.inflight = set()
        self._reader = threading.Thread(target=self._read, name="deskpilot-cdp", daemon=True)
        self._reader.start()

    def _exact(self, size: int) -> bytes:
        while len(self._buffer) < size:
            if self._closed.is_set():
                raise OSError("closed")
            try:
                block = self.socket.recv(max(4096, min(65536, size - len(self._buffer))))
            except socket.timeout:
                continue
            if not block:
                raise OSError("closed")
            self._buffer.extend(block)
        result = bytes(self._buffer[:size])
        del self._buffer[:size]
        return result

    def _frame(self, opcode: int, data: bytes):
        mask = secrets.token_bytes(4)
        size = len(data)
        header = bytes((0x80 | opcode, 0x80 | size)) if size < 126 else bytes((0x80 | opcode, 0xFE)) + struct.pack("!H", size) if size < 65536 else bytes((0x80 | opcode, 0xFF)) + struct.pack("!Q", size)
        masked = bytes(byte ^ mask[index % 4] for index, byte in enumerate(data))
        with self._send_lock:
            self.socket.sendall(header + mask + masked)

    def _read(self):
        fragmented = bytearray()
        try:
            while not self._closed.is_set():
                first, second = self._exact(2)
                opcode, final, size = first & 15, bool(first & 128), second & 127
                if first & 0x70 or second & 128:
                    raise OSError("invalid frame")
                if size == 126:
                    size = struct.unpack("!H", self._exact(2))[0]
                elif size == 127:
                    size = struct.unpack("!Q", self._exact(8))[0]
                if size > 32 * 1024 * 1024 or len(fragmented) + size > 32 * 1024 * 1024:
                    raise OSError("oversized frame")
                payload = self._exact(size)
                if opcode >= 8 and (not final or size > 125):
                    raise OSError("invalid control frame")
                if opcode == 8:
                    break
                if opcode == 9:
                    self._frame(10, payload)
                    continue
                if opcode == 10:
                    continue
                if opcode not in (0, 1):
                    raise OSError("unexpected frame")
                fragmented.extend(payload)
                if not final:
                    continue
                value = json.loads(fragmented.decode("utf-8"))
                fragmented.clear()
                if not isinstance(value, dict):
                    raise OSError("invalid CDP response")
                with self._lock:
                    waiting = self._pending.get(value.get("id"))
                if waiting is not None:
                    waiting.put(value)
                elif "method" in value:
                    event = value["method"]
                    parameters = value.get("params", {})
                    if event == "Network.requestWillBeSent":
                        self.inflight.add(parameters.get("requestId"))
                    elif event in {"Network.loadingFinished", "Network.loadingFailed"}:
                        self.inflight.discard(parameters.get("requestId"))
                    elif not event.startswith("Network."):
                        self.events.append(value)
        except (OSError, ValueError, UnicodeError):
            pass
        finally:
            self._closed.set()
            with self._lock:
                for waiting in self._pending.values():
                    waiting.put(None)

    def call(self, method: str, params=None, *, timeout=15, mutation=False):
        require(not self._closed.is_set(), "CHROME_CONNECTION_LOST", "The browser connection is closed.", retryable=True)
        waiting = queue.Queue()
        with self._lock:
            self._counter += 1
            request_id = self._counter
            self._pending[request_id] = waiting
        dispatched = False
        try:
            self._frame(1, json.dumps({"id": request_id, "method": method, "params": params or {}}, ensure_ascii=False).encode("utf-8"))
            dispatched = True
            deadline = time.monotonic() + timeout
            while True:
                self._checkpoint()
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise DeskPilotError("CHROME_CALL_TIMEOUT", "The browser did not answer within the command budget.", retryable=True)
                try:
                    value = waiting.get(timeout=min(0.05, remaining))
                except queue.Empty:
                    continue
                require(value is not None, "CHROME_CONNECTION_LOST", "The browser connection ended before a response.", retryable=True)
                if "error" in value:
                    raise DeskPilotError("CHROME_PROTOCOL_ERROR", "Chrome rejected the protocol command.",
                                         details={"cdp_code": value["error"].get("code")})
                return value.get("result", {})
        except DeskPilotError as exc:
            if mutation and dispatched:
                exc.outcome = "unknown"
            raise
        except OSError:
            raise DeskPilotError("CHROME_CONNECTION_LOST", "The browser connection failed.", retryable=True,
                                 outcome="unknown" if mutation and dispatched else "not_dispatched") from None
        finally:
            with self._lock:
                self._pending.pop(request_id, None)

    def close(self):
        if not self._closed.is_set():
            try:
                self._frame(8, b"")
            except OSError:
                pass
        self._closed.set()
        try:
            self.socket.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        self.socket.close()
        if threading.current_thread() is not self._reader:
            self._reader.join(1)


def _windows_app_paths():
    """Read registered browser locations even when the host omits PATH variables."""
    try:
        import winreg
    except ImportError:
        return []
    paths = []
    views = (0, getattr(winreg, "KEY_WOW64_64KEY", 0), getattr(winreg, "KEY_WOW64_32KEY", 0))
    for root in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
        for name in ("chrome.exe", "msedge.exe"):
            for view in dict.fromkeys(views):
                try:
                    with winreg.OpenKey(root, r"Software\Microsoft\Windows\CurrentVersion\App Paths" + "\\" + name,
                                        0, winreg.KEY_READ | view) as key:
                        value, _kind = winreg.QueryValueEx(key, None)
                except OSError:
                    continue
                if isinstance(value, str):
                    path = os.path.expandvars(value.strip().strip('"'))
                    if path and path not in paths:
                        paths.append(path)
    return paths


def chrome_executable(configured=None):
    if configured:
        path = Path(configured).expanduser()
        require(path.is_file(), "CHROME_NOT_FOUND", "The configured Chrome executable does not exist.")
        return str(path)
    candidates = []
    if sys.platform == "win32":
        for key in ("PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA"):
            if os.environ.get(key):
                candidates += [Path(os.environ[key]) / "Google/Chrome/Application/chrome.exe",
                               Path(os.environ[key]) / "Microsoft/Edge/Application/msedge.exe"]
        candidates += [Path(path) for path in _windows_app_paths()]
    elif sys.platform == "darwin":
        candidates += [Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
                       Path.home() / "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
    for name in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome", "msedge"):
        resolved = shutil.which(name)
        if resolved:
            candidates.append(Path(resolved))
    return next((str(path) for path in candidates if path.is_file()), None)


QUERY_JS = r"""(p => {
const elements = Array.from(document.querySelectorAll(p.selector || 'body'));
return {count: elements.length, elements: elements.slice(0,p.limit || 50).map(el => {
 const r=el.getBoundingClientRect(); const s=getComputedStyle(el);
 const sensitive=el.tagName==='INPUT' && el.type==='password';
 return {tag:el.tagName.toLowerCase(),id:el.id,role:el.getAttribute('role'),
 text:sensitive ? null : (el.innerText || el.textContent || '').slice(0,p.max_text || 2000),
 value:sensitive ? null : ('value' in el ? el.value : null),is_password:sensitive,
 visible:r.width>0 && r.height>0 && s.visibility!=='hidden' && s.display!=='none',
 enabled:!el.disabled && el.getAttribute('aria-disabled')!=='true',
 editable:!el.disabled && !el.readOnly && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)),
 bounds:{x:r.x,y:r.y,width:r.width,height:r.height},coordinate_space:'css_viewport',
 attributes:Object.fromEntries((p.attributes || []).map(k => [k,sensitive && String(k).toLowerCase()==='value' ? null : el.getAttribute(k)]))};})};
})"""
STATE_JS = r"""(() => {
 const visible = el => {const r=el.getBoundingClientRect();const s=getComputedStyle(el);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'};
 const password=Array.from(document.querySelectorAll('input[type=password]')).some(visible);
 return {url:location.href,title:document.title,ready_state:document.readyState,visibility:document.visibilityState,
 body_text_length:(document.body?.innerText || '').length,
 actionable_count:document.querySelectorAll('input,button,select,textarea,a[href],[role=button]').length,
 sensitive_controls_visible:password,page_state:document.readyState==='loading'?'loading':'usable'};
})()"""


class Chrome:
    def __init__(self, checkpoint):
        self.checkpoint = checkpoint
        self.endpoint = None
        self.target = None
        self.socket = None
        self._process = None
        self._network_enabled = False

    def _http(self, endpoint, path, *, method="GET", timeout=5):
        require(isinstance(endpoint, str) and urlsplit(endpoint).scheme in {"http", "https"},
                "CHROME_ENDPOINT_INVALID", "Supply the browser's HTTP DevTools endpoint.")
        try:
            with urlopen(Request(endpoint.rstrip("/") + path, method=method), timeout=timeout) as response:
                data = response.read(8 * 1024 * 1024 + 1)
            require(len(data) <= 8 * 1024 * 1024, "CHROME_RESPONSE_TOO_LARGE", "The browser returned too much discovery data.")
            return json.loads(data)
        except DeskPilotError:
            raise
        except (OSError, ValueError):
            raise DeskPilotError("CHROME_ENDPOINT_UNAVAILABLE", "The configured DevTools endpoint is unavailable.", retryable=True) from None

    def _managed_endpoint(self, params):
        base = Path(os.environ.get("LOCALAPPDATA", Path.home() / ".local/share")) / "DeskPilot"
        profile = Path(params.get("profile_dir", base / "chrome-profile")).expanduser().resolve()
        marker = profile / "DevToolsActivePort"
        if marker.is_file():
            try:
                port = int(marker.read_text().splitlines()[0])
                endpoint = f"http://127.0.0.1:{port}"
                self._http(endpoint, "/json/version")
                return endpoint
            except (OSError, ValueError, IndexError, DeskPilotError):
                pass
        require(params.get("auto_start", True), "CHROME_ENDPOINT_UNAVAILABLE", "No active browser was found for the selected profile.")
        executable = chrome_executable(params.get("executable", params.get("chrome_path")))
        require(bool(executable), "CHROME_NOT_FOUND", "Chrome or a configured Chromium executable was not found.")
        profile.mkdir(parents=True, exist_ok=True)
        arguments = [executable, "--remote-debugging-port=0", f"--user-data-dir={profile}",
                     "--force-renderer-accessibility", "--no-first-run", "--no-default-browser-check",
                     "--disable-background-timer-throttling", "--disable-renderer-backgrounding"]
        extra = params.get("launch_args", [])
        require(isinstance(extra, list) and all(isinstance(item, str) and "\x00" not in item for item in extra),
                "INVALID_ARGUMENT", "launch_args must contain strings.")
        arguments += extra
        arguments.append("about:blank")
        options = {"stdin": subprocess.DEVNULL, "stdout": subprocess.DEVNULL, "stderr": subprocess.DEVNULL}
        if sys.platform == "win32":
            options["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
        else:
            options["start_new_session"] = True
        try:
            self._process = subprocess.Popen(arguments, **options)
        except OSError:
            raise DeskPilotError("CHROME_START_FAILED", "The configured browser could not start.") from None
        deadline = time.monotonic() + min(45, number(params.get("timeout_ms", 30000), "timeout_ms", minimum=1) / 1000)
        while time.monotonic() < deadline:
            self.checkpoint()
            try:
                port = int(marker.read_text().splitlines()[0])
                endpoint = f"http://127.0.0.1:{port}"
                self._http(endpoint, "/json/version", timeout=1)
                return endpoint
            except (OSError, ValueError, IndexError, DeskPilotError):
                time.sleep(0.05)
        raise DeskPilotError("CHROME_START_TIMEOUT", "The browser did not publish its DevTools endpoint in time.", retryable=True)

    def _targets(self, endpoint):
        result = self._http(endpoint, "/json/list")
        require(isinstance(result, list), "CHROME_PROTOCOL_ERROR", "The browser returned an invalid target list.")
        return [item for item in result if item.get("type") == "page" and item.get("webSocketDebuggerUrl")]

    def _attach(self, target):
        if self.target and self.target.get("id") == target.get("id") and self.socket and not self.socket._closed.is_set():
            return
        if self.socket:
            self.socket.close()
        self.socket = WebSocket(target["webSocketDebuggerUrl"], self.checkpoint)
        self.target = target
        self._network_enabled = False
        self.socket.call("Page.enable")
        self.socket.call("Runtime.enable")
        self.socket.call("Page.bringToFront")

    def _evaluate(self, expression: str, *, mutation=False):
        require(self.socket is not None, "CHROME_NOT_ATTACHED", "Attach or ensure a browser target first.")
        response = self.socket.call("Runtime.evaluate", {"expression": expression, "awaitPromise": True,
                                                        "returnByValue": True, "userGesture": mutation}, mutation=mutation)
        require("exceptionDetails" not in response, "CHROME_SCRIPT_EXCEPTION", "The browser reported a JavaScript exception.", outcome="unknown" if mutation else "not_dispatched")
        result = response.get("result", {})
        if "unserializableValue" in result:
            return {"unserializable_value": result["unserializableValue"]}
        return result.get("value")

    def _js(self, function: str, params: dict, *, mutation=False):
        result = self._evaluate(f"({function})({json.dumps(params, ensure_ascii=False)})", mutation=mutation)
        if isinstance(result, dict) and result.get("__deskpilot_error"):
            raise DeskPilotError(result["__deskpilot_error"], "The requested page target is not uniquely actionable.",
                                 details={key: value for key, value in result.items() if key in {"count"}})
        return result

    def _state(self):
        return self._evaluate(STATE_JS)

    def _ensure_target(self, params):
        if params.get("target_id") and (not self.target or self.target["id"] != params["target_id"]):
            targets = self._targets(params.get("endpoint", self.endpoint))
            matches = [item for item in targets if item["id"] == params["target_id"]]
            require(len(matches) == 1, "CHROME_TARGET_NOT_FOUND", "The requested target no longer exists.")
            self._attach(matches[0])
        require(self.socket is not None and self.target is not None, "CHROME_NOT_ATTACHED", "Attach or ensure a browser target first.")
        self.socket.call("Page.bringToFront")

    def _match(self, actual, expected):
        if isinstance(expected, dict):
            require(bool(expected) and set(expected) <= {"equals", "contains", "not_contains"},
                    "INVALID_ARGUMENT", "A comparison must use equals, contains or not_contains.")
            def each(value):
                return value if isinstance(value, list) else [value]
            for key in ("contains", "not_contains"):
                if key in expected:
                    require(bool(each(expected[key])) and all(isinstance(item, str) for item in each(expected[key])),
                            "INVALID_ARGUMENT", "Text comparisons require string values.")
            if "equals" in expected and actual != expected["equals"]:
                return False
            if "contains" in expected and not all(str(value) in str(actual or "") for value in each(expected["contains"])):
                return False
            if "not_contains" in expected and any(str(value) in str(actual or "") for value in each(expected["not_contains"])):
                return False
            return True
        return actual == expected

    def _predicate(self, predicate: dict) -> bool:
        require(isinstance(predicate, dict), "INVALID_ARGUMENT", "predicate must be an object.")
        kind = predicate.get("type", "element")
        if kind in {"all", "any"}:
            require(set(predicate) <= {"type", "conditions"}, "INVALID_ARGUMENT", "Unknown combined-predicate field.")
            conditions = predicate.get("conditions")
            require(isinstance(conditions, list) and bool(conditions), "INVALID_ARGUMENT", "A combined predicate requires conditions.")
            values = [self._predicate(condition) for condition in conditions]
            return all(values) if kind == "all" else any(values)
        if kind == "page":
            require(set(predicate) <= {"type", "url", "text"} and ("url" in predicate or "text" in predicate),
                    "INVALID_ARGUMENT", "A page predicate must compare url or text.")
            state = self._state()
            if "url" in predicate and not self._match(state["url"], predicate["url"]):
                return False
            if "text" in predicate:
                text = self._evaluate("document.body?.innerText || ''")
                if not self._match(" ".join(text.split()), predicate["text"]):
                    return False
            return True
        require(kind == "element", "INVALID_ARGUMENT", "Unknown predicate type.")
        require(set(predicate) <= {"type", "selector", "count", "visible", "enabled", "editable", "text", "value", "attribute"},
                "INVALID_ARGUMENT", "Unknown element-predicate field.")
        selector = predicate.get("selector")
        require(isinstance(selector, str), "INVALID_ARGUMENT", "An element predicate requires a selector.")
        attributes = list((predicate.get("attribute") or {}).keys())
        found = self._js(QUERY_JS, {"selector": selector, "attributes": attributes, "limit": 100})
        if "count" in predicate and not self._match(found["count"], predicate["count"]):
            return False
        fields = set(predicate) & {"visible", "enabled", "editable", "text", "value", "attribute"}
        if not fields:
            return found["count"] > 0 if "count" not in predicate else True
        if found["count"] != 1:
            return False
        element = found["elements"][0]
        for key in fields:
            if key == "attribute":
                if not all(self._match(element["attributes"].get(name), expected) for name, expected in predicate[key].items()):
                    return False
            elif not self._match(element.get(key), predicate[key]):
                return False
        return True

    def _wait(self, params):
        timeout = number(params.get("timeout_ms", 30000), "timeout_ms", minimum=0, maximum=3_600_000) / 1000
        interval = number(params.get("poll_ms", 100), "poll_ms", minimum=10, maximum=10000) / 1000
        stable = number(params.get("stable_ms", params.get("ready_stable_ms", 500 if params.get("wait_until") == "network_idle" else 0)), "stable_ms", minimum=0, maximum=120000) / 1000
        if params.get("wait_until") == "network_idle":
            self._enable_network()
        deadline, first = time.monotonic() + timeout, None
        state = None
        while True:
            try:
                self.checkpoint()
            except DeskPilotError as exc:
                if exc.code == "TIMEOUT":
                    raise DeskPilotError("CHROME_WAIT_TIMEOUT", "The requested page condition was not observed in time.", retryable=True,
                                         details={"page": state} if state else None) from None
                raise
            state = self._state()
            condition = True
            if params.get("predicate") is not None:
                condition = self._predicate(params["predicate"])
            elif params.get("selector", params.get("ready_selector")):
                selector = params.get("selector", params.get("ready_selector"))
                found = self._js(QUERY_JS, {"selector": selector, "limit": 100})
                desired = params.get("state", "visible")
                condition = found["count"] == 0 if desired == "absent" else not any(item["visible"] for item in found["elements"]) if desired == "hidden" else any(item["visible"] for item in found["elements"])
            elif params.get("expression", params.get("ready_expression")):
                condition = self._evaluate(params.get("expression", params.get("ready_expression"))) is True
            else:
                until = params.get("wait_until", "domcontentloaded")
                require(until in {"domcontentloaded", "interactive", "load", "complete", "network_idle", "none"},
                        "INVALID_ARGUMENT", "Unsupported wait_until; use an explicit readiness predicate.")
                condition = until == "none" or state["ready_state"] == "complete" or until in {"interactive", "domcontentloaded"} and state["ready_state"] == "interactive"
                if until == "network_idle":
                    condition = state["ready_state"] in {"interactive", "complete"} and not self.socket.inflight
            now = time.monotonic()
            if condition:
                first = first if first is not None else now
                if now - first >= stable:
                    return {"matched": True, "page": state}
            else:
                first = None
            if now >= deadline:
                raise DeskPilotError("CHROME_WAIT_TIMEOUT", "The requested page condition was not observed in time.", retryable=True, details={"page": state})
            time.sleep(min(interval, max(0, deadline - now)))

    def _enable_network(self):
        if not self._network_enabled:
            self.socket.call("Network.enable")
            self._network_enabled = True

    def call(self, method, params):
        if method in {"chrome.ensure", "chrome.attach", "chrome.targets"}:
            endpoint = params.get("endpoint", params.get("cdp_endpoint", self.endpoint))
            if not endpoint:
                require(method == "chrome.ensure", "CHROME_ENDPOINT_REQUIRED", "Supply an endpoint or call chrome.ensure first.")
                endpoint = self._managed_endpoint(params)
            # An explicitly configured endpoint is used exactly; failure never starts another browser.
            targets = self._targets(endpoint)
            if method == "chrome.targets":
                return {"endpoint": endpoint, "targets": [{"target_id": item["id"], "title": item.get("title"), "url": item.get("url")} for item in targets], "count": len(targets)}
            self.endpoint = endpoint
            matches = targets
            if params.get("target_id"):
                matches = [item for item in matches if item["id"] == params["target_id"]]
            elif params.get("url"):
                matches = [item for item in matches if item.get("url") == params["url"]]
            else:
                if params.get("url_contains"):
                    matches = [item for item in matches if params["url_contains"] in item.get("url", "")]
                if params.get("title_contains"):
                    matches = [item for item in matches if params["title_contains"] in item.get("title", "")]
            if not matches and method == "chrome.ensure" and not params.get("target_id"):
                target = self._http(endpoint, "/json/new?" + quote(params.get("url", "about:blank"), safe=""), method="PUT")
                matches = [target]
            require(bool(matches), "CHROME_TARGET_NOT_FOUND", "No page matches the requested target.")
            require(len(matches) == 1, "CHROME_TARGET_AMBIGUOUS", "Several pages match; select an explicit target_id.", details={"count": len(matches)})
            self._attach(matches[0])
            return self._result({"attached": True, "page": self._state()})
        self._ensure_target(params)
        if method == "chrome.navigate":
            require(isinstance(params.get("url"), str), "INVALID_ARGUMENT", "url must be a string.")
            if params.get("wait_until") == "network_idle":
                self._enable_network()
            response = self.socket.call("Page.navigate", {"url": params["url"]}, mutation=True)
            require(not response.get("errorText"), "CHROME_NAVIGATION_FAILED", "Chrome could not navigate to the requested resource.", outcome="unknown")
            result = self._wait(params)
        elif method == "chrome.wait":
            result = self._wait(params)
        elif method == "chrome.evaluate":
            expression = params.get("expression", params.get("script"))
            require(isinstance(expression, str), "INVALID_ARGUMENT", "expression must contain JavaScript source.")
            result = {"value": self._evaluate(expression, mutation=not params.get("read_only", False))}
        elif method == "chrome.query":
            require(isinstance(params.get("selector", "body"), str) and isinstance(params.get("attributes", []), list)
                    and all(isinstance(item, str) for item in params.get("attributes", [])),
                    "INVALID_ARGUMENT", "query requires a CSS selector and optional attribute names.")
            result = self._js(QUERY_JS, {"selector": params.get("selector", "body"),
                                         "limit": int(number(params.get("limit", 50), "limit", minimum=1, maximum=500)),
                                         "max_text": int(number(params.get("max_text", 2000), "max_text", minimum=0, maximum=100000)),
                                         "attributes": params.get("attributes", [])})
        elif method == "chrome.fill":
            require(isinstance(params.get("selector"), str) and isinstance(params.get("value", params.get("text")), str),
                    "INVALID_ARGUMENT", "fill requires selector and value strings.")
            result = self._js(r"""p => {const els=document.querySelectorAll(p.selector);if(els.length!==1)return {__deskpilot_error:'CHROME_TARGET_AMBIGUOUS',count:els.length};
const el=els[0],r=el.getBoundingClientRect();if(el.type==='password')return {__deskpilot_error:'SENSITIVE_INPUT_BLOCKED'};
if(el.disabled || el.readOnly || !r.width || !r.height)return {__deskpilot_error:'CHROME_TARGET_NOT_ACTIONABLE'};
el.focus();if(el.isContentEditable){el.textContent=p.value;}else{const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
const setter=Object.getOwnPropertyDescriptor(proto,'value')?.set;if(!setter)return {__deskpilot_error:'CHROME_TARGET_NOT_EDITABLE'};setter.call(el,p.value);}
el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:p.value}));el.dispatchEvent(new Event('change',{bubbles:true}));
return {verified:(el.isContentEditable?el.textContent:el.value)===p.value,length:p.value.length};}""",
                              {"selector": params["selector"], "value": params.get("value", params.get("text"))}, mutation=True)
            require(result.get("verified"), "CHROME_VALUE_NOT_VERIFIED", "The page did not retain the requested input value.", outcome="unknown")
        elif method == "chrome.select":
            values = params.get("values", [params.get("value")])
            require(isinstance(params.get("selector"), str) and isinstance(values, list) and bool(values)
                    and all(isinstance(value, str) for value in values), "INVALID_ARGUMENT", "select requires a selector and option value(s).")
            result = self._js(r"""p=>{const els=document.querySelectorAll(p.selector);if(els.length!==1)return {__deskpilot_error:'CHROME_TARGET_AMBIGUOUS',count:els.length};const el=els[0];
if(el.tagName!=='SELECT'||el.disabled)return {__deskpilot_error:'CHROME_TARGET_NOT_SELECTABLE'};
const wanted=p.values.map(value=>Array.from(el.options).filter(o=>o.value===value));if(wanted.some(items=>items.length!==1)||(!el.multiple&&wanted.length!==1))return {__deskpilot_error:'CHROME_OPTION_AMBIGUOUS'};
for(const option of el.options)option.selected=wanted.some(items=>items[0]===option);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));
return {verified:p.values.length===el.selectedOptions.length&&Array.from(el.selectedOptions).every(o=>p.values.includes(o.value)),count:el.selectedOptions.length};}""",
                              {"selector": params["selector"], "values": values}, mutation=True)
            require(result.get("verified"), "CHROME_VALUE_NOT_VERIFIED", "The selected option could not be verified.", outcome="unknown")
        elif method == "chrome.click":
            require(isinstance(params.get("selector"), str), "INVALID_ARGUMENT", "click requires a selector.")
            state = self._state()
            require(state.get("visibility") == "visible", "CHROME_PAGE_NOT_VISIBLE",
                    "The browser page is not visible, so mouse input cannot be verified. Bring the intended page forward and observe it again.",
                    retryable=True, details={"visibility": state.get("visibility")})
            point = self._js(r"""p=>{const els=document.querySelectorAll(p.selector);if(els.length!==1)return {__deskpilot_error:'CHROME_TARGET_AMBIGUOUS',count:els.length};const el=els[0];
el.scrollIntoView({block:'center',inline:'center'});const r=el.getBoundingClientRect();if(!r.width||!r.height||el.disabled||el.getAttribute('aria-disabled')==='true')return {__deskpilot_error:'CHROME_TARGET_NOT_ACTIONABLE'};
const x=r.left+r.width/2,y=r.top+r.height/2,top=document.elementFromPoint(x,y);if(!top||!(top===el||el.contains(top)))return {__deskpilot_error:'CHROME_TARGET_OCCLUDED'};return {x,y};}""", {"selector": params["selector"]})
            self.socket.call("Input.dispatchMouseEvent", {"type": "mouseMoved", **point})
            self.socket.call("Input.dispatchMouseEvent", {"type": "mousePressed", "button": "left", "clickCount": 1, **point}, mutation=True)
            self.socket.call("Input.dispatchMouseEvent", {"type": "mouseReleased", "button": "left", "clickCount": 1, **point}, mutation=True)
            result = {"dispatched": True, "coordinate_space": "css_viewport"}
        else:
            raise DeskPilotError("UNKNOWN_METHOD", "Unknown Chrome operation.")
        return self._result(result)

    def _result(self, result):
        return {**result, "target_id": self.target["id"], "endpoint": self.endpoint}

    def window_evidence(self):
        if not self.socket:
            return None
        result = self.socket.call("Browser.getWindowForTarget", {"targetId": self.target["id"]})
        return {"browser_window_id": result.get("windowId"), "bounds": result.get("bounds"), "page": self._state()}

    def diagnose(self):
        executable = chrome_executable()
        return {"available": bool(executable), "executable": executable,
                "attached": self.socket is not None and not self.socket._closed.is_set(), "endpoint": self.endpoint}

    def close(self):
        if self.socket:
            self.socket.close()
            self.socket = None
        # Chrome and its user's profile have an independent lifetime.
        self._process = None
