from __future__ import annotations

import ctypes
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from deskpilot import DeskPilotError
from deskpilot.session import Session


@unittest.skipUnless(sys.platform == "win32" and os.environ.get("DESKPILOT_LIVE_TESTS") == "1", "requires an explicitly selected Windows interactive fixture run")
class WindowsLiveTests(unittest.TestCase):
    def test_native_controls_unicode_sensitive_rejection_capture_and_offline_ocr(self):
        title = "DeskPilot fixture " + uuid.uuid4().hex[:8]
        fixture = subprocess.Popen([sys.executable, "-B", str(Path(__file__).with_name("windows_fixture.py")), title],
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8",
                                   creationflags=subprocess.CREATE_NO_WINDOW)
        session = Session()
        ready = None
        try:
            ready = json.loads(fixture.stdout.readline())
            self.assertTrue(ready["ready"])
            session.execute("interaction.begin", {"show_overlay": True, "show_action_trace": True})
            found = session.execute("ui.find", {"title_exact": title, "automation_id": "101", "overlay_required": True})
            self.assertEqual(found["count"], 1)
            args = {"element_id": found["elements"][0]["element_id"], "observation_id": found["observation_id"]}
            session.execute("ui.set_value", args | {"value": "native value"})
            edit = session.execute("ui.find", {"title_exact": title, "automation_id": "101"})
            session.execute("ui.click", {"element_id": edit["elements"][0]["element_id"], "observation_id": edit["observation_id"]})
            session.execute("input.hotkey", {"title_exact": title, "keys": ["CTRL", "A"]})
            text = "\u4e2d\u6587\u8f93\u5165 12345"
            session.execute("input.type", {"title_exact": title, "text": text})
            button = session.execute("ui.find", {"title_exact": title, "automation_id": "102"})
            session.execute("ui.invoke", {"element_id": button["elements"][0]["element_id"], "observation_id": button["observation_id"]})
            result = session.execute("wait.element", {"title_exact": title, "name": "Result: " + text, "timeout_ms": 3000})
            self.assertEqual(result["count"], 1)
            sensitive = session.execute("ui.find", {"title_exact": title, "automation_id": "104"})
            with self.assertRaises(DeskPilotError) as raised:
                session.execute("ui.set_value", {"element_id": sensitive["elements"][0]["element_id"],
                                                 "observation_id": sensitive["observation_id"], "value": "should not enter"})
            self.assertEqual(raised.exception.code, "SENSITIVE_INPUT_BLOCKED")
            self.assertEqual(raised.exception.outcome, "not_dispatched")
            capture = session.execute("screen.capture", {"title_exact": title})
            self.assertTrue(capture["screenshot"]["trusted"])
            text_result = session.execute("messages.observe", {"screenshot_id": capture["screenshot"]["screenshot_id"],
                                                               "expected_identity": "DeskPilot Fixture"})
            self.assertIn("".join(text.split()), "".join(text_result["recognition"]["text"].split()))
            self.assertTrue(text_result["context_identity"]["matched"])
            with self.assertRaises(DeskPilotError) as raised:
                session.execute("messages.observe", {"screenshot_id": capture["screenshot"]["screenshot_id"], "expected_identity": "Unrelated conversation 9384726"})
            self.assertEqual(raised.exception.code, "CONTEXT_IDENTITY_MISMATCH")
            self._check_small_unrelated_overlay_is_rejected(session, title, capture["window"]["bounds"])
            session.execute("interaction.end", {"restore_original_window": False})
        finally:
            session.execute("interaction.end", {"restore_original_window": False})
            session.close()
            if ready:
                user = ctypes.WinDLL("user32")
                user.PostMessageW.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_size_t, ctypes.c_ssize_t]
                user.PostMessageW(ready["handle"], 0x0010, 0, 0)
            try:
                fixture.wait(timeout=3)
            except subprocess.TimeoutExpired:
                fixture.terminate()
                fixture.wait(timeout=3)
            if fixture.stdout:
                fixture.stdout.close()
            if fixture.stderr:
                errors = fixture.stderr.read()
                fixture.stderr.close()
                self.assertEqual(errors, "")

    def _check_small_unrelated_overlay_is_rejected(self, session, title, area):
        user = ctypes.WinDLL("user32")
        user.CreateWindowExW.restype = ctypes.c_void_p
        user.CreateWindowExW.argtypes = [ctypes.c_ulong, ctypes.c_wchar_p, ctypes.c_wchar_p, ctypes.c_ulong,
                                        ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int,
                                        ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p]
        user.SetWindowPos.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_uint]
        user.DestroyWindow.argtypes = [ctypes.c_void_p]
        overlay = user.CreateWindowExW(0x08000008, "STATIC", "Unrelated fixture", 0x90000000,
                                      area["x"] + 4, area["y"] + 4, 12, 12, None, None, None, None)
        self.assertTrue(overlay)
        try:
            user.SetWindowPos(overlay, ctypes.c_void_p(-1), area["x"] + 4, area["y"] + 4, 12, 12, 0x10 | 0x40)
            with self.assertRaises(DeskPilotError) as raised:
                session.execute("screen.capture", {"title_exact": title})
            self.assertEqual(raised.exception.code, "WINDOW_CAPTURE_UNTRUSTED")
            blockers = raised.exception.details["blockers"]
            self.assertTrue(any(item and item.get("title") == "Unrelated fixture" for item in blockers))
            self.assertTrue(any(item and item.get("pid") == os.getpid() for item in blockers))
            self.assertGreaterEqual(raised.exception.details["overlapping_windows"], 1)
        finally:
            user.DestroyWindow(overlay)


if __name__ == "__main__":
    unittest.main()
