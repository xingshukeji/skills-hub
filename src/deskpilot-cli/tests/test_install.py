from __future__ import annotations

from pathlib import Path
import runpy
import tempfile
import unittest
from unittest.mock import patch

INSTALL = runpy.run_path(str(Path(__file__).resolve().parents[1] / "install.py"))


class InstallationTests(unittest.TestCase):
    def test_shell_registration_preserves_other_configuration_and_is_owned_until_uninstall(self):
        for shell in ("bash", "zsh", "fish"):
            with self.subTest(shell=shell), tempfile.TemporaryDirectory() as directory:
                home = Path(directory)
                command = home / "command directory with spaces"
                first = INSTALL["shell_path"](command, home=home, shell=shell)
                paths = [Path(item["file"]) for item in first["files"]]
                original = [path.read_bytes() for path in paths]
                second = INSTALL["shell_path"](command, home=home, shell=shell, previous=first)
                self.assertTrue(second["added"])
                self.assertEqual([path.read_bytes() for path in paths], original)
                paths[0].write_text("# keep user setting\n" + paths[0].read_text(), encoding="utf-8")
                INSTALL["shell_path"](command, home=home, shell=shell, previous=second, remove=True)
                self.assertEqual(paths[0].read_text(), "# keep user setting\n")
                self.assertTrue(all("shzw-deskpilot-cli" not in path.read_text() for path in paths))

    def test_bash_validates_both_configs_before_writing_either(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            (home / ".bashrc").write_text("# original\n")
            (home / ".bash_profile").mkdir()
            with self.assertRaises(OSError):
                INSTALL["shell_path"](home / "bin", home=home, shell="bash")
            self.assertEqual((home / ".bashrc").read_text(), "# original\n")

    def test_shell_write_failure_restores_the_first_file(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            (home / ".bashrc").write_text("# original\n")
            original = INSTALL["atomic_text"]

            def fail_second(path, text):
                if path.name == ".bash_profile":
                    raise OSError("fixture failure")
                original(path, text)

            with patch.dict(INSTALL["shell_path"].__globals__, {"atomic_text": fail_second}):
                with self.assertRaises(INSTALL["InstallError"]):
                    INSTALL["shell_path"](home / "bin", home=home, shell="bash")
            self.assertEqual((home / ".bashrc").read_text(), "# original\n")
            self.assertFalse((home / ".bash_profile").exists())

    def test_modified_owned_shell_block_is_preserved_and_diagnosed(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            first = INSTALL["shell_path"](home / "bin", home=home, shell="zsh")
            file = Path(first["files"][0]["file"])
            changed = file.read_text().replace("export PATH=", "export PATH=/custom:")
            file.write_text(changed)
            with self.assertRaises(INSTALL["InstallError"]):
                INSTALL["shell_path"](home / "bin", home=home, shell="zsh", previous=first, remove=True)
            self.assertEqual(file.read_text(), changed)
