from pathlib import Path
import os
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from deskpilot import DeskPilotError
from deskpilot import browser


class _RegistryKey:
    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False


class BrowserDiscoveryTests(unittest.TestCase):
    def test_registered_browser_is_discovered_without_environment_paths(self):
        with tempfile.TemporaryDirectory(prefix='deskpilot-browser-discovery-') as temporary:
            executable = Path(temporary) / 'chrome.exe'
            executable.write_bytes(b'fixture')

            def open_key(root, path, *_args):
                if root == 'machine' and path.endswith('\\chrome.exe'):
                    return _RegistryKey()
                raise FileNotFoundError(path)

            fake = types.SimpleNamespace(HKEY_CURRENT_USER='user', HKEY_LOCAL_MACHINE='machine', KEY_READ=1,
                                         KEY_WOW64_32KEY=2, KEY_WOW64_64KEY=4,
                                         OpenKey=open_key, QueryValueEx=lambda key, name: (str(executable), 1))
            with patch.object(browser.sys, 'platform', 'win32'), patch.dict(os.environ, {}, clear=True), \
                    patch.object(browser.shutil, 'which', return_value=None), patch.dict(sys.modules, {'winreg': fake}):
                self.assertEqual(browser.chrome_executable(), str(executable))

    def test_explicit_missing_executable_fails_without_fallback(self):
        with tempfile.TemporaryDirectory(prefix='deskpilot-browser-discovery-') as temporary:
            with self.assertRaises(DeskPilotError) as caught:
                browser.chrome_executable(str(Path(temporary) / 'absent.exe'))
            self.assertEqual(caught.exception.code, 'CHROME_NOT_FOUND')

    def test_hidden_page_cannot_report_a_successful_mouse_dispatch(self):
        chrome = browser.Chrome(lambda: None)
        chrome._ensure_target = lambda params: None
        chrome._state = lambda: {'visibility': 'hidden'}
        calls = []
        chrome._js = lambda *args, **kwargs: calls.append('target_check') or {'x': 1, 'y': 1}
        chrome.socket = types.SimpleNamespace(call=lambda *args, **kwargs: calls.append('dispatch'))
        chrome.target = {'id': 'test'}
        with self.assertRaises(DeskPilotError) as caught:
            chrome.call('chrome.click', {'selector': '#safe'})
        self.assertEqual((caught.exception.code, caught.exception.outcome), ('CHROME_PAGE_NOT_VISIBLE', 'not_dispatched'))
        self.assertEqual(calls, [])

    def test_visible_page_keeps_normal_mouse_dispatch(self):
        chrome = browser.Chrome(lambda: None)
        chrome._ensure_target = lambda params: None
        chrome._state = lambda: {'visibility': 'visible'}
        chrome._js = lambda *args, **kwargs: {'x': 1, 'y': 1}
        calls = []
        chrome.socket = types.SimpleNamespace(call=lambda method, params, **kwargs: calls.append(params['type']))
        chrome.target = {'id': 'test'}
        result = chrome.call('chrome.click', {'selector': '#safe'})
        self.assertTrue(result['dispatched'])
        self.assertEqual(calls, ['mouseMoved', 'mousePressed', 'mouseReleased'])

    def test_hover_relocation_rejects_before_button_events(self):
        chrome = browser.Chrome(lambda: None)
        chrome._ensure_target = lambda params: None
        chrome._state = lambda: {'visibility': 'visible'}
        calls = []
        def target(function, params, **kwargs):
            if 'x' in params:
                raise DeskPilotError('CHROME_TARGET_MOVED', 'Target moved')
            return {'x': 1, 'y': 1}
        chrome._js = target
        chrome.socket = types.SimpleNamespace(call=lambda method, params, **kwargs: calls.append(params['type']))
        chrome.target = {'id': 'test'}
        with self.assertRaises(DeskPilotError) as caught:
            chrome.call('chrome.click', {'selector': '#safe'})
        self.assertEqual((caught.exception.code, caught.exception.outcome), ('CHROME_TARGET_MOVED', 'not_dispatched'))
        self.assertEqual(calls, ['mouseMoved'])

    def test_lost_press_receipt_never_replays_click(self):
        chrome = browser.Chrome(lambda: None)
        chrome._ensure_target = lambda params: None
        chrome._state = lambda: {'visibility': 'visible'}
        chrome._js = lambda *args, **kwargs: {'x': 1, 'y': 1}
        calls = []
        def send(method, params, **kwargs):
            calls.append(params['type'])
            if params['type'] == 'mousePressed':
                raise DeskPilotError('CHROME_CONNECTION_LOST', 'Lost press receipt', outcome='unknown')
        chrome.socket = types.SimpleNamespace(call=send)
        chrome.target = {'id': 'test'}
        with self.assertRaises(DeskPilotError) as caught:
            chrome.call('chrome.click', {'selector': '#safe'})
        self.assertEqual(caught.exception.outcome, 'unknown')
        self.assertEqual(calls, ['mouseMoved', 'mousePressed'])


if __name__ == '__main__':
    unittest.main()
