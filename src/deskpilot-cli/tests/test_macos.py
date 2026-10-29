"""Portable assertions for the native backend's pre-dispatch target checks.

The separate macOS workflow verifies these checks against actual WindowServer
windows. These focused tests must also run on the other maintainer platforms.
"""

from pathlib import Path
from types import SimpleNamespace
import sys
import unittest
from unittest.mock import Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from deskpilot import DeskPilotError
from deskpilot.platforms.macos import MacDesktop, Point


class MacPointGuardTests(unittest.TestCase):
    def setUp(self):
        self.target = {"native": 1, "identity": (1, 100), "pid": 100,
                       "bounds": {"x": 20, "y": 30, "width": 300, "height": 200}}
        self.foreign = {"native": 2, "identity": (2, 200), "pid": 200,
                        "bounds": {"x": 60, "y": 70, "width": 80, "height": 60}}
        self.desktop = MacDesktop.__new__(MacDesktop)
        self.desktop._overlay = None
        self.desktop.cg = SimpleNamespace(CGWindowLevelForKey=lambda key: {19: 2147483630, 7: 20}.get(key, 0))
        self.desktop._input_access = Mock()
        self.desktop.foreground = lambda: self.target["native"]
        self.desktop._post = Mock()
        self.desktop._pointer = Mock(side_effect=AssertionError("Rejected input must not reach pointer dispatch."))

    def test_foreign_floating_window_blocks_click_and_scroll_before_any_event(self):
        self.desktop.windows = Mock(return_value=[self.foreign, self.target])
        for action in (lambda: self.desktop.click(self.target, 60, 60),
                       lambda: self.desktop.scroll(self.target, 60, 60, 120)):
            with self.assertRaises(DeskPilotError) as raised:
                action()
            self.assertEqual(raised.exception.code, "POINT_OCCLUDED")
            self.assertEqual(raised.exception.outcome, "not_dispatched")
            self.assertEqual(raised.exception.details["blocking_pid"], 200)
        self.desktop.windows.assert_called_with(include_overlays=True)
        self.desktop._pointer.assert_not_called()
        self.desktop._post.assert_not_called()

    def test_uncovered_point_remains_actionable_when_another_window_is_elsewhere(self):
        self.desktop.windows = Mock(return_value=[self.foreign, self.target])
        self.desktop._point_guard(self.target, Point(25, 35))

    def test_only_the_live_owned_activity_helper_is_excluded(self):
        process = SimpleNamespace(pid=200, poll=lambda: None)
        self.desktop._overlay = SimpleNamespace(process=process)
        self.desktop.windows = Mock(return_value=[self.foreign, self.target])
        self.desktop._point_guard(self.target, Point(80, 90))
        process.poll = lambda: 1
        with self.assertRaises(DeskPilotError) as raised:
            self.desktop._point_guard(self.target, Point(80, 90))
        self.assertEqual(raised.exception.code, "POINT_OCCLUDED")

    def test_same_pid_different_window_is_not_assumed_to_be_the_target(self):
        popup = dict(self.foreign, pid=100, identity=(2, 100))
        self.desktop.windows = Mock(return_value=[popup, self.target])
        with self.assertRaises(DeskPilotError) as raised:
            self.desktop._point_guard(self.target, Point(80, 90))
        self.assertEqual(raised.exception.code, "POINT_OCCLUDED")

    def test_system_cursor_surface_is_excluded_without_exempting_other_high_windows(self):
        cursor = dict(self.foreign, process="Window Server", title="Cursor", layer=2147483630)
        self.desktop.windows = Mock(return_value=[cursor, self.target])
        self.desktop._point_guard(self.target, Point(80, 90))
        for change in ({"process": "Other"}, {"title": "Other"}, {"layer": 3}):
            self.desktop.windows = Mock(return_value=[cursor | change, self.target])
            with self.assertRaises(DeskPilotError) as raised:
                self.desktop._point_guard(self.target, Point(80, 90))
            self.assertEqual(raised.exception.code, "POINT_OCCLUDED")

    def test_missing_target_point_and_lost_foreground_do_not_dispatch(self):
        self.desktop.windows = Mock(return_value=[])
        with self.assertRaises(DeskPilotError) as missing:
            self.desktop._point_guard(self.target, Point(80, 90))
        self.assertEqual(missing.exception.code, "INPUT_TARGET_MISMATCH")
        self.desktop.foreground = lambda: 9
        with self.assertRaises(DeskPilotError) as background:
            self.desktop.scroll(self.target, 60, 60, 120)
        self.assertEqual(background.exception.code, "WINDOW_NOT_FOREGROUND")
        self.desktop._post.assert_not_called()

    def test_dock_transparent_region_requires_system_hit_test_and_actual_controls_still_block(self):
        dock = dict(self.foreign, process="Dock", title="Dock", layer=20)
        self.desktop.windows = Mock(return_value=[dock, self.target])
        self.desktop._point_pid = Mock(return_value=100)
        self.desktop._point_guard(self.target, Point(80, 90))
        for pid in (200, None):
            self.desktop._point_pid.return_value = pid
            with self.assertRaises(DeskPilotError) as raised:
                self.desktop._point_guard(self.target, Point(80, 90))
            self.assertEqual(raised.exception.code, "POINT_OCCLUDED")
        self.desktop._point_pid.return_value = 300
        self.desktop.windows = Mock(return_value=[dock, self.foreign | {"pid": 300}, self.target])
        with self.assertRaises(DeskPilotError) as raised:
            self.desktop._point_guard(self.target, Point(80, 90))
        self.assertEqual(raised.exception.details["blocking_pid"], 300)

    def test_scroll_event_has_the_requested_location_before_dispatch(self):
        self.desktop.windows = Mock(return_value=[self.target])
        self.desktop._pointer = lambda: Point(1, 2)
        events = []
        class Graphics:
            def CGEventCreateMouseEvent(self, *args): return ("mouse", args[2].x, args[2].y)
            def CGEventCreateScrollWheelEvent(self, *args): return {"kind": "wheel", "position": (1, 2)}
            def CGEventSetLocation(self, event, point): event["position"] = (point.x, point.y)
        self.desktop.cg = Graphics()
        self.desktop._post = events.append
        self.desktop.scroll(self.target, 60, 60, -120)
        self.assertEqual(events[1], {"kind": "wheel", "position": (80, 90)})
        self.assertEqual(events[-1], ("mouse", 1, 2))


class MacWindowBindingTests(unittest.TestCase):
    def setUp(self):
        self.window = {"native": 1, "pid": 100, "title": "Fixture page", "process": "Google Chrome",
                       "bounds": {"x": 20, "y": 30, "width": 300, "height": 200}}
        self.candidate = {"AXTitle": "Fixture page - Google Chrome", "bounds": dict(self.window["bounds"])}
        self.candidates = [self.candidate]
        self.desktop = MacDesktop.__new__(MacDesktop)
        self.desktop.cf = SimpleNamespace(CFRelease=Mock())
        self.desktop.ax = SimpleNamespace(AXUIElementCreateApplication=lambda pid: 1,
                                         AXUIElementSetMessagingTimeout=Mock())
        self.desktop._trusted = Mock()
        self.desktop._children = lambda *args: self.candidates
        self.desktop._read = lambda item, name, default=None: item.get(name, default)
        self.desktop._bounds = lambda item: item["bounds"]

    def test_chrome_owner_suffix_binds_the_same_unique_native_frame(self):
        self.assertIs(self.desktop._window_ax(self.window), self.candidate)
        self.candidate["AXTitle"] = self.window["title"]
        self.assertIs(self.desktop._window_ax(self.window), self.candidate)

    def test_other_titles_or_frame_changes_are_not_treated_as_the_same_window(self):
        for title in ("Different page - Google Chrome", "Fixture page - Other app", "Fixture page - Google Chrome extra"):
            self.candidate["AXTitle"] = title
            with self.assertRaises(DeskPilotError) as raised:
                self.desktop._window_ax(self.window)
            self.assertEqual(raised.exception.code, "WINDOW_IDENTITY_MISMATCH")
        self.candidate["AXTitle"] = "Fixture page - Google Chrome"
        self.candidate["bounds"]["x"] += 10
        with self.assertRaises(DeskPilotError):
            self.desktop._window_ax(self.window)

    def test_decorated_title_does_not_resolve_ambiguous_windows(self):
        self.candidates.append(dict(self.candidate))
        with self.assertRaises(DeskPilotError) as raised:
            self.desktop._window_ax(self.window)
        self.assertEqual(raised.exception.code, "WINDOW_IDENTITY_MISMATCH")


class MacForegroundTests(unittest.TestCase):
    def test_foreground_uses_the_actual_frontmost_application_and_window_order(self):
        desktop = MacDesktop.__new__(MacDesktop)
        def send(receiver, selector, *args):
            return {"sharedWorkspace": 2, "frontmostApplication": 3, "processIdentifier": 100}[selector]
        desktop.objc = SimpleNamespace(cls=lambda _: 1, send=send)
        desktop.windows = lambda: [{"native": 9, "pid": 200, "visible": True},
                                   {"native": 1, "pid": 100, "visible": True},
                                   {"native": 2, "pid": 100, "visible": True}]
        self.assertEqual(desktop.foreground(), 1)

    def test_no_frontmost_app_does_not_guess_another_visible_window(self):
        desktop = MacDesktop.__new__(MacDesktop)
        desktop.objc = SimpleNamespace(cls=lambda _: 1, send=lambda *args: 0)
        desktop.windows = Mock()
        self.assertIsNone(desktop.foreground())
        desktop.windows.assert_not_called()


if __name__ == "__main__":
    unittest.main()
