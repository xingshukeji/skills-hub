import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const lock = JSON.parse(readFileSync(new URL('../distributions/skillhub/shzw-deskpilot-cli/artifacts.json', import.meta.url)));

test('registry pins four platform bundles and a separate OCR bundle', () => {
  assert.deepEqual(Object.keys(lock.platforms).sort(), ['linux-x64', 'macos-arm64', 'macos-x64', 'windows-x64']);
  const bundles = [...Object.values(lock.platforms), lock.models];
  assert.equal(new Set(bundles.map(b => b.sha256)).size, bundles.length);
  for (const b of bundles) {
    assert.match(b.sha256, /^[0-9a-f]{64}$/);
    assert.ok(b.bytes > 0);
  }
});

test('a corrupt download never becomes active and cached resources work offline', () => {
  const python = process.env.DESKPILOT_TEST_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  const code = `
import hashlib, io, os, runpy, tempfile, zipfile
from pathlib import Path
from unittest.mock import patch
m=runpy.run_path("distributions/skillhub/shzw-deskpilot-cli/deskpilot.py")
stream=io.BytesIO()
with zipfile.ZipFile(stream, "w") as z: z.writestr("assets/ocr/sample", b"model")
payload=stream.getvalue()
spec=dict(file="ocr.zip", bytes=len(payload), sha256=hashlib.sha256(payload).hexdigest())
class Reply:
    def __init__(self, data): self.data=data
    def open(self, *a, **kw): return io.BytesIO(self.data)
with tempfile.TemporaryDirectory() as td, patch.dict(os.environ, {"LOCALAPPDATA":td,"DESKPILOT_NEXUS_ROOT":"https://example.invalid/raw"}, clear=True), patch("netrc.netrc", side_effect=FileNotFoundError):
    cache=Path(td)
    with patch("urllib.request.build_opener", return_value=Reply(b"x"*len(payload))):
        try: m["blob"](spec, cache)
        except ValueError: pass
        else: raise AssertionError("corrupt download accepted")
    assert not list(cache.iterdir())
    with patch("urllib.request.build_opener", return_value=Reply(payload)):
        verified=m["blob"](spec, cache)
    with patch("urllib.request.build_opener", side_effect=AssertionError("network on cache hit")):
        assert m["blob"](spec, cache)==verified
    runtime=cache/"runtime"
    m["materialize"]([verified],runtime)
    (runtime/"assets/ocr/sample").write_bytes(b"damage")
    try: m["materialize"]([verified],runtime)
    except ValueError: pass
    else: raise AssertionError("corrupt extracted resource accepted")
`;
  const r = spawnSync(python, ['-I', '-B', '-c', code], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});
