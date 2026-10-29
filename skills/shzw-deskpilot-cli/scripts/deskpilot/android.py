"""Optional, locally bound Android-emulator accessibility and input transport."""

from __future__ import annotations

import os
from pathlib import Path
import queue
import re
import shutil
import string
import subprocess
import threading
import time
import uuid
import xml.etree.ElementTree as ET

from . import DeskPilotError, require


def key_events(value: str):
    """Map printable US-ASCII to Android numeric key codes before dispatch."""
    require(isinstance(value, str) and len(value) <= 128,
            "ANDROID_TEXT_UNSUPPORTED", "Android input supports at most 128 printable ASCII characters.")
    mapping = {chr(97 + i): (29 + i, False) for i in range(26)}
    mapping.update({chr(65 + i): (29 + i, True) for i in range(26)})
    mapping.update({str(i): (7 + i, False) for i in range(10)})
    mapping.update({char: (7 + i, True) for i, char in enumerate(")!@#$%^&*(")})
    for lower, upper, code in (("`", "~", 68), ("-", "_", 69), ("=", "+", 70),
                               ("[", "{", 71), ("]", "}", 72), ("\\", "|", 73),
                               (";", ":", 74), ("'", '"', 75), (",", "<", 55),
                               (".", ">", 56), ("/", "?", 76)):
        mapping[lower], mapping[upper] = (code, False), (code, True)
    mapping[" "] = (62, False)
    require(set(mapping) == set(string.printable[:95]), "ANDROID_INPUT_UNAVAILABLE", "The Android key map is incomplete.")
    require(all(char in mapping for char in value), "ANDROID_TEXT_UNSUPPORTED",
            "The Android input transport supports printable ASCII only; use another observed input method for other text.")
    return [f"input keycombination 59 {mapping[char][0]}" if mapping[char][1]
            else f"input keyevent {mapping[char][0]}" for char in value]


def _adb_path(executable: str, override: str | None):
    candidates = []
    if override is not None:
        require(isinstance(override, str) and Path(override).is_absolute(), "ANDROID_ADB_UNAVAILABLE",
                "The selected ADB executable must be an absolute local path.")
        candidates.append(Path(override))
    else:
        if executable:
            for parent in Path(executable).parents:
                if parent.name.lower() == "emulator":
                    candidates.append(parent.parent / "platform-tools" / ("adb.exe" if os.name == "nt" else "adb"))
                    break
        for name in ("ANDROID_SDK_ROOT", "ANDROID_HOME"):
            if os.environ.get(name):
                candidates.append(Path(os.environ[name]) / "platform-tools" / ("adb.exe" if os.name == "nt" else "adb"))
        found = shutil.which("adb")
        if found:
            candidates.append(Path(found))
    def local(candidate):
        if os.name != "nt":
            return True
        if not re.fullmatch(r"[A-Za-z]:", candidate.drive):
            return False
        import ctypes
        get_type = ctypes.WinDLL("kernel32").GetDriveTypeW
        get_type.argtypes = [ctypes.c_wchar_p]
        get_type.restype = ctypes.c_uint
        return get_type(candidate.anchor) in (2, 3, 6)

    for candidate in candidates:
        if local(candidate) and candidate.is_file():
            resolved = candidate.resolve()
            if local(resolved):
                return str(resolved)
    raise DeskPilotError("ANDROID_ADB_UNAVAILABLE", "ADB was not found in the emulator SDK or the configured local path.")


def _nodes(xml: bytes, limit: int):
    require(len(xml) <= 4 * 1024 * 1024, "ANDROID_OBSERVATION_INCOMPLETE", "The Android hierarchy is too large.")
    start, end = xml.find(b"<hierarchy"), xml.rfind(b"</hierarchy>")
    require(start >= 0 and end >= start, "ANDROID_OBSERVATION_UNAVAILABLE", "The Android hierarchy is unavailable.")
    try:
        root = ET.fromstring(xml[start:end + len(b"</hierarchy>")])
    except (ET.ParseError, ValueError):
        raise DeskPilotError("ANDROID_OBSERVATION_UNAVAILABLE", "The Android hierarchy could not be read.") from None
    require(root.tag == "hierarchy", "ANDROID_OBSERVATION_UNAVAILABLE", "The Android hierarchy is unavailable.")
    result = []

    def visit(parent, path=(), sensitive=False):
        for index, node in enumerate(parent):
            if node.tag != "node":
                continue
            current = path + (index,)
            hidden = sensitive or node.get("password") == "true"
            match = re.fullmatch(r"\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]", node.get("bounds", ""))
            if match:
                left, top, right, bottom = map(int, match.groups())
                if right > left and bottom > top:
                    cls = node.get("class", "")[:256]
                    text = None if hidden else node.get("text", "")[:4096]
                    description = None if hidden else node.get("content-desc", "")[:4096]
                    result.append({"path": current, "package": node.get("package", "")[:256],
                                   "class_name": cls, "resource_id": node.get("resource-id", "")[:512],
                                   "bounds": {"x": left, "y": top, "width": right-left, "height": bottom-top},
                                   "enabled": node.get("enabled") == "true", "focused": node.get("focused") == "true",
                                   "focusable": node.get("focusable") == "true", "clickable": node.get("clickable") == "true",
                                   "scrollable": node.get("scrollable") == "true",
                                   "editable": cls.endswith("EditText"), "password": hidden,
                                   "text": text, "description": description})
            visit(node, current, hidden)

    visit(root)
    return result[:limit], len(result) > limit


def signature(node):
    """Editable text can change independently; password text is never retained."""
    names = ("path", "package", "class_name", "resource_id", "bounds", "password", "enabled", "scrollable")
    value = tuple((key, repr(node[key])) for key in names)
    return value if node["editable"] else value + (("text", node["text"]), ("description", node["description"]))


class AndroidBridge:
    def __init__(self, window, *, executable="", adb_path=None, checkpoint=lambda: None):
        match = re.fullmatch(r"Android Emulator - ([A-Za-z0-9_.-]{1,128}):(\d{4,5})", window.get("title", ""))
        require(match and window.get("process", "").lower().startswith("qemu-system-"),
                "ANDROID_WINDOW_UNSUPPORTED", "Select a local Android Emulator window with an identifiable device port.")
        port = int(match.group(2))
        require(5554 <= port <= 5680 and port % 2 == 0, "ANDROID_WINDOW_UNSUPPORTED", "The emulator port is not supported.")
        self.avd = match.group(1)
        self.serial = f"emulator-{port}"
        self.adb = _adb_path(executable, adb_path)
        self.checkpoint = checkpoint
        self.env = dict(os.environ)
        self.env.pop("ADB_SERVER_SOCKET", None)
        self.env.pop("ANDROID_ADB_SERVER_PORT", None)
        self.flags = getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0
        response = self._run(["emu", "avd", "name"], timeout=10).decode("utf-8", "replace").splitlines()
        require(response and response[0].strip() == self.avd, "ANDROID_DEVICE_MISMATCH",
                "The selected window does not match the local Android emulator.")
        self._keycombination = None

    def _process(self, arguments, **kwargs):
        return subprocess.Popen([self.adb, "-s", self.serial, *arguments], env=self.env,
                                creationflags=self.flags, **kwargs)

    def _run(self, arguments, *, timeout=20):
        self.checkpoint()
        try:
            process = self._process(arguments, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        except OSError:
            raise DeskPilotError("ANDROID_ADB_UNAVAILABLE", "The local ADB process could not start.") from None
        end = time.monotonic() + timeout
        try:
            while True:
                self.checkpoint()
                require(time.monotonic() < end, "ANDROID_TIMEOUT", "Android did not respond within the time budget.", retryable=True)
                try:
                    output, _ = process.communicate(timeout=min(0.2, max(0.01, end-time.monotonic())))
                    break
                except subprocess.TimeoutExpired:
                    continue
            require(process.returncode == 0, "ANDROID_ADB_FAILED", "The selected Android emulator did not accept the request.", retryable=True)
            return output
        finally:
            if process.poll() is None:
                process.kill()
                process.communicate()

    def observe(self, limit=1000):
        # exec-out exposes the hierarchy on the pipe without a device-side file.
        return _nodes(self._run(["exec-out", "uiautomator", "dump", "/dev/tty"], timeout=25), limit)

    def require_keys(self):
        if self._keycombination is None:
            response = self._run(["shell", "cmd input help"], timeout=10).decode("utf-8", "replace")
            self._keycombination = "keycombination" in response
        require(self._keycombination, "ANDROID_INPUT_UNAVAILABLE",
                "This Android emulator does not provide the required key-combination input command.")

    def tap(self, x, y, guard, on_send):
        guard()
        on_send()
        try:
            self._run(["shell", f"input tap {int(x)} {int(y)}"], timeout=10)
        except DeskPilotError as error:
            error.outcome = "unknown"
            raise

    def swipe(self, start, end, duration, guard, on_send):
        guard()
        on_send()
        try:
            self._run(["shell", f"input swipe {start[0]} {start[1]} {end[0]} {end[1]} {duration}"], timeout=10)
        except DeskPilotError as error:
            error.outcome = "unknown"
            raise

    def send_keys(self, events, guard, on_send):
        self.require_keys()
        guard()
        try:
            process = self._process(["shell"], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                    stderr=subprocess.DEVNULL, bufsize=0)
        except OSError:
            raise DeskPilotError("ANDROID_ADB_UNAVAILABLE", "The local ADB input channel could not start.") from None
        lines = queue.Queue()

        def read_lines():
            try:
                for line in iter(process.stdout.readline, b""):
                    lines.put(line)
            except (OSError, ValueError):
                pass
            finally:
                lines.put(None)

        threading.Thread(target=read_lines, daemon=True).start()
        dispatched = False
        try:
            for event in events:
                guard()
                marker = "deskpilot_ack_" + uuid.uuid4().hex
                payload = f"{event} >/dev/null 2>&1; printf '{marker}:%s\\n' $?\n".encode("ascii")
                on_send()
                dispatched = True
                try:
                    process.stdin.write(payload)
                    process.stdin.flush()
                except (OSError, BrokenPipeError):
                    raise DeskPilotError("ANDROID_INPUT_UNCERTAIN", "The Android input channel closed after dispatch.", outcome="unknown") from None
                deadline = time.monotonic() + 10
                while True:
                    guard()
                    require(time.monotonic() < deadline, "ANDROID_INPUT_UNCERTAIN", "Android did not acknowledge input.", outcome="unknown")
                    try:
                        line = lines.get(timeout=0.1)
                    except queue.Empty:
                        continue
                    require(line is not None, "ANDROID_INPUT_UNCERTAIN", "The Android input channel closed after dispatch.", outcome="unknown")
                    if line.startswith(marker.encode("ascii") + b":"):
                        require(line.strip().endswith(b":0"), "ANDROID_INPUT_UNCERTAIN", "Android could not confirm the input event.", outcome="unknown")
                        break
        except DeskPilotError as error:
            if dispatched:
                error.outcome = "unknown"
            raise
        finally:
            if process.poll() is None:
                process.kill()
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                pass
            if process.stdin:
                process.stdin.close()
            if process.stdout:
                process.stdout.close()
