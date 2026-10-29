"""Opt-in installed CLI check with an actual TextPattern-only WPF provider.

The fixture uses Windows' built-in .NET Framework/WPF compiler. DeskPilot's
delivered runtime and installation remain Python-only.
"""
import ctypes
import json
import os
from pathlib import Path
import runpy
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import uuid

from test_installed_live import ProcessSession
from deskpilot import DeskPilotError


@unittest.skipUnless(sys.platform == 'win32' and os.environ.get('DESKPILOT_TEXT_ONLY_TESTS') == '1',
                     'requires an explicitly selected Windows WPF fixture run')
class TextOnlyInstalledTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory(prefix='DeskPilot text-only installed ')
        cls.directory = Path(cls.temporary.name)
        cls.addClassCleanup(cls.cleanup_skill)
        root = Path(__file__).resolve().parents[3]
        cls.skill = cls.directory / 'read only skill'
        shutil.copytree(root / 'skills/shzw-deskpilot-cli', cls.skill)
        for path in cls.skill.rglob('*'):
            if path.is_file():
                path.chmod(0o444)
        namespace = runpy.run_path(str(cls.skill / 'scripts/install.py'))
        args = type('Args', (), {'state_dir': cls.directory / 'runtime', 'bin_dir': cls.directory / 'commands', 'uninstall': False})()
        with patch.dict(namespace['install'].__globals__, {'configure_path': lambda *a, **k: {'kind': 'test', 'added': False}}):
            cls.installed = namespace['install'](args, skill=cls.skill)
        framework = Path(os.environ.get('WINDIR', 'C:/Windows')) / 'Microsoft.NET/Framework64/v4.0.30319'
        compiler, wpf = framework / 'csc.exe', framework / 'WPF'
        if not compiler.is_file():
            raise unittest.SkipTest('The optional Windows WPF fixture compiler is unavailable.')
        cls.executable = cls.directory / 'TextOnlyFixture.exe'
        references = [framework / 'System.Xaml.dll'] + [wpf / name for name in (
            'WindowsBase.dll', 'PresentationCore.dll', 'PresentationFramework.dll',
            'UIAutomationProvider.dll', 'UIAutomationTypes.dll')]
        command = [str(compiler), '/nologo', '/target:exe', '/out:' + str(cls.executable)]
        command += ['/reference:' + str(path) for path in references]
        command.append(str(Path(__file__).with_name('windows_text_only_fixture.cs')))
        result = subprocess.run(command, capture_output=True, timeout=30)
        if result.returncode:
            raise RuntimeError('The optional WPF fixture could not be compiled.')

    @classmethod
    def cleanup_skill(cls):
        if hasattr(cls, 'skill') and cls.skill.exists():
            for path in cls.skill.rglob('*'):
                if path.is_file():
                    path.chmod(0o644)
        cls.temporary.cleanup()

    def test_text_only_provider_fallback_is_single_and_verified(self):
        title = 'DeskPilot installed text-only ' + uuid.uuid4().hex[:8]
        app = subprocess.Popen([str(self.executable), title], stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               text=True, encoding='utf-8', creationflags=subprocess.CREATE_NO_WINDOW)
        session, ready = None, None
        try:
            ready = json.loads(app.stdout.readline())
            session = ProcessSession(self.installed['application'])
            session.execute('interaction.begin', {'show_overlay': False})
            def reference():
                found = session.execute('ui.find', {'title_exact': title, 'pid': ready['pid'],
                                                   'automation_id': 'text-only', 'depth': 16})
                self.assertEqual(found['count'], 1)
                return {'element_id': found['elements'][0]['element_id'], 'observation_id': found['observation_id']}
            before = session.execute('ui.get', reference())['element']
            self.assertEqual(before['value_source'], 'uia_text')
            self.assertIn('First line', before['value'])
            value = '第一行\nSecond line'
            with self.assertRaises(DeskPilotError) as caught:
                session.execute('ui.set_value', reference() | {'value': value})
            self.assertEqual((caught.exception.code, caught.exception.outcome),
                             ('TEXT_INPUT_STRATEGY_REQUIRED', 'not_dispatched'))
            self.assertEqual(session.execute('ui.get', reference())['element']['value'], before['value'])
            for expected in ('中文 test 123', value, ''):
                args = reference() | {'value': expected}
                if '\n' in expected:
                    # The fixture declares AcceptsReturn=true, so Enter is known
                    # to insert a line break in this specific control.
                    args['newline_strategy'] = 'enter'
                written = session.execute('ui.set_value', args)
                self.assertEqual(written['verification']['method'], 'uia_text_keyboard')
                self.assertTrue(written['verification']['matched'])
                actual = session.execute('ui.get', reference())['element']['value']
                self.assertEqual(actual.replace('\r\n', '\n'), expected)
        finally:
            if session:
                session.close()
            if ready:
                user = ctypes.WinDLL('user32')
                user.PostMessageW.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_size_t, ctypes.c_ssize_t]
                user.PostMessageW(ready['handle'], 0x0010, 0, 0)
            try:
                app.wait(timeout=5)
            except subprocess.TimeoutExpired:
                app.terminate()
                app.wait(timeout=3)
            app.stdout.close()
            errors = app.stderr.read()
            app.stderr.close()
            self.assertEqual(errors, '')

    def test_text_only_read_only_control_is_never_modified(self):
        title = 'DeskPilot installed read-only ' + uuid.uuid4().hex[:8]
        app = subprocess.Popen([str(self.executable), title, '--read-only'], stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               text=True, encoding='utf-8', creationflags=subprocess.CREATE_NO_WINDOW)
        session, ready = None, None
        try:
            ready = json.loads(app.stdout.readline())
            session = ProcessSession(self.installed['application'])
            def reference():
                found = session.execute('ui.find', {'title_exact': title, 'pid': ready['pid'],
                                                   'automation_id': 'text-only', 'depth': 16})
                self.assertEqual(found['count'], 1)
                return {'element_id': found['elements'][0]['element_id'], 'observation_id': found['observation_id']}
            before = session.execute('ui.get', reference())['element']
            self.assertEqual(before['value_source'], 'uia_text')
            with self.assertRaises(DeskPilotError) as caught:
                session.execute('ui.set_value', reference() | {'value': 'must not replace'})
            self.assertEqual((caught.exception.code, caught.exception.outcome), ('ELEMENT_READ_ONLY', 'not_dispatched'))
            self.assertEqual(session.execute('ui.get', reference())['element']['value'], before['value'])
        finally:
            if session:
                session.close()
            if ready:
                user = ctypes.WinDLL('user32')
                user.PostMessageW.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_size_t, ctypes.c_ssize_t]
                user.PostMessageW(ready['handle'], 0x0010, 0, 0)
            try:
                app.wait(timeout=5)
            except subprocess.TimeoutExpired:
                app.terminate()
                app.wait(timeout=3)
            app.stdout.close()
            errors = app.stderr.read()
            app.stderr.close()
            self.assertEqual(errors, '')
