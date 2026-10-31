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
