import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'shzw standalone skill '));
  t.after(async () => {
    const inside = relative(resolve(tmpdir()), resolve(root));
    assert.ok(inside && !inside.startsWith('..') && !isAbsolute(inside));
    await rm(root, { recursive: true, force: true });
  });
  const installed = join(root, 'installed separately');
  await cp(new URL('../skills/shzw-runtime-operations/', import.meta.url), installed, { recursive: true });
  const project = join(root, 'target project');
  const other = join(root, 'other working directory');
  await mkdir(project); await mkdir(other);
  return { root, project, other, script: join(installed, 'modes/services/scripts/run-service.mjs') };
}
function run(f, args, cwd = f.other) {
  return spawnSync(process.execPath, [f.script, ...args], { cwd, encoding: 'utf8', windowsHide: true });
}

test('copied service helper resolves the explicit target and the working directory independently of installation', async t => {
  const f = await fixture(t);
  await writeFile(join(f.project, 'package.json'), JSON.stringify({ scripts: { status: 'node status.cjs', 'target-only': 'node status.cjs' } }));
  const explicit = run(f, ['--workspace-root', f.project, '--list']);
  assert.equal(explicit.status, 0, explicit.stderr);
  assert.match(explicit.stdout, /target-only/);
  const implicit = run(f, ['--list'], f.project);
  assert.equal(implicit.status, 0, implicit.stderr);
  assert.match(implicit.stdout, /target-only/);
  const missing = run(f, ['--list']);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /target package.json/);
});

test('copied service helper dispatches only the target project command and propagates its exit status', async t => {
  const f = await fixture(t);
  await writeFile(join(f.project, 'package.json'), JSON.stringify({ scripts: { status: 'node status.cjs' } }));
  await writeFile(join(f.project, 'status.cjs'), "require('node:fs').writeFileSync('observed.json', JSON.stringify({ cwd: process.cwd() })); process.exit(7);\n");
  const result = run(f, ['--workspace-root', f.project, '--service', 'xrain', '--action', 'status']);
  assert.equal(result.status, 7, result.stderr);
  assert.equal(JSON.parse(await readFile(join(f.project, 'observed.json'), 'utf8')).cwd, f.project);
  const unavailable = run(f, ['--workspace-root', f.project, '--action', 'start']);
  assert.equal(unavailable.status, 1);
  assert.match(unavailable.stderr, /does not define script 'start'/);
});

test('copied service helper provides help without any project or dependency installation', async t => {
  const f = await fixture(t);
  const result = run(f, ['--help']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--workspace-root/);
});
