import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runReplay, inspectReplayTrace } from '../tools/skill-replay-runner.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-replay-trace-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'input/project/tests'), { recursive: true });
  fs.mkdirSync(path.join(root, 'output'));
  fs.writeFileSync(path.join(root, 'input/example.md'), 'hello\nworld\n');
  const run = (args, extra = {}) => {
    let stdout = '', stderr = '';
    const code = runReplay({ caseDirectory: root, args,
      stdout: { write: value => { stdout += value; } }, stderr: { write: value => { stderr += value; } }, ...extra });
    const events = fs.readFileSync(path.join(root, 'output/trace.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    const start = events.findLast(event => event.phase === 'start');
    const invocation = events.filter(event => event.invocationId === start.invocationId);
    assert.equal(invocation.filter(event => event.phase === 'start').length, 1);
    assert.equal(invocation.filter(event => event.phase === 'finish').length, 1);
    assert.deepEqual(start.args, args);
    assert.equal(invocation.at(-1).exitCode, code);
    assert.equal(inspectReplayTrace(invocation).complete, true);
    return { code, stdout, stderr, events: invocation, finish: invocation.at(-1) };
  };
  return { root, run };
}

test('replay journals invalid operations, missing arguments, wrong search order, regex and filesystem failures', t => {
  const f = fixture(t);
  for (const args of [[], ['unknown'], ['read'], ['test', 'extra'], ['search', 'example.md'],
    ['read', 'missing.md'], ['list', 'missing'], ['search', 'needle', 'example.md'],
    ['search', 'example.md', '['], ['read', '../outside.md']]) {
    const result = f.run(args);
    assert.equal(result.code, 1, JSON.stringify(args));
    assert.equal(result.finish.status, 'failed');
    assert.ok(result.finish.error.message);
    assert.ok(result.stderr);
  }
});

test('read, list and search retain actual hashes, returned content and per-file search progress', t => {
  const f = fixture(t);
  const read = f.run(['read', 'example.md']);
  assert.equal(read.stdout, 'hello\nworld\n'); assert.equal(read.finish.bytes, 12);
  assert.match(read.finish.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(f.run(['list', '.']).finish.files, ['example.md']);
  const search = f.run(['search', '.', 'world']);
  assert.equal(search.finish.matches[0].line, 2);
  assert.equal(search.events[1].phase, 'search-file');
  assert.equal(search.events[1].sha256, read.finish.sha256);
  assert.equal(f.run(['search', '.', 'absent']).finish.matches.length, 0);
});

test('test refusal, failing assertions and spawn failure cannot be recorded as successful execution', t => {
  const f = fixture(t);
  assert.equal(f.run(['test']).finish.error.code, 'NO_TESTS');
  const file = path.join(f.root, 'input/project/tests/example.test.mjs');
  fs.writeFileSync(file, "import test from 'node:test'; test('intentional fixture failure',()=>{throw Error('expected fixture failure');});");
  const failed = f.run(['test']);
  assert.equal(failed.finish.status, 'failed'); assert.notEqual(failed.code, 0);
  assert.match(failed.finish.stdout, /expected fixture failure/);
  const spawn = f.run(['test'], { nodeExecutable: path.join(f.root, 'missing-node') });
  assert.equal(spawn.finish.status, 'failed'); assert.equal(spawn.finish.error.code, 'ENOENT');
  fs.writeFileSync(file, "import test from 'node:test'; test('success',()=>{});");
  assert.equal(f.run(['test']).finish.status, 'succeeded');
});

test('unavailable journal refuses to run rather than silently losing the attempt', t => {
  const f = fixture(t);
  fs.rmSync(path.join(f.root, 'output'), { recursive: true });
  let stdout = '', stderr = '';
  const code = runReplay({ caseDirectory: f.root, args: ['read', 'example.md'],
    stdout: { write: value => { stdout += value; } }, stderr: { write: value => { stderr += value; } } });
  assert.equal(code, 1); assert.equal(stdout, ''); assert.match(stderr, /operation not executed/);
});

test('an output delivery failure cannot leave a successful completion in the journal', t => {
  const f = fixture(t);
  for (const key of ['stdout', 'stderr']) {
    const throwing = { write() { throw Object.assign(new Error('closed output'), { code: 'EPIPE' }); } };
    const result = f.run(key === 'stdout' ? ['read', 'example.md'] : ['read', 'missing.md'], { [key]: throwing });
    assert.equal(result.code, 1);
    assert.equal(result.finish.status, 'failed');
    assert.equal(result.finish.error.stage, 'output');
    assert.equal(result.finish.error.code, 'EPIPE');
    assert.equal(result.finish.operationExitCode, key === 'stdout' ? 0 : 1);
    if (key === 'stderr') assert.equal(result.finish.operationError.code, 'ENOENT');
  }
});

test('an interrupted start is incomplete; malformed or contradictory completions are rejected', () => {
  const start = { schemaVersion: 2, invocationId: 'one', phase: 'start', op: 'read', args: ['read', 'example.md'] };
  assert.equal(inspectReplayTrace([start]).complete, false);
  assert.equal(inspectReplayTrace([start]).invocations[0].finish, null);
  assert.throws(() => inspectReplayTrace([start, start]), /Duplicate/);
  const finish = { schemaVersion: 2, invocationId: 'one', phase: 'finish', exitCode: 1, status: 'succeeded' };
  assert.throws(() => inspectReplayTrace([start, finish]), /disagree/);
  assert.throws(() => inspectReplayTrace([{ ...finish, status: 'failed' }]), /outside/);
});
