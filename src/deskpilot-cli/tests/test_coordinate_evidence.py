"""Public-session regressions for target changes without a window change."""
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from deskpilot import DeskPilotError
from deskpilot.screen import Image
from deskpilot.session import Session
from test_session import Desktop


class CoordinateEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.desktop = Desktop()
        self.desktop.item["bounds"] = {"x": 10, "y": 20, "width": 180, "height": 100}
        self.desktop.scroll = lambda *args, **kwargs: setattr(self.desktop, "writes", self.desktop.writes + 1)
        self.target_x = 20
        self.animate_elsewhere = False
        self.caret = False
        self.frames = 0
        self.desktop.capture = self.capture
        self.session = Session(desktop=self.desktop)
        self.addCleanup(self.session.close)

    def capture(self, window, **kwargs):
        self.frames += 1
        pixels = bytearray(b"\xff\xff\xff" * 180 * 100)
        for y in range(30, 65):
            for x in range(self.target_x, self.target_x + 40):
                offset = (y * 180 + x) * 3
                pixels[offset:offset + 3] = b"\x20\x50\xc0"
        if self.animate_elsewhere:
            for y in range(100):
                for x in range(150, 180):
                    offset = (y * 180 + x) * 3
                    pixels[offset:offset + 3] = bytes([self.frames % 2 * 255]) * 3
        if self.caret and self.frames % 2:
            for y in range(35, 55):
                offset = (y * 180 + 40) * 3
                pixels[offset:offset + 3] = b"\0\0\0"
        return Image(180, 100, bytes(pixels)), {"trusted": True}

    def coordinates(self):
        shot = self.session.execute("screen.capture", {"title_exact": "Fixture"})
        return {"window_id": shot["window"]["window_id"], "screenshot_id": shot["screenshot"]["screenshot_id"], "x": 40, "y": 45}

    def test_external_scroll_rejects_old_point_then_fresh_location_succeeds(self):
        args = self.coordinates()
        self.target_x = 95
        with self.assertRaises(DeskPilotError) as caught:
            self.session.execute("input.click", args)
        self.assertEqual((caught.exception.code, caught.exception.outcome), ("STALE_OBSERVATION", "not_dispatched"))
        self.assertEqual(self.desktop.writes, 0)
        fresh = self.coordinates() | {"x": 115}
        self.assertTrue(self.session.execute("input.click", fresh)["dispatched"])
        self.assertEqual(self.desktop.writes, 1)

    def test_stable_target_accepts_unrelated_animation_and_blinking_caret(self):
        self.animate_elsewhere = self.caret = True
        args = self.coordinates()
        self.assertTrue(self.session.execute("input.click", args)["dispatched"])
        self.assertEqual(self.desktop.writes, 1)

    def test_target_moving_during_preflight_never_dispatches(self):
        args = self.coordinates()
        old_capture = self.desktop.capture
        def moving(window, **kwargs):
            self.target_x += 20
            return old_capture(window, **kwargs)
        self.desktop.capture = moving
        with self.assertRaises(DeskPilotError):
            self.session.execute("input.scroll", args | {"amount": -120})
        self.assertEqual(self.desktop.writes, 0)

    def test_dispatched_unknown_is_not_retried_and_reference_expires(self):
        args = self.coordinates()
        def failed(*args, **kwargs):
            self.desktop.writes += 1
            self.desktop.value = "saved"
            raise DeskPilotError("INPUT_NOT_DELIVERED", "Lost receipt", outcome="unknown")
        self.desktop.click = failed
        with self.assertRaises(DeskPilotError) as caught:
            self.session.execute("input.click", args)
        self.assertEqual(caught.exception.outcome, "unknown")
        with self.assertRaises(DeskPilotError) as stale:
            self.session.execute("input.click", args)
        self.assertEqual(stale.exception.code, "STALE_OBSERVATION")
        self.assertEqual(self.desktop.writes, 1)
        # A resumed consumer observes the already-saved effect with fresh references.
        resumed = Session(desktop=self.desktop)
        self.addCleanup(resumed.close)
        observed = resumed.execute("ui.find", {"title_exact": "Fixture", "automation_id": "input", "require_unique": True})
        read = resumed.execute("ui.get", {"element_id": observed["elements"][0]["element_id"], "observation_id": observed["observation_id"]})
        self.assertEqual(read["element"]["value"], "saved")
        self.assertEqual(self.desktop.writes, 1)

    def test_observed_control_move_rejects_coordinate_but_semantic_click_relocates(self):
        observed = self.session.execute("observe", {"title_exact": "Fixture"})
        ref = {"observation_id": observed["observation_id"], "element_id": observed["elements"][0]["element_id"]}
        self.desktop.element_info = lambda native: {"name": "Input", "bounds": {"x": 80, "y": 40, "width": 40, "height": 20},
                                                    "enabled": True, "offscreen": False}
        with self.assertRaises(DeskPilotError) as caught:
            self.session.execute("input.click", ref | {"window_id": observed["window"]["window_id"], "x": 10, "y": 10})
        self.assertEqual(caught.exception.code, "STALE_OBSERVATION")
        observed = self.session.execute("observe", {"title_exact": "Fixture"})
        clicked = []
        self.desktop.click = lambda window, x, y, **kwargs: clicked.append((x, y))
        self.session.execute("ui.click", {"observation_id": observed["observation_id"], "element_id": observed["elements"][0]["element_id"]})
        self.assertEqual(clicked, [(90, 30)])

    def test_reused_control_with_a_different_name_cannot_be_clicked(self):
        observed = self.session.execute("observe", {"title_exact": "Fixture"})
        original = self.desktop.element_info
        self.desktop.element_info = lambda native: {**original(native), "name": "Different target"}
        with self.assertRaises(DeskPilotError) as caught:
            self.session.execute("ui.click", {"observation_id": observed["observation_id"], "element_id": observed["elements"][0]["element_id"]})
        self.assertEqual(caught.exception.code, "STALE_OBSERVATION")
        self.assertEqual(self.desktop.writes, 0)

    def test_unsupported_secret_is_discoverable_and_never_reads_or_dispatches(self):
        for platform in ("macos-arm64", "macos-x64", "linux-x64"):
            with self.subTest(platform=platform), patch("deskpilot.session.platform_key", return_value=platform), \
                    patch("deskpilot.secret.read_local_secret", side_effect=AssertionError("must not read")):
                session = Session()
                for kind in ("native_password", "observed_opaque_password"):
                    self.assertFalse(session.execute("capabilities")["sensitive_input"][kind]["implemented"])
                    self.assertFalse(session.execute("schema", {"method": "input.secret"})["sensitive_input"][kind]["implemented"])
                    with self.assertRaises(DeskPilotError) as caught:
                        session.execute("input.secret", {"confirmed": True, "purpose": "authorized_local_test", "target_kind": kind})
                    self.assertEqual((caught.exception.code, caught.exception.outcome), ("UNSUPPORTED_PLATFORM", "not_dispatched"))
                self.assertIsNone(session._desktop)
                session.close()

    def test_doctor_distinguishes_generic_input_from_sensitive_input(self):
        self.desktop.doctor = lambda: {"input": {"available": True}}
        self.session._browser = type("Browser", (), {"diagnose": lambda self: {}, "close": lambda self: None})()
        with patch("deskpilot.screen.Ocr.diagnose", return_value={"available": True}):
            result = self.session.execute("doctor")
        self.assertTrue(result["input"]["available"])
        self.assertFalse(result["sensitive_input"]["native_password"]["implemented"])
        self.assertTrue(result["sensitive_input"]["android_password"]["implemented"])

    def test_container_scroll_requires_explicit_target_and_then_remains_usable(self):
        area = dict(self.desktop.item["bounds"])
        self.desktop.tree = lambda window, **kwargs: [{"native": "scroll", "name": "Scroll", "bounds": area,
                                                       "control_type": 50033, "enabled": True, "offscreen": False}]
        self.desktop.element_info = lambda native: {"name": "Scroll", "bounds": area, "enabled": True, "offscreen": False}
        scrolls = []
        self.desktop.scroll = lambda window, x, y, amount, **kwargs: scrolls.append(amount)
        observed = self.session.execute("observe", {"title_exact": "Fixture"})
        params = {"window_id": observed["window"]["window_id"], "observation_id": observed["observation_id"],
                  "x": 40, "y": 45, "amount": -120}
        with self.assertRaises(DeskPilotError) as caught:
            self.session.execute("input.scroll", params)
        self.assertEqual(caught.exception.code, "COORDINATE_TARGET_REQUIRED")
        with self.assertRaises(DeskPilotError) as click:
            self.session.execute("input.click", params | {"element_id": observed["elements"][0]["element_id"]})
        self.assertEqual(click.exception.code, "COORDINATE_TARGET_REQUIRED")
        self.session.execute("input.scroll", params | {"element_id": observed["elements"][0]["element_id"]})
        self.assertEqual(scrolls, [-120])


if __name__ == "__main__":
    unittest.main()
