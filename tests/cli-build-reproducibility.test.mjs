import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

test('the committed CLI build is reproducible with dependencies linked from another location', t => {
  const root = realpathSync(join(dirname(fileURLToPath(import.meta.url)), '..'));
  const temporaryRoot = realpathSync(tmpdir());
  const fixture = realpathSync(mkdtempSync(join(temporaryRoot, 'xrain-cli-build-')));
  const within = relative(temporaryRoot, fixture);
  assert.ok(within && !within.startsWith('..') && !isAbsolute(within));
  const links = [];
  t.after(() => {
    for (const link of links) unlinkSync(link);
    rmSync(fixture, { recursive: true, force: true });
  });
  for (const folder of ['tools', 'src', 'skills/shzw-xrain-cli']) mkdirSync(join(fixture, folder), { recursive: true });
  cpSync(join(root, 'tools/build.mjs'), join(fixture, 'tools/build.mjs'));
  cpSync(join(root, 'src/xrain-cli'), join(fixture, 'src/xrain-cli'), { recursive: true });
  cpSync(join(root, 'skills/shzw-xrain-cli/scripts'), join(fixture, 'skills/shzw-xrain-cli/scripts'), { recursive: true });
  for (const folder of ['node_modules', 'src/deskpilot-cli', 'skills/shzw-deskpilot-cli']) {
    const link = join(fixture, folder);
    symlinkSync(join(root, folder), link, process.platform === 'win32' ? 'junction' : 'dir');
    links.push(link);
  }
  const result = spawnSync(process.execPath, [join(fixture, 'tools/build.mjs'), '--check'], {
    cwd: fixture, encoding: 'utf8', timeout: 120_000, windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
});
