import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, mockServer, respond } from './helpers.mjs';

const output = result => JSON.parse(result.stdout);
function login(f, server, applicationId = 'APP') {
  f.store.save({ activeProfile: 'Demo', profiles: { Demo: { server, tenant: 'TEN', ...(applicationId ? { applicationId } : {}) } } });
  f.store.saveSession('Demo', server, 'TEN', 'member-session', Date.now() + 300000);
}
function input(f, name, value) { const file = join(f.directory, name + '.json'); writeFileSync(file, JSON.stringify(value)); return file; }

test('member downloads stream above former upload and JSON limits, with or without Content-Length', async t => {
  const f = fixture(t), size = 40 * 1024 * 1024, chunk = Buffer.alloc(512 * 1024, 73);
  const platform = await mockServer(t, (_hit, res) => respond(res, { tenantId: 'TEN', userId: 'human' }));
  let lengthHeader = true;
  const host = await mockServer(t, async (hit, res) => {
    assert.equal(hit.headers.authorization, 'Bearer member-session'); assert.equal(hit.headers['x-xrain-application-id'], 'APP');
    assert.equal(hit.headers['x-xrain-expected-user-id'], 'human'); assert.equal(hit.headers['accept-encoding'], 'identity');
    res.writeHead(200, { 'content-type': 'application/octet-stream', ...(lengthHeader ? { 'content-length': size } : {}) });
    for (let offset = 0; offset < size; offset += chunk.length) if (!res.write(chunk)) await once(res, 'drain');
    res.end();
  });
  login(f, platform.url);
  for (const mode of ['length', 'chunked']) {
    const out = join(f.directory, mode + '.bin');
    const result = await f.run(['workforce', 'attachment', 'download', 'original', '--workforce', host.url, '--out', out, '--json']);
    assert.equal(result.code, 0, result.stdout); assert.equal(output(result).data.bytes, size); assert.equal(readFileSync(out).length, size);
    lengthHeader = false;
  }
});

test('a failed or interrupted attachment leaves no destination or temporary file', async t => {
  const f = fixture(t), platform = await mockServer(t, (_hit,res) => respond(res, { tenantId: 'TEN', userId: 'human' }));
  let denied = true;
  const host = await mockServer(t, (_hit, res) => {
    if (denied) return respond(res, { error: { code: 'file.forbidden' } }, 403);
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': '1000000' });
    res.write('incomplete'); setTimeout(() => res.destroy(), 10);
  });
  login(f, platform.url); const out = join(f.directory, 'received.bin');
  const args = ['workforce', 'attachment', 'download', 'file', '--workforce', host.url, '--out', out, '--json'];
  assert.equal(output(await f.run(args)).error.code, 'permission_denied'); denied = false;
  assert.equal((await f.run(args)).code, 1); assert.equal(existsSync(out), false);
  assert.equal(readdirSync(f.directory).some(name => name.endsWith('.part')), false);
});

test('a local destination failure closes the attachment response instead of retaining its stream', async t => {
  const f = fixture(t), platform = await mockServer(t, (_hit, res) => respond(res, { tenantId: 'TEN', userId: 'human' }));
  let closed; const responseClosed = new Promise(resolve => { closed = resolve; });
  const host = await mockServer(t, (_hit, res) => {
    res.on('close', () => closed(true));
    res.writeHead(200, { 'content-type': 'application/octet-stream' }); res.write('unfinished response');
  });
  login(f, platform.url);
  const result = await f.run(['workforce', 'attachment', 'download', 'file', '--workforce', host.url, '--out', join(f.directory, 'missing', 'file.bin'), '--json']);
  assert.equal(result.code, 1);
  let deadline;
  try { assert.equal(await Promise.race([responseClosed, new Promise(resolve => { deadline = setTimeout(() => resolve(false), 2000); })]), true); }
  finally { clearTimeout(deadline); }
});

test('application publication preserves executor, sender, target and original request, including failures and lost receipts', async t => {
  const f = fixture(t); f.env.XRAIN_TOKEN = 'application-executor';
  const platform = await mockServer(t, (hit,res) => { assert.equal(hit.headers.authorization, 'Bearer application-executor'); respond(res, { tenantId: 'TEN', userId: 'executor' }); });
  let status = 'accepted', drop = false;
  const body = { applicationId: 'sender-app', target: { kind: 'application' }, clientMessageId: 'original-request', content: { type: 'text', text: '通知正文' } };
  const host = await mockServer(t, (hit,res) => {
    assert.equal(hit.headers.authorization, 'Bearer application-executor'); assert.equal(hit.headers['x-xrain-application-id'], undefined);
    if (hit.method === 'POST') { assert.equal(hit.url, '/api/application-messages'); assert.deepEqual(hit.json(), body); }
    else assert.equal(hit.url, '/api/application-messages/sender-app/channels/announcement/requests/original-request');
    if (drop) return res.destroy();
    respond(res, { status, channelId: 'announcement', clientMessageId: 'original-request', ...(status !== 'unknown' ? { messageSeq: '8', chatMessageId: 'native-message' } : {}) });
  });
  login(f, platform.url, null);
  const args = ['workforce', 'application-message', 'send', '--workforce', host.url, '--request-json', input(f, 'publish', body), '--json'];
  const accepted = await f.run(args); assert.equal(accepted.code, 0, accepted.stdout); assert.equal(output(accepted).data.status, 'accepted');
  status = 'saved';
  const lookup = await f.run(['workforce', 'application-message', 'lookup', 'sender-app', 'announcement', 'original-request', '--workforce', host.url, '--json']);
  assert.equal(lookup.code, 0, lookup.stdout); assert.equal(output(lookup).data.status, 'saved');
  status = 'failed'; assert.equal(output(await f.run(args)).error.code, 'execution_failed');
  drop = true;
  const unknown = output(await f.run(args)); assert.equal(unknown.error.code, 'outcome_unknown');
  assert.equal(unknown.error.details.applicationId, 'sender-app'); assert.equal(unknown.error.details.clientMessageId, 'original-request');
  assert.deepEqual(unknown.error.details.target, body.target);
  assert.equal(host.hits.length, 4, 'publication and lookup never automatically resend');
});

test('feedback uses the original session and answer and preserves explicit rejection without replay', async t => {
  const f = fixture(t), platform = await mockServer(t, (_hit,res) => respond(res, { tenantId: 'TEN', userId: 'human' }));
  let denied = false;
  const body = { messageId: '7', rating: 'negative', category: 'task-result', note: '请核对结果' };
  const host = await mockServer(t, (hit,res) => {
    assert.equal(hit.url, '/api/cli/v1/workbench/sessions/original/feedback');
    if (denied) return respond(res, { error: { code: 'session.forbidden' } }, 403);
    if (hit.method === 'GET') return respond(res, { items: [body] });
    assert.deepEqual(hit.json(), body); respond(res, { saved: true });
  });
  login(f, platform.url);
  const args = ['workforce', 'session', 'feedback', 'set', 'original', '--workforce', host.url, '--request-json', input(f, 'feedback', body), '--json'];
  assert.equal((await f.run(args)).code, 0);
  assert.equal((await f.run(['workforce', 'session', 'feedback', 'list', 'original', '--workforce', host.url, '--json'])).code, 0);
  denied = true; assert.equal(output(await f.run(args)).error.code, 'permission_denied'); assert.equal(host.hits.length, 3);
});

test('local speech audio retains bytes and uses server input capabilities and explicit native selection', async t => {
  const f = fixture(t), platform = await mockServer(t, (_hit,res) => respond(res, { tenantId: 'TEN', userId: 'human' }));
  const bytes = Buffer.from('RIFF synthetic audio'), audio = join(f.directory, '本地.wav'); writeFileSync(audio, bytes);
  let maximum = 1000, unavailable = false;
  const host = await mockServer(t, (hit,res) => {
    if (hit.method === 'GET') return respond(res, { selection: { providerId: 'native-model', language: 'auto' }, maxAudioBytes: maximum });
    if (unavailable) return respond(res, { error: { code: 'speech.not_ready' } }, 503);
    assert.equal(hit.url, '/api/cli/v1/workbench/speech/transcribe');
    assert.deepEqual(hit.json(), { providerId: 'native-model', language: 'zh', audioBase64: bytes.toString('base64') }); respond(res, { text: '识别文字' });
  });
  login(f, platform.url);
  const args = ['workforce', 'speech', 'transcribe', '--workforce', host.url, '--file', audio, '--request-json', input(f, 'selection', { language: 'zh' }), '--json'];
  const result = await f.run(args); assert.equal(result.code, 0, result.stdout); assert.equal(output(result).data.text, '识别文字');
  maximum = 1; assert.equal((await f.run(args)).code, 1); assert.equal(host.hits.length, 3, 'server-owned input limit prevents a transcription call');
  maximum = 1000; unavailable = true;
  const rejected = output(await f.run(args)); assert.equal(rejected.error.serverCode, 'speech.not_ready'); assert.equal(host.hits.length, 5);
});
