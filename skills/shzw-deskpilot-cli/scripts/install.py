#!/usr/bin/env python3
"""Build and register the complete installed Skill using the standard library."""

from __future__ import annotations

import argparse
import base64
import ctypes
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shlex
import shutil
import subprocess
import sys
import sysconfig
import tempfile
import uuid
import zipfile
from contextlib import contextmanager

OWNER = "shzw-deskpilot-cli"
LAUNCHER = """import os, sys
from pathlib import Path
sys.dont_write_bytecode = True
os.environ['DESKPILOT_RESOURCES'] = str(Path(sys.argv[0]).resolve().parent)
from deskpilot.cli import main
raise SystemExit(main())
"""


class InstallError(Exception):
    def __init__(self, code, message, data=None):
        super().__init__(message)
        self.code, self.data = code, data or {}


def ensure(condition, code, message, data=None):
    if not condition:
        raise InstallError(code, message, data)


def digest(path):
    value = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def atomic_json(path, value):
    temporary = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
    try:
        with temporary.open("x", encoding="utf-8", newline="\n") as output:
            json.dump(value, output, ensure_ascii=False, indent=2)
            output.write("\n")
        temporary.chmod(0o600)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def atomic_text(path, value):
    temporary = path.with_name(".deskpilot-" + uuid.uuid4().hex + ".tmp")
    mode = path.stat().st_mode & 0o777 if path.exists() else 0o600
    try:
        with temporary.open("x", encoding="utf-8", newline="\n") as output:
            output.write(value)
        temporary.chmod(mode)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def inside(root, path):
    resolved = path.resolve()
    ensure(resolved != root.resolve() and resolved.is_relative_to(root.resolve()),
           "INSTALL_STATE_INVALID", "A managed path escaped the selected installation directory.")
    return resolved


def remove_owned_tree(root, path):
    checked = inside(root, path)
    if checked.exists():
        shutil.rmtree(checked)


@contextmanager
def installation_lock(state):
    path = state / "install.lock"
    with path.open("a+b") as lock:
        lock.seek(0, os.SEEK_END)
        if not lock.tell():
            lock.write(b"0")
            lock.flush()
        lock.seek(0)
        try:
            if sys.platform == "win32":
                import msvcrt
                msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            raise InstallError("INSTALLATION_BUSY", "Another installer is using this state directory.") from None
        try:
            yield
        finally:
            lock.seek(0)
            if sys.platform == "win32":
                msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(lock.fileno(), fcntl.LOCK_UN)


def system_key():
    system = {"win32": "windows", "darwin": "macos", "linux": "linux"}.get(sys.platform, sys.platform)
    machine = platform.machine().lower()
    architecture = {"amd64": "x64", "x86_64": "x64", "aarch64": "arm64", "arm64": "arm64"}.get(machine, machine)
    return f"{system}-{architecture}"


def selected_files(skill, manifest, target):
    ensure(manifest.get("format") == 1 and isinstance(manifest.get("files"), list),
           "SKILL_INCOMPLETE", "The installed Skill has no supported file manifest.")
    python = manifest.get("python", {})
    ensure(platform.python_implementation() == python.get("implementation", "CPython")
           and list(sys.version_info[:2]) in python.get("versions", []),
           "PYTHON_UNSUPPORTED", "This Skill requires the CPython version declared in vendor/manifest.json.")
    ensure(sys.maxsize > 2**32 and not sysconfig.get_config_var("Py_GIL_DISABLED"),
           "PYTHON_ABI_UNSUPPORTED", "The bundled native files require a 64-bit CPython build with the standard GIL ABI.")
    ensure(target in manifest.get("platforms", []), "PLATFORM_UNSUPPORTED", "This Skill has no complete resources for the current platform.")
    selected, seen = [], set()
    for item in manifest["files"]:
        relative = item.get("path")
        ensure(isinstance(relative, str) and relative not in seen and "\\" not in relative,
               "SKILL_INCOMPLETE", "The resource manifest contains an invalid or duplicate path.")
        seen.add(relative)
        path = skill / relative
        ensure(not Path(relative).is_absolute() and not path.is_symlink() and path.resolve().is_relative_to(skill.resolve()),
               "SKILL_INCOMPLETE", "A bundled file is outside the complete Skill.")
        platforms = item.get("platforms")
        if platforms and target not in platforms:
            continue
        ensure(path.is_file() and path.stat().st_size == item.get("bytes") and digest(path) == item.get("sha256"),
               "SKILL_INCOMPLETE", "A required bundled file is missing or has changed.", {"file": relative})
        selected.append(item)
    source_files = {path.relative_to(skill).as_posix() for path in (skill / "scripts/deskpilot").rglob("*.py")}
    declared = {item["path"] for item in selected if item["path"].startswith("scripts/deskpilot/")}
    ensure(source_files == declared and "scripts/deskpilot/__main__.py" in declared
           and "scripts/install.py" in seen, "SKILL_INCOMPLETE", "The complete generated Python source is not present.")
    return selected


def archive_sources(skill, selected, target):
    with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        sources = [("__main__.py", LAUNCHER.encode("utf-8"))]
        sources += [(item["path"].removeprefix("scripts/"), (skill / item["path"]).read_bytes())
                    for item in selected if item["path"].startswith("scripts/deskpilot/")]
        for name, content in sorted(sources):
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, content)


def probe(application):
    environment = dict(os.environ, PYTHONDONTWRITEBYTECODE="1", PYTHONIOENCODING="utf-8")
    environment.pop("PYTHONPATH", None)
    options = {"capture_output": True, "text": True, "encoding": "utf-8", "timeout": 60,
               "stdin": subprocess.DEVNULL, "env": environment}
    if sys.platform == "win32":
        options["creationflags"] = subprocess.CREATE_NO_WINDOW
    try:
        result = subprocess.run([sys.executable, "-B", str(application), "doctor", "--format", "json"], **options)
        reply = json.loads(result.stdout)
        ensure(result.returncode == 0 and reply.get("ok") and reply["result"].get("desktop_text", {}).get("available"),
               "BUILD_CHECK_FAILED", "The built application or its fixed OCR resources could not initialize.",
               {"diagnostics": reply.get("result", {}).get("desktop_text", {})})
    except (OSError, ValueError, subprocess.TimeoutExpired):
        raise InstallError("BUILD_CHECK_FAILED", "The local build did not complete its non-interactive startup check.") from None


def build(skill, selected, state, input_digest):
    builds = state / "builds"
    builds.mkdir(parents=True, exist_ok=True, mode=0o700)
    destination = builds / input_digest[:24]
    receipt = destination / "build.json"
    if receipt.is_file():
        try:
            previous = json.loads(receipt.read_text(encoding="utf-8"))
            resources_valid = all((destination / item["path"]).is_file()
                                  and digest(destination / item["path"]) == item["sha256"]
                                  for item in selected if not item["path"].startswith("scripts/"))
            if previous.get("input_digest") == input_digest and resources_valid and digest(destination / "deskpilot.pyz") == previous.get("app_sha256"):
                probe(destination / "deskpilot.pyz")
                return destination, "unchanged"
        except (OSError, ValueError, InstallError):
            pass
    if destination.exists():
        destination = builds / (input_digest[:24] + "-" + uuid.uuid4().hex[:8])
    temporary = Path(tempfile.mkdtemp(prefix=".prepare-", dir=builds))
    try:
        archive_sources(skill, selected, temporary / "deskpilot.pyz")
        for item in selected:
            if item["path"].startswith("scripts/"):
                continue
            source, target = skill / item["path"], temporary / item["path"]
            target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            shutil.copyfile(source, target)
        probe(temporary / "deskpilot.pyz")
        atomic_json(temporary / "build.json", {"owner": OWNER, "input_digest": input_digest,
                                               "app_sha256": digest(temporary / "deskpilot.pyz")})
        os.replace(temporary, destination)
        return destination, "built"
    finally:
        if temporary.exists():
            remove_owned_tree(builds, temporary)


def wrapper(skill, application):
    source = str(skill.resolve())
    python = str(Path(sys.executable).resolve())
    for path in (source, python, str(application)):
        ensure(not any(character in path for character in "\r\n\x00"), "PATH_UNSUPPORTED", "Installation paths must not contain newlines.")
    marker = base64.urlsafe_b64encode(source.encode("utf-8")).decode("ascii")
    if sys.platform == "win32":
        escaped_python = python.replace("%", "%%")
        escaped_application = str(application).replace("%", "%%")
        return f'@echo off\r\nrem Managed by {OWNER} {marker}\r\nsetlocal DisableDelayedExpansion\r\n"{escaped_python}" -I -S -B "{escaped_application}" %*\r\nexit /b %ERRORLEVEL%\r\n'
    return f"#!/bin/sh\n# Managed by {OWNER} {marker}\nexec {shlex.quote(python)} -I -S -B {shlex.quote(str(application))} \"$@\"\n"


def register(command, content, previous):
    command.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    expected = content.encode("utf-8")
    old = None
    if command.exists() or command.is_symlink():
        ensure(command.is_file() and not command.is_symlink() and previous is not None
               and previous.get("command_path") == str(command) and command.read_bytes() == previous.get("command_text", "").encode("utf-8"),
               "COMMAND_CONFLICT", "The command path is owned by another installation or was modified.", {"command_path": str(command)})
        old = command.read_bytes()
        if old == expected:
            return "unchanged"
    temporary = command.with_name(".deskpilot-" + uuid.uuid4().hex + ".tmp")
    try:
        with temporary.open("xb") as output:
            output.write(expected)
        temporary.chmod(0o755)
        if old is None:
            try:
                os.link(temporary, command)
            except FileExistsError:
                raise InstallError("COMMAND_CONFLICT", "Another file acquired the command path during installation.") from None
        else:
            ensure(command.read_bytes() == old, "COMMAND_CONFLICT", "The command changed during installation.")
            os.replace(temporary, command)
        return "installed" if old is None else "updated"
    finally:
        temporary.unlink(missing_ok=True)


def normalize_path(value):
    return os.path.normcase(os.path.normpath(os.path.expandvars(str(value).strip().strip('"'))))


def contains_path(value, directory):
    expected = normalize_path(directory)
    return any(normalize_path(part) == expected for part in value.split(os.pathsep) if part)


def windows_path(directory, *, remove=False):
    import winreg
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, "Environment") as key:
        try:
            current, value_type = winreg.QueryValueEx(key, "Path")
        except FileNotFoundError:
            current, value_type = "", winreg.REG_EXPAND_SZ
        if remove:
            parts = current.split(";")
            index = next((index for index, part in enumerate(parts) if normalize_path(part) == normalize_path(directory)), None)
            if index is None:
                return {"kind": "windows", "added": False}
            del parts[index]
            updated = ";".join(parts)
        else:
            if contains_path(current, directory):
                return {"kind": "windows", "added": False}
            try:
                with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment") as machine:
                    machine_path = winreg.QueryValueEx(machine, "Path")[0]
                if contains_path(machine_path, directory):
                    return {"kind": "windows", "added": False}
            except OSError:
                pass
            updated = current.rstrip(";") + (";" if current.rstrip(";") else "") + str(directory)
        winreg.SetValueEx(key, "Path", 0, value_type, updated)
    user = ctypes.WinDLL("user32", use_last_error=True)
    user.SendMessageTimeoutW.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_size_t, ctypes.c_void_p,
                                       ctypes.c_uint, ctypes.c_uint, ctypes.POINTER(ctypes.c_size_t)]
    message, result = ctypes.c_wchar_p("Environment"), ctypes.c_size_t()
    user.SendMessageTimeoutW(0xFFFF, 0x001A, 0, ctypes.cast(message, ctypes.c_void_p), 2, 2000, ctypes.byref(result))
    return {"kind": "windows", "added": not remove}


def shell_path(directory, *, home=None, shell=None, previous=None, remove=False):
    home = Path(home or Path.home())
    shell = Path(shell or os.environ.get("SHELL", "")).name
    ensure(shell in {"bash", "zsh", "fish"}, "SHELL_UNSUPPORTED", "PATH registration supports bash, zsh and fish; use the returned absolute command path for this shell.")
    begin, end = f"# >>> {OWNER} >>>", f"# <<< {OWNER} <<<"
    quoted = shlex.quote(str(directory))
    if shell == "fish":
        files = [home / ".config/fish/conf.d/deskpilot.fish"]
        body = f"contains -- {quoted} $PATH; or set -gx PATH {quoted} $PATH"
    else:
        files = [home / (".zshrc" if shell == "zsh" else ".bashrc")]
        if shell == "bash":
            files.append(next((home / name for name in (".bash_profile", ".bash_login", ".profile") if (home / name).is_file()), home / ".bash_profile"))
        pattern = shlex.quote(":" + str(directory) + ":")
        body = f'case ":$PATH:" in *{pattern}*) ;; *) export PATH={quoted}:"$PATH" ;; esac'
    block = begin + "\n" + body + "\n" + end + "\n"
    if remove and previous:
        files = [Path(item["file"]) for item in previous.get("files", []) if item.get("added")]
    records, changes = [], []
    for file in files:
        file = file.resolve()
        current = file.read_text(encoding="utf-8") if file.exists() else ""
        expression = re.compile(re.escape(begin) + r"\n.*?" + re.escape(end) + r"\n?", re.S)
        existing = expression.findall(current)
        ensure(len(existing) <= 1 and (not existing or existing[0].rstrip("\n") == block.rstrip("\n")),
               "PATH_REGISTRATION_FAILED", "The managed PATH block was modified; preserve it and configure PATH explicitly.", {"file": str(file)})
        updated = expression.sub("", current) if remove else current if existing else current + ("\n" if current and not current.endswith("\n") else "") + block
        if current != updated:
            changes.append((file, current, updated, file.exists()))
        previously_owned = any(item.get("file") == str(file) and item.get("added") for item in (previous or {}).get("files", []))
        records.append({"file": str(file), "block": block, "added": not remove and (not existing or previously_owned)})
    written = []
    try:
        for file, before, after, existed in changes:
            file.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            ensure((file.read_text(encoding="utf-8") if file.exists() else "") == before,
                   "PATH_REGISTRATION_FAILED", "The shell configuration changed during PATH setup.")
            atomic_text(file, after)
            written.append((file, before, after, existed))
    except (OSError, InstallError):
        # Restore only bytes written by this operation, preserving concurrent edits.
        retained = []
        for file, before, after, existed in reversed(written):
            try:
                if file.read_text(encoding="utf-8") != after:
                    retained.append(str(file))
                elif existed:
                    atomic_text(file, before)
                else:
                    file.unlink()
            except OSError:
                retained.append(str(file))
        raise InstallError("PATH_REGISTRATION_FAILED", "Shell PATH setup failed; completed writes were restored where possible.",
                           {"path": {"kind": "shell", "shell": shell, "files": [item for item in records if item["file"] in retained], "added": bool(retained)}}) from None
    return {"kind": "shell", "shell": shell, "files": records, "added": any(item["added"] for item in records)}


def configure_path(directory, previous=None):
    if sys.platform == "win32":
        result = windows_path(directory)
        if previous and previous.get("kind") == "windows" and previous.get("added"):
            result["added"] = True
        return result
    return shell_path(directory, previous=previous)


def uninstall(state, record):
    ensure(record is not None and record.get("owner") == OWNER, "NOT_INSTALLED", "There is no owned installation at the selected state directory.")
    command = Path(record["command_path"])
    if command.exists():
        ensure(command.is_file() and not command.is_symlink() and command.read_bytes() == record["command_text"].encode("utf-8"),
               "COMMAND_CONFLICT", "The command was modified and will be preserved.", {"command_path": str(command)})
        command.unlink()
    shared = any(path.is_file() for path in command.parent.iterdir()) if command.parent.is_dir() else False
    path_info = record.get("path", {})
    if path_info.get("added") and not shared:
        if path_info.get("kind") == "windows":
            windows_path(command.parent, remove=True)
        elif path_info.get("kind") == "shell":
            shell_path(command.parent, shell=path_info.get("shell"), previous=path_info, remove=True)
    for entry in record.get("builds", []):
        target = inside(state / "builds", Path(entry))
        try:
            receipt = json.loads((target / "build.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if receipt.get("owner") == OWNER:
            remove_owned_tree(state / "builds", target)
    (state / "installation.json").unlink(missing_ok=True)
    return {"status": "uninstalled", "command_path": str(command), "path_retained_for_shared_directory": shared}


def install(args, *, skill=None):
    skill = Path(skill or Path(__file__).resolve().parent.parent).resolve()
    state = Path(args.state_dir or (Path(os.environ["LOCALAPPDATA"]) / "DeskPilot/runtime" if sys.platform == "win32" and os.environ.get("LOCALAPPDATA") else Path.home() / ".local/share/deskpilot/runtime")).expanduser().resolve()
    state.mkdir(parents=True, exist_ok=True, mode=0o700)
    with installation_lock(state):
        return _install_locked(args, skill, state)


def _install_locked(args, skill, state):
    record_path = state / "installation.json"
    try:
        previous = json.loads(record_path.read_text(encoding="utf-8")) if record_path.exists() else None
    except (OSError, ValueError):
        raise InstallError("INSTALL_STATE_INVALID", "The installation record cannot be read; preserve it before recovery.") from None
    if args.uninstall:
        return uninstall(state, previous)
    if previous:
        ensure(previous.get("owner") == OWNER, "INSTALL_STATE_INVALID", "This state directory belongs to another tool.")
        previous_source = Path(previous.get("source", ""))
        ensure(normalize_path(previous_source) == normalize_path(skill) or not previous_source.exists(),
               "INSTALLATION_CONFLICT", "Another existing Skill directory owns this installation.", {"source": str(previous_source)})
    try:
        manifest = json.loads((skill / "vendor/manifest.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        raise InstallError("SKILL_INCOMPLETE", "Run this installer from a complete installed Skill directory.") from None
    selected = selected_files(skill, manifest, system_key())
    identity = {"files": [(item["path"], item["sha256"]) for item in selected],
                "python": str(Path(sys.executable).resolve()), "version": list(sys.version_info[:3]), "platform": system_key()}
    input_digest = hashlib.sha256(json.dumps(identity, sort_keys=True).encode("utf-8")).hexdigest()
    destination, status = build(skill, selected, state, input_digest)
    directory = Path(args.bin_dir or Path.home() / ".local/bin").expanduser().resolve()
    command = directory / ("deskpilot.cmd" if sys.platform == "win32" else "deskpilot")
    existing_command = shutil.which("deskpilot")
    ensure(not existing_command or normalize_path(existing_command) == normalize_path(command),
           "COMMAND_CONFLICT", "Another command named deskpilot is already on PATH; use the built application directly or resolve that command first.",
           {"command_path": str(command), "existing_command": existing_command, "application": str(destination / "deskpilot.pyz")})
    if previous and previous.get("command_path") != str(command):
        ensure(not Path(previous["command_path"]).exists(), "COMMAND_CONFLICT", "The existing installation owns a different command path; remove it before changing bin-dir.")
    content = wrapper(skill, destination / "deskpilot.pyz")
    registered = register(command, content, previous)
    data = {"status": status, "registration": registered, "command_path": str(command), "source": str(skill),
            "application": str(destination / "deskpilot.pyz"), "on_path": contains_path(os.environ.get("PATH", ""), directory)}
    record = {"owner": OWNER, "source": str(skill), "interpreter": str(Path(sys.executable).resolve()),
              "input_digest": input_digest, "builds": list(dict.fromkeys((previous or {}).get("builds", []) + [str(destination)])),
              "command_path": str(command), "command_text": content, "path": (previous or {}).get("path", {})}
    atomic_json(record_path, record)
    try:
        record["path"] = configure_path(directory, record["path"])
        atomic_json(record_path, record)
        data["path_registered"] = True
    except (OSError, InstallError) as exc:
        if isinstance(exc, InstallError) and exc.data.get("path", {}).get("added"):
            record["path"] = exc.data["path"]
            atomic_json(record_path, record)
        data["path_error"] = {"code": exc.code if isinstance(exc, InstallError) else "OS_ERROR", "message": str(exc)}
        raise InstallError("PATH_REGISTRATION_FAILED", "The program was built and registered, but persistent PATH setup did not complete. Use command_path and retry installation after correcting the reported shell/environment issue.", data) from None
    return data


def main(argv=None):
    class Parser(argparse.ArgumentParser):
        def error(self, message):
            raise InstallError("INVALID_ARGUMENT", "Use --bin-dir DIRECTORY, --state-dir DIRECTORY, --uninstall or --json.")

    parser = Parser(description=__doc__)
    parser.add_argument("--bin-dir", type=Path)
    parser.add_argument("--state-dir", type=Path)
    parser.add_argument("--uninstall", action="store_true")
    parser.add_argument("--json", action="store_true")
    try:
        args = parser.parse_args(argv)
        result = {"ok": True, "data": install(args)}
    except InstallError as exc:
        result = {"ok": False, "error": {"code": exc.code, "message": str(exc)}, "data": exc.data}
    except OSError as exc:
        result = {"ok": False, "error": {"code": "INSTALLATION_FAILED", "message": f"A local installation operation failed ({type(exc).__name__})."}}
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    raise SystemExit(main())
