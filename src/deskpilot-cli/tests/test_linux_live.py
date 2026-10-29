from __future__ import annotations

import json
import ctypes as C
import os
from pathlib import Path
import subprocess
import sys
import unittest
import uuid
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from deskpilot.session import Session
from deskpilot.screen import Image
from deskpilot import DeskPilotError


@unittest.skipUnless(sys.platform.startswith("linux") and os.environ.get("DESKPILOT_LINUX_TESTS") == "1", "requires an explicitly selected Linux X11 fixture run")
class LinuxLiveTests(unittest.TestCase):
    def test_system_gtk_controls_unicode_input_capture_and_offline_ocr(self):
        title = "DeskPilot Linux " + uuid.uuid4().hex[:8]
        fixture = subprocess.Popen([sys.executable, "-B", str(Path(__file__).with_name("linux_fixture.py")), title],
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8")
        session = Session()
        screenshot = None
        activity_capture = None
        try:
            self.assertTrue(json.loads(fixture.stdout.readline())["ready"])
            found = session.execute("wait.window", {"title_exact": title, "timeout_ms": 5000})
            self.assertEqual(found["count"], 1)
            session.execute("interaction.begin", {"show_overlay": True, "show_action_trace": True})
            edit = session.execute("ui.find", {"title_exact": title, "name": "Input"})
            self.assertEqual(edit["count"], 1)
            text = "Linux \u4e2d\u6587\u8f93\u5165 12345"
            session.execute("ui.set_value", {"element_id": edit["elements"][0]["element_id"], "observation_id": edit["observation_id"], "value": text})
            edit = session.execute("ui.find", {"title_exact": title, "name": "Input"})
            session.execute("ui.click", {"element_id": edit["elements"][0]["element_id"], "observation_id": edit["observation_id"]})
            activity_capture = self._check_activity(session, title, edit)
            session.execute("input.hotkey", {"title_exact": title, "keys": ["CTRL", "A"]})
            text = "Linux \u4e2d\u6587\u8f93\u5165 67890"
            session.execute("input.type", {"title_exact": title, "text": text})
            apply = session.execute("ui.find", {"title_exact": title, "name": "Apply"})
            self.assertEqual(apply["count"], 1)
            session.execute("ui.invoke", {"element_id": apply["elements"][0]["element_id"], "observation_id": apply["observation_id"]})
            result = session.execute("wait.element", {"title_exact": title, "name": "Result: " + text, "timeout_ms": 3000})
            self.assertEqual(result["count"], 1)
            # Accessibility state can update before GTK paints the new frame.
            # Wait for the actual captured pixels to contain the new text.
            deadline = time.monotonic() + 3
            expected_text = "".join(text.split())
            while True:
                screenshot = session.execute("observe", {"title_exact": title, "include_screenshot": True})
                recognized = session.execute("messages.observe", {
                    "screenshot_id": screenshot["screenshot"]["screenshot_id"],
                    "expected_identity": "DeskPilot Linux Fixture"})
                captured_text = "".join(recognized["recognition"]["text"].split())
                if expected_text in captured_text or time.monotonic() >= deadline:
                    break
                time.sleep(0.05)
            self.assertTrue(screenshot["screenshot"]["trusted"])
            self.assertTrue(any(item["name"] == "Result: " + text for item in screenshot["elements"]))
            image = Image.open(screenshot["screenshot"]["path"])
            self.assertGreater(len(set(image.rgb)), 3)
            self.assertTrue(recognized["context_identity"]["matched"])
            self.assertIn(expected_text, captured_text)
            self._check_unrelated_overlay_is_rejected(session, title)
        finally:
            session.close()
            if screenshot:
                self.assertFalse(Path(screenshot["screenshot"]["path"]).exists())
            if activity_capture:
                self.assertFalse(Path(activity_capture).exists())
            fixture.terminate()
            fixture.wait(timeout=3)
            fixture.stdout.close()
            fixture.stderr.close()

    def _check_activity(self, session, title, edit):
        doctor = session.execute("doctor")
        self.assertTrue(doctor["activity"]["available"])
        self.assertTrue(doctor["activity"]["status_panel"])
        self.assertTrue(doctor["activity"]["action_trace"])
        self.assertTrue(doctor["activity"]["input_transparent"])
        # The session owns the process-wide AT-SPI lifecycle. Reuse its desktop
        # so this visual inspection cannot shut down the active session.
        desktop = session.desktop
        area, element = edit["window"]["bounds"], edit["elements"][0]["bounds"]
        center = (element["x"] + element["width"] // 2, element["y"] + element["height"] // 2)
        def colors(x, y, width=1, height=1):
            image = desktop.x.XGetImage(desktop.display, desktop.root, x, y, width, height, C.c_ulong(-1).value, 2)
            self.assertTrue(image)
            try:
                frame = image.contents
                self.assertEqual(frame.bits_per_pixel, 32)
                raw = C.string_at(frame.data, frame.bytes_per_line * frame.height)
                order = "little" if frame.byte_order == 0 else "big"
                return {int.from_bytes(raw[i:i + 4], order) & 0xFFFFFF for i in range(0, len(raw), 4)}
            finally:
                desktop.x.XDestroyImage(image)

        self.assertEqual(desktop.window(desktop.foreground())["title"], title)
        self.assertEqual(colors(area["x"] + 20, area["y"] - 2), {0x3080FF})
        self.assertEqual(colors(*center), {0x3080FF})
        screen = desktop._geometry(desktop.root)
        panel_colors = colors(max(0, screen["width"] - 335), 12, 320, 40)
        self.assertIn(0x111827, panel_colors)
        self.assertIn(0xF9FAFB, panel_colors)
        captured = session.execute("screen.capture", {"title_exact": title})
        image = Image.open(captured["screenshot"]["path"])
        x, y = center[0] - area["x"], center[1] - area["y"]
        offset = (y * image.width + x) * 3
        self.assertNotEqual(tuple(image.rgb[offset:offset + 3]), (0x30, 0x80, 0xFF))
        self.assertEqual(colors(*center), {0x3080FF})
        self.assertIn(0xF9FAFB, colors(max(0, screen["width"] - 335), 12, 320, 40))
        return captured["screenshot"]["path"]

    def _check_unrelated_overlay_is_rejected(self, session, title):
        observed = session.execute("observe", {"title_exact": title})
        area = observed["window"]["bounds"]
        desktop = session.desktop
        overlay = desktop.x.XCreateSimpleWindow(desktop.display, desktop.root,
                                                area["x"] + 4, area["y"] + 4, 12, 12, 0, 0xFF0000, 0xFF0000)
        self.assertTrue(overlay)
        try:
            kind = (C.c_ulong * 1)(desktop._atom("_NET_WM_WINDOW_TYPE_NOTIFICATION"))
            desktop.x.XChangeProperty(desktop.display, overlay, desktop._atom("_NET_WM_WINDOW_TYPE"), 4, 32, 0, kind, 1)
            desktop.x.XMapRaised(desktop.display, overlay)
            desktop.x.XSync(desktop.display, False)
            time.sleep(0.1)
            with self.assertRaises(DeskPilotError) as raised:
                session.execute("screen.capture", {"title_exact": title})
            self.assertEqual(raised.exception.code, "WINDOW_CAPTURE_UNTRUSTED")
            for method in ("input.click", "input.scroll"):
                observed = session.execute("observe", {"title_exact": title})
                with self.assertRaises(DeskPilotError) as raised:
                    session.execute(method, {"title_exact": title, "observation_id": observed["observation_id"],
                                             "x": 10, "y": 10, "amount": 120})
                self.assertEqual(raised.exception.code, "INPUT_TARGET_MISMATCH")
        finally:
            desktop.x.XDestroyWindow(desktop.display, overlay)
            desktop.x.XSync(desktop.display, False)
