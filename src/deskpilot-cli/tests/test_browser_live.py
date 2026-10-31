from __future__ import annotations

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import os
from pathlib import Path
import sys
import tempfile
import threading
import subprocess
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from deskpilot import DeskPilotError
from deskpilot.session import Session

HTML = b"""<!doctype html><meta charset=utf-8><title>DeskPilot local browser fixture</title>
<label>Input <input id=input></label><select id=category><option value=first>First</option><option value=automation>Automation</option></select>
<button id=apply onclick="document.querySelector('#result').textContent=document.querySelector('#input').value+' | '+document.querySelector('#category').value">Apply</button>
<output id=result>waiting</output><input id=password type=password value=private-fixture-value>
<button class=ambiguous>One</button><button class=ambiguous>Two</button>"""


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(HTML)))
        self.end_headers()
        self.wfile.write(HTML)

    def log_message(self, *args):
        pass


@unittest.skipUnless(os.environ.get("DESKPILOT_BROWSER_TESTS") == "1", "requires an explicitly selected owned Chrome fixture run")
class BrowserLiveTests(unittest.TestCase):
    def test_public_methods_complete_local_form_and_preserve_failure_boundaries(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        profile = tempfile.TemporaryDirectory(prefix="deskpilot chrome fixture ")
        session = Session()
        owned = False
        process = None
        try:
            url = f"http://127.0.0.1:{server.server_port}/fixture"
            connected = session.execute("chrome.ensure", {"profile_dir": profile.name, "url": url, "timeout_ms": 30000,
                                                         "launch_args": ["--headless=new"] if os.environ.get("DESKPILOT_HEADLESS_TESTS") == "1" else []})
            owned = True
            self.assertIn("target_id", connected)
            session.execute("chrome.navigate", {"url": url, "ready_selector": "#input", "timeout_ms": 10000})
            value = "\u4e2d\u6587 % ! & $(literal)"
            result = session.execute("actions.batch", {"show_overlay": False, "steps": [
                {"id": "fill", "method": "chrome.fill", "params": {"selector": "#input", "value": value}},
                {"id": "select", "method": "chrome.select", "params": {"selector": "#category", "value": "automation"}},
                {"id": "apply", "method": "chrome.click", "params": {"selector": "#apply"}},
                {"id": "verify", "method": "chrome.wait", "params": {"predicate": {"type": "element", "selector": "#result", "text": {"equals": value + " | automation"}}}}]})
            self.assertEqual(result["status"], "completed")
            actual = session.execute("chrome.query", {"selector": "#result"})
            self.assertEqual(actual["elements"][0]["text"], value + " | automation")
            password = session.execute("chrome.query", {"selector": "#password"})
            self.assertIsNone(password["elements"][0]["value"])
            self.assertTrue(password["elements"][0]["is_password"])
            attributes = session.execute("chrome.query", {"selector": "#password", "attributes": ["value", "type"]})
            self.assertIsNone(attributes["elements"][0]["attributes"]["value"])
            self.assertEqual(attributes["elements"][0]["attributes"]["type"], "password")
            with self.assertRaises(DeskPilotError) as raised:
                session.execute("chrome.fill", {"selector": "#password", "value": "not authorized here"})
            self.assertEqual(raised.exception.code, "SENSITIVE_INPUT_BLOCKED")
            self.assertEqual(raised.exception.outcome, "not_dispatched")
            # Continuous unrelated animation must not block an otherwise stable target.
            session.execute("chrome.evaluate", {"expression": """window.targetClicks=0;
const moving=document.createElement('button');moving.id='moving';moving.textContent='Moving target';moving.style='position:fixed;left:160px;top:200px';moving.onclick=()=>window.targetClicks++;
document.body.append(moving);let tick=0;window.keepMoving=true;
function move(){if(!window.keepMoving)return;moving.style.left=(tick++%2?160:360)+'px';requestAnimationFrame(move)}requestAnimationFrame(move);"""})
            session.execute("chrome.click", {"selector": "#apply"})
            with self.assertRaises(DeskPilotError) as moved:
                session.execute("chrome.click", {"selector": "#moving"})
            self.assertEqual((moved.exception.code, moved.exception.outcome), ("CHROME_TARGET_MOVED", "not_dispatched"))
            self.assertEqual(session.execute("chrome.evaluate", {"expression": "window.targetClicks", "read_only": True})["value"], 0)
            session.execute("chrome.evaluate", {"expression": "window.keepMoving=false;document.querySelector('#moving').onmouseenter=()=>{document.querySelector('#moving').style.top='300px'}"})
            with self.assertRaises(DeskPilotError) as hovered:
                session.execute("chrome.click", {"selector": "#moving"})
            self.assertEqual((hovered.exception.code, hovered.exception.outcome), ("CHROME_TARGET_MOVED", "not_dispatched"))
            self.assertEqual(session.execute("chrome.evaluate", {"expression": "window.targetClicks", "read_only": True})["value"], 0)
            session.execute("chrome.evaluate", {"expression": "document.querySelector('#moving').onmouseenter=null"})
            session.execute("chrome.click", {"selector": "#moving"})
            self.assertEqual(session.execute("chrome.evaluate", {"expression": "window.targetClicks", "read_only": True})["value"], 1)
            with self.assertRaises(DeskPilotError) as raised:
                session.execute("chrome.click", {"selector": ".ambiguous"})
            self.assertEqual(raised.exception.code, "CHROME_TARGET_AMBIGUOUS")
            self.assertEqual(raised.exception.outcome, "not_dispatched")
            with self.assertRaises(DeskPilotError) as raised:
                session.execute("chrome.wait", {"selector": "#missing", "timeout_ms": 150})
            self.assertEqual(raised.exception.code, "CHROME_WAIT_TIMEOUT")
            with self.assertRaises(DeskPilotError) as raised:
                session.execute("chrome.wait", {"predicate": {"type": "element", "selector": "#input", "unexpected": True}})
            self.assertEqual(raised.exception.code, "INVALID_ARGUMENT")
            process = session.browser._process
            with self.assertRaises(DeskPilotError) as raised:
                session.execute("chrome.ensure", {"endpoint": "http://127.0.0.1:1", "auto_start": True})
            self.assertEqual(raised.exception.code, "CHROME_ENDPOINT_UNAVAILABLE")
            self.assertIs(session.browser._process, process)
            session.execute("chrome.navigate", {"url": url, "wait_until": "network_idle", "timeout_ms": 3000})
        finally:
            if owned and session.browser.socket:
                try:
                    session.browser.socket.call("Browser.close", timeout=3, mutation=True)
                except DeskPilotError:
                    pass
            session.close()
            if process is not None:
                try:
                    process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    process.terminate()
                    process.wait(timeout=3)
            server.shutdown()
            server.server_close()
            thread.join(1)
            # Chrome may still be releasing profile files after Browser.close.
            import time
            for attempt in range(20):
                try:
                    profile.cleanup()
                    break
                except PermissionError:
                    time.sleep(0.1)


if __name__ == "__main__":
    unittest.main()
