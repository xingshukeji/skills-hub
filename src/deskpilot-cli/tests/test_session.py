from __future__ import annotations

from io import BytesIO, StringIO
from pathlib import Path
import sys
import threading
import time
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from deskpilot import DeskPilotError
from deskpilot.cli import parse_argv, run_stream
from deskpilot.screen import Image
from deskpilot.session import Session, resolve_references


class Desktop:
    def __init__(self):
        self.item = {"native": 7, "identity": (7, 9, "fixture"), "pid": 9, "process": "fixture",
                     "title": "Fixture", "class_name": "fixture", "bounds": {"x": 10, "y": 20, "width": 80, "height": 60}}
        self.value = ""
        self.writes = 0
        self.failure = None
        self.listed = threading.Event()

    def windows(self):
        self.listed.set()
        return [dict(self.item)]

    def window(self, native):
        return dict(self.item)

    def activate(self, window, *, checkpoint=lambda: None):
        return window

    def foreground(self):
        return 7

    def restore(self, previous):
        return False

    def activity(self, *args, **kwargs):
        pass

    def tree(self, window, **kwargs):
        kwargs["checkpoint"]()
        return [{"native": "edit", "name": "Input", "automation_id": "input", "class_name": "EditControl", "control_type": 50004,
                 "enabled": True, "offscreen": False, "is_password": False, "bounds": {"x": 15, "y": 25, "width": 40, "height": 20}}]

    def element_info(self, native):
        return {"value": self.value, "bounds": {"x": 15, "y": 25, "width": 40, "height": 20}, "enabled": True, "offscreen": False}

    def set_value(self, native, value, *, checkpoint=lambda: None, window=None, newline_strategy=None):
        if self.failure == "password":
            raise DeskPilotError("SENSITIVE_INPUT_BLOCKED", "The control is sensitive.")
        self.writes += 1
        self.value = value
        if self.failure == "unknown":
            raise DeskPilotError("INPUT_NOT_DELIVERED", "The result could not be observed.", outcome="unknown")
        if self.failure == "crash":
            raise RuntimeError("private-text-should-not-escape")

    def capture(self, window, *, checkpoint=lambda: None):
        return Image(80, 60, b"\xff\xff\xff" * 80 * 60), {"trusted": True}

    def click(self, *args, **kwargs):
        self.writes += 1

    def close(self):
        pass


class SessionTests(unittest.TestCase):
    def setUp(self):
        self.desktop = Desktop()
        self.session = Session(desktop=self.desktop)
        self.addCleanup(self.session.close)

    def found(self):
        observation = self.session.execute("ui.find", {"title_exact": "Fixture", "automation_id": "input"})
        return {"element_id": observation["elements"][0]["element_id"], "observation_id": observation["observation_id"]}

    def test_element_class_does_not_override_window_identity_filters(self):
        window = self.session.execute("windows.find", {"class_name": "fixture"})["windows"][0]["window_id"]
        result = self.session.execute("ui.find", {"window_id": window, "class_name": "EditControl"})
        self.assertEqual(result["count"], 1)
        self.assertEqual(result["elements"][0]["automation_id"], "input")
        result = self.session.execute("wait.element", {"title_exact": "Fixture", "class_name": "EditControl", "timeout_ms": 500})
        self.assertEqual(result["count"], 1)
        result = self.session.execute("ui.find", {"class": "fixture", "class_name": "EditControl"})
        self.assertEqual(result["count"], 1)
        result = self.session.execute("ui.find", {"window_class_name": "fixture", "class_name": "EditControl"})
        self.assertEqual(result["count"], 1)
        with self.assertRaises(DeskPilotError) as caught:
            self.session.execute("ui.find", {"window_id": window, "window_class_name": "different", "class_name": "EditControl"})
        self.assertEqual(caught.exception.code, "WINDOW_IDENTITY_MISMATCH")

    def test_truncated_search_cannot_prove_absence_or_uniqueness(self):
        with self.assertRaises(DeskPilotError) as absent:
            self.session.execute("wait.element", {"title_exact": "Fixture", "automation_id": "missing",
                                                  "limit": 1, "state": "absent", "timeout_ms": 500})
        self.assertEqual(absent.exception.code, "UI_AUTOMATION_INCOMPLETE")
        with self.assertRaises(DeskPilotError) as unique:
            self.session.execute("ui.find", {"title_exact": "Fixture", "automation_id": "input",
                                             "limit": 1, "require_unique": True})
        self.assertEqual(unique.exception.code, "UI_AUTOMATION_INCOMPLETE")
        with self.assertRaises(DeskPilotError) as no_match:
            self.session.execute("ui.find", {"title_exact": "Fixture", "automation_id": "missing",
                                             "require_unique": True})
        self.assertEqual(no_match.exception.code, "ELEMENT_NOT_FOUND")

    def test_batch_never_writes_when_a_search_is_ambiguous(self):
        original_tree = self.desktop.tree
        self.desktop.tree = lambda window, **kwargs: original_tree(window, **kwargs) * 2
        with self.assertRaises(DeskPilotError) as caught:
            self.session.execute("actions.batch", {"steps": [
                {"id": "find", "method": "ui.find", "params": {"title_exact": "Fixture", "automation_id": "input",
                                                                   "require_unique": True}},
                {"id": "write", "method": "ui.set_value", "params": {
                    "element_id": {"$ref": "find.result.elements[0].element_id"},
                    "observation_id": {"$ref": "find.result.observation_id"}, "value": "must not write"}}]})
        self.assertEqual(caught.exception.code, "ELEMENT_NOT_UNIQUE")
        self.assertEqual(self.desktop.writes, 0)

    def test_refs_are_session_owned_and_invalidated_after_write(self):
        reference = self.found()
        other = Session(desktop=self.desktop)
        self.addCleanup(other.close)
        with self.assertRaises(DeskPilotError) as raised:
            other.execute("ui.set_value", reference | {"value": "cross-session"})
        self.assertEqual(raised.exception.code, "STALE_OBSERVATION")
        self.session.execute("ui.set_value", reference | {"value": "first"})
        with self.assertRaises(DeskPilotError) as raised:
            self.session.execute("ui.set_value", reference | {"value": "second"})
        self.assertEqual(raised.exception.code, "STALE_OBSERVATION")
        self.assertEqual((self.desktop.writes, self.desktop.value), (1, "first"))

    def test_click_and_invoke_do_not_claim_the_application_result_was_verified(self):
        self.desktop.invoke = lambda _element: None
        clicked = self.session.execute("ui.click", self.found())
        invoked = self.session.execute("ui.invoke", self.found())
        self.assertEqual(clicked["verification"], {"status": "not_checked"})
        self.assertEqual(invoked["verification"], {"status": "not_checked"})

    def test_window_move_or_context_change_rejects_old_evidence_before_input(self):
        reference = self.found()
        self.desktop.item["title"] = "Different context"
        with self.assertRaises(DeskPilotError) as raised:
            self.session.execute("ui.set_value", reference | {"value": "wrong-context"})
        self.assertEqual(raised.exception.code, "STALE_OBSERVATION")
        self.assertEqual(self.desktop.writes, 0)

    def test_reused_native_window_cannot_reuse_an_opaque_id(self):
        self.found()
        self.desktop.item["identity"] = (7, 99, "another-window")
        with self.assertRaises(DeskPilotError) as raised:
            self.session.execute("windows.info", {})
        self.assertEqual(raised.exception.code, "WINDOW_IDENTITY_MISMATCH")

    def test_coordinates_require_current_evidence_and_boolean_override(self):
        with self.assertRaises(DeskPilotError):
            self.session.execute("input.click", {"title_exact": "Fixture", "x": 10, "y": 10, "allow_unobserved": "false"})
        self.assertEqual(self.desktop.writes, 0)
        captured = self.session.execute("screen.capture", {"title_exact": "Fixture"})
        args = {"window_id": captured["window"]["window_id"], "screenshot_id": captured["screenshot"]["screenshot_id"], "x": 10, "y": 10}
        self.session.execute("input.click", args)
        with self.assertRaises(DeskPilotError) as raised:
            self.session.execute("input.click", args)
        self.assertEqual(raised.exception.code, "STALE_OBSERVATION")
        self.assertEqual(self.desktop.writes, 1)

    def test_observe_can_return_one_current_tree_and_screenshot(self):
        result = self.session.execute("observe", {"title_exact": "Fixture", "include_screenshot": True})
        self.assertTrue(result["screenshot"]["trusted"])
        self.assertEqual(result["count"], 1)
        reference = {"element_id": result["elements"][0]["element_id"], "observation_id": result["observation_id"]}
        self.assertEqual(self.session.execute("ui.get", reference)["element"]["value"], "")
        self.session.execute("input.click", {"window_id": result["window"]["window_id"],
                                               "screenshot_id": result["screenshot"]["screenshot_id"], "x": 10, "y": 10})
        with self.assertRaises(DeskPilotError) as stale:
            self.session.execute("ui.get", reference)
        self.assertEqual(stale.exception.code, "STALE_OBSERVATION")

    def test_combined_observation_rejects_a_window_that_changes_during_capture(self):
        original_capture = self.desktop.capture
        def moved(window, **kwargs):
            result = original_capture(window, **kwargs)
            self.desktop.item["title"] = "Different context"
            return result
        self.desktop.capture = moved
        with self.assertRaises(DeskPilotError) as caught:
            self.session.execute("observe", {"title_exact": "Fixture", "include_screenshot": True})
        self.assertEqual(caught.exception.code, "STALE_OBSERVATION")

    def test_screenshot_coordinates_include_window_frame_offset(self):
        self.desktop.capture = lambda window, **kwargs: (
            Image(60, 50, b"\xff\xff\xff" * 60 * 50),
            {"trusted": True, "origin": {"x": 17, "y": 25}})
        clicks = []
        self.desktop.click = lambda window, x, y, **kwargs: clicks.append((x, y))
        capture = self.session.execute("screen.capture", {"title_exact": "Fixture"})
        self.assertEqual(capture["screenshot"]["origin"], {"x": 17, "y": 25})
        args = {"window_id": capture["window"]["window_id"],
                "screenshot_id": capture["screenshot"]["screenshot_id"]}
        with self.assertRaises(DeskPilotError) as caught:
            self.session.execute("input.click", args | {"x": 60, "y": 10})
        self.assertEqual(caught.exception.code, "INVALID_ARGUMENT")
        self.assertEqual(clicks, [])
        self.session.execute("input.click", args | {"x": 10, "y": 10})
        self.assertEqual(clicks, [(17, 15)])

    def test_capture_rejects_frame_geometry_outside_the_target(self):
        self.desktop.capture = lambda window, **kwargs: (
            Image(60, 50, b"\xff\xff\xff" * 60 * 50),
            {"trusted": True, "origin": {"x": 40, "y": 25}})
        with self.assertRaises(DeskPilotError) as caught:
            self.session.execute("screen.capture", {"title_exact": "Fixture"})
        self.assertEqual(caught.exception.code, "WINDOW_CAPTURE_UNTRUSTED")
        self.assertFalse(self.session._shots)

    def test_batch_validates_structure_before_any_operation(self):
        with self.assertRaises(DeskPilotError):
            self.session.execute("actions.batch", {"steps": [
                {"id": "find", "method": "ui.find", "params": {"title_exact": "Fixture"}},
                {"id": "invalid", "method": "unknown", "params": {}}]})
        self.assertFalse(self.desktop.listed.is_set())

    def test_batch_confirmation_cannot_be_bypassed_by_step_parameters(self):
        with self.assertRaises(DeskPilotError) as raised:
            self.session.execute("actions.batch", {"require_confirmation": True, "steps": [
                {"method": "input.click", "params": {"allow_unobserved": True, "title_exact": "Fixture", "x": 10, "y": 10}}]})
        self.assertEqual(raised.exception.code, "NEED_USER_CONFIRMATION")
        self.assertEqual(self.desktop.writes, 0)

    def test_batch_step_budget_stops_after_completed_write_without_marking_whole_batch_retryable(self):
        reference = self.found()
        started = time.monotonic()
        with self.assertRaises(DeskPilotError) as raised:
            self.session.execute("actions.batch", {"timeout_ms": 1000, "steps": [
                {"method": "ui.set_value", "params": reference | {"value": "keep"}},
                {"method": "wait.window", "params": {"title_exact": "absent", "timeout_ms": 40}},
                {"method": "input.type", "params": {"text": "must not run"}}]})
        self.assertLess(time.monotonic() - started, 0.5)
        self.assertEqual(raised.exception.code, "BATCH_STEP_FAILED")
        self.assertEqual(raised.exception.details["cause_code"], "TIMEOUT")
        self.assertFalse(raised.exception.retryable)
        self.assertEqual(self.desktop.writes, 1)

    def test_untrusted_capture_is_rejected_before_creating_an_image_reference(self):
        self.desktop.capture = lambda window, **kwargs: (Image(1, 1, b"\0\0\0"), {"trusted": False})
        with self.assertRaises(DeskPilotError) as raised:
            self.session.execute("screen.capture", {"title_exact": "Fixture"})
        self.assertEqual(raised.exception.code, "WINDOW_CAPTURE_UNTRUSTED")
        self.assertFalse(self.session._shots)

    def test_region_ocr_returns_full_image_coordinates_and_does_not_invent_verified_identity(self):
        class Reader:
            def read(reader, image, *args, **kwargs):
                self.assertEqual((image.width, image.height), (30, 20))
                return {"text": "hello", "blocks": [{"block_id": "text_1", "text": "hello", "bounds": {"x": 1, "y": 2, "width": 10, "height": 5}}]}

            def close(self):
                pass

        self.session._ocr = Reader()
        reply = self.session.execute("messages.observe", {"title_exact": "Fixture", "region": {"x": 10, "y": 20, "width": 30, "height": 20}})
        self.assertEqual(reply["recognition"]["blocks"][0]["bounds"]["x"], 11)
        self.assertEqual(reply["recognition"]["blocks"][0]["bounds"]["y"], 22)
        self.assertIsNone(reply["context_identity"]["matched"])
        self.assertEqual(reply["context_identity"]["status"], "not_requested")

    def test_batch_reports_verified_prefix_and_never_runs_the_remaining_step(self):
        with self.assertRaises(DeskPilotError) as raised:
            self.session.execute("actions.batch", {"steps": [
                {"id": "find", "method": "ui.find", "params": {"title_exact": "Fixture"}},
                {"id": "write", "method": "ui.set_value", "params": {
                    "element_id": {"$ref": "find.result.elements[0].element_id"},
                    "observation_id": {"$ref": "find.result.observation_id"}, "value": "kept"}},
                {"id": "missing", "method": "ui.get", "params": {"element_id": {"$ref": "absent.result.id"}}},
                {"id": "never", "method": "input.click", "params": {"allow_unobserved": True, "x": 1, "y": 1}}]})
        self.assertEqual(raised.exception.code, "BATCH_STEP_FAILED")
        self.assertEqual(raised.exception.details["cause_code"], "INVALID_REFERENCE")
        self.assertEqual([item["step_id"] for item in raised.exception.details["steps"]], ["find", "write", "missing"])
        self.assertEqual((self.desktop.writes, self.desktop.value), (1, "kept"))

    def test_unknown_mutation_is_distinct_from_pre_dispatch_rejection(self):
        for failure, expected, writes in (("password", "SENSITIVE_INPUT_BLOCKED", 0), ("unknown", "BATCH_OUTCOME_UNKNOWN", 1)):
            with self.subTest(failure=failure):
                self.desktop.failure = failure
                previous = self.desktop.writes
                reference = self.found()
                with self.assertRaises(DeskPilotError) as raised:
                    self.session.execute("actions.batch", {"steps": [{"method": "ui.set_value", "params": reference | {"value": "one attempt"}}]})
                self.assertEqual(raised.exception.code, expected)
                self.assertEqual(self.desktop.writes - previous, writes)

    def test_cancellation_interrupts_wait_without_blocking_the_control_request(self):
        result = []

        def wait():
            try:
                self.session.execute("wait.window", {"title_exact": "not present", "timeout_ms": 10000})
            except DeskPilotError as exc:
                result.append(exc.code)

        worker = threading.Thread(target=wait)
        worker.start()
        self.assertTrue(self.desktop.listed.wait(1))
        self.assertEqual(self.session.request_cancel()["status"], "cancellation_requested")
        worker.join(1)
        self.assertFalse(worker.is_alive())
        self.assertEqual(result, ["CANCELLED"])
        self.assertEqual(self.session.execute("capabilities")["session_id"], self.session.id)

    def test_cancelled_queued_request_never_clears_cancellation_and_dispatches(self):
        generation = self.session.cancellation_generation
        self.session.request_cancel()
        with self.assertRaises(DeskPilotError) as raised:
            self.session.execute("input.click", {"title_exact": "Fixture", "x": 1, "y": 1, "allow_unobserved": True},
                                 cancellation_generation=generation)
        self.assertEqual(raised.exception.code, "CANCELLED")
        self.assertEqual(self.desktop.writes, 0)
        current = self.session.cancellation_generation
        self.session.execute("input.click", {"title_exact": "Fixture", "x": 1, "y": 1, "allow_unobserved": True},
                             cancellation_generation=current)
        self.assertEqual(self.desktop.writes, 1)

    def test_unexpected_native_failure_does_not_echo_private_text_or_claim_no_effect(self):
        reference = self.found()
        self.desktop.failure = "crash"
        with self.assertRaises(DeskPilotError) as raised:
            self.session.execute("ui.set_value", reference | {"value": "private-text-should-not-escape"})
        self.assertEqual(raised.exception.outcome, "unknown")
        self.assertNotIn("private-text", str(raised.exception.body()))

    def test_stream_preserves_request_order_ids_and_recovers_from_invalid_json(self):
        import json
        source = BytesIO(b'{broken}\n{"id":7,"method":"capabilities"}\n{"id":"last","method":"close"}\n')
        destination = StringIO()
        run_stream(source, destination, lambda: Session(desktop=Desktop()))
        replies = [json.loads(line) for line in destination.getvalue().splitlines()]
        self.assertEqual([item["id"] for item in replies], [None, 7, "last"])
        self.assertEqual(replies[0]["error"]["code"], "INVALID_JSON")
        self.assertEqual(replies[-1]["result"]["status"], "closed")

    def test_argv_keeps_negative_numbers_and_json_values(self):
        method, params = parse_argv(["input", "scroll", "--amount", "-120", "--allow-unobserved=false", "--params-json", '{"x":2,"y":3}', "--format", "json"])
        self.assertEqual((method, params), ("input.scroll", {"amount": -120, "allow_unobserved": False, "x": 2, "y": 3}))
        self.assertEqual(resolve_references({"$ref": "s.result.items[0]"}, {"s": {"result": {"items": [9]}}}), 9)


if __name__ == "__main__":
    unittest.main()
