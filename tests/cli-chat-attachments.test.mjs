import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { fixture, mockServer, respond } from './helpers.mjs';

const frame = value => `data: ${JSON.stringify(value)}\n\n`;
const event = (type, data) => ({ type: 'event', event: { type, data } });

test('chat uploads exact binary files to its created session, sends only receipts and retains durable file history', async t => {
  const f = fixture(t), binary = Buffer.from([0, 255, 13, 10, 127, 65]), text = Buffer.from('甲 2\n乙 3\n');
  const a = join(f.directory, '资料.bin'), b = join(f.directory, '资料.txt'); writeFileSync(a, binary); writeFileSync(b, text);
  let stream; const uploaded = [], refs = [];
  const service = await mockServer(t, (hit, res) => {
    if (hit.url === '/v1/dsh/workbench-agents') return respond(res, { supportsDefaultServiceTools: true, serviceToolProtocolVersions: [1] });
    if (hit.url === '/v1/dsh/sessions') return respond(res, { sessionId: 'original-session' }, 201);
    if (hit.url.endsWith('/stream')) { stream = res; res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(frame({ type: 'snapshot', records: [] })); return; }
    if (hit.url.endsWith('/files')) {
      assert.equal(hit.url, '/v1/dsh/sessions/original-session/files'); assert.equal(hit.headers['x-xrain-application-id'], 'app');
      assert.equal(hit.headers.authorization, 'Bearer member'); assert.equal(hit.headers['x-xrain-authorization'], 'Bearer member');
      const ref = { bytes: hit.body.length, name: decodeURIComponent(hit.headers['x-file-name']), attachmentId: createHash('sha256').update(hit.body).digest('hex') };
      uploaded.push(hit.body); refs.push(ref); return respond(res, { receiptId: 'receipt-' + refs.length, file: ref }, 201);
    }
    if (hit.url.endsWith('/inputs')) {
      assert.deepEqual(hit.json().content, [{ type: 'text', text: 'sum' }, { type: 'file', receiptId: 'receipt-1' }, { type: 'file', receiptId: 'receipt-2' }]);
      respond(res, { accepted: true }, 202);
      for (const e of [event('turn/start', { turn: 1 }), event('user/message', { source: { kind: 'user', rpcId: 'input-key' },
        content: [{ type: 'text', text: 'sum' }, ...refs.map(ref => ({ type: 'file', attachment: { attachmentId: ref.attachmentId, name: ref.name, bytes: ref.bytes } }))] }),
      event('assistant/message', { turn: 1, content: [{ type: 'text', text: '5' }] }), event('turn/end', { turn: 1, reason: { kind: 'completed' } })]) stream.write(frame(e));
      return;
    }
    if (hit.url.endsWith('/history')) return respond(res, { type: 'snapshot', cursor: 1, hasMore: false, records: [{ event: { type: 'user/message', data: {
      source: { kind: 'user', rpcId: 'input-key' }, content: refs.map(ref => ({ type: 'file', attachment: ref })),
    } } }] });
    respond(res, {}, 404);
  });
  f.profile(service.url, 'tenant', 'member');
  const result = await f.run(['agent', 'chat', 'start', 'agent', '--runtime', service.url, '--application-id', 'app', '--message', 'sum', '--attach', a, '--attach', b, '--request-id', 'input-key', '--json']);
  assert.equal(result.code, 0, result.stdout); assert.equal(JSON.parse(result.stdout).data.answer, '5');
  assert.deepEqual(uploaded, [binary, text]); assert.equal(JSON.parse(result.stdout).data.attachments.length, 2);
  const history = await f.run(['agent', 'chat', 'history', 'original-session', '--runtime', service.url, '--json']);
  assert.equal(history.code, 0, history.stdout); assert.deepEqual(JSON.parse(history.stdout).data.items[0].attachments, refs);
  assert.equal(service.hits.filter(h => h.url.endsWith('/inputs')).length, 1);
});

test('pending actions, invalid local files and ambiguous upload receipts never submit an attachment input', async t => {
  const f = fixture(t), file = join(f.directory, 'sample.txt'); writeFileSync(file, 'private test');
  let pending = true, stream, uploads = 0;
  const service = await mockServer(t, (hit, res) => {
    if (hit.url === '/v1/dsh/workbench-agents') return respond(res, { supportsDefaultServiceTools: true, serviceToolProtocolVersions: [1] });
    if (hit.url.endsWith('/stream')) { stream = res; res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      if (pending) res.write(frame({ type: 'pending-actions', items: [{ actionRef: 'needs-answer' }] }));
      res.write(frame({ type: 'snapshot', records: [] })); return; }
    if (hit.url.endsWith('/files')) { uploads++; return res.destroy(); }
    assert.fail('No input or replacement session is authorized after upload failure');
  });
  f.profile(service.url, 'tenant', 'member');
  const args = ['agent', 'chat', 'send', 'original', '--runtime', service.url, '--attach', file, '--request-id', 'original-input', '--json'];
  const blocked = await f.run(args); assert.equal(JSON.parse(blocked.stdout).error.code, 'action_required'); assert.equal(uploads, 0);
  pending = false;
  const failed = await f.run(args); assert.equal(JSON.parse(failed.stdout).error.code, 'outcome_unknown');
  assert.equal(JSON.parse(failed.stdout).error.details.inputSubmitted, false); assert.equal(JSON.parse(failed.stdout).error.details.phase, 'attachment-upload');
  assert.equal(uploads, 1); assert.equal(service.hits.some(h => h.url.endsWith('/inputs')), false);
  const directory = join(f.directory, 'directory'); mkdirSync(directory);
  const bad = await f.run(['agent', 'chat', 'start', 'agent', '--runtime', service.url, '--attach', directory, '--json']);
  assert.equal(bad.code, 1); assert.equal(service.hits.some(h => h.url === '/v1/dsh/sessions'), false);
  if (!stream.destroyed && !stream.writableEnded) await once(stream, 'close', { signal: AbortSignal.timeout(1000) });
  assert.ok(stream.destroyed || stream.writableEnded);
});

test('a later rejected attachment preserves earlier receipts without sending or retrying the input', async t => {
  const f = fixture(t), file = join(f.directory, 'sample.txt'); writeFileSync(file, 'sample');
  let uploads = 0;
  const receipt = { receiptId: 'first-receipt', file: { attachmentId: 'file-one', name: 'sample.txt', bytes: 6 } };
  const service = await mockServer(t, (hit, res) => {
    if (hit.url === '/v1/dsh/workbench-agents') return respond(res, { supportsDefaultServiceTools: true, serviceToolProtocolVersions: [1] });
    if (hit.url.endsWith('/stream')) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(frame({ type: 'snapshot', records: [] })); return;
    }
    if (hit.url.endsWith('/files')) return ++uploads === 1 ? respond(res, receipt, 201) : respond(res, { error: 'FILE_REJECTED' }, 403);
    assert.fail('A partial upload must not submit or replace the conversation input');
  });
  f.profile(service.url, 'tenant', 'member');
  const result = await f.run(['agent', 'chat', 'send', 'original', '--runtime', service.url, '--attach', file, '--attach', file, '--json']);
  const error = JSON.parse(result.stdout).error;
  assert.equal(result.code, 1); assert.equal(error.code, 'permission_denied'); assert.deepEqual(error.details.attachments, [receipt]);
  assert.equal(uploads, 2); assert.equal(service.hits.some(hit => hit.url.endsWith('/inputs')), false);
});
