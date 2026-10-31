import test from 'node:test';
import assert from 'node:assert/strict';
import fs, { existsSync, readFileSync, readdirSync, writeFileSync, openSync, closeSync, ftruncateSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { Readable } from 'node:stream';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { once } from 'node:events';
import { gzipSync } from 'node:zlib';
import { fixture, mockServer, respond, zip, PACKAGE_ID, VERSION_ID } from './helpers.mjs';
import { sha256 } from '../src/xrain-cli/core.mjs';
import { readManifestFile } from '../src/xrain-cli/archive.mjs';

const json = value => JSON.parse(value.stdout);
function login(f, url) {
  f.store.save({ activeProfile: 'Demo', profiles: { Demo: { server: url, runtime: url, tenant: 'TEN' } } });
  f.store.saveSession('Demo', url, 'TEN', 'member-session', Date.now() + 300000);
}
function request(f, value = {}) { const file = join(f.directory, 'request.json'); writeFileSync(file, JSON.stringify(value)); return file; }
const rawArgs = (input, out) => ['security', 'api-debug', '--auth', 'session', '--request-json', input, '--out', out, '--json'];

test('raw file output streams beyond the JSON budget, retains HTTP errors, and refuses overwrite before any effect', async t => {
  const f = fixture(t), chunk = Buffer.alloc(512 * 1024, 65), size = 40 * 1024 * 1024;
  let mode = 'length';
  const service = await mockServer(t, async (hit, response) => {
    assert.equal(hit.headers['accept-encoding'], 'identity');
    if (mode === 'denied') return respond(response, { error: { code: 'native.forbidden' } }, 403);
    if (mode === 'gzip') {
      const bytes = gzipSync(Buffer.from('decoded original response'));
      response.writeHead(200, { 'content-type': 'text/plain', 'content-encoding': 'gzip', 'content-length': bytes.length }); return response.end(bytes);
    }
    response.writeHead(200, { 'content-type': 'application/octet-stream', ...(mode === 'length' ? { 'content-length': size } : {}) });
    for (let sent = 0; sent < size; sent += chunk.length) if (!response.write(chunk)) await once(response, 'drain');
    response.end();
  });
  login(f, service.url); const input = request(f);
  for (mode of ['length', 'chunked']) {
    const out = join(f.directory, mode + '.bin'), result = await f.run(rawArgs(input, out));
    assert.equal(result.code, 0, result.stdout); assert.equal(json(result).data.bytes, size); assert.equal(fs.statSync(out).size, size);
    const before = service.hits.length;
    assert.equal(json(await f.run(rawArgs(input, out))).error.code, 'output_exists'); assert.equal(service.hits.length, before);
  }
  mode = 'gzip'; const compressedOut = join(f.directory, 'decoded.txt');
  assert.equal((await f.run(rawArgs(input, compressedOut))).code, 0); assert.equal(readFileSync(compressedOut, 'utf8'), 'decoded original response');
  mode = 'denied'; const deniedOut = join(f.directory, 'denied.json'), denied = json(await f.run(rawArgs(input, deniedOut)));
  assert.equal(denied.error.code, 'permission_denied'); assert.equal(denied.error.serverCode, 'native.forbidden');
  assert.equal(JSON.parse(readFileSync(deniedOut)).error.code, 'native.forbidden');
});

test('interrupted, cancelled and locally failed raw output cleans only the owned file and never replays a request', async t => {
  const f = fixture(t); let mode = 'disconnect', activeOutput;
  const service = await mockServer(t, async (_hit, response) => {
    response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': '1000000' }); response.write('partial');
    if (mode === 'disconnect') setTimeout(() => response.destroy(), 10);
    if (mode === 'cancel') setTimeout(() => process.emit('SIGINT'), 20);
    if (mode === 'local') response.end(Buffer.alloc(999993));
    if (mode === 'replace') {
      await new Promise(resolve => setTimeout(resolve, 20));
      fs.renameSync(activeOutput, activeOutput + '.moved'); writeFileSync(activeOutput, 'other owner'); process.emit('SIGINT');
    }
  });
  login(f, service.url); const input = request(f);
  for (mode of ['disconnect', 'cancel', 'local', 'replace']) {
    const out = join(f.directory, mode + '.bin'), originalWrite = fs.writeSync;
    activeOutput = out;
    if (mode === 'local') { fs.writeSync = () => { throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); }; syncBuiltinESMExports(); }
    try {
      const result = await f.run(rawArgs(input, out));
      assert.equal(result.code, 1, result.stdout);
      assert.equal(json(result).error.code, mode === 'local' ? 'output_write_failed' : 'outcome_unknown');
      if (mode === 'replace') assert.equal(readFileSync(out, 'utf8'), 'other owner'); else assert.equal(existsSync(out), false);
    } finally { fs.writeSync = originalWrite; syncBuiltinESMExports(); }
  }
  assert.equal(service.hits.length, 4);
  assert.equal(readdirSync(f.directory).some(name => name.endsWith('.part')), false);
});

async function conversation(t) {
  const f = fixture(t), inputs = [], responses = []; let stream, failed = false;
  const event = (type, seq, data) => ({ type: 'event', event: { type, seq, data } });
  const emit = value => stream.write(`data: ${JSON.stringify(value)}\n\n`);
  const service = await mockServer(t, (hit, response) => {
    if (hit.url.endsWith('/stream')) { stream = response; response.writeHead(200, { 'content-type': 'text/event-stream' }); emit({ type: 'snapshot', records: [], hasMore: false }); return; }
    if (hit.url.endsWith('/inputs')) {
      const body = hit.json(); inputs.push(body); respond(response, { accepted: true }, 202);
      emit(event('turn/start', 1, { turn: 1 }));
      emit(event('user/message', 2, { source: { kind: 'user', rpcId: body.requestId }, content: body.content }));
      emit(event('tool/call', 3, { turn: 1, callId: 'original-tool', name: 'run_code' }));
      emit(event('tool/result', 4, { turn: 1, message: { role: 'tool', toolCallId: 'original-tool', content: [{ type: 'text', text: 'done' }] } }));
      emit(event('turn/end', 5, { turn: 1, reason: { kind: failed ? 'failed' : 'completed' } })); return;
    }
    if (hit.url === '/v1/dsh/pending-actions/question-original/responses') { responses.push(hit.json()); return respond(response, { accepted: true }); }
    if (hit.url === '/v1/dsh/ephemeral-runs') return respond(response, { error: { code: 'native.prompt_limit' } }, 400);
    if (hit.url === '/xrain/runs') { inputs.push(hit.json()); return respond(response, { runId: '00000000-0000-4000-8000-000000000001', status: 'accepted' }, 202); }
    respond(response, {}, 404);
  });
  login(f, service.url); return { ...f, service, inputs, responses, fail() { failed = true; } };
}

test('long inline, file and stdin prompts retain original request IDs and tool-only completion does not stop a batch', async t => {
  const f = await conversation(t), text = '原文'.repeat(140000), file = join(f.directory, '原文.txt'); writeFileSync(file, text);
  const base = ['agent', 'chat', 'send', 'original-session', '--request-id', 'task:original/request', '--json'];
  for (const [options, io] of [[['--message', text], {}], [['--message-file', file], {}], [['--message-file', '-'], { stdin: Readable.from([Buffer.from(text)]) }]]) {
    const result = await f.run([...base, ...options], io);
    assert.equal(result.code, 0, result.stdout); const data = json(result).data;
    assert.equal(data.status, 'completed'); assert.equal(data.answer, ''); assert.equal(data.toolCalls[0].status, 'succeeded');
    assert.equal(f.inputs.at(-1).requestId, 'task:original/request'); assert.equal(f.inputs.at(-1).content[0].text, text);
  }
  const batch = join(f.directory, 'batch.json'); writeFileSync(batch, JSON.stringify([[...base.slice(0, -1), '--message', '只执行工具'], ['profile', 'show']]));
  const result = await f.run(['batch', '--file', batch, '--json']); assert.equal(result.code, 0, result.stdout); assert.equal(json(result).data.length, 2);
  f.fail(); const failed = await f.run([...base, '--message', '原失败']);
  assert.equal(json(failed).error.code, 'turn_failed'); assert.equal(f.inputs.length, 5);
});

test('managed and ephemeral prompts reach their own service and question responses keep the original response ID', async t => {
  const f = await conversation(t), text = 'x'.repeat(64001);
  const run = await f.run(['agent', 'run', 'start', 'original-agent', '--message', text, '--json']);
  assert.equal(run.code, 0, run.stdout); assert.equal(f.inputs[0].input.prompt, text);
  const ephemeral = await f.run(['agent', 'ephemeral', 'generate', 'original-agent', '--message', text, '--json']);
  assert.equal(json(ephemeral).error.serverCode, 'native.prompt_limit'); assert.equal(f.service.hits.filter(hit => hit.url.endsWith('ephemeral-runs')).length, 1);
  const answer = await f.run(['agent', 'chat', 'respond', 'question-original', '--request-id', 'task:original/answer', '--values', '{"answers":{"question":"明确答案"}}', '--json']);
  assert.equal(answer.code, 0, answer.stdout); assert.equal(f.responses[0].responseId, 'task:original/answer'); assert.deepEqual(f.responses[0].answers, { question: '明确答案' });
});

test('oversized file upload reaches the file service and retains its actual refusal', async t => {
  const f = fixture(t), file = join(f.directory, 'sparse.bin'), length = 512 * 1024 * 1024 + 1;
  const fd = openSync(file, 'w'); ftruncateSync(fd, length); closeSync(fd); let calls = 0;
  const server = createServer((req, res) => { calls++; assert.equal(Number(req.headers['content-length']), length); req.resume(); respond(res, { error: { code: 'file.size_limit' } }, 413); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  f.profile(`http://127.0.0.1:${server.address().port}`, 'TEN', 'isolated-file-credential');
  const result = json(await f.run(['file', 'upload', file, '--uploader-id', 'original-uploader', '--json']));
  assert.equal(result.error.httpStatus, 413); assert.equal(result.error.serverCode, 'file.size_limit'); assert.equal(calls, 1);
});

test('package import, publish and download delegate transfer size while preserving archive identity and hashes', async t => {
  const f = fixture(t), manifest = { packageId: PACKAGE_ID, versionId: VERSION_ID, version: '1.0.0' };
  const bytes = zip([['manifest.json', JSON.stringify(manifest)], ['payload.bin', Buffer.alloc(33 * 1024 * 1024, 65)]], { deflate: false });
  const file = join(f.directory, 'large.appkg'); writeFileSync(file, bytes);
  assert.deepEqual(await readManifestFile(file), manifest);
  const hash = sha256(bytes), service = await mockServer(t, (hit, res) => {
    if (hit.url.endsWith('/my-published')) return respond(res, []);
    if (hit.url.endsWith('/packages:import') || hit.url.endsWith('/packages:publish')) { assert.deepEqual(hit.body, bytes); return respond(res, manifest); }
    if (hit.url.endsWith('/packages:build')) {
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'x-appkg-package-id': PACKAGE_ID, 'x-appkg-version': manifest.version,
        'x-appkg-file-sha256': hash, 'x-appkg-source-sha256': sha256(hit.body) }); return res.end(bytes);
    }
    if (hit.url.endsWith('/manifest')) return respond(res, { ...manifest, digest: 'original-digest', fileSha256: hash });
    assert.ok(hit.url.endsWith('/artifact'));
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'x-appkg-package-id': PACKAGE_ID, 'x-appkg-version-id': VERSION_ID, 'x-appkg-package-digest': 'original-digest', 'x-appkg-file-sha256': hash }); res.end(bytes);
  });
  login(f, service.url);
  for (const command of ['import-file', 'publish']) { const result = await f.run(['app', command, '--file', file, '--json']); assert.equal(result.code, 0, result.stdout); }
  const out = join(f.directory, 'received.appkg');
  const originalLink = fs.promises.link;
  fs.promises.link = async () => { throw Object.assign(new Error('This filesystem has no hard links'), { code: 'ENOTSUP' }); }; syncBuiltinESMExports();
  let downloaded;
  try { downloaded = await f.run(['market', 'download', PACKAGE_ID, '--version-id', VERSION_ID, '--exchange', service.url, '--out', out, '--json']); }
  finally { fs.promises.link = originalLink; syncBuiltinESMExports(); }
  assert.equal(downloaded.code, 0, downloaded.stdout); assert.equal(sha256(readFileSync(out)), hash);
  const source = request(f, { packageId: PACKAGE_ID, versionId: VERSION_ID, version: manifest.version, records: [] }), built = join(f.directory, 'built.appkg');
  const build = await f.run(['app', 'build', '--source', source, '--output', built, '--json']);
  assert.equal(build.code, 0, build.stdout); assert.equal(sha256(readFileSync(built)), hash);
});

test('build source size is decided by the server, and oversized manifests remain rejected locally', async t => {
  const f = fixture(t), service = await mockServer(t, (hit, res) => {
    assert.ok(hit.body.length > 32 * 1024 * 1024); respond(res, { error: { code: 'native.source_limit' } }, 413);
  });
  login(f, service.url);
  const source = join(f.directory, 'source.json'); writeFileSync(source, JSON.stringify({ records: [], input: 'x'.repeat(32 * 1024 * 1024) }));
  const result = json(await f.run(['app', 'build', '--source', source, '--output', join(f.directory, 'not-created.appkg'), '--json']));
  assert.equal(result.error.httpStatus, 413); assert.equal(result.error.serverCode, 'native.source_limit'); assert.equal(service.hits.length, 1);
  const bad = join(f.directory, 'unsafe.appkg'); writeFileSync(bad, zip([['manifest.json', ' '.repeat(1024 * 1024 + 1)]]));
  await assert.rejects(readManifestFile(bad), /manifest limit/);
  const deceptive = zip([['manifest.json', ' '.repeat(2 * 1024 * 1024)]]);
  const central = deceptive.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  deceptive.writeUInt32LE(1, 22); deceptive.writeUInt32LE(1, central + 24); writeFileSync(bad, deceptive);
  await assert.rejects(readManifestFile(bad), /manifest limit/);
  assert.equal(readdirSync(f.directory).some(name => name.endsWith('.part')), false);
});
