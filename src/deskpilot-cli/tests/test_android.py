from __future__ import annotations

import copy
import json
from pathlib import Path
import queue
import re
import string
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from deskpilot import DeskPilotError
from deskpilot.android import AndroidBridge, _nodes, key_events
from deskpilot.session import Session
from test_session import Desktop


def node(*, password=False):
    return {"path": (0, 0), "package": "local.fixture", "class_name": "android.widget.EditText",
            "resource_id": "fixture:id/input", "bounds": {"x": 10, "y": 20, "width": 50, "height": 30},
            "enabled": True, "focused": True, "focusable": True, "clickable": True,
            "scrollable": False, "editable": True, "password": password, "text": None if password else "old",
            "description": None if password else ""}


class FakeBridge:
    serial = "emulator-5556"
    def __init__(self):
        self.current = node()
        self.other_nodes = []
        self.events = []
        self.next_value = None
        self.fail_after_dispatch = False
    def observe(self, limit=1000):
        return copy.deepcopy([self.current, *self.other_nodes]), False
    def tap(self, x, y, guard, on_send):
        guard(); on_send(); self.events.append((x, y))
    def swipe(self, start, end, duration, guard, on_send):
        guard(); on_send(); self.events.append((start, end, duration))
    def send_keys(self, events, guard, on_send, *, before_key):
        before_key(); guard(); on_send(); self.events.append(list(events))
        if self.fail_after_dispatch:
            raise DeskPilotError("CANCELLED", "Cancelled after dispatch.", outcome="unknown")
        if self.next_value is not None:
            self.current["text"] = self.next_value


def key_channel(on_key):
    """Acknowledge real transport writes without an emulator or keyboard input."""
    channel = queue.Queue()
    class Input:
        def write(self, data):
            on_key(data)
            marker = re.search(rb'(deskpilot_ack_[0-9a-f]+):%s', data).group(1)
            channel.put(marker + b':0\n')
        def flush(self): pass
        def close(self): pass
    class Output:
        def readline(self): return channel.get()
        def close(self): pass
    class Process:
        def __init__(self): self.stdin, self.stdout, self.dead = Input(), Output(), False
        def poll(self): return 0 if self.dead else None
        def kill(self): self.dead = True; channel.put(b'')
        def wait(self, timeout): return 0
    return Process()


class AndroidTests(unittest.TestCase):
    def setUp(self):
        self.desktop = Desktop()
        self.bridge = FakeBridge()
        self.session = Session(desktop=self.desktop, android_factory=lambda *args, **kwargs: self.bridge)
        self.addCleanup(self.session.close)

    def observed(self):
        result = self.session.execute("android.observe", {"title_exact": "Fixture"})
        return {"window_id": result["window"]["window_id"], "observation_id": result["observation_id"],
                "element_id": result["elements"][0]["element_id"]}

    def test_ascii_key_map_is_complete_and_rejects_unavailable_characters_before_input(self):
        self.assertEqual(len(key_events(''.join(chr(i) for i in range(32, 127)))), 95)
        with self.assertRaises(DeskPilotError) as caught:
            key_events('中')
        self.assertEqual(caught.exception.code, 'ANDROID_TEXT_UNSUPPORTED')
        self.assertEqual(caught.exception.outcome, 'not_dispatched')

    def test_hierarchy_redacts_password_and_its_descendants(self):
        xml = b'<hierarchy><node class="android.widget.EditText" package="local.fixture" bounds="[0,0][10,10]" password="true" text="secret" content-desc="secret"><node class="Text" bounds="[0,0][5,5]" text="secret" content-desc="secret"/></node></hierarchy>'
        nodes, truncated = _nodes(xml, 100)
        self.assertFalse(truncated)
        self.assertEqual(len(nodes), 2)
        self.assertNotIn('secret', json.dumps(nodes))
        self.assertTrue(all(item['password'] and item['text'] is None and item['description'] is None for item in nodes))

    def test_rejects_non_emulator_and_mismatched_avd(self):
        with self.assertRaises(DeskPilotError) as caught:
            AndroidBridge({'title': 'other', 'process': 'qemu-system-x86_64'})
        self.assertEqual(caught.exception.code, 'ANDROID_WINDOW_UNSUPPORTED')
        window = {'title':'Android Emulator - Expected:5556', 'process':'qemu-system-x86_64'}
        with patch('deskpilot.android._adb_path', return_value='adb'), patch.object(AndroidBridge, '_run', return_value=b'Other\nOK\n'):
            with self.assertRaises(DeskPilotError) as caught:
                AndroidBridge(window)
        self.assertEqual(caught.exception.code, 'ANDROID_DEVICE_MISMATCH')

    def test_set_value_verifies_actual_guest_value_and_invalidates_old_reference(self):
        ref = self.observed()
        self.bridge.next_value = 'aB1!'
        result = self.session.execute('android.set_value', ref | {'value':'aB1!'})
        self.assertEqual(result['verification'], {'status':'matched', 'method':'android_accessibility'})
        self.assertEqual(len(self.bridge.events), 1)
        with self.assertRaises(DeskPilotError) as caught:
            self.session.execute('android.set_value', ref | {'value':'again'})
        self.assertEqual(caught.exception.code, 'STALE_OBSERVATION')
        self.assertEqual(len(self.bridge.events), 1)

    def test_tap_uses_guest_bounds_and_does_not_claim_the_result_was_verified(self):
        ref = self.observed()
        result = self.session.execute('android.click', ref)
        self.assertEqual(self.bridge.events, [(35, 35)])
        self.assertEqual(result['verification']['status'], 'not_checked')
        with self.assertRaises(DeskPilotError) as caught:
            self.session.execute('android.click', ref)
        self.assertEqual(caught.exception.code, 'STALE_OBSERVATION')

    def test_tap_rejects_overlapping_actionable_sibling_before_dispatch(self):
        self.bridge.other_nodes = [node() | {'path': (1,), 'class_name': 'android.widget.Button',
                                          'editable': False, 'text': 'Floating button'}]
        ref = self.observed()
        with self.assertRaises(DeskPilotError) as caught:
            self.session.execute('android.click', ref)
        self.assertEqual((caught.exception.code, caught.exception.outcome), ('ANDROID_TARGET_OVERLAPPED', 'not_dispatched'))
        self.assertEqual(self.bridge.events, [])

    def test_tap_allows_target_ancestor_and_descendant(self):
        self.bridge.other_nodes = [node() | {'path': (0,), 'class_name': 'android.widget.Button', 'editable': False},
                                   node() | {'path': (0, 0, 0), 'class_name': 'android.widget.Button', 'editable': False}]
        ref = self.observed()
        self.session.execute('android.click', ref)
        self.assertEqual(self.bridge.events, [(35, 35)])

    def test_swipe_requires_scrollable_current_control_and_reports_dispatch_only(self):
        self.bridge.current['scrollable'] = True
        ref = self.observed()
        result = self.session.execute('android.swipe', ref | {'start':{'x':20,'y':40},'end':{'x':20,'y':25}})
        self.assertEqual(result['verification'], {'status':'not_checked'})
        self.assertEqual(self.bridge.events, [((20,40),(20,25),400)])
        with self.assertRaises(DeskPilotError) as stale:
            self.session.execute('android.swipe', ref | {'start':{'x':20,'y':40},'end':{'x':20,'y':25}})
        self.assertEqual(stale.exception.code, 'STALE_OBSERVATION')

    def test_swipe_rejects_outside_and_overlapped_endpoints_before_dispatch(self):
        self.bridge.current.update({'scrollable':True,'clickable':False})
        ref = self.observed()
        with self.assertRaises(DeskPilotError) as invalid:
            self.session.execute('android.swipe', ref | {'start':{'x':0,'y':40},'end':{'x':20,'y':25}})
        self.assertEqual(invalid.exception.code, 'INVALID_ARGUMENT')
        child = node() | {'path':(0,0,0),'bounds':{'x':15,'y':35,'width':10,'height':10}}
        self.bridge.other_nodes = [child]
        ref = self.observed()
        with self.assertRaises(DeskPilotError) as covered:
            self.session.execute('android.swipe', ref | {'start':{'x':20,'y':40},'end':{'x':20,'y':25}})
        self.assertEqual((covered.exception.code, covered.exception.outcome), ('ANDROID_TARGET_OVERLAPPED','not_dispatched'))
        self.assertEqual(self.bridge.events, [])

    def test_host_typing_explicitly_reports_that_value_was_not_checked(self):
        self.desktop.type_text = lambda text, checkpoint: checkpoint()
        result = self.session.execute('input.type', {'title_exact':'Fixture', 'text':'ordinary'})
        self.assertEqual(result['verification']['status'], 'not_checked')

    def test_mismatch_is_unknown_and_is_not_replayed(self):
        ref = self.observed()
        self.bridge.next_value = 'different'
        with self.assertRaises(DeskPilotError) as caught:
            self.session.execute('android.set_value', ref | {'value':'expected'})
        self.assertEqual((caught.exception.code, caught.exception.outcome), ('ANDROID_VALUE_NOT_VERIFIED', 'unknown'))
        self.assertEqual(len(self.bridge.events), 1)

    def test_stale_or_unfocused_control_does_not_dispatch(self):
        ref = self.observed()
        self.bridge.current['bounds']['x'] += 1
        with self.assertRaises(DeskPilotError) as caught:
            self.session.execute('android.click', ref)
        self.assertEqual(caught.exception.code, 'STALE_OBSERVATION')
        self.assertEqual(self.bridge.events, [])
        self.bridge.current = node()
        self.bridge.current['focused'] = False
        ref = self.observed()
        with self.assertRaises(DeskPilotError) as caught:
            self.session.execute('android.set_value', ref | {'value':'x'})
        self.assertEqual(caught.exception.code, 'ANDROID_FOCUS_NOT_CONFIRMED')
        self.assertEqual(self.bridge.events, [])

    def test_password_never_uses_regular_set_value_or_exposes_plaintext(self):
        self.bridge.current = node(password=True)
        ref = self.observed()
        with self.assertRaises(DeskPilotError) as caught:
            self.session.execute('android.set_value', ref | {'value':'not-secret'})
        self.assertEqual(caught.exception.code, 'SENSITIVE_INPUT_BLOCKED')
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'secret.json'
            marker = 'aB1!test'
            path.write_text(json.dumps({'value': marker}), encoding='utf-8')
            params = ref | {'target_kind':'android_password', 'purpose':'authorized_local_test', 'confirmed':True,
                            'expected_package':'local.fixture', 'secret_ref':{'path':str(path), 'json_path':['value']}}
            result = self.session.execute('input.secret', params)
        self.assertEqual(result['verification'], 'not_read')
        self.assertNotIn(marker, json.dumps(result))
        self.assertNotIn(marker, json.dumps(self.bridge.events))
        self.assertEqual(len(self.bridge.events), 1)

    def test_password_requires_authorization_and_expected_application(self):
        self.bridge.current = node(password=True)
        ref = self.observed()
        params = ref | {'target_kind':'android_password', 'purpose':'authorized_local_test', 'confirmed':False,
                        'expected_package':'local.fixture'}
        with self.assertRaises(DeskPilotError) as caught:
            self.session.execute('input.secret', params)
        self.assertEqual(caught.exception.code, 'SENSITIVE_INPUT_BLOCKED')
        with self.assertRaises(DeskPilotError) as caught:
            self.session.execute('input.secret', params | {'confirmed':True, 'expected_package':'another.app'})
        self.assertEqual(caught.exception.code, 'ANDROID_DEVICE_MISMATCH')
        self.assertEqual(self.bridge.events, [])

    def test_secret_stops_after_first_key_when_guest_focus_or_identity_changes(self):
        for change in ({'focused': False}, {'package': 'other.app'}, {'password': False},
                       {'resource_id': 'fixture:id/other'}):
            with self.subTest(change=change):
                self.bridge.current = node(password=True)
                ref = self.observed()
                writes = []
                def on_key(data):
                    writes.append(data)
                    self.bridge.current.update(change)
                self.bridge.require_keys = lambda: None
                self.bridge._process = lambda *args, **kwargs: key_channel(on_key)
                self.bridge.send_keys = AndroidBridge.send_keys.__get__(self.bridge)
                params = ref | {'target_kind': 'android_password', 'purpose': 'authorized_local_test',
                                'confirmed': True, 'expected_package': 'local.fixture', 'secret_ref': {}}
                with patch('deskpilot.secret.read_local_secret', return_value='abcdefgh'):
                    with self.assertRaises(DeskPilotError) as caught:
                        self.session.execute('input.secret', params)
                self.assertEqual((caught.exception.code, caught.exception.outcome),
                                 ('SENSITIVE_FOCUS_NOT_CONFIRMED', 'unknown'))
                self.assertEqual(len(writes), 1, 'No later character may be sent to the changed guest target.')
                with self.assertRaises(DeskPilotError) as stale:
                    self.session.execute('input.secret', params)
                self.assertEqual(stale.exception.code, 'STALE_OBSERVATION')

    def test_secret_rechecks_guest_after_reading_the_reference_before_any_key(self):
        self.bridge.current = node(password=True)
        ref = self.observed()
        writes = []
        self.bridge.require_keys = lambda: None
        self.bridge._process = lambda *args, **kwargs: key_channel(writes.append)
        self.bridge.send_keys = AndroidBridge.send_keys.__get__(self.bridge)
        def read_secret(_):
            self.bridge.current['focused'] = False
            return 'abcdefgh'
        with patch('deskpilot.secret.read_local_secret', side_effect=read_secret):
            with self.assertRaises(DeskPilotError) as caught:
                self.session.execute('input.secret', ref | {'target_kind': 'android_password',
                    'purpose': 'authorized_local_test', 'confirmed': True, 'expected_package': 'local.fixture', 'secret_ref': {}})
        self.assertEqual((caught.exception.code, caught.exception.outcome),
                         ('SENSITIVE_FOCUS_NOT_CONFIRMED', 'not_dispatched'))
        self.assertEqual(writes, [])

    def test_regular_input_stops_before_delete_if_focus_changes_after_select_all(self):
        ref = self.observed()
        writes = []
        def on_key(data):
            writes.append(data)
            self.bridge.current['focused'] = False
        self.bridge.require_keys = lambda: None
        self.bridge._process = lambda *args, **kwargs: key_channel(on_key)
        self.bridge.send_keys = AndroidBridge.send_keys.__get__(self.bridge)
        with self.assertRaises(DeskPilotError) as caught:
            self.session.execute('android.set_value', ref | {'value': 'replacement'})
        self.assertEqual((caught.exception.code, caught.exception.outcome), ('ANDROID_FOCUS_NOT_CONFIRMED', 'unknown'))
        self.assertEqual(len(writes), 1)

    def test_real_key_channel_preserves_a_stable_password_or_editable_target(self):
        for password in (False, True):
            with self.subTest(password=password):
                self.bridge.current = node(password=password)
                ref = self.observed()
                writes = []
                def on_key(data):
                    writes.append(data)
                    if not password:
                        self.bridge.current['text'] = 'aB1!'[:max(0, len(writes) - 2)]
                self.bridge.require_keys = lambda: None
                self.bridge._process = lambda *args, **kwargs: key_channel(on_key)
                self.bridge.send_keys = AndroidBridge.send_keys.__get__(self.bridge)
                if password:
                    with patch('deskpilot.secret.read_local_secret', return_value='aB1!'):
                        value = self.session.execute('input.secret', ref | {'target_kind': 'android_password',
                            'purpose': 'authorized_local_test', 'confirmed': True, 'expected_package': 'local.fixture', 'secret_ref': {}})
                    self.assertEqual(value['verification'], 'not_read')
                    self.assertEqual(len(writes), 4)
                else:
                    value = self.session.execute('android.set_value', ref | {'value': 'aB1!'})
                    self.assertEqual(value['verification']['status'], 'matched')
                    self.assertEqual(len(writes), 6)
                self.assertNotIn('aB1!', repr(writes))

    def test_cancelled_after_dispatch_is_unknown_and_invalidates_reference(self):
        ref = self.observed()
        self.bridge.fail_after_dispatch = True
        with self.assertRaises(DeskPilotError) as caught:
            self.session.execute('android.set_value', ref | {'value':'x'})
        self.assertEqual(caught.exception.outcome, 'unknown')
        with self.assertRaises(DeskPilotError) as stale:
            self.session.execute('android.set_value', ref | {'value':'x'})
        self.assertEqual(stale.exception.code, 'STALE_OBSERVATION')
        self.assertEqual(len(self.bridge.events), 1)

    def test_android_key_channel_does_not_put_secret_in_process_arguments_or_output(self):
        marker = 'aB1!test'
        channel = queue.Queue()
        captured = []
        class Input:
            def write(self, data):
                captured.append(data)
                match = re.search(rb'(deskpilot_ack_[0-9a-f]+):%s', data)
                assert match
                channel.put(match.group(1) + b':0\n')
            def flush(self): pass
            def close(self): pass
        class Output:
            def readline(self): return channel.get()
            def close(self): pass
        class Process:
            def __init__(self): self.stdin, self.stdout, self.dead = Input(), Output(), False
            def poll(self): return 0 if self.dead else None
            def kill(self): self.dead = True; channel.put(b'')
            def wait(self, timeout): return 0
        bridge = object.__new__(AndroidBridge)
        bridge.require_keys = lambda: None
        arguments = []
        bridge._process = lambda args, **kwargs: (arguments.append(args) or Process())
        sent = []
        bridge.send_keys(key_events(marker), lambda: None, lambda: sent.append(True), before_key=lambda: None)
        self.assertEqual(arguments, [['shell']])
        self.assertNotIn(marker, repr(arguments))
        self.assertNotIn(marker.encode(), b''.join(captured))
        self.assertEqual(len(sent), len(marker))

    def test_android_secret_is_not_allowed_in_a_batch(self):
        with self.assertRaises(DeskPilotError) as caught:
            self.session.execute('actions.batch', {'steps':[{'method':'input.secret','params':{'target_kind':'android_password'}}]})
        self.assertEqual(caught.exception.code, 'INVALID_BATCH')

    def test_foreground_loss_before_dispatch_does_not_touch_guest(self):
        ref = self.observed()
        self.desktop.foreground = lambda: 8
        with self.assertRaises(DeskPilotError) as caught:
            self.session.execute('android.set_value', ref | {'value':'x'})
        self.assertEqual((caught.exception.code, caught.exception.outcome), ('WINDOW_NOT_FOREGROUND', 'not_dispatched'))
        self.assertEqual(self.bridge.events, [])


if __name__ == '__main__':
    unittest.main()
