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

test('case directories reached through an ancestor link retain reads while rejecting links outside input', t => {
  const f = fixture(t), parent = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-replay-alias-'));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const alias = path.join(parent, 'case');
  fs.symlinkSync(f.root, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const options = { caseDirectory: alias };
  const read = f.run(['read', 'example.md'], options);
  assert.equal(read.code, 0); assert.equal(read.stdout, 'hello\nworld\n');
  assert.deepEqual(f.run(['list', '.'], options).finish.files, ['example.md']);
  assert.equal(f.run(['search-files', 'world', 'example.md'], options).finish.matches[0].line, 2);
  const outside = path.join(parent, 'outside');
  fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, 'secret.md'), 'outside input');
  fs.symlinkSync(outside, path.join(f.root, 'input', 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  for (const args of [['read', 'escape/secret.md'], ['search-files', 'outside', 'escape/secret.md'], ['read', '../output/trace.jsonl']]) {
    const result = f.run(args, options);
    assert.equal(result.code, 1); assert.equal(result.finish.error.code, 'OUTSIDE_INPUT');
    assert.equal(result.stdout, '');
  }
});

test('the input directory itself cannot redirect reads outside the case', t => {
  const f = fixture(t), outside = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-replay-outside-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.writeFileSync(path.join(outside, 'secret.md'), 'outside input');
  fs.rmSync(path.join(f.root, 'input'), { recursive: true });
  fs.symlinkSync(outside, path.join(f.root, 'input'), process.platform === 'win32' ? 'junction' : 'dir');
  const result = f.run(['read', 'secret.md']);
  assert.equal(result.code, 1); assert.equal(result.finish.error.code, 'OUTSIDE_INPUT');
  assert.equal(result.stdout, '');
});

test('listing exposes sizes without opening file content and hex reads retain raw and rendered receipts', t => {
  const f = fixture(t), raw = Buffer.from([0x46, 0x58, 0, 0xff, 0xfe, 0x61, 0x80]);
  fs.writeFileSync(path.join(f.root, 'input/rate.bin'), raw);
  const original = fs.openSync; let opened = 0, listed;
  try {
    fs.openSync = (file, ...args) => { if (String(file).startsWith(path.join(f.root, 'input') + path.sep)) opened++; return original(file, ...args); };
    listed = f.run(['list', '.']);
  } finally { fs.openSync = original; }
  assert.equal(opened, 0); assert.equal(listed.finish.metadataOnly, true); assert.equal(listed.finish.bytesRead, 0);
  assert.deepEqual(listed.finish.entries, [{ path: 'example.md', bytes: 12 }, { path: 'rate.bin', bytes: 7 }]);
  assert.match(listed.stderr, /File sizes \(bytes\):/); assert.equal(listed.stdout, 'example.md\nrate.bin\n');
  const read = f.run(['read-hex', 'rate.bin']);
  assert.equal(read.code, 0); assert.equal(read.stdout, raw.toString('hex')); assert.equal(read.finish.bytes, raw.length);
  assert.equal(read.finish.sha256, createHash('sha256').update(raw).digest('hex'));
  assert.equal(read.finish.outputEncoding, 'hex'); assert.equal(read.finish.outputBytes, raw.length * 2);
  assert.equal(read.finish.outputSHA256, createHash('sha256').update(read.stdout).digest('hex'));
  fs.writeFileSync(path.join(f.root, 'input/malformed.cs'), Buffer.from([0xff, 0xfe, 0x61]));
  assert.equal(f.run(['read-hex', 'malformed.cs']).stdout, 'fffe61');
});

test('explicit file-set search excludes unselected archives and deduplicates resolved paths', t => {
  const f = fixture(t), directory = path.join(f.root, 'input/project/resources');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'Rules.cs'), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('class Needle {}\n', 'utf16le')]));
  fs.writeFileSync(path.join(directory, 'Program'), 'export const Needle = 1;\n');
  fs.writeFileSync(path.join(directory, 'archive.capture'), Buffer.alloc(2 * 1024 * 1024, 0));
  const open = fs.openSync; let archiveOpened = false, result;
  try {
    fs.openSync = (file, ...args) => { if (String(file).endsWith('archive.capture')) archiveOpened = true; return open(file, ...args); };
    result = f.run(['search-files', 'Needle', 'project/resources/Rules.cs', 'project/resources/Program', 'project/resources/../resources/Rules.cs']);
  } finally { fs.openSync = open; }
  assert.equal(result.code, 0); assert.equal(archiveOpened, false); assert.equal(result.finish.files.length, 2);
  assert.deepEqual(result.finish.duplicatePaths, [{ path: 'project/resources/../resources/Rules.cs', duplicateOf: 'project/resources/Rules.cs' }]);
  assert.equal(result.events.filter(e => e.phase === 'search-file').length, 2);
  assert.equal(result.finish.matches.length, 2); assert.deepEqual(result.finish.skipped, []);
  assert.equal(result.finish.bytesRead, fs.statSync(path.join(directory, 'Rules.cs')).size + fs.statSync(path.join(directory, 'Program')).size);
  const selectedBinary = f.run(['search-files', 'Needle', 'project/resources/archive.capture']);
  assert.equal(selectedBinary.finish.skipped.length, 1); assert.equal(selectedBinary.finish.bytesRead, 8192);
});

test('match byte spans round trip through bounded reads for UTF-8 and both UTF-16 orders', t => {
  const f = fixture(t), text = '序😀\r\nclass Needle { string S = "中😀"; }\nNeedle\r';
  const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
  for (const [name, bytes, encoding] of [['source.cs', le, 'utf-16le'], ['no-extension', Buffer.from(le).swap16(), 'utf-16be'],
    ['resource.bin', Buffer.from('\ufeff' + text), 'utf-8']]) {
    fs.writeFileSync(path.join(f.root, 'input', name), bytes);
    const found = f.run(['search-files', 'Needle', name]);
    assert.equal(found.finish.matches.length, 2);
    for (const hit of found.finish.matches) {
      const raw = bytes.subarray(hit.byteOffset, hit.byteOffset + hit.byteLength);
      assert.equal(new TextDecoder(encoding, { fatal: true, ignoreBOM: true }).decode(raw), hit.text);
      const read = f.run(['read-range', name, String(hit.byteOffset), String(hit.byteLength)]);
      assert.equal(read.stdout, hit.text); assert.ok(read.finish.bytesRead <= hit.byteLength + 10);
    }
    const oldEntry = f.run(['search', name, 'Needle']);
    assert.deepEqual(oldEntry.finish.matches, found.finish.matches);
  }
});

test('file-set preflight failures read no content and later read failures retain earlier results', t => {
  const f = fixture(t);
  for (const args of [['search-files'], ['search-files', 'hello'], ['search-files', '[', 'example.md'],
    ['search-files', 'hello', 'example.md', 'missing.cs'], ['search-files', 'hello', 'example.md', '.'],
    ['search-files', 'hello', 'example.md', '../outside']]) {
    const failed = f.run(args);
    assert.equal(failed.code, 1); assert.equal(failed.finish.bytesRead ?? 0, 0);
    assert.equal(failed.events.filter(e => e.phase === 'search-file').length, 0);
  }
  fs.writeFileSync(path.join(f.root, 'input/later.cs'), 'class hello {}');
  const open = fs.openSync; let failed;
  try {
    fs.openSync = (file, ...args) => { if (String(file).endsWith('later.cs')) throw Object.assign(new Error('blocked'), { code: 'EACCES' }); return open(file, ...args); };
    failed = f.run(['search-files', 'hello', 'example.md', 'later.cs']);
  } finally { fs.openSync = open; }
  assert.equal(failed.code, 1); assert.equal(failed.finish.matches.length, 1);
  assert.equal(failed.finish.bytesRead, 12); assert.equal(failed.events.at(-2).status, 'failed');
  assert.equal(failed.events.at(-2).path, 'later.cs'); assert.equal(failed.finish.error.code, 'EACCES');
  assert.equal(f.run(['search-files', 'hello', 'example.md']).code, 0);
  assert.equal(f.run(['read-hex', 'missing']).code, 1);
});

test('file-set previews bound wide and long-line output while retaining all matches and recovery ranges', t => {
  const f = fixture(t), text = Array.from({ length: 300 }, (_, i) => `const Needle${i} = "${'中😀'.repeat(160)}";`).join('\n');
  fs.writeFileSync(path.join(f.root, 'input/large-source'), text);
  const result = f.run(['search-files', 'Needle', 'large-source']), output = JSON.parse(result.stdout);
  assert.equal(result.code, 0); assert.equal(result.finish.matches.length, 300);
  assert.equal(output.outputScope, 'preview'); assert.equal(output.matchCount, 300);
  const file = output.files[0];
  assert.equal(file.matchCount, 300); assert.equal(file.omittedMatchCount + file.matches.length, 300);
  assert.ok(file.omittedMatchCount > 0); assert.ok(Buffer.byteLength(result.stdout) < 12000);
  assert.ok(file.matches.every(hit => hit.textIsExcerpt && hit.text.length < result.finish.matches[hit.line - 1].text.length));
  assert.ok(file.matches.every(hit => !/[\ud800-\udbff]$/.test(hit.text)));
  const range = file.omittedByteRange;
  const recovered = f.run(['read-range', 'large-source', String(range.offset), String(range.length)]);
  assert.equal(recovered.code, 0); assert.match(recovered.stdout, /const Needle150 =/);
  assert.equal(file.sha256, createHash('sha256').update(text).digest('hex'));
});

test('bounded source windows cover UTF-8 and BOM UTF-16 without repeated full scans or split characters', t => {
  const f = fixture(t), directory = path.join(f.root, 'input/project/resources');
  fs.mkdirSync(directory, { recursive: true });
  const text = Array.from({ length: 900 }, (_, i) => `rule ${i}: 中文😀 with no missing source\n`).join('');
  const little = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
  for (const [name, bytes, expected] of [['source.cs', little, text],
    ['source', Buffer.from(little).swap16(), text], ['source.js', Buffer.from('\ufeff' + text), '\ufeff' + text]]) {
    fs.writeFileSync(path.join(directory, name), bytes);
    let offset = 0, rendered = '', total = 0, calls = 0;
    do {
      const original = fs.readSync; let measured = 0, result;
      try {
        fs.readSync = (fd, ...args) => { const n = original(fd, ...args); measured += n; return n; };
        result = f.run(['read-range', `project/resources/${name}`, String(offset), '4093']);
      } finally { fs.readSync = original; }
      assert.equal(result.code, 0); const receipt = result.finish;
      assert.equal(receipt.bytesRead, measured); assert.ok(measured <= 4103);
      assert.equal(receipt.bytesRead, receipt.encodingProbeBytesRead + receipt.windowBytesRead);
      assert.equal(receipt.hashScope, 'range'); assert.equal(receipt.sha256, undefined);
      assert.equal(receipt.rangeSHA256, createHash('sha256').update(bytes.subarray(receipt.rangeOffset, receipt.nextOffset)).digest('hex'));
      assert.equal(receipt.outputBytes, Buffer.byteLength(result.stdout));
      assert.equal(receipt.outputSHA256, createHash('sha256').update(result.stdout).digest('hex'));
      assert.ok(receipt.nextOffset > offset); assert.match(result.stderr, /Read range:/);
      rendered += result.stdout; offset = receipt.nextOffset; total += measured; calls++;
      if (receipt.eof) break;
    } while (offset < bytes.length);
    assert.equal(rendered, expected); assert.equal(offset, bytes.length);
    assert.ok(total <= bytes.length + calls * 10); assert.ok(calls > 8);
    const eof = f.run(['read-range', `project/resources/${name}`, String(bytes.length), '10']);
    assert.equal(eof.code, 0); assert.equal(eof.stdout, ''); assert.equal(eof.finish.eof, true);
  }
});

test('bounded ranges complete intersected Unicode characters and do not strip interior BOM characters', t => {
  const f = fixture(t), little = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('a😀\ufeffb', 'utf16le')]);
  for (const [name, bytes] of [['le.cs', little], ['be', Buffer.from(little).swap16()]]) {
    fs.writeFileSync(path.join(f.root, 'input', name), bytes);
    for (const offset of ['4', '5', '6', '7']) {
      const result = f.run(['read-range', name, offset, '1']);
      assert.equal(result.stdout, '😀'); assert.equal(result.finish.rangeOffset, 4); assert.equal(result.finish.nextOffset, 8);
    }
    assert.equal(f.run(['read-range', name, '8', '2']).stdout, '\ufeff');
  }
  fs.writeFileSync(path.join(f.root, 'input/utf8'), 'a😀b');
  for (const offset of ['1', '2', '3', '4']) assert.equal(f.run(['read-range', 'utf8', offset, '1']).stdout, '😀');
});

test('bounded read failures retain partial I/O and hashes without claiming a full-file scan', t => {
  const f = fixture(t);
  for (const args of [['read-range', 'missing', '0', '20'], ['read-range', '../outside', '0', '2'],
    ...[['-1', '2'], ['0', '0'], ['1.5', '2'], ['0', '2e3'], ['9007199254740991', '1'], ['13', '1']]
      .map(values => ['read-range', 'example.md', ...values])]) assert.equal(f.run(args).code, 1);
  for (const [name, bytes] of [['nul', Buffer.from([0, 1])], ['bad.cs', Buffer.from([0xff, 0xfe, 0x61])],
    ['bad-utf8', Buffer.from([0x61, 0xff])], ['bad-pair', Buffer.from([0xfe, 0xff, 0xd8, 0x3d])]]) {
    fs.writeFileSync(path.join(f.root, 'input', name), bytes);
    const failed = f.run(['read-range', name, '0', String(bytes.length)]);
    assert.equal(failed.code, 1); assert.equal(failed.stdout, ''); assert.equal(failed.finish.outputBytes, 0);
    assert.equal(failed.finish.hashScope, 'range'); assert.equal(failed.finish.sha256, undefined);
    assert.equal(failed.finish.rangeSHA256, createHash('sha256').update(bytes).digest('hex'));
  }
  const original = fs.readSync; let readCalls = 0, failed;
  try {
    fs.readSync = (fd, buffer, offset, length, position) => {
      if (++readCalls === 3) throw Object.assign(new Error('range read failed'), { code: 'EIO' });
      return original(fd, buffer, offset, Math.min(length, 3), position);
    };
    failed = f.run(['read-range', 'example.md', '0', '12']);
  } finally { fs.readSync = original; }
  assert.equal(failed.code, 1); assert.equal(failed.finish.error.code, 'EIO');
  assert.equal(failed.finish.bytesRead, 5); assert.equal(failed.finish.windowBytesRead, 3);
  assert.equal(failed.finish.windowSHA256, createHash('sha256').update('hel').digest('hex'));
  assert.equal(failed.finish.rangeSHA256, undefined); assert.equal(failed.stdout, '');
  const recovered = f.run(['read-range', 'example.md', '0', '12']);
  assert.equal(recovered.stdout, 'hello\nworld\n');
  const delivery = f.run(['read-range', 'example.md', '0', '5'], { stdout: { write() { throw Object.assign(new Error('closed'), { code: 'EPIPE' }); } } });
  assert.equal(delivery.code, 1); assert.equal(delivery.finish.operationExitCode, 0);
  assert.equal(delivery.finish.error.stage, 'output'); assert.equal(delivery.finish.outputBytes, 5);
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

test('replay runs existing native Node ESM and CommonJS test files without omitting consumers', t => {
  const f = fixture(t), directory = path.join(f.root, 'input/project/tests');
  fs.writeFileSync(path.join(f.root, 'input/project/package.json'), JSON.stringify({ type: 'commonjs' }));
  for (const extension of ['cjs', 'js']) fs.writeFileSync(path.join(directory, `native.test.${extension}`),
    `require('node:test')('${extension} consumer',()=>require('node:assert/strict').equal(2+2,4));`);
  fs.writeFileSync(path.join(directory, 'native.test.mjs'), "import test from 'node:test'; test('mjs consumer',()=>{});");
  const result = f.run(['test']);
  assert.equal(result.code, 0); assert.equal(result.finish.files.length, 3);
  for (const extension of ['mjs', 'js', 'cjs']) assert.match(result.stdout, new RegExp(`\\b${extension} consumer\\b`));
  fs.writeFileSync(path.join(directory, 'native.test.cjs'), "require('node:test')('cjs business failure',()=>{throw Error('counter refund violated');});");
  const failed = f.run(['test']);
  assert.equal(failed.code, 1); assert.match(failed.stdout, /counter refund violated/);
});

test('replay discovers both conventional test directories and preserves existing-directory failures', t => {
  const f = fixture(t), singular = path.join(f.root, 'input/project/test'), plural = path.join(f.root, 'input/project/tests');
  fs.rmdirSync(plural); fs.mkdirSync(singular);
  fs.writeFileSync(path.join(singular, 'business.test.cjs'), "require('node:test')('singular business',()=>{});");
  const single = f.run(['test']);
  assert.equal(single.code, 0); assert.deepEqual(single.finish.files, ['project/test/business.test.cjs']);
  assert.deepEqual(single.finish.missingTestDirectories, ['project/tests']);
  fs.mkdirSync(plural);
  fs.writeFileSync(path.join(plural, 'adjacent.test.mjs'), "import test from 'node:test'; test('plural business',()=>{});");
  const both = f.run(['test']);
  assert.equal(both.code, 0); assert.equal(both.finish.files.length, 2);
  assert.deepEqual(both.finish.testDirectories, ['project/tests', 'project/test']);
  assert.deepEqual(both.finish.missingTestDirectories, []);
  const original = fs.lstatSync; let denied;
  try {
    fs.lstatSync = (file, ...args) => {
      if (file === singular) throw Object.assign(new Error('test directory denied'), { code: 'EACCES' });
      return original(file, ...args);
    };
    denied = f.run(['test']);
  } finally { fs.lstatSync = original; }
  assert.equal(denied.code, 1); assert.equal(denied.finish.error.code, 'EACCES');
  assert.deepEqual(denied.finish.files, ['project/tests/adjacent.test.mjs']);
  assert.equal(denied.finish.stdout, undefined);
});

test('search finds source text regardless of extension and exposes skipped non-text files', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, 'input/Program.cs'), 'class PermissionSetItem {}\n');
  fs.writeFileSync(path.join(f.root, 'input/contract'), 'PermissionSetItem\n');
  fs.writeFileSync(path.join(f.root, 'input/data.bin'), Buffer.from([0, 1, 2]));
  fs.writeFileSync(path.join(f.root, 'input/legacy.txt'), Buffer.from([0xff, 0xfe, 0x61]));
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

test('BOM UTF-16 source reads and searches preserve raw receipts and decoded source across chunk boundaries', t => {
  const f = fixture(t);
  const directory = path.join(f.root, 'input/project/resources');
  fs.mkdirSync(directory, { recursive: true });
  let text = '//' + 'x'.repeat(4092) + '😀\n//';
  text += 'y'.repeat(36862 - text.length) + '😀\nclass TailRule { string Note = "中文"; }\n';
  const little = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
  for (const [name, encoding, bytes] of [['Rules.cs', 'utf-16le', little],
    ['RuleSource', 'utf-16be', Buffer.from(little).swap16()]]) {
    const relative = `project/resources/${name}`, file = path.join(f.root, 'input', relative);
    fs.writeFileSync(file, bytes);
    const read = f.run(['read', relative]);
    assert.equal(read.stdout, text); assert.equal(read.finish.encoding, encoding);
    assert.equal(read.finish.bytes, bytes.length);
    assert.equal(read.finish.sha256, createHash('sha256').update(bytes).digest('hex'));
    assert.equal(read.finish.outputBytes, Buffer.byteLength(text));
    assert.equal(read.finish.outputSHA256, createHash('sha256').update(text).digest('hex'));
    const open = fs.openSync, close = fs.closeSync, readSync = fs.readSync, descriptors = new Set();
    let measured = 0, result;
    try {
      fs.openSync = (target, ...args) => { const fd = open(target, ...args); if (target === file) descriptors.add(fd); return fd; };
      fs.closeSync = fd => { descriptors.delete(fd); return close(fd); };
      fs.readSync = (fd, ...args) => { const count = readSync(fd, ...args); if (descriptors.has(fd)) measured += count; return count; };
      result = f.run(['search', relative, 'TailRule|😀']);
    } finally { fs.openSync = open; fs.closeSync = close; fs.readSync = readSync; }
    assert.equal(result.code, 0); assert.equal(result.finish.bytesRead, measured);
    assert.equal(measured, bytes.length); assert.deepEqual(result.finish.skipped, []);
    assert.deepEqual(result.finish.matches.map(hit => [hit.line, hit.text]),
      text.trimEnd().split('\n').map((line, index) => [index + 1, line]));
    assert.equal(result.events[1].encoding, encoding);
    assert.equal(result.events[1].sha256, read.finish.sha256);
  }
});

test('UTF-16 BOM detection tolerates short reads and accepts an empty BOM-marked text file', t => {
  const f = fixture(t), file = path.join(f.root, 'input/Short.cs');
  const bytes = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('class ShortRead {}\n', 'utf16le')]);
  fs.writeFileSync(file, bytes);
  const original = fs.readSync;
  let result;
  try {
    fs.readSync = (fd, buffer, offset, length, position) => original(fd, buffer, offset, Math.min(length, 1), position);
    result = f.run(['search', 'Short.cs', 'ShortRead']);
  } finally { fs.readSync = original; }
  assert.equal(result.code, 0); assert.equal(result.finish.matches[0].text, 'class ShortRead {}');
  assert.equal(result.finish.bytesRead, bytes.length); assert.deepEqual(result.finish.skipped, []);
  fs.writeFileSync(path.join(f.root, 'input/EmptySource'), Buffer.from([0xfe, 0xff]));
  const empty = f.run(['search', 'EmptySource', 'absent']);
  assert.deepEqual(empty.finish.skipped, []); assert.equal(empty.events[1].bytesRead, 2);
  assert.equal(f.run(['read', 'EmptySource']).stdout, '');
});

test('malformed or NUL-containing UTF-16 stays skipped and failed decoding cannot emit unreadable bytes', t => {
  const f = fixture(t);
  for (const [name, bytes] of [['odd.cs', Buffer.from([0xff, 0xfe, 0x61])],
    ['surrogate.cs', Buffer.from([0xfe, 0xff, 0xd8, 0x3d])],
    ['nul.bin', Buffer.from([0xff, 0xfe, 0, 0])]]) {
    fs.writeFileSync(path.join(f.root, 'input', name), bytes);
    const search = f.run(['search', name, '.']);
    assert.equal(search.code, 0); assert.deepEqual(search.finish.matches, []);
    assert.equal(search.finish.skipped[0].hashScope, 'full');
    assert.equal(search.finish.skipped[0].sha256, createHash('sha256').update(bytes).digest('hex'));
  }
  const failed = f.run(['read', 'odd.cs']);
  assert.equal(failed.code, 1); assert.equal(failed.stdout, '');
  assert.equal(failed.finish.bytes, 3); assert.equal(failed.finish.outputBytes, 0);
  assert.equal(failed.finish.encoding, 'utf-16le'); assert.ok(failed.finish.error);
  const prefix = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('x'.repeat(40000), 'utf16le')]);
  const binary = Buffer.concat([prefix, Buffer.from([0, 0]), Buffer.alloc(1024 * 1024)]);
  fs.writeFileSync(path.join(f.root, 'input/late.bin'), binary);
  const late = f.run(['search', 'late.bin', 'x']);
  const skip = late.finish.skipped[0];
  assert.equal(skip.hashScope, 'prefix'); assert.equal(skip.encoding, 'utf-16le');
  assert.ok(skip.bytesRead < binary.length); assert.equal(skip.sha256, undefined);
  assert.equal(skip.sampleSHA256, createHash('sha256').update(binary.subarray(0, skip.bytesRead)).digest('hex'));
  assert.equal(f.run(['read', 'example.md']).code, 0);
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
