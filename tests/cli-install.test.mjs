import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, chmodSync, cpSync, existsSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function fixture(t) {
  const base = realpathSync(tmpdir()), directory = mkdtempSync(join(base, 'xrain-cli-install-'));
  assert.equal(dirname(realpathSync(directory)), base);
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const skill = join(directory, process.platform === 'win32' ? 'skill % ! & space' : "skill ' space");
  cpSync(join(root, 'skills/shzw-xrain-cli'), skill, { recursive: true });
  const binDir = join(directory, 'user bin');
  return { directory, skill, binDir, installer: join(skill, 'scripts/install-cli.mjs'), script: join(skill, 'scripts/xrain-cli.mjs') };
}
function install(f, extra = [], env = process.env) {
  const run = spawnSync(process.execPath, [f.installer, '--bin-dir', f.binDir, '--json', ...extra], { encoding: 'utf8', env });
  return { ...run, result: JSON.parse(run.stdout) };
}
function command(path) {
  if (process.platform !== 'win32') return spawnSync(path, ['auth', 'whoami', '--help'], { encoding: 'utf8' });
  const literal = path.replaceAll("'", "''");
  return spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', `& '${literal}' auth whoami --help`], { encoding: 'utf8' });
}

test('registered command runs the skill bundle without npm and follows in-place updates', t => {
  const f = fixture(t), env = { ...process.env, PATH: [f.binDir, process.env.PATH].join(delimiter) };
  const first = install(f, [], env);
  assert.equal(first.status, 0, first.stderr); assert.equal(first.result.data.status, 'installed');
  assert.equal(first.result.data.onPath, true); assert.equal(first.result.data.source, f.script);
  const target = first.result.data.commandPath, original = readFileSync(target);
  let call = command(target); assert.equal(call.status, 0, call.stderr); assert.match(call.stdout, /auth whoami/);
  const second = install(f, [], env); assert.equal(second.status, 0, second.stderr); assert.equal(second.result.data.status, 'unchanged');
  assert.deepEqual(readFileSync(target), original);
  appendFileSync(f.script, '\nconsole.log("synthetic-updated-cli");\n');
  call = command(target); assert.equal(call.status, 0, call.stderr); assert.match(call.stdout, /synthetic-updated-cli/);
  const third = install(f, [], env); assert.equal(third.result.data.status, 'unchanged'); assert.deepEqual(readFileSync(target), original);
  if (process.platform !== 'win32') {
    chmodSync(target, 0o600);
    const repaired = install(f, [], env); assert.equal(repaired.result.data.status, 'updated');
    assert.ok(lstatSync(target).mode & 0o100);
    const alias = join(f.directory, 'installer-alias.mjs'); symlinkSync(f.installer, alias);
    const throughAlias = install({ ...f, installer: alias }, [], env);
    assert.equal(throughAlias.status, 0, throughAlias.stderr); assert.equal(throughAlias.result.data.status, 'unchanged');
  }
});

test('registration updates only its own entry and never overwrites another command', t => {
  const f = fixture(t), initial = install(f); assert.equal(initial.status, 0, initial.stderr);
  const target = initial.result.data.commandPath, original = readFileSync(target, 'utf8'), secondSkill = join(f.directory, 'another skill');
  cpSync(f.skill, secondSkill, { recursive: true });
  const second = { ...f, installer: join(secondSkill, 'scripts/install-cli.mjs') };
  const collision = install(second); assert.equal(collision.status, 1);
  assert.match(collision.result.error.message, /Another installed skill/);
  assert.equal(readFileSync(target, 'utf8'), original);
  assert.equal(dirname(realpathSync(f.skill)), realpathSync(f.directory));
  rmSync(f.skill, { recursive: true });
  const moved = install(second);
  assert.equal(moved.status, 0, moved.stderr); assert.equal(moved.result.data.status, 'updated');
  assert.equal(moved.result.data.source, join(secondSkill, 'scripts/xrain-cli.mjs'));
  assert.equal(command(target).status, 0);
  writeFileSync(target, 'unrelated user command\n');
  const rejected = install(second); assert.equal(rejected.status, 1); assert.equal(rejected.result.error.code, 'installation_failed');
  assert.equal(readFileSync(target, 'utf8'), 'unrelated user command\n');
  assert.ok(existsSync(join(secondSkill, 'scripts/xrain-cli.mjs')));
});
