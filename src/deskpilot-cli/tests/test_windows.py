"""Bounded Windows recovery contracts; no desktop or application is touched."""
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from deskpilot import DeskPilotError
from deskpilot.platforms.windows import WindowsDesktop
from deskpilot.session import Session


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

    def test_explicit_native_secret_requires_focused_password_and_never_reads_it(self):
        focused = SimpleNamespace(CurrentIsPassword=True, CurrentIsEnabled=True,
                                  CurrentIsOffscreen=False, CurrentProcessId=9)
        self.desktop._automation = lambda: SimpleNamespace(GetFocusedElement=lambda: focused)
        self.desktop.foreground = lambda: 10
        self.desktop.related = lambda target, actual: target == actual
        self.desktop._send = Mock()
        self.desktop.type_secret('synthetic-value', lambda: None, window={'native': 10, 'pid': 9},
                                 target_kind='native_password')
        self.desktop._send.assert_called_once()
        self.desktop._send.reset_mock()
        focused.CurrentIsPassword = False
        with self.assertRaises(DeskPilotError) as caught:
            self.desktop.type_secret('synthetic-value', lambda: None, window={'native': 10, 'pid': 9},
                                     target_kind='native_password')
        self.assertEqual(caught.exception.code, 'SENSITIVE_FOCUS_NOT_CONFIRMED')
        self.desktop._send.assert_not_called()
        focused.CurrentIsPassword = True
        self.desktop.foreground = lambda: 11
        self.desktop.related = lambda *args: True  # An owned popup is not the intended password target.
        with self.assertRaises(DeskPilotError) as caught:
            self.desktop.type_secret('synthetic-value', lambda: None, window={'native': 10, 'pid': 9},
                                     target_kind='native_password')
        self.assertEqual(caught.exception.code, 'WINDOW_NOT_FOREGROUND')
        self.desktop._send.assert_not_called()

    def test_scroll_keeps_the_pointer_at_the_selected_target_briefly(self):
        class User:
            x, y = 10, 20
            def GetCursorPos(self, pointer):
                pointer._obj.x, pointer._obj.y = self.x, self.y
                return True
            def SetCursorPos(self, x, y):
                self.x, self.y = x, y
                return True
        self.desktop.user = User()
        self.desktop.related = lambda *_: True
        self.desktop.foreground = lambda: 10
        self.desktop._point_owned = lambda *_args, **_kwargs: None
        self.desktop._send = Mock()
        at_wait = []
        self.clock.sleep = lambda seconds: at_wait.append((seconds, self.desktop.user.x, self.desktop.user.y))
        self.desktop.scroll({'native':10, 'bounds':{'x':100, 'y':200}}, 30, 40, -120)
        self.assertEqual(at_wait, [(0.1, 130, 240)])
        self.assertEqual((self.desktop.user.x, self.desktop.user.y), (10, 20))
        self.desktop._send.assert_called_once()

    def test_click_waits_at_the_target_and_preserves_user_cursor_movement(self):
        class User:
            x, y = 10, 20
            def GetCursorPos(self, pointer):
                pointer._obj.x, pointer._obj.y = self.x, self.y
                return True
            def SetCursorPos(self, x, y):
                self.x, self.y = x, y
                return True
        self.desktop.user = User()
        self.desktop.related = lambda *_: True
        self.desktop.foreground = lambda: 10
        self.desktop._point_owned = lambda *_args, **_kwargs: None
        self.desktop._send = Mock()
        observed = []
        def moved(seconds):
            observed.append((seconds, self.desktop.user.x, self.desktop.user.y))
            self.desktop.user.SetCursorPos(777, 888)
        self.clock.sleep = moved
        self.desktop.click({'native':10, 'bounds':{'x':100, 'y':200}}, 30, 40)
        self.assertEqual(observed, [(0.1, 130, 240)])
        self.assertEqual((self.desktop.user.x, self.desktop.user.y), (777, 888))
        self.desktop._send.assert_called_once()

    def test_scroll_does_not_restore_the_cursor_if_the_user_moves_it(self):
        class User:
            x, y = 10, 20
            def GetCursorPos(self, pointer):
                pointer._obj.x, pointer._obj.y = self.x, self.y
                return True
            def SetCursorPos(self, x, y):
                self.x, self.y = x, y
                return True
        self.desktop.user = User()
        self.desktop.related = lambda *_: True
        self.desktop.foreground = lambda: 10
        self.desktop._point_owned = lambda *_args, **_kwargs: None
        self.desktop._send = Mock()
        self.clock.sleep = lambda seconds: self.desktop.user.SetCursorPos(777, 888)
        self.desktop.scroll({'native':10, 'bounds':{'x':100, 'y':200}}, 30, 40, -120)
        self.assertEqual((self.desktop.user.x, self.desktop.user.y), (777, 888))
    def text_only_setup(self, *, readonly=False):
        state = {'text': 'old'}
        element = SimpleNamespace(CurrentIsPassword=False, CurrentControlType=50030,
                                  CurrentIsKeyboardFocusable=True, CurrentHasKeyboardFocus=False)
        element.SetFocus = lambda: setattr(element, 'CurrentHasKeyboardFocus', True)
        class Range:
            def GetAttributeValue(self, attribute):
                self.attribute = attribute
                return readonly
            def GetText(self, length):
                return state['text'][:length]
        text = SimpleNamespace(DocumentRange=Range())
        def pattern(_element, pattern_id, _interface):
            if pattern_id == 10002:
                raise DeskPilotError('UI_PATTERN_UNAVAILABLE', 'no value pattern')
            self.assertEqual(pattern_id, 10014)
            return text
        self.desktop._pattern = pattern
        self.desktop.foreground = lambda: 10
        self.desktop.related = lambda target, actual: target == actual
        self.desktop.key = Mock()
        def type_text(value, checkpoint):
            checkpoint()
            state['text'] = value
        self.desktop.type_text = Mock(side_effect=type_text)
        return element, state, {'native': 10}

    def test_text_only_edit_uses_focus_and_keyboard_then_verifies(self):
        element, state, window = self.text_only_setup()
        result = self.desktop.set_value(element, '新内容', window=window)
        self.assertEqual(result['method'], 'uia_text_keyboard')
        self.assertTrue(result['matched'])
        self.assertEqual(state['text'], '新内容')
        self.desktop.key.assert_called_once_with(['CTRL', 'A'])
        self.desktop.type_text.assert_called_once()

    def test_text_only_readonly_never_sends_keyboard_input(self):
        element, _, window = self.text_only_setup(readonly=True)
        with self.assertRaises(DeskPilotError) as caught:
            self.desktop.set_value(element, 'new', window=window)
        self.assertEqual(caught.exception.code, 'ELEMENT_READ_ONLY')
        self.desktop.key.assert_not_called()
        self.desktop.type_text.assert_not_called()

    def test_text_only_multiline_requires_strategy_before_any_input(self):
        element, state, window = self.text_only_setup()
        with self.assertRaises(DeskPilotError) as caught:
            self.desktop.set_value(element, 'one\ntwo', window=window)
        self.assertEqual((caught.exception.code, caught.exception.outcome), ('TEXT_INPUT_STRATEGY_REQUIRED', 'not_dispatched'))
        self.assertEqual(state['text'], 'old')
        self.desktop.key.assert_not_called()
        self.desktop.type_text.assert_not_called()

    def test_text_only_multiline_uses_explicit_enter_strategy_once(self):
        element, state, window = self.text_only_setup()
        def key(keys):
            if keys == ['CTRL', 'A']:
                state['text'] = ''
            elif keys == ['ENTER']:
                state['text'] += '\r\n'
            else:
                self.fail('Unexpected key sequence')
        def type_text(value, checkpoint):
            checkpoint()
            state['text'] += value
        self.desktop.key.side_effect = key
        self.desktop.type_text.side_effect = type_text
        result = self.desktop.set_value(element, 'one\ntwo', window=window, newline_strategy='enter')
        self.assertTrue(result['matched'])
        self.assertEqual(state['text'], 'one\r\ntwo')
        self.assertEqual(self.desktop.key.call_args_list[0].args[0], ['CTRL', 'A'])
        self.assertEqual(self.desktop.key.call_args_list[1].args[0], ['ENTER'])
        self.assertEqual(self.desktop.key.call_count, 2)

    def test_focus_loss_after_select_all_does_not_type_into_another_window(self):
        element, _, window = self.text_only_setup()
        self.desktop.key.side_effect = lambda keys: setattr(element, 'CurrentHasKeyboardFocus', False)
        with self.assertRaises(DeskPilotError) as caught:
            self.desktop.set_value(element, 'new', window=window)
        self.assertEqual((caught.exception.code, caught.exception.outcome), ('FOCUS_NOT_CONFIRMED', 'unknown'))
        self.desktop.type_text.assert_not_called()

    def test_failed_semantic_write_is_never_replayed_with_keyboard(self):
        pattern = self.value_pattern(['old'])
        pattern.SetValue = Mock(side_effect=RuntimeError('unknown provider result'))
        self.desktop.key = Mock()
        self.desktop.type_text = Mock()
        with self.assertRaises(RuntimeError):
            self.desktop.set_value(self.element, 'new', window={'native': 10})
        self.desktop.key.assert_not_called()
        self.desktop.type_text.assert_not_called()

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

    def test_window_capture_unavailable_preserves_untrusted_screen_rejection(self):
        original = DeskPilotError('WINDOW_CAPTURE_UNTRUSTED', 'screen is covered',
                                  details={'target_found': True, 'overlapping_windows': 1})
        self.desktop._overlay = None
        self.desktop._capture_screen = Mock(side_effect=original)
        self.desktop._capture_window_frame = Mock(side_effect=DeskPilotError(
            'WINDOW_CAPTURE_BACKEND_UNAVAILABLE', 'backend unavailable'))
        with self.assertRaises(DeskPilotError) as caught:
            self.desktop.capture({'native': 10})
        self.assertIs(caught.exception, original)
        self.assertEqual(caught.exception.details['window_capture']['code'], 'WINDOW_CAPTURE_BACKEND_UNAVAILABLE')

    def test_window_capture_fallback_never_masks_cancellation(self):
        self.desktop._overlay = None
        self.desktop._capture_screen = Mock(side_effect=DeskPilotError(
            'WINDOW_CAPTURE_UNTRUSTED', 'screen is covered',
            details={'target_found': True, 'overlapping_windows': 1}))
        self.desktop._capture_window_frame = Mock(side_effect=DeskPilotError('CANCELLED', 'stopped'))
        with self.assertRaises(DeskPilotError) as caught:
            self.desktop.capture({'native': 10})
        self.assertEqual(caught.exception.code, 'CANCELLED')

    def test_window_capture_fallback_does_not_run_for_unknown_target(self):
        self.desktop._capture_screen = Mock(side_effect=DeskPilotError(
            'WINDOW_CAPTURE_UNTRUSTED', 'target missing',
            details={'target_found': False, 'overlapping_windows': 1}))
        self.desktop._capture_window_frame = Mock()
        with self.assertRaises(DeskPilotError):
            self.desktop.capture({'native': 10})
        self.desktop._capture_window_frame.assert_not_called()

    def test_raw_tree_recovery_keeps_promoted_controls_and_parent_depth(self):
        class Array:
            def __init__(self, nodes):
                self.nodes = nodes
                self.Length = len(nodes)
            def GetElement(self, index):
                return self.nodes[index]
        class Node:
            def __init__(self, name, control, children=()):
                self.CurrentName = self.CurrentAutomationId = name
                self.CurrentClassName = 'Edit' if name == 'document' else 'fixture'
                self.CurrentControlType = 50030 if name == 'document' else 50004
                self.CurrentIsControlElement = control
                self.CurrentBoundingRectangle = SimpleNamespace(left=0, top=0, right=40, bottom=20)
                self.CurrentIsPassword = False
                self.CurrentIsEnabled, self.CurrentIsOffscreen = True, False
                self.CurrentHasKeyboardFocus = False
                self.children = list(children)
            def FindAll(self, scope, condition):
                self_scope = scope
                if self_scope != 2:
                    raise AssertionError('Expected direct raw children')
                return Array(self.children)
        edit = Node('edit', True)
        hidden = Node('hidden-container', False, [edit])
        document = Node('document', True)
        root = Node('root', True, [hidden, document])
        class Walker:
            def GetFirstChildElement(self, element):
                if element is root:
                    return document
                raise OSError(-2147024809, 'synthetic UIA invalid argument')
            def GetNextSiblingElement(self, element):
                return None
        automation = SimpleNamespace(ElementFromHandle=lambda _: root, ControlViewWalker=Walker(),
                                     CreateTrueCondition=lambda: object())
        self.desktop._automation = lambda: automation
        result = self.desktop.tree({'native': 10}, depth=4, limit=10, checkpoint=lambda: None)
        self.assertEqual(self.desktop.tree_backend, 'uia_raw_tree_fallback')
        self.assertEqual([node['automation_id'] for node in result], ['root', 'edit', 'document'])
        self.assertEqual([(node['depth'], node['parent']) for node in result], [(0, None), (1, 0), (1, 0)])
        filtered = self.desktop.find_tree({'native': 10}, depth=4, limit=10, checkpoint=lambda: None,
                                          filters={'automation_id': 'edit'})
        self.assertEqual([node['automation_id'] for node in filtered if not node.get('_filtered_out')], ['edit'])
        self.assertEqual((filtered[1]['depth'], filtered[1]['parent']), (1, 0))

    def test_filtered_search_preserves_duplicates_depth_limits_and_password_redaction(self):
        class Node:
            def __init__(self, name, identifier, children=(), password=False):
                self._name, self.CurrentAutomationId = name, identifier
                self.CurrentClassName, self.CurrentControlType = 'Edit', 50004
                self.CurrentIsPassword = password
                self.CurrentIsControlElement = True
                self.CurrentIsEnabled, self.CurrentIsOffscreen, self.CurrentHasKeyboardFocus = True, False, False
                self.CurrentBoundingRectangle = SimpleNamespace(left=0, top=0, right=40, bottom=20)
                self.children = list(children)
                for index, child in enumerate(self.children):
                    child.next_sibling = self.children[index + 1] if index + 1 < len(self.children) else None
                self.next_sibling = None
            @property
            def CurrentName(self):
                if self.CurrentIsPassword:
                    raise AssertionError('Password name must not be read')
                return self._name
            def FindAll(self, scope, identifier):
                self_scope = scope
                if self_scope != 7:
                    raise AssertionError('Expected subtree search')
                def descendants(node):
                    return [node] + [item for child in node.children for item in descendants(child)]
                matches = [item for item in descendants(self) if item.CurrentAutomationId == identifier]
                return SimpleNamespace(Length=len(matches), GetElement=lambda index: matches[index])
        deep = Node('Alpha deep', 'duplicate')
        password = Node('private', 'duplicate', password=True)
        root = Node('root', 'root', [Node('Alpha', 'duplicate'), Node('container', 'parent', [deep]), password])
        walker = SimpleNamespace(GetFirstChildElement=lambda node: node.children[0] if node.children else None,
                                 GetNextSiblingElement=lambda node: node.next_sibling)
        self.desktop._automation = lambda: SimpleNamespace(ElementFromHandle=lambda _: root, ControlViewWalker=walker,
                                                            CreatePropertyCondition=lambda _property, value: value,
                                                            CompareElements=lambda a, b: a is b)
        self.desktop._uia_module = SimpleNamespace(UIA_AutomationIdPropertyId=30011)
        window = {'native': 10, 'identity': (10, 1, 'fixture'), 'pid': 1, 'process': 'fixture',
                  'title': 'fixture', 'class_name': 'fixture', 'bounds': {'x': 0, 'y': 0, 'width': 50, 'height': 50}}
        self.desktop.windows = lambda: [window]
        self.desktop.window = lambda _: window
        self.desktop.activate = lambda value, **_: value
        self.desktop.activity = lambda *a, **k: None
        self.desktop.foreground = lambda: None
        self.desktop.close = lambda: None
        session = Session(desktop=self.desktop)
        self.addCleanup(session.close)
        params = {'title_exact': 'fixture', 'automation_id': 'duplicate'}
        found = session.execute('ui.find', params)
        self.assertEqual(found['count'], 3)
        self.assertEqual([item['name'] for item in found['elements']], ['Alpha', 'Alpha deep', ''])
        self.assertEqual([(item['depth'], item['parent']) for item in found['elements']], [(1, 0), (2, 2), (1, 0)])
        self.assertTrue(found['elements'][-1]['is_password'])
        shallow = session.execute('ui.find', params | {'depth': 1})
        self.assertEqual(shallow['count'], 2)
        limited = session.execute('ui.find', params | {'limit': 3})
        self.assertEqual(limited['count'], 1)
        self.assertTrue(limited['truncated'])
        named = session.execute('ui.find', {'title_exact': 'fixture', 'name_contains': 'ALPHA'})
        self.assertEqual([item['name'] for item in named['elements']], ['Alpha', 'Alpha deep'])
        exact = session.execute('ui.find', params | {'search_scope': 'subtree'})
        self.assertEqual([item['name'] for item in exact['elements']], ['Alpha', 'Alpha deep', ''])
        self.assertFalse(exact['truncated'])
        self.assertTrue(session.execute('ui.find', params | {'search_scope': 'subtree', 'limit': 2})['truncated'])
        with self.assertRaises(DeskPilotError) as duplicate:
            session.execute('ui.find', params | {'search_scope': 'subtree', 'require_unique': True})
        self.assertEqual(duplicate.exception.code, 'ELEMENT_NOT_UNIQUE')
        with self.assertRaises(DeskPilotError) as incomplete:
            session.execute('ui.find', params | {'search_scope': 'subtree', 'limit': 1, 'require_unique': True})
        self.assertEqual(incomplete.exception.code, 'UI_AUTOMATION_INCOMPLETE')
        with self.assertRaises(DeskPilotError) as invalid:
            session.execute('ui.find', params | {'search_scope': 'subtree', 'depth': 2})
        self.assertEqual(invalid.exception.code, 'INVALID_ARGUMENT')

    def test_unreadable_subtree_cannot_prove_unique_or_absent(self):
        class Node:
            def __init__(self, identifier, children=(), broken=False):
                self.identifier, self.broken, self.CurrentName = identifier, broken, identifier
                self.CurrentClassName, self.CurrentControlType = 'Edit', 50004
                self.CurrentIsPassword, self.CurrentIsControlElement = False, True
                self.CurrentIsEnabled, self.CurrentIsOffscreen, self.CurrentHasKeyboardFocus = True, False, False
                self.CurrentBoundingRectangle = SimpleNamespace(left=0, top=0, right=40, bottom=20)
                self.children, self.next_sibling = list(children), None
                for i, child in enumerate(self.children):
                    child.next_sibling = self.children[i + 1] if i + 1 < len(self.children) else None
            @property
            def CurrentAutomationId(self):
                if self.broken: raise OSError('synthetic inaccessible provider')
                return self.identifier
        root = Node('root', [Node('unreadable', [Node('target'), Node('hidden-only')], True), Node('target')])
        walker = SimpleNamespace(GetFirstChildElement=lambda node: node.children[0] if node.children else None,
                                 GetNextSiblingElement=lambda node: node.next_sibling)
        self.desktop._automation = lambda: SimpleNamespace(ElementFromHandle=lambda _: root, ControlViewWalker=walker)
        window = {'native': 10, 'identity': (10, 1, 'fixture'), 'pid': 1, 'process': 'fixture',
                  'title': 'fixture', 'class_name': 'fixture', 'bounds': {'x': 0, 'y': 0, 'width': 50, 'height': 50}}
        self.desktop.windows = lambda: [window]
        self.desktop.window = lambda _: window
        self.desktop.activate = lambda value, **_: value
        self.desktop.activity = lambda *a, **k: None
        self.desktop.foreground = lambda: None
        self.desktop.close = lambda: None
        session = Session(desktop=self.desktop)
        self.addCleanup(session.close)
        for method, params in [('ui.find', {'automation_id': 'target', 'require_unique': True}),
                               ('wait.element', {'automation_id': 'hidden-only', 'state': 'absent'})]:
            with self.subTest(method=method), self.assertRaises(DeskPilotError) as caught:
                session.execute(method, {'title_exact': 'fixture', **params})
            self.assertEqual(caught.exception.code, 'UI_AUTOMATION_INCOMPLETE')


if __name__ == '__main__':
    unittest.main()
