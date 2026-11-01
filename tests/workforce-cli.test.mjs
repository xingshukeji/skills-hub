import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, mockServer, respond } from './helpers.mjs';
const output = value => JSON.parse(value.stdout);
function setup(f, url) {
  f.store.save({ activeProfile: 'Demo', profiles: { Demo: { server: url, tenant: 'TEN', applicationId: 'APP' } } });
  f.store.saveSession('Demo', url, 'TEN', 'platform-session', Date.now() + 300000);
}

for (const [command, route, readCommand, readRoute] of [
  [['session', 'cancel', 'original'], '/workbench/sessions/original/cancel', ['session', 'history', 'original'], '/workbench/sessions/original/history'],
  [['schedule', 'run', 'cancel', 'plan', 'original'], '/task-schedules/plan/runs/original/cancel', ['schedule', 'run', 'show', 'plan', 'original'], '/task-schedules/plan/runs/original'],
]) test(`${command.slice(0, -1).join(' ')} reaches JSON-only cancellation and preserves refusals and unknown outcomes`, async t => {
  const f = fixture(t), platform = await mockServer(t, (_hit, res) => respond(res, { tenantId: 'TEN', userId: 'human' }));
  let status = 202, writes = 0;
  const host = await mockServer(t, (hit, res) => {
    assert.equal(hit.headers['x-xrain-expected-user-id'], 'human');
    if (hit.method === 'GET') { assert.equal(hit.url, '/api/cli/v1' + readRoute); return respond(res, { status: 'Cancelled' }); }
    assert.equal(hit.url, '/api/cli/v1' + route);
    if (hit.body.toString() !== '{}') return respond(res, { error: { code: 'request.invalid_json' } }, 400);
    writes++;
    if (status === 0) return res.destroy();
    respond(res, status === 202 ? { accepted: true } : { error: { code: status === 403 ? 'execution.forbidden' : 'execution.finished' } }, status);
  });
  setup(f, platform.url);
  const argv = ['workforce', ...command, '--workforce', host.url];
  const accepted = await f.run([...argv, '--json']);
  assert.equal(accepted.code, 0, accepted.stdout); assert.deepEqual(output(accepted).data, { accepted: true });
  status = 403;
  assert.equal(output(await f.run([...argv, '--json'])).error.code, 'permission_denied');
  status = 409;
  assert.equal(output(await f.run([...argv, '--json'])).error.serverCode, 'execution.finished');
  status = 0;
  const batch = join(f.directory, 'cancel-batch.json');
  writeFileSync(batch, JSON.stringify([argv, argv]));
  const unknown = await f.run(['batch', batch, '--json']);
  assert.equal(unknown.code, 1);
  assert.equal(output(unknown).error.details.results[0].error.code, 'outcome_unknown');
  assert.equal(writes, 4, 'one cancellation per explicit command; no replay or second batch step');
  const read = await f.run(['workforce', ...readCommand, '--workforce', host.url, '--json']);
  assert.equal(read.code, 0, read.stdout); assert.equal(output(read).data.status, 'Cancelled');
  assert.equal(writes, 4, 'recovery reads the original resource');
});

test('message execution commands retain the source, native session and explicit approval decision', async t => {
  const f = fixture(t), platform = await mockServer(t, (_hit, res) => respond(res, { tenantId: 'TEN', userId: 'human' }));
  const host = await mockServer(t, (hit, res) => {
    assert.equal(hit.headers['x-xrain-expected-user-id'], 'human');
    respond(res, hit.method === 'GET' ? { items: [] } : { accepted: true });
  });
  setup(f, platform.url);
  assert.equal((await f.run(['workforce', 'message', 'execution', 'show', 'chat', '7', '--workforce', host.url, '--json'])).code, 0);
  const file = join(f.directory, 'decision.json');
  const body = { sessionId: 'native', actionRef: 'original-action', response: { responseId: 'original-decision', outcome: 'rejected' } };
  writeFileSync(file, JSON.stringify(body));
  const decision = await f.run(['workforce', 'message', 'execution', 'respond', 'chat', '7', 'employee', '--request-json', file, '--workforce', host.url, '--json']);
  assert.equal(decision.code, 0, decision.stdout);
  assert.deepEqual(host.hits.map(hit => [hit.method, hit.url]), [['GET', '/api/cli/v1/channels/chat/messages/7/agent-executions'], ['POST', '/api/cli/v1/channels/chat/messages/7/agent-executions/employee/respond']]);
  assert.deepEqual(host.hits[1].json(), body);
});

test('task detach uses the original member, preserves the receipt and stops after an unknown removal', async t => {
  const f = fixture(t), platform = await mockServer(t, (_hit, res) => respond(res, { tenantId: 'TEN', userId: 'human' }));
  let fail = false;
  const host = await mockServer(t, (hit, res) => {
    assert.equal(hit.method, 'DELETE'); assert.equal(hit.url, '/api/cli/v1/tasks/original/channels/chat');
    assert.equal(hit.headers['x-xrain-expected-user-id'], 'human');
    respond(res, fail ? { error: { code: 'platform.unavailable' } } : { id: 'original', channelIds: [] }, fail ? 502 : 200);
  });
  setup(f, platform.url);
  const args = ['workforce', 'task', 'detach', 'original', 'chat', '--workforce', host.url];
  const removed = await f.run([...args, '--json']);
  assert.equal(removed.code, 0, removed.stdout); assert.deepEqual(output(removed).data, { id: 'original', channelIds: [] });
  fail = true;
  const batch = join(f.directory, 'detach-batch.json');
  writeFileSync(batch, JSON.stringify([args, ['workforce', 'people', '--workforce', host.url]]));
  const unknown = await f.run(['batch', batch, '--json']);
  assert.equal(unknown.code, 1); assert.equal(host.hits.length, 2, 'one deletion per explicit command and no next step');
  assert.equal(output(unknown).error.details.results[0].error.code, 'outcome_unknown');
});

test('saved Task receipts stop a batch on incomplete follow-up steps and remain readable without repeating writes', async t => {
  const f = fixture(t), platform = await mockServer(t, (_hit, res) => respond(res, { tenantId: 'TEN', userId: 'human' }));
  let receipt, rejected = false;
  const host = await mockServer(t, (hit, res) => {
    assert.equal(hit.headers['x-xrain-expected-user-id'], 'human');
    assert.equal(hit.headers['x-xrain-expected-tenant-id'], 'TEN');
    assert.equal(hit.headers['x-xrain-application-id'], 'APP');
    if (rejected) return respond(res, { error: { code: 'task.edit_forbidden' } }, 403);
    respond(res, receipt);
  });
  setup(f, platform.url);
  const file = join(f.directory, 'task.json'), batch = join(f.directory, 'batch.json');
  writeFileSync(file, JSON.stringify({ description: 'task', assigneeId: 'agent', status: 'open' }));
  for (const [action, partial] of [
    ['create', { creationIssues: ['channels', 'execution'] }], ['confirm', { confirmationIssues: ['execution'] }],
    ['update', { executionAdmission: 'unavailable' }], ['status', { executionAdmission: 'unavailable' }],
  ]) {
    const args = ['workforce', 'task', action, ...(action === 'create' ? [] : ['original']), '--workforce', host.url,
      ...(action === 'confirm' ? [] : ['--request-json', file])];
    receipt = { id: 'original', status: 'open', ...partial };
    writeFileSync(batch, JSON.stringify([args, ['workforce', 'people', '--workforce', host.url]]));
    const before = host.hits.length, result = await f.run(['batch', batch, '--json']);
    assert.equal(result.code, 1, result.stdout); assert.equal(host.hits.length, before + 1, 'no replay and no next batch command');
    assert.equal(output(result).error.code, 'batch_failed');
    const failedStep = output(result).error.details.results[0];
    assert.equal(failedStep.error.code, 'partial_success');
    assert.deepEqual(failedStep.error.details.result, receipt); assert.equal(failedStep.error.details.taskId, 'original');
    const saved = await f.run(['workforce', 'task', 'show', 'original', '--workforce', host.url, '--json']);
    assert.equal(saved.code, 0, saved.stdout); assert.deepEqual(output(saved).data, receipt, 'inspection is not a new execution');
    receipt = { id: 'original', status: 'open', ...(action === 'update' || action === 'status' ? { executionAdmission: 'accepted' } : {}) };
    assert.equal((await f.run([...args, '--json'])).code, 0, 'accepted AI work is not falsely described as completed');
  }
  rejected = true;
  const denied = await f.run(['workforce', 'task', 'confirm', 'original', '--workforce', host.url, '--json']);
  assert.equal(output(denied).error.code, 'permission_denied');
});

test('Workforce uses the saved platform session and explicit host/application context despite a stale API token', async t => {
  const f = fixture(t); f.env.XRAIN_TOKEN = 'stale-api-token';
  const platform = await mockServer(t, (hit, res) => { assert.equal(hit.url, '/api/service/authen/v1/account/context'); assert.equal(hit.headers.authorization, 'Bearer platform-session'); respond(res, { tenantId: 'TEN', userId: 'human' }); });
  const host = await mockServer(t, (hit, res) => {
    assert.equal(hit.headers.authorization, 'Bearer platform-session'); assert.equal(hit.headers['x-xrain-application-id'], 'APP');
    assert.equal(hit.headers['x-xrain-expected-tenant-id'], 'TEN'); assert.equal(hit.headers['x-xrain-expected-user-id'], 'human');
    assert.equal(hit.headers.cookie, undefined); assert.equal(hit.url, '/api/cli/v1/tasks/original'); respond(res, { id: 'original', status: 'open' });
  });
  setup(f, platform.url);
  const result = await f.run(['workforce', 'task', 'show', 'original', '--workforce', host.url, '--json']);
  assert.equal(result.code, 0, result.stdout); assert.equal(output(result).data.id, 'original'); assert.equal(host.hits.length, 1);
});

test('Task session creation passes taskId to the host without exposing grants and preserves an unknown write without replay', async t => {
  const f = fixture(t), platform = await mockServer(t, (_hit, res) => respond(res, { tenantId: 'TEN', userId: 'human' }));
  let drop = false;
  const host = await mockServer(t, (hit, res) => {
    assert.equal(hit.url, '/api/cli/v1/workbench/sessions'); assert.deepEqual(hit.json(), { taskId: 'task', source: 'xrain-cli', requestId: 'original' });
    if (drop) res.destroy(); else respond(res, { sessionId: 'native' }, 201);
  });
  setup(f, platform.url); const file = join(f.directory, 'session.json'); writeFileSync(file, '{"taskId":"task","source":"xrain-cli","requestId":"original"}');
  const argv = ['workforce', 'session', 'create', '--workforce', host.url, '--request-json', file, '--json'];
  assert.equal((await f.run(argv)).code, 0); drop = true;
  const unknown = output(await f.run(argv)); assert.equal(unknown.error.code, 'outcome_unknown'); assert.equal(unknown.error.details.requestId, 'original'); assert.equal(host.hits.length, 2);
  writeFileSync(file, '{"taskId":"task","grantId":"caller-grant"}');
  assert.equal(output(await f.run(argv)).error.code, 'invalid_arguments'); assert.equal(host.hits.length, 2);
});

test('changed tenants and expired platform sessions stop before a host write; native host rejections stay definite', async t => {
  const f = fixture(t); let tenant = 'OTHER';
  const platform = await mockServer(t, (_hit, res) => respond(res, { tenantId: tenant, userId: 'human' }));
  const host = await mockServer(t, (_hit, res) => respond(res, { error: { code: 'task.edit_forbidden' } }, 403));
  setup(f, platform.url); const file = join(f.directory, 'status.json'); writeFileSync(file, '{"status":"completed"}');
  const argv = ['workforce', 'task', 'status', 'original', '--workforce', host.url, '--request-json', file, '--json'];
  assert.equal(output(await f.run(argv)).error.code, 'identity_mismatch'); assert.equal(host.hits.length, 0);
  tenant = 'TEN'; const denied = output(await f.run(argv)); assert.equal(denied.error.code, 'permission_denied'); assert.equal(denied.error.serverCode, 'task.edit_forbidden'); assert.equal(host.hits.length, 1);
  f.store.deleteSession('Demo'); assert.equal(output(await f.run(argv)).error.code, 'authentication_required'); assert.equal(host.hits.length, 1);
});
