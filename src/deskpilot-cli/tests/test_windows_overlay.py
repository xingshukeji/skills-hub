from __future__ import annotations

import ctypes
import os
from pathlib import Path
import sys
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from deskpilot import DeskPilotError
from deskpilot.platforms.windows_overlay import ActivityOverlay, _status_text


class ActivityLabelTests(unittest.TestCase):
    def test_common_actions_and_custom_labels(self):
        self.assertEqual(_status_text("ui.set_value"), "Entering text")
        self.assertEqual(_status_text("input.hotkey"), "Pressing keys")
        self.assertEqual(_status_text("input.unknown"), "Working")
        self.assertEqual(_status_text("  正在处理\n资料  "), "正在处理 资料")

    def test_dismissal_only_blocks_actions_that_require_a_visible_indicator(self):
        from deskpilot.session import Session

        class DismissedDesktop:
            def activity(self, window, label, *, visible=True, trace=None):
                if visible:
                    raise DeskPilotError("OVERLAY_DISMISSED", "The user closed the indicator.")

            def close(self):
                pass

        session = Session(desktop=DismissedDesktop())
        try:
            session._activity(None, "Observe", {})
            with self.assertRaises(DeskPilotError) as required:
                session._activity(None, "Observe", {"overlay_required": True})
            self.assertEqual(required.exception.code, "OVERLAY_UNAVAILABLE")
        finally:
            session.close()


@unittest.skipUnless(sys.platform == "win32" and os.environ.get("DESKPILOT_LIVE_TESTS") == "1",
                     "requires a Windows interactive desktop")
class ActivityOverlayLiveTests(unittest.TestCase):
    def test_close_button_hides_the_cue_without_activating_or_interrupting(self):
        from ctypes import wintypes as w

        class Point(ctypes.Structure):
            _fields_ = [("x", w.LONG), ("y", w.LONG)]

        class Rect(ctypes.Structure):
            _fields_ = [("left", w.LONG), ("top", w.LONG), ("right", w.LONG), ("bottom", w.LONG)]

        user = ctypes.WinDLL("user32", use_last_error=True)
        user.GetForegroundWindow.restype = w.HWND
        user.GetWindowRect.argtypes = [w.HWND, ctypes.POINTER(Rect)]
        user.GetWindowThreadProcessId.argtypes = [w.HWND, ctypes.POINTER(w.DWORD)]
        user.GetWindowTextW.argtypes = [w.HWND, w.LPWSTR, ctypes.c_int]
        user.WindowFromPoint.argtypes = [Point]
        user.WindowFromPoint.restype = w.HWND
        user.IsWindowVisible.argtypes = [w.HWND]
        user.GetCursorPos.argtypes = [ctypes.POINTER(Point)]
        user.SetCursorPos.argtypes = [ctypes.c_int, ctypes.c_int]
        user.mouse_event.argtypes = [w.DWORD, w.DWORD, w.DWORD, w.DWORD, ctypes.c_size_t]
        callback_type = ctypes.WINFUNCTYPE(w.BOOL, w.HWND, w.LPARAM)
        user.EnumWindows.argtypes = [callback_type, w.LPARAM]

        def window(title):
            matches = []

            @callback_type
            def inspect(handle, _):
                pid = w.DWORD()
                user.GetWindowThreadProcessId(handle, ctypes.byref(pid))
                text = ctypes.create_unicode_buffer(128)
                user.GetWindowTextW(handle, text, len(text))
                if pid.value == os.getpid() and text.value == title:
                    matches.append(handle)
                return True

            user.EnumWindows(inspect, 0)
            self.assertEqual(len(matches), 1, title)
            return matches[0]

        def wait_for(predicate):
            deadline = time.monotonic() + 2
            while time.monotonic() < deadline:
                if predicate():
                    return
                time.sleep(0.02)
            self.fail("Activity window did not reach the expected state")

        overlay = ActivityOverlay()
        try:
            foreground = user.GetForegroundWindow()
            overlay.update({"x": 40, "y": 100, "width": 300, "height": 180}, "ui.set_value", (80, 80))
            panel, button, frame = (window(title) for title in
                                    ("DeskPilot status", "Close DeskPilot status", "DeskPilot activity"))
            wait_for(lambda: user.IsWindowVisible(panel) and user.IsWindowVisible(button) and user.IsWindowVisible(frame))
            self.assertEqual(user.GetForegroundWindow(), foreground)
            rect = Rect()
            self.assertTrue(user.GetWindowRect(button, ctypes.byref(rect)))
            click = Point((rect.left + rect.right) // 2, (rect.top + rect.bottom) // 2)
            self.assertEqual(user.WindowFromPoint(click), button, "The visible close control must receive the click")
            panel_rect = Rect()
            self.assertTrue(user.GetWindowRect(panel, ctypes.byref(panel_rect)))
            self.assertNotEqual(user.WindowFromPoint(Point(panel_rect.left + 20, click.y)), panel,
                                "The rest of the cue must remain click-through")

            overlay.hide()
            wait_for(lambda: not user.IsWindowVisible(panel) and not user.IsWindowVisible(button))
            overlay.resume()
            wait_for(lambda: user.IsWindowVisible(panel) and user.IsWindowVisible(button))
            self.assertEqual(user.WindowFromPoint(click), button)

            previous = Point()
            self.assertTrue(user.GetCursorPos(ctypes.byref(previous)))
            try:
                self.assertTrue(user.SetCursorPos(click.x, click.y))
                self.assertEqual(user.WindowFromPoint(click), button)
                user.mouse_event(0x0002, 0, 0, 0, 0)
                user.mouse_event(0x0004, 0, 0, 0, 0)
                wait_for(lambda: not user.IsWindowVisible(panel) and not user.IsWindowVisible(button)
                         and not user.IsWindowVisible(frame))
            finally:
                current = Point()
                if user.GetCursorPos(ctypes.byref(current)) and (current.x, current.y) == (click.x, click.y):
                    user.SetCursorPos(previous.x, previous.y)
            self.assertEqual(user.GetForegroundWindow(), foreground)
            with self.assertRaises(DeskPilotError) as dismissed:
                overlay.update(None, "Observe")
            self.assertEqual(dismissed.exception.code, "OVERLAY_DISMISSED")
            overlay.resume()
            overlay.finish("Ready")
            time.sleep(0.1)
            self.assertFalse(user.IsWindowVisible(panel), "Later updates must not reopen a dismissed cue")
            self.assertTrue(overlay._thread.is_alive(), "Dismissing the cue must not stop the owning process")
        finally:
            overlay.close()

        # The same control must also be discoverable and invokable by assistive technology.
        from deskpilot.platforms.windows import WindowsDesktop
        skill = Path(__file__).resolve().parents[3] / "skills" / "shzw-deskpilot-cli"
        with patch.dict(os.environ, {"DESKPILOT_RESOURCES": str(skill)}):
            desktop = WindowsDesktop()
            accessible_overlay = ActivityOverlay()
            try:
                accessible_overlay.update(None, "Observe")
                accessible_button = window("Close DeskPilot status")
                wait_for(lambda: user.IsWindowVisible(accessible_button))
                element = desktop._automation().ElementFromHandle(accessible_button)
                self.assertEqual(element.CurrentName, "Close DeskPilot status")
                self.assertEqual(element.CurrentControlType, 50000)  # UIA Button
                pattern = element.GetCurrentPattern(10000).QueryInterface(desktop._uia_module.IUIAutomationInvokePattern)
                pattern.Invoke()
                wait_for(accessible_overlay._dismissed.is_set)
                self.assertFalse(user.IsWindowVisible(accessible_button))
            finally:
                accessible_overlay.close()
                desktop.close()


if __name__ == "__main__":
    unittest.main()
