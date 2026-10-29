"""Window-frame format, cancellation, and capture-session lifecycle contracts."""
from pathlib import Path
import os
import sys
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from deskpilot import DeskPilotError
from deskpilot.platforms.windows_capture import capture_window


class WindowsCaptureContracts(unittest.TestCase):
    def setUp(self):
        resources = str(Path(__file__).resolve().parents[3] / 'skills/shzw-deskpilot-cli')
        self.resources = patch.dict(os.environ, {'DESKPILOT_RESOURCES': resources})
        self.resources.start()
        self.addCleanup(self.resources.stop)

    def native(self, *, emit=True, color_format='bgra8', stop_error=None):
        control = SimpleNamespace(stop=Mock(side_effect=stop_error), is_finished=Mock(return_value=False))
        class Capture:
            def __init__(self, callback, closed, **kwargs):
                self.callback = callback
                self.kwargs = kwargs
            def start_free_threaded(self):
                if emit:
                    frame = SimpleNamespace(bytes_per_row=12, color_format=color_format,
                                            buffer_view=lambda: memoryview(bytes([3, 2, 1, 255, 6, 5, 4, 255, 0, 0, 0, 0])))
                    self.callback(frame, 12, 2, 1, [False], 0)
                return control
        return Capture, control

    def test_copies_bgra_frame_and_closes_capture(self):
        native, control = self.native()
        with patch('deskpilot.platforms.windows_capture._native_capture_class', return_value=native):
            image = capture_window(123)
        self.assertEqual((image.width, image.height, image.rgb), (2, 1, bytes([1, 2, 3, 4, 5, 6])))
        control.stop.assert_called_once()

    def test_cancel_while_waiting_closes_capture(self):
        native, control = self.native(emit=False)
        checks = 0
        def checkpoint():
            nonlocal checks
            checks += 1
            if checks > 2:
                raise DeskPilotError('CANCELLED', 'stopped')
        with patch('deskpilot.platforms.windows_capture._native_capture_class', return_value=native):
            with self.assertRaises(DeskPilotError) as caught:
                capture_window(123, checkpoint=checkpoint)
        self.assertEqual(caught.exception.code, 'CANCELLED')
        control.stop.assert_called_once()

    def test_cancel_during_stalled_start_cleans_up_when_start_returns(self):
        gate, stopped = threading.Event(), threading.Event()
        control = SimpleNamespace(stop=Mock(side_effect=stopped.set), is_finished=Mock(return_value=False))
        class SlowCapture:
            def __init__(self, callback, closed, **kwargs):
                pass
            def start_free_threaded(self):
                gate.wait(2)
                return control
        checks = 0
        def checkpoint():
            nonlocal checks
            checks += 1
            if checks > 1:
                raise DeskPilotError('CANCELLED', 'stopped')
        try:
            with patch('deskpilot.platforms.windows_capture._native_capture_class', return_value=SlowCapture):
                with self.assertRaises(DeskPilotError) as caught:
                    capture_window(123, checkpoint=checkpoint)
            self.assertEqual(caught.exception.code, 'CANCELLED')
            self.assertFalse(stopped.is_set())
        finally:
            gate.set()
        self.assertTrue(stopped.wait(2))
        control.stop.assert_called_once()

    def test_unsupported_frame_format_cannot_be_trusted(self):
        native, control = self.native(color_format='rgba16f')
        with patch('deskpilot.platforms.windows_capture._native_capture_class', return_value=native):
            with self.assertRaises(DeskPilotError) as caught:
                capture_window(123)
        self.assertEqual(caught.exception.code, 'WINDOW_CAPTURE_FAILED')
        control.stop.assert_called_once()

    def test_cleanup_failure_is_not_reported_as_success(self):
        native, control = self.native(stop_error=RuntimeError('native stop failed'))
        with patch('deskpilot.platforms.windows_capture._native_capture_class', return_value=native):
            with self.assertRaises(DeskPilotError) as caught:
                capture_window(123)
        self.assertEqual(caught.exception.code, 'WINDOW_CAPTURE_FAILED')
        control.stop.assert_called_once()
