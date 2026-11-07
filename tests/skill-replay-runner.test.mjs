import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
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

test('search finds source text regardless of extension and exposes skipped non-text files', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, 'input/Program.cs'), 'class PermissionSetItem {}\n');
  fs.writeFileSync(path.join(f.root, 'input/contract'), 'PermissionSetItem\n');
  fs.writeFileSync(path.join(f.root, 'input/data.bin'), Buffer.from([0, 1, 2]));
  fs.writeFileSync(path.join(f.root, 'input/legacy.txt'), Buffer.from([0xff, 0xfe]));
  const direct = f.run(['search', 'Program.cs', 'PermissionSetItem']);
  assert.equal(direct.finish.matches.length, 1);
  assert.equal(direct.finish.matches[0].line, 1);
  assert.equal(direct.events[1].path, 'Program.cs');
  assert.deepEqual(direct.finish.skipped, []);
  const directory = f.run(['search', '.', 'PermissionSetItem']);
  assert.deepEqual(directory.finish.matches.map(hit => hit.path).sort(), ['Program.cs', 'contract']);
  assert.deepEqual(directory.finish.skipped.map(item => item.path).sort(), ['data.bin', 'legacy.txt']);
  assert.equal(directory.events.filter(event => event.phase === 'search-file').length, 5);
  assert.match(directory.stderr, /Search skipped non-text files/);
  const binary = f.run(['search', 'data.bin', 'absent']);
  assert.match(binary.stderr, /data.bin/);
  assert.equal(binary.events[1].skipped, true);
  assert.equal(binary.finish.skipped.length, 1);
});

test('search bounds binary probes without excluding source text or splitting valid UTF-8', t => {
  const f = fixture(t), binary = path.join(f.root, 'input/large.blob');
  const descriptor = fs.openSync(binary, 'w');
  fs.writeSync(descriptor, Buffer.from([0, 1, 2]));
  fs.ftruncateSync(descriptor, 8 * 1024 * 1024); fs.closeSync(descriptor);
  // Four-byte characters cross both the probe and next chunk boundary.
  const source = 'a'.repeat(8191) + '😀' + 'b'.repeat(65532) + '😀\nclass TailNeedle {}\n';
  fs.writeFileSync(path.join(f.root, 'input/Program.cs'), source);
  fs.writeFileSync(path.join(f.root, 'input/text.png'), 'TailNeedle\n');
  fs.writeFileSync(path.join(f.root, 'input/contract'), 'TailNeedle\n');
  const originalOpen = fs.openSync, originalRead = fs.readSync, originalReadFile = fs.readFileSync, originalClose = fs.closeSync;
  const descriptors = new Set(); let observedBinaryBytes = 0;
  t.mock.method(fs, 'openSync', function(file, ...args) {
    const fd = originalOpen.call(this, file, ...args);
    if (file === binary) descriptors.add(fd);
    return fd;
  });
  t.mock.method(fs, 'readSync', function(fd, ...args) {
    const count = originalRead.call(this, fd, ...args);
    if (descriptors.has(fd)) observedBinaryBytes += count;
    return count;
  });
  t.mock.method(fs, 'closeSync', function(fd) {
    descriptors.delete(fd);
    return originalClose.call(this, fd);
  });
  t.mock.method(fs, 'readFileSync', function(file, ...args) {
    assert.notEqual(file, binary, 'Do not read the entire binary just to skip it');
    return originalReadFile.call(this, file, ...args);
  });
  const result = f.run(['search', '.', 'TailNeedle']);
  assert.equal(result.code, 0);
  assert.deepEqual(result.finish.matches.map(hit => hit.path).sort(), ['Program.cs', 'contract', 'text.png']);
  const skipped = result.events.find(e => e.path === 'large.blob' && e.phase === 'search-file');
  assert.equal(skipped.skipped, true); assert.equal(skipped.hashScope, 'prefix');
  assert.equal(skipped.bytes, 8 * 1024 * 1024);
  assert.equal(skipped.bytesRead, 8192); assert.equal(observedBinaryBytes, 8192);
  assert.equal(skipped.sampleBytes, 8192); assert.match(skipped.sampleSHA256, /^[a-f0-9]{64}$/);
  const expectedPrefix = Buffer.alloc(8192); expectedPrefix[1] = 1; expectedPrefix[2] = 2;
  assert.equal(skipped.sampleSHA256, createHash('sha256').update(expectedPrefix).digest('hex'));
  assert.equal(Object.hasOwn(skipped, 'sha256'), false);
  const searched = result.events.find(e => e.path === 'Program.cs' && e.phase === 'search-file');
  assert.equal(searched.bytesRead, Buffer.byteLength(source));
  assert.equal(searched.sha256, createHash('sha256').update(source).digest('hex'));
  assert.equal(result.finish.bytesRead, result.events.filter(e => e.phase === 'search-file').reduce((sum, e) => sum + e.bytesRead, 0));
});

test('a text-looking prefix cannot hide late NUL or malformed UTF-8, and empty text stays searchable', t => {
  const f = fixture(t), prefix = Buffer.from('Needle\n' + 'a'.repeat(9000));
  for (const [name, tail] of [['late.cs', Buffer.from([0])], ['late-utf8', Buffer.from([0xff])],
    ['truncated.cs', Buffer.from([0xe2, 0x82])]]) {
    const bytes = Buffer.concat([prefix, tail]);
    fs.writeFileSync(path.join(f.root, 'input', name), bytes);
    const result = f.run(['search', name, 'Needle']);
    assert.equal(result.code, 0); assert.deepEqual(result.finish.matches, []);
    const skipped = result.events[1];
    assert.equal(skipped.skipped, true); assert.equal(skipped.hashScope, 'full');
    assert.equal(skipped.bytesRead, bytes.length);
    assert.equal(skipped.sha256, createHash('sha256').update(bytes).digest('hex'));
  }
  fs.writeFileSync(path.join(f.root, 'input/empty.cs'), '');
  const empty = f.run(['search', 'empty.cs', 'Needle']);
  assert.equal(empty.code, 0); assert.deepEqual(empty.finish.skipped, []);
  assert.equal(empty.events[1].bytesRead, 0); assert.deepEqual(empty.finish.matches, []);
  // An ASCII-looking header must not force reading a large binary tail either.
  const lateLarge = path.join(f.root, 'input/late-large');
  const fd = fs.openSync(lateLarge, 'w');
  fs.writeSync(fd, Buffer.concat([prefix, Buffer.from([0])]));
  fs.ftruncateSync(fd, 8 * 1024 * 1024); fs.closeSync(fd);
  const stopped = f.run(['search', 'late-large', 'Needle']);
  assert.equal(stopped.code, 0); assert.deepEqual(stopped.finish.matches, []);
  assert.equal(stopped.events[1].hashScope, 'prefix');
  assert.equal(stopped.events[1].bytesRead, 8192 + 65536);
  assert.equal(stopped.events[1].sampleBytes, stopped.events[1].bytesRead);
});

test('search open and mid-read failures retain prior matches, failed paths and measured reads', t => {
  const f = fixture(t), failed = path.join(f.root, 'input/b.cs');
  fs.writeFileSync(path.join(f.root, 'input/a.cs'), 'Needle\n');
  fs.writeFileSync(failed, 'a'.repeat(20000));
  const originalOpen = fs.openSync, originalRead = fs.readSync, originalClose = fs.closeSync;
  let mode = 'open', targetDescriptor, targetRead = 0, closed = false;
  t.mock.method(fs, 'openSync', function(file, ...args) {
    if (file === failed && mode === 'open') throw Object.assign(new Error('fixture denied'), { code: 'EACCES' });
    const fd = originalOpen.call(this, file, ...args); if (file === failed) targetDescriptor = fd; return fd;
  });
  t.mock.method(fs, 'readSync', function(fd, ...args) {
    if (fd === targetDescriptor && targetRead++) throw Object.assign(new Error('fixture read error'), { code: 'EIO' });
    return originalRead.call(this, fd, ...args);
  });
  t.mock.method(fs, 'closeSync', function(fd) {
    if (fd === targetDescriptor) closed = true;
    return originalClose.call(this, fd);
  });
  for (const [currentMode, expectedCode, bytesRead] of [['open', 'EACCES', 0], ['read', 'EIO', 8192]]) {
    mode = currentMode;
    const result = f.run(['search', '.', 'Needle']);
    assert.equal(result.code, 1); assert.equal(result.finish.error.code, expectedCode);
    assert.equal(result.finish.matches[0].path, 'a.cs');
    const progress = result.events.find(e => e.phase === 'search-file' && e.path === 'b.cs');
    assert.equal(progress.status, 'failed'); assert.equal(progress.error.code, expectedCode);
    assert.equal(progress.bytesRead, bytesRead); assert.equal(Object.hasOwn(progress, 'sha256'), false);
    assert.match(result.stderr, new RegExp(expectedCode));
  }
  assert.equal(closed, true);
});

test('failed skip disclosure keeps the binary probe and failed output receipt', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, 'input/binary'), Buffer.alloc(100000));
  const result = f.run(['search', 'binary', 'absent'], { stderr: { write() {
    throw Object.assign(new Error('fixture closed output'), { code: 'EPIPE' });
  } } });
  assert.equal(result.code, 1); assert.equal(result.finish.operationExitCode, 0);
  assert.equal(result.finish.error.stage, 'output'); assert.equal(result.finish.error.code, 'EPIPE');
  assert.equal(result.finish.skipped[0].hashScope, 'prefix');
  assert.equal(result.events[1].bytesRead, 8192);
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
