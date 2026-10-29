"""Opt-in Development checks through an independently built, isolated CLI process."""

from __future__ import annotations

from http.server import ThreadingHTTPServer
import json
import os
from pathlib import Path
import queue
import runpy
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
from urllib.request import urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from deskpilot import DeskPilotError
from deskpilot.browser import WebSocket
from test_browser_live import Handler
import test_windows_live
import test_linux_live


class ProcessSession:
    def __init__(self, application):
        environment = dict(os.environ, PYTHONPATH="", PYTHONIOENCODING="utf-8", PYTHONDONTWRITEBYTECODE="1")
        environment.pop("DESKPILOT_RESOURCES", None)
        self.process = subprocess.Popen([sys.executable, "-I", "-S", "-B", str(application), "exec"],
                                        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                        text=True, encoding="utf-8", env=environment, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        self.counter = 0
        self.output = queue.Queue()
        self.reader = threading.Thread(target=self._read, daemon=True)
        self.reader.start()

    def _read(self):
        for line in self.process.stdout:
            self.output.put(line)
        self.output.put(None)

    def execute(self, method, params=None):
        self.counter += 1
        self.process.stdin.write(json.dumps({"id": self.counter, "method": method, "params": params or {}}, ensure_ascii=False) + "\n")
        self.process.stdin.flush()
        line = self.output.get(timeout=45)
        if line is None:
            raise AssertionError("Installed CLI exited before responding.")
        reply = json.loads(line)
        if reply["id"] != self.counter:
            raise AssertionError("Response did not match the public request ID.")
        if not reply["ok"]:
            error = reply["error"]
            raise DeskPilotError(error["code"], error["message"], outcome=error.get("outcome", "not_dispatched"), details=error.get("details"))
        return reply["result"]

    def close(self):
        if self.process.poll() is None:
            try:
                self.execute("close")
            finally:
                self.process.stdin.close()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.terminate()
                self.process.wait(timeout=3)
        self.reader.join(1)
        errors = self.process.stderr.read()
        self.process.stdout.close()
        self.process.stderr.close()
        if errors:
            raise AssertionError("Installed CLI stderr was not empty: " + errors)

    def check_cancellation(self):
        self.counter += 1
        waiting = self.counter
        self.process.stdin.write(json.dumps({"id": waiting, "method": "wait.window", "params": {
            "title_exact": "DeskPilot absent cancellation fixture", "timeout_ms": 30000}}) + "\n")
        self.process.stdin.flush()
        time.sleep(0.1)
        self.counter += 1
        cancellation = self.counter
        self.process.stdin.write(json.dumps({"id": cancellation, "method": "interaction.cancel"}) + "\n")
        self.process.stdin.flush()
        responses = {item["id"]: item for item in (json.loads(self.output.get(timeout=5)) for _ in range(2))}
        if responses[waiting].get("error", {}).get("code") != "CANCELLED" or not responses[cancellation]["ok"]:
            raise AssertionError("The installed process did not cancel its pending window wait.")
        self.execute("capabilities")


@unittest.skipUnless(sys.platform == "win32" and os.environ.get("DESKPILOT_INSTALLED_LIVE_TESTS") == "1", "requires an explicitly selected Windows installed fixture run")
class InstalledLiveTests(unittest.TestCase):
    def test_readonly_complete_skill_runs_native_and_browser_operations_through_public_process(self):
        root = Path(__file__).resolve().parents[3]
        with tempfile.TemporaryDirectory(prefix="DeskPilot installed % ! & ") as temporary:
            directory = Path(temporary)
            skill, state, commands = directory / "read only Skill", directory / "runtime", directory / "commands"
            shutil.copytree(root / "skills/shzw-deskpilot-cli", skill)
            for path in skill.rglob("*"):
                if path.is_file():
                    path.chmod(0o444)
            session = None
            try:
                namespace = runpy.run_path(str(skill / "scripts/install.py"))
                args = type("Args", (), {"state_dir": state, "bin_dir": commands, "uninstall": False})()
                with patch.dict(namespace["install"].__globals__, {"configure_path": lambda *a, **k: {"kind": "test", "added": False}}):
                    installed = namespace["install"](args, skill=skill)
                application = Path(installed["application"])
                # Exercise the generated command, including batch-file metacharacter escaping.
                help_result = subprocess.run([installed["command_path"], "--help"], capture_output=True, text=True, encoding="utf-8", timeout=20)
                self.assertEqual(help_result.returncode, 0, help_result.stdout + help_result.stderr)
                self.assertIn("DeskPilot", help_result.stdout)
                with patch.object(test_windows_live, "Session", lambda: ProcessSession(application)):
                    test_windows_live.WindowsLiveTests().test_native_controls_unicode_sensitive_rejection_capture_and_offline_ocr()
                    test_windows_live.WindowsLiveTests().test_system_capture_protection_is_honored()
                session = ProcessSession(application)
                doctor = session.execute("doctor")
                self.assertTrue(doctor["desktop_text"]["available"])
                self._browser_case(session, doctor["chrome"]["executable"], directory)
            finally:
                if session:
                    session.close()
                for path in skill.rglob("*"):
                    if path.is_file():
                        path.chmod(0o644)

    def _browser_case(self, session, executable, directory):
        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        profile = directory / "owned Chrome profile"
        chrome = subprocess.Popen([executable, "--remote-debugging-port=0", "--user-data-dir=" + str(profile),
                                   "--no-first-run", "--no-default-browser-check", "about:blank"],
                                  stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        endpoint = None
        try:
            for _ in range(200):
                marker = profile / "DevToolsActivePort"
                if marker.is_file():
                    endpoint = "http://127.0.0.1:" + marker.read_text().splitlines()[0]
                    break
                time.sleep(0.05)
            self.assertIsNotNone(endpoint)
            url = f"http://127.0.0.1:{server.server_port}/fixture"
            session.execute("chrome.ensure", {"endpoint": endpoint})
            session.execute("chrome.navigate", {"url": url, "ready_selector": "#input"})
            text = "安装后中文表单 % ! &"
            result = session.execute("actions.batch", {"show_overlay": False, "steps": [
                {"id": "write", "method": "chrome.fill", "params": {"selector": "#input", "value": text}},
                {"id": "choose", "method": "chrome.select", "params": {"selector": "#category", "value": "automation"}},
                {"id": "apply", "method": "chrome.click", "params": {"selector": "#apply"}},
                {"id": "read", "method": "chrome.wait", "params": {"predicate": {"type": "element", "selector": "#result", "text": {"equals": text + " | automation"}}}}]})
            self.assertEqual(result["status"], "completed")
            with self.assertRaises(DeskPilotError) as raised:
                session.execute("chrome.click", {"selector": ".ambiguous"})
            self.assertEqual(raised.exception.code, "CHROME_TARGET_AMBIGUOUS")
        finally:
            if endpoint:
                try:
                    with urlopen(endpoint + "/json/version", timeout=3) as response:
                        url = json.load(response)["webSocketDebuggerUrl"]
                    socket = WebSocket(url, lambda: None)
                    try:
                        socket.call("Browser.close", mutation=True, timeout=3)
                    finally:
                        socket.close()
                except (OSError, DeskPilotError):
                    pass
            try:
                chrome.wait(timeout=5)
            except subprocess.TimeoutExpired:
                chrome.terminate()
                chrome.wait(timeout=3)
            server.shutdown()
            server.server_close()
            worker.join(1)


@unittest.skipUnless(sys.platform.startswith("linux") and os.environ.get("DESKPILOT_INSTALLED_LIVE_TESTS") == "1", "requires an explicitly selected Linux installed fixture run")
class LinuxInstalledLiveTests(unittest.TestCase):
    def test_readonly_complete_skill_runs_native_ocr_and_browser_through_public_process(self):
        resources = Path(os.environ["DESKPILOT_RESOURCES"]).resolve()
        with tempfile.TemporaryDirectory(prefix="DeskPilot installed % ! & ") as temporary:
            directory = Path(temporary)
            skill, state, commands = directory / "read only Skill", directory / "runtime", directory / "commands"
            shutil.copytree(resources, skill)
            for path in skill.rglob("*"):
                if path.is_file():
                    path.chmod(0o444)
            namespace = runpy.run_path(str(skill / "scripts/install.py"))
            args = type("Args", (), {"state_dir": state, "bin_dir": commands, "uninstall": False})()
            with patch.dict(namespace["install"].__globals__, {"configure_path": lambda *a, **k: {"kind": "test", "added": False}}):
                installed = namespace["install"](args, skill=skill)
            application = Path(installed["application"])
            help_result = subprocess.run([installed["command_path"], "--help"], capture_output=True, text=True, encoding="utf-8", timeout=20)
            self.assertEqual(help_result.returncode, 0, help_result.stdout + help_result.stderr)
            self.assertIn("DeskPilot", help_result.stdout)
            with patch.object(test_linux_live, "Session", lambda: ProcessSession(application)):
                test_linux_live.LinuxLiveTests().test_system_gtk_controls_unicode_input_capture_and_offline_ocr()
            session = ProcessSession(application)
            try:
                doctor = session.execute("doctor")
                self.assertTrue(doctor["desktop_text"]["available"])
                InstalledLiveTests._browser_case(self, session, doctor["chrome"]["executable"], directory)
                session.check_cancellation()
            finally:
                session.close()


if __name__ == "__main__":
    unittest.main()
