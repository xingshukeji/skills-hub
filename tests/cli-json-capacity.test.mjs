import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { readJsonInput } from '../src/xrain-cli/core.mjs';
import { request, requireStreamSuccess } from '../src/xrain-cli/http.mjs';
import { fixture, mockServer, respond } from './helpers.mjs';

const size = 32 * 1024 * 1024 + 1;
const hash = value => createHash('sha256').update(value).digest('hex');

test('complete JSON files and streamed stdin remain readable beyond the former generic size', async t => {
  const f = fixture(t), text = 'x'.repeat(size) + '🌧完整末尾', bytes = Buffer.from(JSON.stringify({ text }));
  const file = join(f.directory, 'complete.json'); writeFileSync(file, bytes);
  assert.equal(hash((await readJsonInput(file)).text), hash(text));
  const stdin = Readable.from([bytes.subarray(0, 1_048_577), bytes.subarray(1_048_577, bytes.length - 4), bytes.subarray(bytes.length - 4)]);
  assert.equal(hash((await readJsonInput('-', 'JSON input', { stdin })).text), hash(text));
  await assert.rejects(readJsonInput(file, 'Explicit field input', { limit: 64 }), /exceeds/);
});

test('complete declared and chunked JSON responses and native errors retain their actual result', async t => {
  const text = 'r'.repeat(size) + '🌧响应末尾';
  const service = await mockServer(t, (hit, res) => {
    const body = JSON.stringify(hit.url === '/error' ? { error: { code: 'native.complete_error' }, text } : { text });
    if (hit.url === '/chunked') { res.writeHead(200, { 'content-type': 'application/json' }); res.write(body.slice(0, 1_048_577)); res.end(body.slice(1_048_577)); }
    else { res.writeHead(hit.url === '/error' ? 403 : 200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }); res.end(body); }
  });
  for (const route of ['/declared', '/chunked']) assert.equal(hash((await request(service.url + route)).json().text), hash(text));
  const native = await request(service.url + '/error', { stream: true });
  await assert.rejects(requireStreamSuccess(native), error => error.serverCode === 'native.complete_error' && hash(error.details.response.text) === hash(text));
  await assert.rejects(request(service.url + '/declared', { limit: 64 }), { code: 'response_too_large' });
});

test('a CLI update sends and reads the full original JSON without replaying the write', async t => {
  const f = fixture(t), text = 'v'.repeat(size) + '🌧原值末尾', file = join(f.directory, 'values.json');
  writeFileSync(file, JSON.stringify({ payload: text }));
  const service = await mockServer(t, (hit, res) => {
    assert.equal(hit.method, 'PUT'); assert.equal(hit.url, '/api/data/v1/entities/customer/records/original');
    assert.equal(hash(hit.json().values.payload), hash(text)); respond(res, { recordId: 'original', values: hit.json().values });
  });
  f.profile(service.url, 'tenant', 'synthetic-json-session');
  const result = await f.run(['data', 'update', 'customer', 'original', '--values-json', file, '--json']);
  assert.equal(result.code, 0, result.stderr || result.stdout.slice(0, 1500)); assert.equal(hash(JSON.parse(result.stdout).data.values.payload), hash(text));
  writeFileSync(file, '{malformed');
  assert.equal((await f.run(['data', 'update', 'customer', 'original', '--values-json', file, '--json'])).code, 1);
  assert.equal(service.hits.length, 1);
});

test('a complete conversation event beyond the former buffer gate retains its request and reply', async t => {
  const f = fixture(t), answer = 'a'.repeat(size) + '🌧对话末尾'; let stream;
  const frame = value => 'data: ' + JSON.stringify(value) + '\n\n';
  const event = (type, seq, data) => frame({ type: 'event', event: { type, seq, data } });
  const service = await mockServer(t, (hit, res) => {
    if (hit.url.endsWith('/stream')) {
      stream = res; res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write(frame({ type: 'snapshot', records: [], hasMore: false })); return;
    }
    assert.ok(hit.url.endsWith('/inputs')); const input = hit.json(); respond(res, { accepted: true }, 202);
    stream.write(event('turn/start', 1, { turn: 1 }));
    stream.write(event('user/message', 2, { source: { kind: 'user', rpcId: input.requestId }, content: input.content }));
    stream.write(event('assistant/message', 3, { turn: 1, message: { content: [{ type: 'text', text: answer }] } }));
    stream.write(event('turn/end', 4, { turn: 1, reason: { kind: 'completed' } }));
  });
  f.profile(service.url, 'tenant', 'synthetic-conversation-session');
  const response = await f.run(['agent', 'chat', 'send', 'original', '--message', '核对原输入', '--request-id', 'original-large-event', '--runtime', service.url, '--json']);
  assert.equal(response.code, 0, response.stderr); const value = JSON.parse(response.stdout).data;
  assert.equal(value.requestId, 'original-large-event'); assert.equal(hash(value.answer), hash(answer));
  assert.equal(service.hits.filter(hit => hit.url.endsWith('/inputs')).length, 1);
});

test('a large native conversation error keeps its server code without submitting an input', async t => {
  const f = fixture(t), detail = 'e'.repeat(1_048_577) + '🌧错误末尾';
  const service = await mockServer(t, (_hit, res) => respond(res, { error: { code: 'native.stream_denied' }, detail }, 403));
  f.profile(service.url, 'tenant', 'synthetic-error-session');
  const result = await f.run(['agent', 'chat', 'wait', 'original', '--request-id', 'original-request', '--runtime', service.url, '--json']);
  assert.equal(result.code, 1); const error = JSON.parse(result.stdout).error;
  assert.equal(error.code, 'permission_denied'); assert.equal(error.serverCode, 'native.stream_denied');
  assert.equal(hash(error.details.response.detail), hash(detail));
  assert.equal(service.hits.some(hit => hit.method === 'POST'), false);
});

test('import discovery reads complete native JSON and preserves a complete refusal', async t => {
  const f = fixture(t), detail = 'i'.repeat(size) + '🌧导入末尾'; let denied = false;
  const service = await mockServer(t, (hit, res) => {
    assert.equal(hit.method, 'GET'); assert.equal(hit.url, '/api/data/v1/entities/customer/imports/capabilities');
    respond(res, denied ? { error: { code: 'native.import_denied' }, detail } : { entityCode: 'customer', detail }, denied ? 403 : 200);
  });
  f.profile(service.url, 'tenant', 'synthetic-import-session');
  const words = ['data', 'import', 'capabilities', '--entity', 'customer', '--json'];
  const accepted = await f.run(words); assert.equal(accepted.code, 0, accepted.stderr);
  assert.equal(hash(JSON.parse(accepted.stdout).data.detail), hash(detail));
  denied = true; const rejected = await f.run(words); assert.equal(rejected.code, 1);
  const error = JSON.parse(rejected.stdout).error; assert.equal(error.serverCode, 'native.import_denied');
  assert.equal(hash(error.details.response.detail), hash(detail)); assert.equal(service.hits.length, 2);
});
