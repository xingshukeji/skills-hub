"""Opt-in installed CLI checks against an owned offline Electron/React view.

Set DESKPILOT_ELECTRON_LIVE_TESTS=1, DESKPILOT_ELECTRON (exe), and
DESKPILOT_REACT_NODE_MODULES (existing local React/React DOM modules). No downloads.
"""
import ctypes
import json
import os
from pathlib import Path
import queue
import runpy
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import uuid
from unittest.mock import patch

from test_installed_live import ProcessSession
import test_windows_live
from deskpilot import DeskPilotError
from deskpilot.session import Session as SourceSession


@unittest.skipUnless(sys.platform == 'win32' and os.environ.get('DESKPILOT_ELECTRON_LIVE_TESTS') == '1',
                     'requires an explicitly selected Windows Electron fixture run')
class ElectronLiveTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory(prefix='DeskPilot Electron installed ')
        cls.directory = Path(cls.temporary.name)
        cls.root = Path(__file__).resolve().parents[3]
        cls.fixture = Path(__file__).with_name('electron_fixture')
        cls.skill = cls.directory / 'read only skill'
        shutil.copytree(cls.root / 'skills/shzw-deskpilot-cli', cls.skill)
        for path in cls.skill.rglob('*'):
            if path.is_file():
                path.chmod(0o444)
        cls.addClassCleanup(cls.cleanup_skill)
        namespace = runpy.run_path(str(cls.skill / 'scripts/install.py'))
        args = type('Args', (), {'state_dir': cls.directory / 'runtime', 'bin_dir': cls.directory / 'commands', 'uninstall': False})()
        with patch.dict(namespace['install'].__globals__, {'configure_path': lambda *a, **k: {'kind': 'test', 'added': False}}):
            cls.installed = namespace['install'](args, skill=cls.skill)
        cls.page = cls.directory / 'offline page'
        subprocess.run(['node', str(cls.fixture / 'build.mjs'), str(cls.page), os.environ['DESKPILOT_REACT_NODE_MODULES']],
                       cwd=cls.root, check=True, capture_output=True, timeout=30)

    @classmethod
    def cleanup_skill(cls):
        for path in cls.skill.rglob('*'):
            if path.is_file():
                path.chmod(0o644)
        cls.temporary.cleanup()

    def setUp(self):
        self.case = self.directory / uuid.uuid4().hex
        shutil.copytree(self.page, self.case)
        self.title = 'DeskPilot React fixture ' + self.case.name[:8]
        env = dict(os.environ)
        env.pop('ELECTRON_RUN_AS_NODE', None)
        self.stderr = (self.case / 'stderr.txt').open('w', encoding='utf-8')
        self.app = subprocess.Popen([os.environ['DESKPILOT_ELECTRON'], str(self.fixture / 'main.cjs'), str(self.case), self.title],
                                    stdout=subprocess.PIPE, stderr=self.stderr, text=True, encoding='utf-8',
                                    env=env, creationflags=subprocess.CREATE_NO_WINDOW)
        self.addCleanup(self.cleanup_app)
        ready_queue = queue.Queue()
        def read_ready():
            for line in self.app.stdout:
                if line.startswith('{'):
                    ready_queue.put(json.loads(line))
        self.reader = threading.Thread(target=read_ready, daemon=True)
        self.reader.start()
        self.ready = ready_queue.get(timeout=15)
        self.selector = {'title_exact': self.title, 'pid': self.ready['pid']}
        self.session = ProcessSession(self.installed['application'])
        self.addCleanup(self.cleanup_session)
        self.session.execute('interaction.begin', {'show_overlay': False})
        self.session.execute('wait.window', self.selector | {'timeout_ms': 4000})

    def cleanup_session(self):
        try:
            self.session.execute('interaction.end', {'restore_original_window': False})
        finally:
            self.session.close()

    def cleanup_app(self):
        (self.case / 'close').touch()
        try:
            self.app.wait(timeout=8)
        except subprocess.TimeoutExpired:
            self.app.terminate()
            self.app.wait(timeout=3)
        if hasattr(self, 'reader'):
            self.reader.join(2)
        self.app.stdout.close()
        self.stderr.close()

    def find(self, identifier):
        observed = self.session.execute('ui.find', self.selector | {'automation_id': identifier, 'depth': 16})
        self.assertEqual(observed['count'], 1)
        return {'element_id': observed['elements'][0]['element_id'], 'observation_id': observed['observation_id']}

    def state(self, **expected):
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            try:
                value = json.loads((self.case / 'state.json').read_text(encoding='utf-8'))
                if all(value[key] == item for key, item in expected.items()):
                    return value
            except (FileNotFoundError, json.JSONDecodeError):
                pass
            time.sleep(.02)
        self.fail('The offline React state did not reach the expected result.')

    def test_controlled_value_document_url_keyboard_and_unknown_result(self):
        document = self.find('RootWebArea')
        self.assertEqual(self.session.execute('ui.get', document)['element']['value'], self.ready['url'])
        for index in range(6):
            value = f'synthetic value {index}'
            result = self.session.execute('ui.set_value', self.find('account') | {'value': value})
            self.assertTrue(result['verification']['matched'])
            self.assertEqual(self.session.execute('ui.get', self.find('account'))['element']['value'], value)
            self.state(account=value, accepted=index + 1)
        refused = self.find('refused')
        with self.assertRaises(DeskPilotError) as caught:
            self.session.execute('ui.set_value', refused | {'value': 'not accepted'})
        self.assertEqual((caught.exception.code, caught.exception.outcome), ('VALUE_NOT_VERIFIED', 'unknown'))
        with self.assertRaises(DeskPilotError) as stale:
            self.session.execute('ui.get', refused)
        self.assertEqual(stale.exception.code, 'STALE_OBSERVATION')
        self.assertEqual(self.session.execute('ui.get', self.find('refused'))['element']['value'], '')
        self.state(refused=1)
        with self.assertRaises(DeskPilotError) as budget:
            self.session.execute('ui.set_value', self.find('refused') | {'value': 'budget case', 'timeout_ms': 100})
        self.assertEqual((budget.exception.code, budget.exception.outcome), ('TIMEOUT', 'unknown'))
        self.state(refused=2)
        self.session.execute('ui.click', self.find('account'))
        self.assertTrue(self.session.execute('ui.get', self.find('account'))['element']['has_keyboard_focus'])
        self.session.execute('input.hotkey', self.selector | {'keys': ['CTRL', 'A']})
        text = '离线中文 keyboard 123'
        self.session.execute('input.type', self.selector | {'text': text})
        self.assertEqual(self.session.execute('ui.get', self.find('account'))['element']['value'], text)
        self.state(account=text)

    def test_exact_search_and_combined_observation_on_electron(self):
        selected = self.session.execute('ui.find', self.selector | {
            'automation_id': 'account', 'search_scope': 'subtree', 'require_unique': True})
        self.assertEqual((selected['count'], selected['truncated']), (1, False))
        self.assertEqual(selected['tree_backend'], 'uia_control_view_exact_id')
        reference = {'element_id': selected['elements'][0]['element_id'], 'observation_id': selected['observation_id']}
        result = self.session.execute('ui.set_value', reference | {'value': 'subtree 中文 123'})
        self.assertTrue(result['verification']['matched'])
        self.state(account='subtree 中文 123')
        observed = self.session.execute('observe', self.selector | {'depth': 16, 'include_screenshot': True})
        self.assertTrue(observed['screenshot']['trusted'])
        self.assertTrue(Path(observed['screenshot']['path']).read_bytes().startswith(b'\x89PNG\r\n\x1a\n'))
        elements = [item for item in observed['elements'] if item['automation_id'] == 'account']
        self.assertEqual(len(elements), 1)
        value = self.session.execute('ui.get', {'element_id': elements[0]['element_id'],
                                                 'observation_id': observed['observation_id']})
        self.assertEqual(value['element']['value'], 'subtree 中文 123')

    def test_reply_switch_recovers_and_overlaid_target_capture_blocks_covered_click(self):
        self.session.execute('windows.activate', self.selector)
        native = subprocess.Popen([sys.executable, '-B', str(Path(__file__).with_name('windows_fixture.py')),
                                   'DeskPilot reply fixture ' + self.case.name[:8], '--claim-input'],
                                  stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding='utf-8',
                                  creationflags=subprocess.CREATE_NO_WINDOW)
        ready = None
        try:
            ready = json.loads(native.stdout.readline())
            result = self.session.execute('actions.batch', {'steps': [
                {'id': 'find', 'method': 'ui.find', 'params': self.selector | {'automation_id': 'account', 'depth': 16}},
                {'id': 'read', 'method': 'ui.get', 'params': {
                    'element_id': {'$ref': 'find.result.elements[0].element_id'},
                    'observation_id': {'$ref': 'find.result.observation_id'}}}]})
            self.assertEqual(result['status'], 'completed')
            found = result['steps'][0]['result']
            activation = found['window']['activation']
            self.assertEqual(activation['foreground_before']['pid'], ready['pid'])
            self.assertFalse(activation['set_foreground_returned'])
            self.assertEqual(activation['method'], 'uia_set_focus')
            self.assertEqual(activation['foreground_after']['pid'], self.ready['pid'])
            test_windows_live.WindowsLiveTests()._check_overlay_capture_and_hit_guard(self.session, self.title, found['window']['bounds'])
        finally:
            if ready:
                user = ctypes.WinDLL('user32')
                user.PostMessageW.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_size_t, ctypes.c_ssize_t]
                user.PostMessageW(ready['handle'], 0x0010, 0, 0)
            try:
                native.wait(timeout=4)
            except subprocess.TimeoutExpired:
                native.terminate()
                native.wait(timeout=3)
            native.stdout.close()
            errors = native.stderr.read()
            native.stderr.close()
            self.assertEqual(errors, '')

    def test_raw_tree_recovery_keeps_electron_document_and_controls(self):
        source = SourceSession()
        try:
            natural = source.execute('observe', self.selector | {'depth': 16})
            expected_ids = {'RootWebArea', 'account', 'refused', 'password'}
            self.assertTrue(expected_ids.issubset({item['automation_id'] for item in natural['elements']}))
            native = source.desktop._automation()
            class FailedWalker:
                def GetFirstChildElement(self, _element):
                    raise OSError(-2147024809, 'simulated UIA TreeWalker invalid argument')
            class RawAutomation:
                ControlViewWalker = FailedWalker()
                def __getattr__(self, name):
                    return getattr(native, name)
            source.desktop._automation = lambda: RawAutomation()
            recovered = source.execute('observe', self.selector | {'depth': 16})
            self.assertEqual(recovered['tree_backend'], 'uia_raw_tree_fallback')
            self.assertTrue(expected_ids.issubset({item['automation_id'] for item in recovered['elements']}))
            document = next(item for item in recovered['elements'] if item['automation_id'] == 'RootWebArea')
            read = source.execute('ui.get', {'element_id': document['element_id'],
                                             'observation_id': recovered['observation_id']})
            self.assertEqual(read['element']['value'], self.ready['url'])
            password = next(item for item in recovered['elements'] if item['automation_id'] == 'password')
            self.assertTrue(password['is_password'])
            self.assertEqual(password['name'], '')
        finally:
            source.close()


if __name__ == '__main__':
    unittest.main()
