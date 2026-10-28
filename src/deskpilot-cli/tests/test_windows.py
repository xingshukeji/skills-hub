"""Bounded Windows recovery contracts; no desktop or application is touched."""
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from deskpilot import DeskPilotError
from deskpilot.platforms.windows import WindowsDesktop


class Clock:
    now = 0.0
    def monotonic(self):
        return self.now
    def sleep(self, seconds):
        self.now += seconds


class ValuePattern:
    CurrentIsReadOnly = False
    def __init__(self, readings):
        self.readings = list(readings)
        self.writes = []
        self.reads = 0
    def SetValue(self, value):
        self.writes.append(value)
    @property
    def CurrentValue(self):
        self.reads += 1
        if len(self.readings) > 1:
            return self.readings.pop(0)
        return self.readings[0]


class WindowsContracts(unittest.TestCase):
    def setUp(self):
        self.clock = Clock()
        self.time_patch = patch('deskpilot.platforms.windows.time', self.clock)
        self.time_patch.start()
        self.addCleanup(self.time_patch.stop)
        self.desktop = WindowsDesktop.__new__(WindowsDesktop)
        self.desktop.element_info = lambda element: {'is_password': False, 'enabled': True, 'offscreen': False}
        self.element = SimpleNamespace(CurrentIsPassword=False)

    def value_pattern(self, readings):
        pattern = ValuePattern(readings)
        self.desktop._pattern = lambda *args: pattern
        return pattern

    def test_delayed_value_is_read_until_confirmed_without_repeating_write(self):
        pattern = self.value_pattern(['old', 'old', 'new', 'new'])
        result = self.desktop.set_value(self.element, 'new')
        self.assertTrue(result['matched'])
        self.assertGreaterEqual(pattern.reads, 4)
        self.assertEqual(pattern.writes, ['new'])

    def test_transient_value_then_rejection_stays_unknown_and_omits_content(self):
        pattern = self.value_pattern(['private-input', 'old-private-value'])
        with self.assertRaises(DeskPilotError) as caught:
            self.desktop.set_value(self.element, 'private-input')
        self.assertEqual((caught.exception.code, caught.exception.outcome), ('VALUE_NOT_VERIFIED', 'unknown'))
        self.assertEqual(pattern.writes, ['private-input'])
        self.assertGreaterEqual(self.clock.now, .75)
        self.assertNotIn('private', str(caught.exception.body()))

    def test_cancellation_during_readback_does_not_retry(self):
        pattern = self.value_pattern(['old'])
        def checkpoint():
            if pattern.reads >= 2:
                raise DeskPilotError('CANCELLED', 'Stopped.', outcome='unknown')
        with self.assertRaises(DeskPilotError) as caught:
            self.desktop.set_value(self.element, 'new', checkpoint=checkpoint)
        self.assertEqual(caught.exception.code, 'CANCELLED')
        self.assertEqual(pattern.writes, ['new'])
        self.assertLess(self.clock.now, .1)

    def test_control_becoming_sensitive_stops_before_value_readback(self):
        pattern = self.value_pattern(['never-read'])
        def checkpoint():
            if pattern.writes:
                self.element.CurrentIsPassword = True
        with self.assertRaises(DeskPilotError) as caught:
            self.desktop.set_value(self.element, 'new', checkpoint=checkpoint)
        self.assertEqual((caught.exception.code, caught.exception.outcome), ('SENSITIVE_INPUT_BLOCKED', 'unknown'))
        self.assertEqual(pattern.reads, 0)

    def focus_setup(self, *, native_return=False, focus_recovers=False):
        foreground = [20]
        target = {'native': 10, 'identity': (10, 1, 'fixture'), 'pid': 1, 'title': 'target'}
        other = {'native': 20, 'identity': (20, 2, 'fixture'), 'pid': 2, 'title': 'reply fixture'}
        self.desktop.user = SimpleNamespace(IsIconic=lambda _: False, SetForegroundWindow=Mock(return_value=native_return))
        self.desktop.foreground = lambda: foreground[0]
        self.desktop.related = lambda a, b: a == b
        self.desktop.window = lambda handle: dict(target if handle == 10 else other)
        focus = Mock(side_effect=lambda: foreground.__setitem__(0, 10) if focus_recovers else None)
        self.desktop._automation = Mock(return_value=SimpleNamespace(ElementFromHandle=Mock(return_value=SimpleNamespace(SetFocus=focus))))
        return target, focus

    def test_supported_focus_recovery_requires_actual_foreground(self):
        target, focus = self.focus_setup(focus_recovers=True)
        result = self.desktop.activate(target)
        self.assertEqual(result['activation']['method'], 'uia_set_focus')
        self.assertEqual(result['activation']['foreground_before']['title'], 'reply fixture')
        self.assertEqual(result['activation']['foreground_after']['title'], 'target')
        focus.assert_called_once()
        self.desktop.user.SetForegroundWindow.assert_called_once_with(10)

    def test_api_success_without_foreground_is_not_reported_as_activation(self):
        target, focus = self.focus_setup(native_return=True)
        with self.assertRaises(DeskPilotError) as caught:
            self.desktop.activate(target)
        self.assertEqual((caught.exception.code, caught.exception.outcome), ('WINDOW_ACTIVATION_FAILED', 'not_dispatched'))
        self.assertEqual(caught.exception.details['foreground_after']['title'], 'reply fixture')
        focus.assert_called_once()

    def test_activation_budget_stops_before_focus_fallback(self):
        target, focus = self.focus_setup()
        def checkpoint():
            if self.clock.now >= .1:
                raise DeskPilotError('TIMEOUT', 'Budget exhausted.')
        with self.assertRaises(DeskPilotError) as caught:
            self.desktop.activate(target, checkpoint=checkpoint)
        self.assertEqual(caught.exception.code, 'TIMEOUT')
        focus.assert_not_called()


if __name__ == '__main__':
    unittest.main()
