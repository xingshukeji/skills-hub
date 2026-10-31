import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, mockServer, respond } from './helpers.mjs';

const output = result => JSON.parse(result.stdout);
test('enterprise discovery reads current member tenants without identity exchange, switching, or borrowing an API token', async t => {
  const f = fixture(t), platform = await mockServer(t, (hit, res) => {
    assert.equal(hit.url, '/api/service/authen/v1/security/tenants'); assert.equal(hit.headers.authorization, 'Bearer member-session');
    respond(res, [{ tenantId: 'TEN', userId: 'human', label: '本人企业' }]);
  });
  f.profile(platform.url, 'TEN'); f.env.XRAIN_TOKEN = 'unrelated-api-token';
  f.store.saveSession('Demo', platform.url, 'TEN', 'member-session', Date.now() + 300000);
  const before = f.store.load(), result = await f.run(['auth', 'tenants', '--json']);
  assert.equal(result.code, 0, result.stdout); assert.equal(output(result).data[0].tenantId, 'TEN');
  assert.deepEqual(f.store.load(), before); assert.equal(platform.hits.length, 1);
  f.store.deleteSession('Demo');
  assert.equal(output(await f.run(['auth', 'tenants', '--json'])).error.code, 'authentication_required'); assert.equal(platform.hits.length, 1);
});
async function member(t, handle) {
  const f = fixture(t);
  const platform = await mockServer(t, (_hit, res) => respond(res, { tenantId: 'TEN', userId: 'human' }));
  const app = await mockServer(t, (hit, res) => {
    assert.equal(hit.headers.authorization, 'Bearer member-session');
    assert.equal(hit.headers['x-xrain-application-id'], 'APP');
    assert.equal(hit.headers['x-xrain-expected-user-id'], 'human');
    assert.equal(hit.headers.cookie, undefined);
    return handle(hit, res);
  });
  f.env.XRAIN_TOKEN = 'unrelated-service-token';
  f.store.save({ activeProfile: 'Demo', profiles: { Demo: { server: platform.url, tenant: 'TEN', applicationId: 'APP' } } });
  f.store.saveSession('Demo', platform.url, 'TEN', 'member-session', Date.now() + 300000);
  return { ...f, app, input(name, body) { const file = join(f.directory, name + '.json'); writeFileSync(file, JSON.stringify(body)); return file; } };
}

test('group and messaging writes retain native revisions, entry evidence, original message and independent target', async t => {
  let conflict = false;
  const f = await member(t, (hit, res) => respond(res, conflict ? { error: { code: 'draft.conflict' } } : hit.json(), conflict ? 409 : 200));
  const data = { applicantUserId: 'peer', decision: 'approve', expectedRevision: '7' };
  const decision = await f.run(['workforce', 'group', 'decide', 'group', '18', '--workforce', f.app.url, '--request-json', f.input('decision', data), '--json']);
  assert.equal(decision.code, 0, decision.stdout); assert.deepEqual(output(decision).data, data);
  assert.equal(f.app.hits[0].url, '/api/cli/v1/channels/group/applications/18/decision');
  const reaction = await f.run(['workforce', 'message', 'react', 'source', '19', '👍', '--workforce', f.app.url, '--request-json', f.input('react', { active: false }), '--json']);
  assert.equal(reaction.code, 0, reaction.stdout); assert.match(f.app.hits[1].url, /\/source\/messages\/19\/reactions\/%F0%9F%91%8D$/);
  const forward = { sourceChannelId: 'source', sourceMessageSeqs: ['19'], clientMessageId: 'forward-once', mode: 'merged', note: '请查阅' };
  assert.equal((await f.run(['workforce', 'message', 'forward', 'target', '--workforce', f.app.url, '--request-json', f.input('forward', forward), '--json'])).code, 0);
  assert.equal(f.app.hits[2].url, '/api/cli/v1/channels/target/message-forwards'); assert.deepEqual(f.app.hits[2].json(), forward);
  conflict = true;
  const saved = await f.run(['workforce', 'draft', 'set', 'source', '--workforce', f.app.url, '--request-json', f.input('draft', { expectedRevision: 'old', draft: { text: 'reply' } }), '--json']);
  assert.equal(output(saved).error.code, 'conflict'); assert.equal(f.app.hits.length, 4, 'conflicts are not refreshed or replayed');
});

test('human attachment bytes use the member host with original message scope and cannot overwrite files or save errors', async t => {
  const bytes = Buffer.from([0, 1, 2, 255, 10]); let denied = false;
  const f = await member(t, (hit, res) => {
    if (hit.method === 'POST') {
      assert.equal(decodeURIComponent(hit.headers['x-file-name']), '本人附件.bin'); assert.deepEqual(hit.body, bytes);
      return respond(res, { id: 'file', length: bytes.length });
    }
    assert.equal(hit.url, '/api/cli/v1/files/file/content?channelId=original&messageSeq=19');
    if (denied) return respond(res, { error: { code: 'file.forbidden' } }, 403);
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': bytes.length }); res.end(bytes);
  });
  const file = join(f.directory, '本人附件.bin'); writeFileSync(file, bytes);
  assert.equal((await f.run(['workforce', 'attachment', 'upload', '--workforce', f.app.url, '--file', file, '--json'])).code, 0);
  const out = join(f.directory, 'received.bin'), query = f.input('scope', { channelId: 'original', messageSeq: '19' });
  const args = ['workforce', 'attachment', 'download', 'file', '--workforce', f.app.url, '--query-json', query, '--out', out, '--json'];
  assert.equal((await f.run(args)).code, 0); assert.deepEqual(readFileSync(out), bytes);
  assert.equal(output(await f.run(args)).error.code, 'output_exists'); assert.equal(f.app.hits.length, 2);
  denied = true; const rejected = join(f.directory, 'forbidden.bin'); args[args.indexOf(out)] = rejected;
  assert.equal(output(await f.run(args)).error.code, 'permission_denied'); assert.equal(existsSync(rejected), false);
});

test('mail assistance keeps the original mailbox/message and saves only on an explicit separate native draft action', async t => {
  let drafts = 0;
  const reference = { accountId: 'mailbox', mailbox: 'human@example.invalid', folder: 'INBOX', uidValidity: 8, uid: 12 };
  const f = await member(t, (hit, res) => {
    if (hit.url.endsWith('/ais')) return respond(res, { items: [{ id: 'writer', canUse: true }] });
    if (hit.url.endsWith('/assist')) { assert.deepEqual(hit.json(), { agentId: 'writer', reference, action: 'draft' }); return respond(res, { answer: '可编辑的回复' }); }
    assert.equal(hit.url, '/api/cli/v1/mail/accounts/mailbox/drafts');
    assert.deepEqual(hit.json().source, reference); drafts++; return respond(res, { status: 'Saved', internetMessageId: 'draft-original-mailbox' });
  });
  assert.equal((await f.run(['mail', 'ai', 'list', '--app-url', f.app.url, '--json'])).code, 0);
  const assist = await f.run(['mail', 'assist', 'mailbox', '--app-url', f.app.url, '--request-json', f.input('assist', { agentId: 'writer', reference, action: 'draft' }), '--json']);
  assert.equal(assist.code, 0, assist.stdout); assert.equal(output(assist).data.answer, '可编辑的回复'); assert.equal(drafts, 0);
  const draft = await f.run(['mail', 'app', 'draft', 'mailbox', '--app-url', f.app.url, '--request-json', f.input('save', { source: reference, textBody: '本人修改后的回复', to: [] }), '--json']);
  assert.equal(draft.code, 0, draft.stdout); assert.equal(drafts, 1);
  const invalid = await f.run(['mail', 'assist', 'mailbox', '--app-url', f.app.url, '--auth', 'token', '--request-json', f.input('invalid', {}), '--json']);
  assert.equal(output(invalid).error.code, 'invalid_arguments'); assert.equal(f.app.hits.length, 3);
});

test('retail discovers original customer conversations and continues the selected session through that application', async t => {
  const f = await member(t, (hit, res) => {
    if (hit.method === 'GET') return respond(res, { items: [{ sessionId: 'original', agentId: 'selected' }] });
    if (hit.url.endsWith('/conversations')) { assert.deepEqual(hit.json(), { agentId: 'selected', requestId: 'once', source: 'retail-assistant' }); return respond(res, { items: [{ sessionId: 'original' }] }); }
    assert.equal(hit.url, '/api/cli/v1/applications/retail-assistant/assistant/sessions/original/inputs'); return respond(res, { accepted: true });
  });
  const list = await f.run(['retail', 'conversation', 'list', 'customer-object', 'customer-record', '--app-url', f.app.url, '--json']);
  assert.equal(list.code, 0, list.stdout); assert.equal(output(list).data.items[0].sessionId, 'original');
  assert.match(f.app.hits[0].url, /customer-object\/records\/customer-record\/conversations\?source=retail-assistant$/);
  assert.equal((await f.run(['retail', 'conversation', 'start', 'customer-object', 'customer-record', '--app-url', f.app.url, '--request-json', f.input('start', { agentId: 'selected', requestId: 'once' }), '--json'])).code, 0);
  assert.equal((await f.run(['retail', 'session', 'send', 'original', '--app-url', f.app.url, '--request-json', f.input('send', { content: [{ type: 'text', text: '继续接待' }], requestId: 'one' }), '--json'])).code, 0);
});

test('account and enterprise entries preserve native browser confirmation without performing identity writes', async t => {
  const f = await member(t, (_hit, res) => respond(res, { tenantId: 'TEN', userId: 'human', applicationId: 'APP' }));
  for (const action of ['account', 'enterprise']) {
    const result = await f.run(['workforce', action, 'open', '--workforce', f.app.url, '--no-browser', '--json']);
    assert.equal(result.code, 0, result.stdout); assert.equal(output(result).data.status, 'requires_browser_interaction');
    assert.deepEqual(output(result).data.expectedIdentity, { tenantId: 'TEN', userId: 'human' });
    assert.equal(new URL(output(result).data.url).origin, f.app.url);
  }
  assert.ok(f.app.hits.every(hit => hit.method === 'GET' && hit.url === '/api/cli/v1/context'));
});

test('Host database browsing uses only server-owned source/schema/table APIs with a saved login', async t => {
  const f = fixture(t), host = await mockServer(t, (hit, res) => { assert.equal(hit.headers.authorization, 'Bearer host-session'); respond(res, { table: 'native' }); });
  f.store.save({ activeProfile: 'Host', profiles: { Host: { server: host.url, scope: 'host' } } });
  f.store.saveSession('Host', host.url, null, 'host-session', Date.now() + 300000, 'host');
  const query = join(f.directory, 'query.json'); writeFileSync(query, '{"previewLimit":5}');
  const result = await f.run(['host', 'database', 'table', 'host', 'dbo', 'Customer', '--query-json', query, '--json']);
  assert.equal(result.code, 0, result.stdout); assert.equal(host.hits[0].url, '/api/service/authen/v1/host/databases/host/schemas/dbo/tables/Customer?previewLimit=5');
  writeFileSync(query, '{"sql":"select *"}');
  assert.equal(output(await f.run(['host', 'database', 'table', 'host', 'dbo', 'Customer', '--query-json', query, '--json'])).error.code, 'invalid_arguments'); assert.equal(host.hits.length, 1);
});
