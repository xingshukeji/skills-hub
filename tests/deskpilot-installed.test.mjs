import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const python = process.env.DESKPILOT_TEST_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
function run(args, cwd, env = {}, input = '') {
  return new Promise((done, reject) => {
    const child = spawn(python, ['-I', '-S', '-B', ...args], { cwd, env: { ...process.env, ...env,
      PYTHONPATH: '', PYTHONHOME: '', PYTHONDONTWRITEBYTECODE: '1', PYTHONIOENCODING: 'utf-8' }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timeout = setTimeout(() => child.kill(), 90000);
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr += data; });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
    child.on('error', error => { clearTimeout(timeout); reject(error); });
    child.on('close', code => { clearTimeout(timeout); done({ code, stdout, stderr }); });
  });
}

test('complete DeskPilot Skill builds alone, preserves failures and removes only owned files', { timeout: 240000 }, async t => {
  const temporary = await mkdtemp(join(tmpdir(), 'DeskPilot installed '));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const skill = join(temporary, 'read only skill with spaces');
  const state = join(temporary, 'runtime state');
  const bin = join(temporary, 'commands');
  const home = join(temporary, 'home');
  await mkdir(home);
  await cp(join(root, 'skills/shzw-deskpilot-cli'), skill, { recursive: true });
  const installer = join(skill, 'scripts/install.py');
  const environment = { HOME: home, USERPROFILE: home, SHELL: '/bin/bash' };
  // Patch the PATH writer in this child only. Test real shell writes in an isolated HOME;
  // the Windows registry writer is tested separately and never changed by repository checks.
  const invoke = (extra = []) => run(['-c',
    'import runpy,sys; n=runpy.run_path(sys.argv[1]); n["main"].__globals__["configure_path"]=lambda *a,**k:{"kind":"test","added":False}; sys.exit(n["main"](sys.argv[2:]))',
    installer, '--state-dir', state, '--bin-dir', bin, '--json', ...extra], temporary, environment);
  const built = await invoke();
  assert.equal(built.code, 0, built.stdout + built.stderr);
  const first = JSON.parse(built.stdout).data;
  assert.equal(first.status, 'built');
  assert.equal((await run([first.application, '--help'], temporary, environment)).code, 0);
  const doctor = await run([first.application, 'doctor'], temporary, environment);
  assert.equal(doctor.code, 0, doctor.stdout + doctor.stderr);
  assert.equal(JSON.parse(doctor.stdout).result.desktop_text.available, true);
  const stream = await run([first.application, 'exec'], temporary, environment,
    '{"id":"hello","method":"capabilities"}\n{"id":"bad","method":"missing"}\n{"id":"end","method":"close"}\n');
  assert.equal(stream.code, 0, stream.stdout + stream.stderr);
  const replies = stream.stdout.trim().split(/\r?\n/).map(row => JSON.parse(row));
  assert.deepEqual(replies.map(item => item.id), ['hello', 'bad', 'end']);
  assert.equal(replies[1].error.code, 'UNKNOWN_METHOD');
  assert.equal(JSON.parse((await invoke()).stdout).data.status, 'unchanged');
  const entryBefore = await readFile(first.command_path);
  const source = join(skill, 'scripts/deskpilot/__init__.py');
  const original = await readFile(source);
  await writeFile(source, Buffer.concat([original, Buffer.from('\n# stale bundled source\n')]));
  const failed = await invoke();
  assert.equal(failed.code, 1);
  assert.equal(JSON.parse(failed.stdout).error.code, 'SKILL_INCOMPLETE');
  assert.deepEqual(await readFile(first.command_path), entryBefore);
  assert.equal((await run([first.application, 'capabilities'], temporary, environment)).code, 0);
  await writeFile(source, original);
  const otherState = join(temporary, 'other runtime');
  const conflict = await run([installer, '--state-dir', otherState, '--bin-dir', bin, '--json'], temporary, environment);
  assert.equal(conflict.code, 1);
  assert.equal(JSON.parse(conflict.stdout).error.code, 'COMMAND_CONFLICT');
  assert.deepEqual(await readFile(first.command_path), entryBefore);
  await writeFile(join(bin, 'unrelated-command'), 'keep');
  const uninstalled = await invoke(['--uninstall']);
  assert.equal(uninstalled.code, 0, uninstalled.stdout);
  assert.equal(await readFile(join(bin, 'unrelated-command'), 'utf8'), 'keep');
});

test('DeskPilot protocol and installer focused tests', { timeout: 120000 }, async () => {
  const result = await run(['-m', 'unittest', 'discover', '-s', join(root, 'src/deskpilot-cli/tests'), '-p', 'test_*.py'], root);
  assert.equal(result.code, 0, result.stdout + result.stderr);
});
