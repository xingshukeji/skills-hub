from __future__ import annotations

import ctypes
import hashlib
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import tempfile
import time
import unittest
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from deskpilot import DeskPilotError
from deskpilot.screen import Image
from deskpilot.session import Session


@unittest.skipUnless(sys.platform == "win32" and os.environ.get("DESKPILOT_LIVE_TESTS") == "1", "requires an explicitly selected Windows interactive fixture run")
class WindowsLiveTests(unittest.TestCase):
    def test_authorized_local_native_password_uses_local_reference(self):
        title = "DeskPilot password fixture " + uuid.uuid4().hex[:8]
        marker = secrets.token_urlsafe(18)
        digest = hashlib.sha256(marker.encode("utf-8")).hexdigest()
        fixture = subprocess.Popen([sys.executable, "-B", str(Path(__file__).with_name("windows_fixture.py")), title,
                                    "--secret-digest=" + digest],
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8",
                                   creationflags=subprocess.CREATE_NO_WINDOW)
        session = Session()
        ready = None
        try:
            ready = json.loads(fixture.stdout.readline())
            session.execute("interaction.begin", {"show_overlay": False, "restore_original_window": False})
            control = session.execute("ui.find", {"title_exact": title, "automation_id": "104", "require_unique": True})
            reference = {"element_id": control["elements"][0]["element_id"], "observation_id": control["observation_id"]}
            session.execute("ui.click", reference)
            with self.assertRaises(DeskPilotError) as blocked:
                session.execute("input.type", {"title_exact": title, "text": "ordinary input"})
            self.assertEqual(blocked.exception.code, "SENSITIVE_INPUT_BLOCKED")
            capture = session.execute("screen.capture", {"title_exact": title})
            with tempfile.TemporaryDirectory() as directory:
                source = Path(directory) / "fixture.json"
                source.write_text(json.dumps({"credential": marker}), encoding="utf-8")
                result = session.execute("input.secret", {"window_id": capture["window"]["window_id"],
                    "screenshot_id": capture["screenshot"]["screenshot_id"], "confirmed": True,
                    "purpose": "authorized_local_test", "target_kind": "native_password",
                    "secret_ref": {"path": str(source), "json_path": ["credential"]}})
                self.assertNotIn(marker, json.dumps(result))
                result = session.execute("wait.element", {"title_exact": title, "name": "Secret: matched", "timeout_ms": 3000})
                self.assertEqual(result["count"], 1)
            control = session.execute("ui.find", {"title_exact": title, "automation_id": "104"})
            observed = session.execute("ui.get", {"element_id": control["elements"][0]["element_id"],
                                                    "observation_id": control["observation_id"]})
            self.assertTrue(observed["element"]["is_password"])
            self.assertIsNone(observed["element"]["value"])
        finally:
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
            fixture.stdout.close()
            errors = fixture.stderr.read()
            fixture.stderr.close()
            self.assertEqual(errors, "")

    def test_system_capture_protection_is_honored(self):
        title = "DeskPilot protected fixture " + uuid.uuid4().hex[:8]
        fixture = subprocess.Popen([sys.executable, "-B", str(Path(__file__).with_name("windows_fixture.py")),
                                    title, "--protect-capture"], stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                   text=True, encoding="utf-8", creationflags=subprocess.CREATE_NO_WINDOW)
        session = Session()
        ready = None
        try:
            ready = json.loads(fixture.stdout.readline())
            with self.assertRaises(DeskPilotError) as caught:
                session.execute("screen.capture", {"title_exact": title, "pid": ready["pid"]})
            self.assertEqual(caught.exception.code, "WINDOW_CAPTURE_PROTECTED")
            if hasattr(session, "_shots"):
                self.assertFalse(session._shots)
        finally:
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
            fixture.stdout.close()
            errors = fixture.stderr.read()
            fixture.stderr.close()
            self.assertEqual(errors, "")

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
            edit = session.execute("ui.find", {"title_exact": title, "automation_id": "101"})
            focused = session.execute("ui.get", {"element_id": edit["elements"][0]["element_id"],
                                                  "observation_id": edit["observation_id"]})
            if not focused["element"]["has_keyboard_focus"]:
                from deskpilot.platforms.windows import WindowsDesktop, POINT
                diagnostic = WindowsDesktop()
                try:
                    actual_focus = diagnostic._automation().GetFocusedElement()
                    area = focused["element"]["bounds"]
                    hit = diagnostic.user.WindowFromPoint(POINT(area["x"] + area["width"] // 2,
                                                                 area["y"] + area["height"] // 2))
                    details = {"actual_focus_pid": actual_focus.CurrentProcessId,
                               "actual_focus_class": actual_focus.CurrentClassName,
                               "hit": diagnostic._window_diagnostic(hit), "fixture_pid": ready["pid"]}
                    if details["hit"]:
                        details["hit"] = {key: details["hit"].get(key) for key in ("pid", "class_name")}
                finally:
                    diagnostic.close()
                self.fail(f"Synthetic edit did not gain focus: {details}")
            session.execute("input.hotkey", {"title_exact": title, "keys": ["CTRL", "A"]})
            user = ctypes.WinDLL("user32")
            user.GetDlgItem.argtypes = [ctypes.c_void_p, ctypes.c_int]
            user.GetDlgItem.restype = ctypes.c_void_p
            user.SendMessageW.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_size_t, ctypes.c_ssize_t]
            user.SendMessageW.restype = ctypes.c_ssize_t
            edit_handle = user.GetDlgItem(ready["handle"], 101)
            selection = 0
            for _ in range(40):
                selection = user.SendMessageW(edit_handle, 0x00B0, 0, 0)  # EM_GETSEL on the owned fixture
                if (selection & 0xffff, (selection >> 16) & 0xffff) == (0, len("native value")):
                    break
                time.sleep(0.025)
            self.assertEqual((selection & 0xffff, (selection >> 16) & 0xffff), (0, len("native value")),
                             "The fixture did not process its select-all input.")
            text = "\u4e2d\u6587\u8f93\u5165 12345"
            session.execute("input.type", {"title_exact": title, "text": text})
            edit = session.execute("ui.find", {"title_exact": title, "automation_id": "101"})
            typed = session.execute("ui.get", {"element_id": edit["elements"][0]["element_id"],
                                                "observation_id": edit["observation_id"]})
            self.assertEqual(typed["element"]["value"], text)
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
            self._check_overlay_capture_and_hit_guard(session, title, capture["window"]["bounds"])
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

    def test_text_pattern_keyboard_fallback_on_native_control(self):
        title = "DeskPilot text-only fixture " + uuid.uuid4().hex[:8]
        fixture = subprocess.Popen([sys.executable, "-B", str(Path(__file__).with_name("windows_fixture.py")), title],
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8",
                                   creationflags=subprocess.CREATE_NO_WINDOW)
        session = Session()
        ready = None
        try:
            ready = json.loads(fixture.stdout.readline())
            session.execute("interaction.begin", {"show_overlay": False})
            session.execute("ui.find", {"title_exact": title, "automation_id": "106"})
            # Use the actual native TextPattern and keyboard with a simulated
            # provider which does not advertise ValuePattern.
            original_pattern = session.desktop._pattern
            def text_only(element, pattern_id, interface):
                if pattern_id == 10002 and str(element.CurrentAutomationId) == "106":
                    raise DeskPilotError("UI_PATTERN_UNAVAILABLE", "The fixture exposes text only.")
                return original_pattern(element, pattern_id, interface)
            session.desktop._pattern = text_only
            def reference():
                rich = session.execute("ui.find", {"title_exact": title, "automation_id": "106"})
                self.assertEqual(rich["count"], 1)
                return {"element_id": rich["elements"][0]["element_id"], "observation_id": rich["observation_id"]}
            before = session.execute("ui.get", reference())
            self.assertEqual(before["element"]["value_source"], "uia_text")
            self.assertIn("First line", before["element"]["value"])
            for expected in ("合成中文 text 456", "第一行\nSecond line"):
                params = reference() | {"value": expected}
                if "\n" in expected:
                    params["newline_strategy"] = "unicode"  # This native fixture accepts literal LF.
                replaced = session.execute("ui.set_value", params)
                self.assertEqual(replaced["verification"]["method"], "uia_text_keyboard")
                self.assertTrue(replaced["verification"]["matched"])
                read = session.execute("ui.get", reference())
                self.assertEqual(read["element"]["value"].replace("\r\n", "\n"), expected)
        finally:
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
            fixture.stdout.close()
            errors = fixture.stderr.read()
            fixture.stderr.close()
            self.assertEqual(errors, "")

    def _check_overlay_capture_and_hit_guard(self, session, title, area):
        baseline = session.execute("screen.capture", {"title_exact": title})
        base_image = Image.open(baseline["screenshot"]["path"])
        user = ctypes.WinDLL("user32")
        user.CreateWindowExW.restype = ctypes.c_void_p
        user.CreateWindowExW.argtypes = [ctypes.c_ulong, ctypes.c_wchar_p, ctypes.c_wchar_p, ctypes.c_ulong,
                                        ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int,
                                        ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p]
        user.SetWindowPos.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_uint]
        user.DestroyWindow.argtypes = [ctypes.c_void_p]
        user.FindWindowW.argtypes = [ctypes.c_wchar_p, ctypes.c_wchar_p]
        user.FindWindowW.restype = ctypes.c_void_p
        user.GetForegroundWindow.restype = ctypes.c_void_p
        user.SetLayeredWindowAttributes.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_byte, ctypes.c_ulong]
        focus_stages = [("baseline", user.GetForegroundWindow())]
        # Create hidden, then show with SWP_NOACTIVATE. Creating an initially
        # visible BUTTON can activate it despite WS_EX_NOACTIVATE.
        overlay = user.CreateWindowExW(0x08000008, "BUTTON", "Unrelated fixture", 0x80000000,
                                      area["x"] + 150, area["y"] + 150, 180, 100, None, None, None, None)
        focus_stages.append(("unrelated created", user.GetForegroundWindow()))
        self.assertTrue(overlay)
        owned_popup = transparent_overlay = None
        try:
            target_handle = user.FindWindowW(None, title)
            self.assertTrue(target_handle)
            owned_popup = user.CreateWindowExW(0x08000008, "BUTTON", "Owned popup fixture", 0x80000000,
                                              area["x"] + 500, area["y"] + 150, 100, 100,
                                              target_handle, None, None, None)
            self.assertTrue(owned_popup)
            focus_stages.append(("owned created", user.GetForegroundWindow()))
            # WS_EX_TRANSPARENT makes WindowFromPoint pass through this
            # foreign overlay, although it is still visible above the target.
            transparent_overlay = user.CreateWindowExW(0x08080028, "BUTTON", "Click-through fixture", 0x80000000,
                                                       area["x"] + 350, area["y"] + 150, 100, 100,
                                                       None, None, None, None)
            self.assertTrue(transparent_overlay)
            focus_stages.append(("click-through created", user.GetForegroundWindow()))
            self.assertTrue(user.SetLayeredWindowAttributes(transparent_overlay, 0, 150, 2))
            user.SetWindowPos(overlay, ctypes.c_void_p(-1), area["x"] + 150, area["y"] + 150, 180, 100, 0x10 | 0x40)
            user.SetWindowPos(owned_popup, ctypes.c_void_p(-1), area["x"] + 500, area["y"] + 150, 100, 100, 0x10 | 0x40)
            user.SetWindowPos(transparent_overlay, ctypes.c_void_p(-1), area["x"] + 350, area["y"] + 150, 100, 100, 0x10 | 0x40)
            focus_stages.append(("positioned", user.GetForegroundWindow()))
            try:
                captured = session.execute("screen.capture", {"title_exact": title})
            except DeskPilotError as error:
                foreground = error.details.get("foreground_after") or {}
                labels = {target_handle: "target", overlay: "unrelated", owned_popup: "owned", transparent_overlay: "click-through"}
                stages = [(stage, labels.get(handle, "other")) for stage, handle in focus_stages]
                raise AssertionError(f"Synthetic capture failed: {error.code}; foreground pid={foreground.get('pid')}, "
                                     f"class={foreground.get('class_name')}, fixture pid={os.getpid()}, stages={stages}") from error
            screenshot = captured["screenshot"]
            self.assertTrue(screenshot["trusted"])
            self.assertEqual(screenshot["capture_layer"], "windows_graphics_capture")
            self.assertEqual(screenshot["capture_scope"], "target_window_only")
            self.assertFalse(screenshot["separate_popup_windows_included"])
            blockers = screenshot["blockers"]
            self.assertTrue(any(item and item.get("title") == "Unrelated fixture" for item in blockers))
            self.assertTrue(any(item and item.get("pid") == os.getpid() for item in blockers))
            self.assertGreaterEqual(screenshot["overlapping_windows"], 1)
            self.assertTrue(any(item and item.get("title") == "Owned popup fixture"
                                for item in screenshot["separate_owned_windows"]))
            frame = Image.open(screenshot["path"])
            screen_x, screen_y = area["x"] + 200, area["y"] + 180
            def pixel(image, origin):
                x, y = screen_x - origin["x"], screen_y - origin["y"]
                self.assertTrue(0 <= x < image.width and 0 <= y < image.height)
                offset = (y * image.width + x) * 3
                return image.rgb[offset:offset + 3]
            self.assertEqual(pixel(base_image, baseline["screenshot"]["origin"]), pixel(frame, screenshot["origin"]))
            with self.assertRaises(DeskPilotError) as raised:
                session.execute("input.click", {"window_id": captured["window"]["window_id"],
                                               "screenshot_id": screenshot["screenshot_id"],
                                               "x": screen_x - screenshot["origin"]["x"],
                                               "y": screen_y - screenshot["origin"]["y"]})
            self.assertEqual(raised.exception.code, "POINT_OCCLUDED")
            self.assertEqual(raised.exception.outcome, "not_dispatched")
            with self.assertRaises(DeskPilotError) as hidden_popup:
                session.execute("input.click", {"window_id": captured["window"]["window_id"],
                                               "screenshot_id": screenshot["screenshot_id"],
                                               "x": area["x"] + 530 - screenshot["origin"]["x"],
                                               "y": area["y"] + 180 - screenshot["origin"]["y"]})
            self.assertEqual(hidden_popup.exception.code, "POINT_OCCLUDED")
            click_through_x, click_through_y = area["x"] + 390, area["y"] + 180
            from deskpilot.platforms.windows import POINT
            user.WindowFromPoint.argtypes = [POINT]
            user.WindowFromPoint.restype = ctypes.c_void_p
            user.IsChild.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
            hit = user.WindowFromPoint(POINT(click_through_x, click_through_y))
            self.assertTrue(hit == target_handle or user.IsChild(target_handle, hit),
                            "Fixture must allow the hit test to pass through.")
            with self.assertRaises(DeskPilotError) as click_through:
                session.execute("input.click", {"window_id": captured["window"]["window_id"],
                                               "screenshot_id": screenshot["screenshot_id"],
                                               "x": click_through_x - screenshot["origin"]["x"],
                                               "y": click_through_y - screenshot["origin"]["y"]})
            self.assertEqual(click_through.exception.code, "POINT_OCCLUDED")
            self.assertEqual(click_through.exception.outcome, "not_dispatched")
            clear_x, clear_y = area["x"] + 100, area["y"] + 60
            allowed = session.execute("input.click", {"window_id": captured["window"]["window_id"],
                                                       "screenshot_id": screenshot["screenshot_id"],
                                                       "x": clear_x - screenshot["origin"]["x"],
                                                       "y": clear_y - screenshot["origin"]["y"]})
            self.assertTrue(allowed["dispatched"])
        finally:
            if transparent_overlay:
                user.DestroyWindow(transparent_overlay)
            if owned_popup:
                user.DestroyWindow(owned_popup)
            user.DestroyWindow(overlay)


if __name__ == "__main__":
    unittest.main()
