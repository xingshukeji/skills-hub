"""Prepare and run the pinned DeskPilot runtime with the Python standard library."""
import base64
import contextlib
import hashlib
import json
import netrc
import os
import platform
import shutil
import subprocess
import sys
import sysconfig
import tempfile
import time
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path, PurePosixPath


def sha(path):
    with path.open("rb") as f:
        return hashlib.file_digest(f, "sha256").hexdigest()


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None


def local_settings():
    base = Path(os.environ.get("LOCALAPPDATA") or os.environ.get("XDG_CONFIG_HOME") or Path.home() / ".config")
    file = base / "DeskPilot" / "nexus.json"
    return json.loads(file.read_text(encoding="utf-8-sig")) if file.is_file() else {}


def blob(spec, cache):
    target = cache / (spec["sha256"] + ".zip")
    if target.is_file() and target.stat().st_size == spec["bytes"] and sha(target) == spec["sha256"]:
        return target
    settings = local_settings()
    root = (os.environ.get("DESKPILOT_NEXUS_ROOT") or settings.get("root", "")).rstrip("/")
    parsed = urllib.parse.urlsplit(root)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username is not None or parsed.query or parsed.fragment or "\\" in root:
        raise ValueError("Set DESKPILOT_NEXUS_ROOT to the team's HTTPS Raw repository root.")
    url = f"{root}/deskpilot/releases/{spec['sha256']}/{spec['file']}"
    req = urllib.request.Request(url)
    name = os.environ.get("NEXUS_NETRC") or settings.get("netrc")
    try:
        auth = netrc.netrc(name).hosts.get(parsed.hostname)
    except FileNotFoundError:
        if name:
            raise ValueError("The configured read credential file is missing.") from None
        auth = None
    except netrc.NetrcParseError:
        raise ValueError("Invalid Nexus read credential file.") from None
    if auth:
        req.add_unredirected_header("Authorization", "Basic " + base64.b64encode(f"{auth[0]}:{auth[2]}".encode()).decode())
    opener = urllib.request.build_opener(NoRedirect())
    with tempfile.NamedTemporaryFile(dir=cache, delete=False) as f:
        pending = Path(f.name)
    try:
        remaining = spec["bytes"]
        with opener.open(req, timeout=90) as response, pending.open("wb") as dest:
            while chunk := response.read(min(1024 * 1024, remaining + 1)):
                remaining -= len(chunk)
                if remaining < 0:
                    raise ValueError("Unexpected runtime artifact length.")
                dest.write(chunk)
        if remaining or sha(pending) != spec["sha256"]:
            raise ValueError("Runtime artifact failed integrity verification.")
        os.replace(pending, target)
    finally:
        pending.unlink(missing_ok=True)
    return target


def materialize(archives, target):
    # Validate files before reusing an extracted runtime. Publish only a complete directory.
    with contextlib.ExitStack() as stack:
        members = {}
        for path in archives:
            archive = stack.enter_context(zipfile.ZipFile(path))
            for entry in archive.infolist():
                name = entry.filename
                if PurePosixPath(name).is_absolute() or ".." in PurePosixPath(name).parts or any(c in name for c in (":", "\\")):
                    raise ValueError("Invalid runtime archive path.")
                if name in members:
                    if archive.read(entry) != members[name].read(name):
                        raise ValueError("Conflicting runtime archives.")
                members[name] = archive
        if target.is_dir():
            files = {p.relative_to(target).as_posix() for p in target.rglob("*") if p.is_file()}
            if files != set(members) or any((target / name).is_symlink() or sha(target / name) != hashlib.sha256(z.read(name)).hexdigest() for name, z in members.items()):
                raise ValueError("Runtime cache changed. Remove the indicated cache directory and retry: " + str(target))
            return
        with tempfile.TemporaryDirectory(dir=target.parent) as td:
            build = Path(td) / "runtime"
            for name, archive in members.items():
                out = build / name
                out.parent.mkdir(parents=True, exist_ok=True)
                with archive.open(name) as src, out.open("xb") as dst:
                    shutil.copyfileobj(src, dst)
            for attempt in range(8):
                try:
                    build.rename(target)
                    return
                except OSError as exc:
                    if target.is_dir():
                        materialize(archives, target)
                        return
                    if getattr(exc, "winerror", None) not in (5, 32) or attempt == 7:
                        raise
                    time.sleep(0.1 * (attempt + 1))


def main(args):
    if sys.implementation.name != "cpython" or sys.version_info[:2] != (3, 13) or sys.maxsize <= 2**32 or sysconfig.get_config_var("Py_GIL_DISABLED"):
        raise ValueError("DeskPilot requires standard 64-bit CPython 3.13.")
    system = {"darwin": "macos", "win32": "windows"}.get(sys.platform, sys.platform)
    arch = platform.machine().lower()
    key = system + "-" + {"amd64":"x64", "x86_64":"x64", "aarch64":"arm64"}.get(arch, arch)
    lock = json.loads(Path(__file__).with_name("artifacts.json").read_text(encoding="utf-8"))
    if key not in lock["platforms"]:
        raise ValueError("Unsupported DeskPilot platform: " + key)
    specs = [lock["platforms"][key]]
    if args[:1] == ["--ocr"]:
        specs.append(lock["models"])
        args = args[1:]
    base = Path(os.environ.get("LOCALAPPDATA") or os.environ.get("XDG_CACHE_HOME") or Path.home() / ".cache")
    cache = Path(os.environ.get("DESKPILOT_CACHE") or base / "DeskPilot" / "skillhub").expanduser().resolve()
    cache.mkdir(mode=0o700, parents=True, exist_ok=True)
    archives = [blob(s, cache) for s in specs]
    target = cache / hashlib.sha256(" ".join(s["sha256"] for s in specs).encode()).hexdigest()[:32]
    materialize(archives, target)
    if args == ["--prepare"]:
        print(json.dumps({"runtime":str(target), "platform":key, "ocr":len(specs)==2}))
        return 0
    # Isolated child ignores PYTHONPATH and executes only the selected, verified runtime.
    code = "import sys;sys.path.insert(0,sys.argv.pop(1));from deskpilot.cli import main;sys.exit(main())"
    return subprocess.call([sys.executable, "-I", "-B", "-c", code, str(target / "scripts"), *args],
                           env=dict(os.environ, DESKPILOT_RESOURCES=str(target)))


if __name__ == "__main__":
    try:
        raise SystemExit(main(sys.argv[1:]))
    except (OSError, ValueError, RuntimeError, netrc.NetrcParseError, zipfile.BadZipFile) as e:
        print("DeskPilot: " + str(e), file=sys.stderr)
        raise SystemExit(1)
