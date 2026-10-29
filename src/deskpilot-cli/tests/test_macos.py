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
        self.desktop.cg = SimpleNamespace(CGWindowLevelForKey=lambda key: 2147483630 if key == 19 else 0)
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


if __name__ == "__main__":
    unittest.main()
