"""Development acceptance on an actual macOS desktop through an installed Skill.

Only the maintainer invokes this script. Client installation still uses bundled
files, the standard library and the declared Python ABI, without a package manager.
"""

from __future__ import annotations

import argparse
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import hashlib
import json
import os
from pathlib import Path
import platform
import plistlib
import queue
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import traceback
import uuid


ROOT = Path(__file__).resolve().parents[1]


def ensure(condition, message):
    if not condition:
        raise AssertionError(message)


def wait_for(read, predicate=lambda value: bool(value), *, timeout=15, description="fixture state"):
    deadline = time.monotonic() + timeout
    value = None
    while time.monotonic() < deadline:
        try:
            value = read()
            if predicate(value):
                return value
        except (OSError, ValueError):
            pass
        time.sleep(0.05)
    raise AssertionError("Timed out waiting for " + description + "; last observation: " + repr(value))


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def run(arguments, *, env=None, cwd=None, timeout=90):
    result = subprocess.run([str(item) for item in arguments], env=env, cwd=cwd,
                            capture_output=True, text=True, encoding="utf-8", timeout=timeout)
    ensure(result.returncode == 0, f"Command failed ({result.returncode}): {arguments[0]}\n{result.stdout}\n{result.stderr}")
    return result.stdout


class Client:
    def __init__(self, application, env, evidence):
        environment = dict(env, PYTHONPATH="", PYTHONDONTWRITEBYTECODE="1", PYTHONIOENCODING="utf-8")
        environment.pop("DESKPILOT_RESOURCES", None)
        self.process = subprocess.Popen([sys.executable, "-I", "-S", "-B", str(application), "exec"],
                                        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                        text=True, encoding="utf-8", env=environment, cwd=application.parent)
        self.counter, self.lines, self.events = 0, queue.Queue(), []
        self.evidence = evidence
        self.reader = threading.Thread(target=self._read, daemon=True)
        self.reader.start()

    def _read(self):
        for line in self.process.stdout:
            self.lines.put(line)
        self.lines.put(None)

    def send(self, method, params=None):
        self.counter += 1
        request = {"id": self.counter, "method": method, "params": params or {}}
        self.events.append({"request": request})
        self.process.stdin.write(json.dumps(request, ensure_ascii=False) + "\n")
        self.process.stdin.flush()
        return self.counter

    def receive(self, timeout=60):
        line = self.lines.get(timeout=timeout)
        ensure(line is not None, f"Installed CLI exited unexpectedly ({self.process.poll()}).")
        reply = json.loads(line)
        self.events.append({"response": reply})
        return reply

    def call(self, method, params=None, *, error=None):
        identifier = self.send(method, params)
        reply = self.receive()
        ensure(reply["id"] == identifier, "The public response ID changed.")
        if error:
            ensure(not reply["ok"] and reply.get("error", {}).get("code") == error,
                   f"Expected {error} from {method}: {reply}")
            return reply["error"]
        ensure(reply["ok"], f"{method} failed: {reply.get('error')}")
        return reply["result"]

    def cancel_pending_wait(self):
        waiting = self.send("wait.window", {"title_exact": "DeskPilot absent cancellation fixture", "timeout_ms": 30000})
        time.sleep(0.15)
        cancellation = self.send("interaction.cancel")
        replies = {reply["id"]: reply for reply in (self.receive(5), self.receive(5))}
        ensure(replies[waiting].get("error", {}).get("code") == "CANCELLED", "Pending wait was not cancelled.")
        ensure(replies[cancellation]["ok"], "Cancellation did not acknowledge the request.")
        self.call("capabilities")

    def close(self):
        try:
            if self.process.poll() is None:
                self.call("close")
                self.process.stdin.close()
                self.process.wait(timeout=8)
            ensure(self.process.returncode == 0, "Installed CLI did not exit cleanly.")
        finally:
            if self.process.poll() is None:
                self.process.terminate()
                self.process.wait(timeout=5)
            self.reader.join(1)
            (self.evidence / "protocol.json").write_text(json.dumps(self.events, ensure_ascii=False, indent=2), encoding="utf-8")
            (self.evidence / "cli-stderr.txt").write_text(self.process.stderr.read(), encoding="utf-8")
            for stream in (self.process.stdin, self.process.stdout, self.process.stderr):
                if not stream.closed:
                    stream.close()


def app_bundle(source, parent, name, identifier, *, background=False):
    bundle = parent / (name + ".app")
    executable = bundle / "Contents/MacOS" / name
    executable.parent.mkdir(parents=True)
    info = {"CFBundleIdentifier": identifier, "CFBundleName": name, "CFBundleExecutable": name,
            "CFBundlePackageType": "APPL", "CFBundleVersion": "1", "NSPrincipalClass": "NSApplication"}
    if background:
        info["LSUIElement"] = True
    (bundle / "Contents/Info.plist").write_bytes(plistlib.dumps(info))
    run(["/usr/bin/xcrun", "swiftc", "-swift-version", "5", "-parse-as-library", "-O", "-framework", "AppKit", source, "-o", executable], timeout=180)
    run(["/usr/bin/codesign", "--force", "--sign", "-", bundle])
    return bundle, executable


def permission_probe(application, pid, output):
    # This code runs inside a separately launched, unapproved application.
    os.environ["DESKPILOT_RESOURCES"] = str(application.parent)
    sys.path.insert(0, str(application))
    from deskpilot import DeskPilotError
    from deskpilot.platforms.macos import MacDesktop
    desktop = MacDesktop()
    result = {"ok": False, "diagnostics": desktop.doctor(), "errors": {}}
    try:
        for name, operation, expected in (
            ("accessibility", desktop._trusted, "ACCESSIBILITY_PERMISSION_REQUIRED"),
            ("input", desktop._input_access, "ACCESSIBILITY_PERMISSION_REQUIRED"),
            ("capture", lambda: desktop.capture({}), "SCREEN_RECORDING_PERMISSION_REQUIRED"),
        ):
            try:
                operation()
            except DeskPilotError as exc:
                ensure(exc.code == expected and exc.outcome == "not_dispatched", f"Unexpected denial for {name}: {exc.body()}")
                result["errors"][name] = exc.body()
            else:
                raise AssertionError("The separate application was unexpectedly authorized for " + name)
        result["ok"] = True
        result["fixture_pid"] = pid
    finally:
        desktop.close()
        output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")


class Page(BaseHTTPRequestHandler):
    def do_GET(self):
        body = b'''<!doctype html><meta charset="utf-8"><title>DeskPilot browser fixture</title>
<label>Input <input id="input"></label><select id="category"><option>choose</option><option value="automation">automation</option></select>
<button id="apply" onclick="window.fixtureClicks++;document.querySelector('#result').textContent=document.querySelector('#input').value+' | '+document.querySelector('#category').value">Apply</button>
<p id="result"></p><button class="ambiguous">A</button><button class="ambiguous">B</button>
<script>window.fixtureClicks=0;window.fixtureEvents=[];
for(const type of ['pointerdown','pointerup','mousedown','mouseup','click','focus','blur','resize'])
addEventListener(type,event=>{window.fixtureEvents.push({type,target:event.target.id||event.target.nodeName,x:event.clientX,y:event.clientY,focused:document.hasFocus()});if(window.fixtureEvents.length>100)window.fixtureEvents.shift()},true);
</script>'''
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_):
        pass


def browser_case(client, executable, directory):
    server = ThreadingHTTPServer(("127.0.0.1", 0), Page)
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    profile = directory / "owned browser profile"
    chrome = subprocess.Popen([executable, "--remote-debugging-port=0", "--user-data-dir=" + str(profile),
                               "--force-renderer-accessibility", "--disable-background-networking", "--no-first-run", "--no-default-browser-check", "about:blank"],
                              stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        port = wait_for(lambda: (profile / "DevToolsActivePort").read_text().splitlines()[0], description="owned Chrome endpoint")
        client.call("chrome.ensure", {"endpoint": "http://127.0.0.1:" + port})
        client.call("chrome.navigate", {"url": f"http://127.0.0.1:{server.server_port}/", "ready_selector": "#input"})
        # A visible tab is not proof that the native browser has finished its
        # activation. Establish the fixture's real foreground/focus precondition.
        client.call("windows.activate", {"pid": chrome.pid, "title_contains": "DeskPilot browser fixture"})
        client.call("chrome.wait", {"expression": "document.hasFocus() && document.visibilityState === 'visible'", "stable_ms": 500})
        for index in range(3):
            text = "浏览器中文输入 12345 " + str(index)
            result = client.call("actions.batch", {"show_overlay": False, "steps": [
                {"id": "fill", "method": "chrome.fill", "params": {"selector": "#input", "value": text}},
                {"id": "select", "method": "chrome.select", "params": {"selector": "#category", "value": "automation"}},
                {"id": "apply", "method": "chrome.click", "params": {"selector": "#apply"}},
                {"id": "read", "method": "chrome.wait", "params": {"predicate": {"type": "element", "selector": "#result", "text": {"equals": text + " | automation"}}}},
            ]})
            ensure(result["status"] == "completed", "The browser form did not complete.")
            clicks = client.call("chrome.evaluate", {"expression": "window.fixtureClicks", "read_only": True})
            ensure(clicks["value"] == index + 1, "The fixture did not receive exactly one click for the requested action.")
        client.call("chrome.click", {"selector": ".ambiguous"}, error="CHROME_TARGET_AMBIGUOUS")
    finally:
        if client.process.poll() is None:
            try:
                state = client.call("chrome.evaluate", {"read_only": True, "expression":
                    "({focused:document.hasFocus(),visibility:document.visibilityState,clicks:window.fixtureClicks,events:window.fixtureEvents,"
                    "input:document.querySelector('#input')?.value,result:document.querySelector('#result')?.textContent,"
                    "viewport:{width:innerWidth,height:innerHeight,scale:devicePixelRatio}})"})
                (client.evidence / "browser-state.json").write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
                windows = client.call("windows.list")
                (client.evidence / "browser-windows.json").write_text(json.dumps(windows, ensure_ascii=False, indent=2), encoding="utf-8")
                run(["/usr/sbin/screencapture", "-x", client.evidence / "browser-desktop.png"])
            except (AssertionError, OSError, queue.Empty):
                pass
        chrome.terminate()
        chrome.wait(timeout=10)
        server.shutdown()
        server.server_close()
        worker.join(2)


def verify(output):
    ensure(sys.platform == "darwin", "This acceptance entry requires a real macOS desktop; another OS is not a pass.")
    output.mkdir(parents=True, exist_ok=True)
    report = {"status": "running", "source_commit": os.environ.get("GITHUB_SHA"),
              "environment": {"os": platform.platform(), "architecture": platform.machine(), "python": platform.python_version(),
                              "runner_image": os.environ.get("ImageOS"), "image_version": os.environ.get("ImageVersion")},
              "cases": [], "limitations": ["No physical peripherals, multiple physical displays or user production applications are exercised.",
                                             "Hosted-runner authorization and separate unapproved-app denial are distinct; first-time human approval is not inferred."]}

    @contextmanager
    def case(name, *, collect_failure=False):
        item = {"name": name, "status": "running"}
        report["cases"].append(item)
        started = time.monotonic()
        print("Checking " + name, flush=True)
        try:
            yield
            item["status"] = "passed"
        except BaseException:
            item["status"] = "failed"
            item["failure"] = traceback.format_exc()
            if not collect_failure:
                raise
        finally:
            item["duration_ms"] = round((time.monotonic() - started) * 1000)
            (output / "result.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    client, fixture, blocker = None, None, None
    with tempfile.TemporaryDirectory(prefix="DeskPilot Mac % ! & ") as temporary:
        directory = Path(temporary)
        try:
            with case("independent read-only Skill installation and zsh PATH"):
                skill = directory / "read only Skill"
                shutil.copytree(ROOT / "skills/shzw-deskpilot-cli", skill)
                for path in skill.rglob("*"):
                    if path.is_file():
                        path.chmod(0o444)
                for path in (skill, *skill.rglob("*")):
                    if path.is_dir():
                        path.chmod(0o555)
                home, state, commands = directory / "home", directory / "runtime", directory / "commands"
                home.mkdir()
                environment = dict(os.environ, HOME=str(home), ZDOTDIR=str(home), SHELL="/bin/zsh", PYTHONPATH="", PYTHONIOENCODING="utf-8")
                environment.pop("DESKPILOT_RESOURCES", None)
                installer = [sys.executable, "-I", "-S", "-B", skill / "scripts/install.py", "--state-dir", state, "--bin-dir", commands, "--json"]
                installed = json.loads(run(installer, env=environment, cwd=directory))["data"]
                application = Path(installed["application"])
                ensure(installed["path_registered"], "The real installer did not register PATH.")
                ensure("DeskPilot" in run([installed["command_path"], "--help"], env=environment, cwd=directory), "Generated command failed.")
                resolved = run(["/bin/zsh", "-i", "-c", "command -v deskpilot"], env=environment, cwd=directory).strip()
                ensure(Path(resolved).resolve() == Path(installed["command_path"]).resolve(), "A fresh zsh did not resolve the installed command.")
                ensure(json.loads(run(installer, env=environment, cwd=directory))["data"]["status"] == "unchanged", "Repeat installation changed the build.")
                record = read_json(state / "installation.json")
                report["installation"] = {"input_digest": record["input_digest"], "application_sha256": hashlib.sha256(application.read_bytes()).hexdigest()}

            with case("real AppKit fixture and granted native permissions"):
                _, fixture_executable = app_bundle(ROOT / "src/deskpilot-cli/tests/macos_fixture.swift", directory, "DeskPilotFixture", "org.xrain.deskpilot.fixture")
                title, state_path = "DeskPilot macOS " + uuid.uuid4().hex[:10], directory / "native-state.json"
                fixture_log = (output / "fixture-stderr.txt").open("w", encoding="utf-8")
                fixture = subprocess.Popen([str(fixture_executable), title, str(state_path)], stdout=subprocess.DEVNULL, stderr=fixture_log)
                wait_for(lambda: read_json(state_path), description="native AppKit window")
                client = Client(application, environment, output)
                doctor = client.call("doctor")
                report["diagnostics"] = doctor
                for key in ("ui_automation", "input", "capture", "desktop_text"):
                    ensure(doctor[key]["available"], f"Required native capability {key} is unavailable: {doctor[key]}")
                ensure(doctor["interactive_desktop"], "The runner has no interactive desktop.")
                client.call("wait.window", {"title_exact": title, "timeout_ms": 10000})
                client.call("interaction.begin", {"show_overlay": True, "show_action_trace": True})

            def find(identifier):
                result = client.call("ui.find", {"title_exact": title, "automation_id": identifier,
                                                "require_unique": True, "overlay_required": True})
                return {"element_id": result["elements"][0]["element_id"], "observation_id": result["observation_id"]}, result

            with case("native controls and independently observed Chinese and multiline values"):
                ref, _ = find("input")
                client.call("ui.set_value", ref | {"value": "原生中文赋值 12345"})
                wait_for(lambda: read_json(state_path), lambda value: value["input"] == "原生中文赋值 12345")
                ref, _ = find("multiline")
                client.call("ui.set_value", ref | {"value": "第一行\nSecond line"})
                wait_for(lambda: read_json(state_path), lambda value: value["multiline"] == "第一行\nSecond line")
                ref, _ = find("input")
                client.call("ui.click", ref)
                wait_for(lambda: read_json(state_path), lambda value: value["focused"] == "input", description="native input focus")
                client.call("input.hotkey", {"title_exact": title, "keys": ["CMD", "A"]})
                wait_for(lambda: read_json(state_path), lambda value: value["input_selection_length"] == len("原生中文赋值 12345"),
                         description="Command+A native field selection")
                client.call("input.type", {"title_exact": title, "text": "键盘中文输入 67890"})
                wait_for(lambda: read_json(state_path), lambda value: value["input"] == "键盘中文输入 67890")
                ref, _ = find("apply")
                client.call("ui.invoke", ref)
                wait_for(lambda: read_json(state_path), lambda value: value["clicks"] == 1 and value["result"] == "Result: 键盘中文输入 67890")
                ref, _ = find("apply")
                client.call("ui.click", ref)
                wait_for(lambda: read_json(state_path), lambda value: value["clicks"] == 2)

            with case("native scroll changes the actual AppKit viewport", collect_failure=True):
                ref, _ = find("multiline")
                content = "\n".join(f"Native scroll line {index:02d}" for index in range(80))
                client.call("ui.set_value", ref | {"value": content})
                wait_for(lambda: read_json(state_path), lambda value: value["multiline"] == content and value["scroll_document_height"] > 500)
                _, observed = find("scroll")
                bounds, area = observed["elements"][0]["bounds"], observed["window"]["bounds"]
                before = read_json(state_path)["scroll_y"]
                client.call("input.scroll", {"title_exact": title, "observation_id": observed["observation_id"],
                                             "x": bounds["x"] + bounds["width"] // 2 - area["x"],
                                             "y": bounds["y"] + bounds["height"] // 2 - area["y"], "amount": -2400})
                wait_for(lambda: read_json(state_path), lambda value: value["scroll_y"] > before + 1,
                         description="native AppKit viewport scrolling")
                report["native_scroll"] = {"before_y": before, "after_y": read_json(state_path)["scroll_y"]}
                ref, _ = find("multiline")
                client.call("ui.set_value", ref | {"value": "第一行\nSecond line"})
                wait_for(lambda: read_json(state_path), lambda value: value["multiline"] == "第一行\nSecond line")

            with case("read-only, password and stale-reference rejection without writes"):
                ref, _ = find("readonly")
                client.call("ui.set_value", ref | {"value": "must not be written"}, error="ELEMENT_READ_ONLY")
                ensure(read_json(state_path)["readonly"] == "Read-only native value", "Read-only content changed.")
                ref, observed = find("password")
                ensure(observed["elements"][0]["is_password"] and observed["elements"][0]["value"] is None, "Password value was exposed.")
                client.call("ui.set_value", ref | {"value": "must not be written"}, error="SENSITIVE_INPUT_BLOCKED")
                ref, _ = find("password")
                client.call("ui.click", ref)
                wait_for(lambda: read_json(state_path), lambda value: value["focused"] == "password", description="native password focus")
                client.call("input.type", {"title_exact": title, "text": "must not be written"}, error="SENSITIVE_INPUT_BLOCKED")
                ensure(read_json(state_path)["password_empty"], "Rejected input changed the password control.")
                ref, _ = find("input")
                before = read_json(state_path)["input"]
                find("apply")
                client.call("ui.set_value", ref | {"value": "stale"}, error="STALE_OBSERVATION")
                ensure(read_json(state_path)["input"] == before, "Stale-reference rejection changed native state.")

            with case("target-owned screenshot, visible activity and offline Chinese OCR"):
                ref, _ = find("input")
                client.call("ui.click", ref)
                children = run(["/usr/bin/pgrep", "-P", str(client.process.pid)]).split()
                ensure(children, "The AppKit activity helper was not running.")
                overlay_pids = [int(value) for value in children]
                run(["/usr/sbin/screencapture", "-x", output / "desktop-activity.png"])
                shot = client.call("screen.capture", {"title_exact": title, "path": str(output / "native-window.png")})
                ensure(shot["screenshot"]["trusted"], "The screenshot did not establish ownership.")
                os.environ["DESKPILOT_RESOURCES"] = str(application.parent)
                sys.path.insert(0, str(application))
                from deskpilot.screen import Image
                image = Image.open(shot["screenshot"]["path"])
                red_pixels = sum(image.rgb[index] > 200 and image.rgb[index + 1] < 100 and image.rgb[index + 2] < 130
                                 for index in range(0, len(image.rgb), 3))
                ensure(red_pixels > 1000, "The actual fixture's color marker was missing from the captured frame.")
                recognized = client.call("messages.observe", {"screenshot_id": shot["screenshot"]["screenshot_id"],
                                                              "expected_identity": "DeskPilot Native Fixture"})
                ensure("自动化测试" in "".join(recognized["recognition"]["text"].split()), "The bundled OCR did not read the visible Chinese label.")
                owned_shot = client.call("screen.capture", {"title_exact": title})["screenshot"]["path"]
                (output / "native-state.json").write_text(json.dumps(read_json(state_path), ensure_ascii=False, indent=2), encoding="utf-8")

            with case("foreign floating window rejects pointer input", collect_failure=True):
                _, button = find("apply")
                bounds = button["elements"][0]["bounds"]
                blocker_state = directory / "blocker-state.json"
                blocker = subprocess.Popen([str(fixture_executable), title + " blocker", str(blocker_state), "--blocker",
                                            str(bounds["x"] - 5), str(bounds["y"] - 5)],
                                           stdout=subprocess.DEVNULL, stderr=fixture_log)
                try:
                    wait_for(lambda: read_json(blocker_state), description="foreign floating window")
                    before = read_json(state_path)["clicks"]
                    observed = client.call("observe", {"title_exact": title})
                    area = observed["window"]["bounds"]
                    denial = client.call("input.click", {"title_exact": title, "observation_id": observed["observation_id"],
                                                         "x": bounds["x"] + bounds["width"] // 2 - area["x"],
                                                         "y": bounds["y"] + bounds["height"] // 2 - area["y"]}, error="POINT_OCCLUDED")
                    ensure(denial["outcome"] == "not_dispatched", "A rejected click was marked dispatched.")
                    denial = client.call("input.scroll", {"title_exact": title, "observation_id": observed["observation_id"],
                                                          "x": bounds["x"] + bounds["width"] // 2 - area["x"],
                                                          "y": bounds["y"] + bounds["height"] // 2 - area["y"],
                                                          "amount": -120}, error="POINT_OCCLUDED")
                    ensure(denial["outcome"] == "not_dispatched", "A rejected scroll was marked dispatched.")
                    ensure(read_json(state_path)["clicks"] == before, "A rejected pointer event clicked the underlying target.")
                finally:
                    blocker.terminate()
                    blocker.wait(timeout=5)
                    blocker = None

            with case("owned Chrome form, Chinese input and ambiguous-target rejection"):
                ensure(doctor["chrome"]["available"], "The maintainer runner must provide Chrome for this real browser test.")
                browser_case(client, doctor["chrome"]["executable"], directory)

            with case("separate application reports real missing permissions and dispatches nothing"):
                probe_bundle, _ = app_bundle(ROOT / "src/deskpilot-cli/tests/macos_permission_probe.swift", directory,
                                            "DeskPilotPermissionProbe", "org.xrain.deskpilot.permissionprobe." + uuid.uuid4().hex,
                                            background=True)
                probe_output = output / "permission-denial.json"
                before = read_json(state_path)
                run(["/usr/bin/open", "-n", "-W", probe_bundle, "--args", sys.executable, Path(__file__).resolve(),
                     application, str(fixture.pid), probe_output], timeout=60)
                probe = read_json(probe_output)
                ensure(probe.get("ok") and len(probe.get("errors", {})) == 3, f"Real unapproved-app permission test failed: {probe}")
                after = read_json(state_path)
                ensure(all(before[key] == after[key] for key in ("input", "multiline", "readonly", "password_empty", "clicks")),
                       "Denied operations changed the native fixture.")

            with case("cancellation, process cleanup and owned screenshot cleanup"):
                client.cancel_pending_wait()
                client.close()
                client = None
                ensure(not Path(owned_shot).exists(), "Session-owned temporary screenshot survived close.")
                for pid in overlay_pids:
                    try:
                        os.kill(pid, 0)
                    except ProcessLookupError:
                        continue
                    raise AssertionError("The activity helper survived closing the installed process.")

            with case("uninstall preserves unrelated commands and their shared zsh PATH"):
                unrelated = commands / "unrelated-command"
                unrelated.write_text("keep", encoding="utf-8")
                removed = json.loads(run(installer + ["--uninstall"], env=environment, cwd=directory))["data"]
                ensure(removed["status"] == "uninstalled" and unrelated.read_text() == "keep", "Uninstall damaged the shared command directory.")
                ensure(not Path(installed["command_path"]).exists(), "Uninstall retained the owned command.")
                ensure(not application.exists(), "Uninstall retained the owned build.")
                ensure(removed["path_retained_for_shared_directory"], "The shared command directory's PATH was unexpectedly removed.")
            with case("clean installation removes only its own zsh PATH block"):
                clean_home = directory / "clean home"
                clean_home.mkdir()
                clean_environment = dict(environment, HOME=str(clean_home), ZDOTDIR=str(clean_home))
                clean_installer = [sys.executable, "-I", "-S", "-B", skill / "scripts/install.py", "--state-dir", directory / "clean runtime",
                                   "--bin-dir", directory / "clean commands", "--json"]
                run(clean_installer, env=clean_environment, cwd=directory)
                ensure("# >>>" in (clean_home / ".zshrc").read_text(), "The clean install did not create its PATH block.")
                run(clean_installer + ["--uninstall"], env=clean_environment, cwd=directory)
                ensure("# >>>" not in (clean_home / ".zshrc").read_text(), "The clean uninstall retained its owned PATH block.")
            ensure(not any(item["status"] != "passed" for item in report["cases"]), "One or more native cases failed; see result.json.")
            report["status"] = "passed"
        except BaseException:
            report["status"] = "failed"
            report["failure"] = traceback.format_exc()
            raise
        finally:
            if "state_path" in locals() and state_path.is_file():
                try:
                    native_state = read_json(state_path)
                    (output / "native-state.json").write_text(json.dumps(native_state, ensure_ascii=False, indent=2), encoding="utf-8")
                    if report["status"] != "passed":
                        subprocess.run(["/usr/sbin/screencapture", "-x", "-o", "-l", str(native_state["window_number"]), str(output / "failure-native.png")],
                                       stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10)
                except (OSError, ValueError, subprocess.TimeoutExpired):
                    pass
            if client:
                try:
                    client.close()
                except BaseException:
                    pass
            for process in (blocker, fixture):
                if process and process.poll() is None:
                    process.terminate()
                    process.wait(timeout=5)
            if "fixture_log" in locals():
                fixture_log.close()
            if "skill" in locals() and skill.exists():
                skill.chmod(0o755)
                for path in skill.rglob("*"):
                    path.chmod(0o755 if path.is_dir() else 0o644)
            (output / "result.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"status": report["status"], "cases": len(report["cases"]), "architecture": platform.machine()}), flush=True)


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "--permission-probe":
        permission_probe(Path(sys.argv[2]), int(sys.argv[3]), Path(sys.argv[4]))
        return
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    verify(args.output.resolve())


if __name__ == "__main__":
    main()
