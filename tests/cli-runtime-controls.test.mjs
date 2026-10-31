import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, mockServer, respond } from './helpers.mjs';

const output = value => JSON.parse(value.stdout);

test('explicit stop and question cancellation preserve the original history and approval decision', async t => {
  const f = fixture(t), state = { running: true, question: true, approval: true };
  const service = await mockServer(t, (hit, res) => {
    assert.equal(hit.headers.authorization, 'Bearer own-token');
    assert.equal(hit.headers['x-xrain-authorization'], 'Bearer own-token');
    if (hit.url === '/v1/dsh/sessions/original/cancel') { state.running = false; respond(res, { accepted: true }, 202); }
    else if (hit.url === '/v1/dsh/pending-actions/question/cancel') {
      assert.deepEqual(hit.json(), { responseId: 'same-response' }); state.question = false; respond(res, { accepted: true }, 202);
    } else if (hit.url === '/v1/dsh/pending-actions/approval/cancel') respond(res, { error: 'INVALID_PENDING_ACTION_RESPONSE' }, 400);
    else if (hit.url === '/v1/dsh/sessions/original/history') respond(res, { type: 'snapshot', records: [], hasMore: false });
    else respond(res, {}, 404);
  });
  f.profile(service.url, 'tenant-one', 'own-token');
  const target = ['--runtime', service.url, '--json'];
  const stop = await f.run(['agent', 'chat', 'cancel', 'original', ...target]);
  assert.equal(stop.code, 0, stop.stdout); assert.equal(output(stop).data.sessionId, 'original');
  assert.equal(state.running, false);
  assert.equal((await f.run(['agent', 'chat', 'history', 'original', ...target])).code, 0);
  assert.equal((await f.run(['agent', 'chat', 'cancel-question', 'question', '--request-id', 'same-response', ...target])).code, 0);
  assert.equal(state.question, false);
  const approval = await f.run(['agent', 'chat', 'cancel-question', 'approval', ...target]);
  assert.equal(output(approval).error.httpStatus, 400);
  assert.equal(state.approval, true);
  assert.equal(service.hits.filter(hit => hit.url.endsWith('/cancel')).length, 3);
});

test('lost stop receipts retain the exact session and never submit another input or stop', async t => {
  const f = fixture(t); let running = true;
  const service = await mockServer(t, (hit, res) => { assert.ok(hit.url.endsWith('/cancel')); running = false; res.destroy(); });
  f.profile(service.url, 'tenant-one', 'own-token');
  const result = await f.run(['agent', 'chat', 'cancel', 'original', '--runtime', service.url, '--json']);
  assert.equal(output(result).error.code, 'outcome_unknown');
  assert.equal(output(result).error.details.sessionId, 'original');
  assert.equal(output(result).error.details.runtime, service.url);
  assert.equal(running, false); assert.equal(service.hits.length, 1);
});

test('another user or tenant and ended native operations retain their server rejection', async t => {
  const f = fixture(t); let changes = 0;
  const service = await mockServer(t, (hit, res) => {
    if (hit.headers.authorization !== 'Bearer own-token') { respond(res, { error: 'SESSION_NOT_FOUND' }, 404); return; }
    if (hit.url.includes('ended')) { respond(res, { error: 'SUBAGENT_NOT_INTERRUPTIBLE' }, 409); return; }
    changes++; respond(res, { accepted: true }, 202);
  });
  for (const [tenant, token] of [['tenant-one', 'other-user'], ['tenant-two', 'other-tenant']]) {
    f.profile(service.url, tenant, token);
    const result = await f.run(['agent', 'chat', 'cancel', 'original', '--runtime', service.url, '--json']);
    assert.equal(output(result).error.code, 'not_found');
  }
  f.profile(service.url, 'tenant-one', 'own-token');
  const ended = await f.run(['agent', 'chat', 'cancel', 'ended-child', '--runtime', service.url, '--json']);
  assert.equal(output(ended).error.code, 'conflict');
  assert.equal(changes, 0);
});

test('session catalogs, slash commands and model selection use their native session contracts', async t => {
  const f = fixture(t); let model = 'first';
  const service = await mockServer(t, (hit, res) => {
    if (hit.url.endsWith('/subagents')) respond(res, { catalog: { entries: [{ kind: 'child', id: 'child' }] }, summaries: [] });
    else if (hit.url.endsWith('/models')) respond(res, { catalog: { providers: [{ id: 'provider', models: [model] }] } });
    else if (hit.url.endsWith('/model')) { assert.deepEqual(hit.json(), { provider: 'provider', model: 'second', reasoningEffort: 'high' }); model = hit.json().model; respond(res, { provider: 'provider', model }); }
    else if (hit.method === 'GET') respond(res, { items: [{ name: '/status' }] });
    else { assert.deepEqual(hit.json(), { line: '/status' }); respond(res, { execution: { commandId: 'native', result: { kind: 'success' } } }); }
  });
  f.profile(service.url, 'tenant-one', 'own-token');
  const target = ['original', '--runtime', service.url, '--json'];
  for (const action of ['subagents', 'commands', 'models']) assert.equal((await f.run(['agent', 'chat', action, ...target])).code, 0);
  const command = await f.run(['agent', 'chat', 'command', ...target, '--line', '/status']);
  assert.equal(output(command).data.execution.result.kind, 'success');
  const selected = await f.run(['agent', 'chat', 'model', ...target, '--values', '{"provider":"provider","model":"second","reasoningEffort":"high"}']);
  assert.equal(selected.code, 0, selected.stdout); assert.equal(model, 'second');
  assert.equal(service.hits.length, 5);
  assert.ok(service.hits.every(hit => hit.url.startsWith('/v1/dsh/sessions/original/')));
  const count = service.hits.length;
  for (const args of [['command', '--line', 'plain input'], ['model', '--values', '{"model":"x"}'], ['model', '--values', '{"provider":"p","model":"m","permissions":["*"]}']]) {
    const result = await f.run(['agent', 'chat', args[0], ...target, ...args.slice(1)]);
    assert.equal(result.code, 1, result.stdout);
  }
  assert.equal(service.hits.length, count);
});
