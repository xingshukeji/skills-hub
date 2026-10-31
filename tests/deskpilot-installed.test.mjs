import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const python = process.env.DESKPILOT_TEST_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
function run(args, cwd, env = {}, input = '', interpreter = python) {
  return new Promise((done, reject) => {
    const child = spawn(interpreter, ['-I', '-S', '-B', ...args], { cwd, env: { ...process.env, ...env,
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
  const temporary = await realpath(await mkdtemp(join(tmpdir(), 'DeskPilot installed ')));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const skill = join(temporary, 'read only skill with spaces');
  const state = join(temporary, 'runtime state');
  const bin = join(temporary, 'commands');
  const home = join(temporary, 'home');
  await mkdir(home);
  const interpreter = spawnSync(python, ['-I', '-S', '-c', 'import sys; print(sys.executable)'],
    { encoding: 'utf8', windowsHide: true });
  assert.equal(interpreter.status, 0, interpreter.stdout + interpreter.stderr);
  const isolatedPython = interpreter.stdout.trim();
  await cp(join(root, 'skills/shzw-deskpilot-cli'), skill, { recursive: true });
  const installer = join(skill, 'scripts/install.py');
  // The user's installed command is outside this fixture. Use the resolved interpreter
  // with a child-only PATH, then exercise an explicit foreign-command conflict below.
  const pathKey = Object.keys(process.env).find(key => key.toLowerCase() === 'path') ?? 'PATH';
  const systemPaths = process.platform === 'win32'
    ? [join(process.env.SystemRoot ?? 'C:/Windows', 'System32'), process.env.SystemRoot ?? 'C:/Windows']
    : ['/usr/bin', '/bin'];
  const environment = { HOME: home, USERPROFILE: home, SHELL: '/bin/bash',
    [pathKey]: [bin, ...systemPaths].join(delimiter) };
  const runInstalled = (args, input = '') => run(args, temporary, environment, input, isolatedPython);
  // Patch the PATH writer in this child only. Test real shell writes in an isolated HOME;
  // the Windows registry writer is tested separately and never changed by repository checks.
  const invoke = (extra = [], childEnvironment = environment) => run(['-c',
    'import runpy,sys; n=runpy.run_path(sys.argv[1]); n["main"].__globals__["configure_path"]=lambda *a,**k:{"kind":"test","added":False}; sys.exit(n["main"](sys.argv[2:]))',
    installer, '--state-dir', state, '--bin-dir', bin, '--json', ...extra], temporary,
    childEnvironment, '', isolatedPython);
  const built = await invoke();
  assert.equal(built.code, 0, built.stdout + built.stderr);
  const first = JSON.parse(built.stdout).data;
  assert.equal(first.status, 'built');
  assert.equal((await runInstalled([first.application, '--help'])).code, 0);
  const doctor = await runInstalled([first.application, 'doctor']);
  assert.equal(doctor.code, 0, doctor.stdout + doctor.stderr);
  assert.equal(JSON.parse(doctor.stdout).result.desktop_text.available, true);
  const stream = await runInstalled([first.application, 'exec'],
    '{"id":"hello","method":"capabilities"}\n{"id":"bad","method":"missing"}\n{"id":"end","method":"close"}\n');
  assert.equal(stream.code, 0, stream.stdout + stream.stderr);
  const replies = stream.stdout.trim().split(/\r?\n/).map(row => JSON.parse(row));
  assert.deepEqual(replies.map(item => item.id), ['hello', 'bad', 'end']);
  assert.equal(replies[1].error.code, 'UNKNOWN_METHOD');
  const repeated = await invoke();
  assert.equal(repeated.code, 0, repeated.stdout + repeated.stderr);
  assert.equal(JSON.parse(repeated.stdout).data.status, 'unchanged');
  const entryBefore = await readFile(first.command_path);
  const foreignBin = join(temporary, 'foreign commands');
  await mkdir(foreignBin);
  const foreignCommand = join(foreignBin, process.platform === 'win32' ? 'deskpilot.cmd' : 'deskpilot');
  const foreignContent = process.platform === 'win32' ? '@exit /b 17\r\n' : '#!/bin/sh\nexit 17\n';
  await writeFile(foreignCommand, foreignContent, { mode: 0o755 });
  const shadowed = await invoke([], { ...environment, [pathKey]: [foreignBin, environment[pathKey]].join(delimiter) });
  assert.equal(shadowed.code, 1);
  const shadowError = JSON.parse(shadowed.stdout).error;
  assert.equal(shadowError.code, 'COMMAND_CONFLICT');
  assert.equal(await realpath(JSON.parse(shadowed.stdout).data.existing_command), await realpath(foreignCommand));
  assert.equal(await readFile(foreignCommand, 'utf8'), foreignContent);
  assert.deepEqual(await readFile(first.command_path), entryBefore);
  const source = join(skill, 'scripts/deskpilot/__init__.py');
  const original = await readFile(source);
  await writeFile(source, Buffer.concat([original, Buffer.from('\n# stale bundled source\n')]));
  const failed = await invoke();
  assert.equal(failed.code, 1);
  assert.equal(JSON.parse(failed.stdout).error.code, 'SKILL_INCOMPLETE');
  assert.deepEqual(await readFile(first.command_path), entryBefore);
  assert.equal((await runInstalled([first.application, 'capabilities'])).code, 0);
  await writeFile(source, original);
  const otherState = join(temporary, 'other runtime');
  const conflict = await runInstalled([installer, '--state-dir', otherState, '--bin-dir', bin, '--json']);
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
