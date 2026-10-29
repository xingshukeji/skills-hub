from __future__ import annotations

import json
from io import BytesIO, StringIO
from pathlib import Path
import secrets
import string
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from deskpilot import DeskPilotError
from deskpilot.cli import run_stream
from deskpilot.secret import keyboard_sequence, read_local_secret
from deskpilot.session import Session
from test_session import Desktop


class SecretDesktop(Desktop):
    def __init__(self):
        super().__init__()
        self.sensitive_write = None
        self.clicks = []
        self.owned = True

    def related(self, native, foreground):
        return self.owned and native == foreground

    def type_secret(self, value, checkpoint, *, window, target_kind):
        checkpoint()
        self.sensitive_write = value

    def click(self, window, x, y, **kwargs):
        self.clicks.append((x, y))


class SecretInputTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "fixture.json"
        self.marker = secrets.token_hex(12)
        self.path.write_text(json.dumps({"account": {"password": self.marker}}), encoding="utf-8")
        self.reference = {"path": str(self.path), "json_path": ["account", "password"]}
        self.desktop = SecretDesktop()
        self.session = Session(desktop=self.desktop)
        self.addCleanup(self.session.close)
        capture = self.session.execute("screen.capture", {"title_exact": "Fixture"})
        self.params = {"window_id": capture["window"]["window_id"], "screenshot_id": capture["screenshot"]["screenshot_id"],
                       "confirmed": True, "purpose": "authorized_local_test", "target_kind": "native_password",
                       "secret_ref": self.reference, "show_overlay": False}

    def test_local_reference_and_generic_errors_do_not_echo_content(self):
        self.assertTrue(read_local_secret(self.reference) == self.marker)
        for reference in ({"path": str(self.path), "json_path": ["missing"]},
                          {"path": "relative.json", "json_path": ["account"]},
                          {"path": str(self.path), "json_path": []}):
            with self.assertRaises(DeskPilotError) as caught:
                read_local_secret(reference)
            self.assertNotIn(self.marker, str(caught.exception.body()))

    def test_explicit_input_never_returns_secret_or_allows_plaintext_parameters(self):
        result = self.session.execute("input.secret", self.params)
        self.assertTrue(self.desktop.sensitive_write == self.marker)
        self.assertEqual(result["verification"], "not_read")
        self.assertNotIn(self.marker, json.dumps(result))
        with self.assertRaises(DeskPilotError) as caught:
            self.session.execute("input.secret", self.params | {"text": self.marker})
        self.assertNotIn(self.marker, str(caught.exception.body()))

    def test_missing_authorization_stale_capture_and_lost_foreground_do_not_write(self):
        for changes, expected in (({"confirmed": False}, "SENSITIVE_INPUT_BLOCKED"),
                                  ({"purpose": "other"}, "SENSITIVE_INPUT_BLOCKED"),
                                  ({"screenshot_id": "stale"}, "STALE_OBSERVATION")):
            with self.assertRaises(DeskPilotError) as caught:
                self.session.execute("input.secret", self.params | changes)
            self.assertEqual(caught.exception.code, expected)
        self.desktop.foreground = lambda: 8  # Even an owned popup is a different input target.
        self.desktop.related = lambda *args: True
        with self.assertRaises(DeskPilotError) as caught:
            self.session.execute("input.secret", self.params)
        self.assertEqual(caught.exception.code, "WINDOW_NOT_FOREGROUND")
        self.assertIsNone(self.desktop.sensitive_write)

    def test_opaque_target_requires_current_focus_evidence_and_secret_is_not_batchable(self):
        with self.assertRaises(DeskPilotError) as caught:
            self.session.execute("input.secret", self.params | {"target_kind": "observed_opaque_password"})
        self.assertEqual(caught.exception.code, "SENSITIVE_FOCUS_NOT_CONFIRMED")
        with self.assertRaises(DeskPilotError) as caught:
            self.session.execute("actions.batch", {"steps": [{"method": "input.secret", "params": self.params}]})
        self.assertEqual(caught.exception.code, "INVALID_BATCH")

    def test_soft_keyboard_layout_is_complete_before_any_secret_action(self):
        mapping = {character: [[10, 10]] for character in string.ascii_letters + string.digits}
        mapping[self.marker[0]] = [[11, 10]]
        layout = {"character_set": "ascii_alphanumeric", "keys": mapping}
        points = keyboard_sequence(layout, self.marker, width=80, height=60, offset_x=0, offset_y=0)
        self.assertEqual(len(points), len(self.marker))
        with self.assertRaises(DeskPilotError) as caught:
            keyboard_sequence(layout, self.marker + "!", width=80, height=60, offset_x=0, offset_y=0)
        self.assertEqual(caught.exception.code, "SECRET_LAYOUT_UNSUPPORTED")
        self.assertNotIn(self.marker, str(caught.exception.body()))
        with self.assertRaises(DeskPilotError):
            keyboard_sequence({"character_set": "ascii_alphanumeric", "keys": {"a": [[1, 1]]}},
                              self.marker, width=80, height=60, offset_x=0, offset_y=0)

    def test_soft_keyboard_runs_once_and_can_explicitly_click_observed_submit(self):
        layout = {"character_set": "ascii_alphanumeric",
                  "keys": {character: [[10, 10]] for character in string.ascii_letters + string.digits}}
        params = self.params | {"target_kind": "observed_opaque_password", "observed_password_focus": True,
                                "keyboard": layout, "submit_point": [50, 30]}
        with patch.object(self.session._cancelled, "wait", return_value=False):
            result = self.session.execute("input.secret", params)
        self.assertEqual(len(self.desktop.clicks), len(self.marker) + 1)
        self.assertEqual(self.desktop.clicks[-1], (50, 30))
        self.assertTrue(result["submit_dispatched"])
        self.assertIsNone(self.desktop.sensitive_write)
        self.assertNotIn(self.marker, json.dumps(result))

    def test_lost_foreground_during_keyboard_input_stops_without_replay(self):
        layout = {"character_set": "ascii_alphanumeric",
                  "keys": {character: [[10, 10]] for character in string.ascii_letters + string.digits}}
        def first_click(*args, **kwargs):
            self.desktop.clicks.append((10, 10))
            self.desktop.foreground = lambda: 8
            self.desktop.related = lambda *args: True
        self.desktop.click = first_click
        params = self.params | {"target_kind": "observed_opaque_password", "observed_password_focus": True,
                                "keyboard": layout}
        with patch.object(self.session._cancelled, "wait", return_value=False):
            with self.assertRaises(DeskPilotError) as caught:
                self.session.execute("input.secret", params)
        self.assertEqual((caught.exception.code, caught.exception.outcome), ("WINDOW_NOT_FOREGROUND", "unknown"))
        self.assertEqual(len(self.desktop.clicks), 1)
        self.assertNotIn(self.marker, str(caught.exception.body()))

    def test_backend_exception_cannot_echo_secret(self):
        def fail(value, *args, **kwargs):
            raise RuntimeError(value)
        self.desktop.type_secret = fail
        with self.assertRaises(DeskPilotError) as caught:
            self.session.execute("input.secret", self.params)
        self.assertEqual((caught.exception.code, caught.exception.outcome), ("INTERNAL_ERROR", "unknown"))
        self.assertNotIn(self.marker, str(caught.exception.body()))

    def test_stream_request_response_and_backend_errors_omit_secret(self):
        def fail(value, *args, **kwargs):
            raise RuntimeError(value)
        self.desktop.type_secret = fail
        request = json.dumps({"id": "private-input", "method": "input.secret", "params": self.params}) + "\n"
        output = StringIO()
        self.assertNotIn(self.marker, request)
        run_stream(BytesIO(request.encode("utf-8")), output, session_factory=lambda: self.session)
        self.assertNotIn(self.marker, output.getvalue())
        self.assertEqual(json.loads(output.getvalue())["error"]["code"], "INTERNAL_ERROR")


if __name__ == "__main__":
    unittest.main()
