import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, mockServer, respond } from './helpers.mjs';

const output = result => JSON.parse(result.stdout);
async function setup(t, behavior = {}) {
  const f = fixture(t);
  const service = await mockServer(t, (hit, res) => {
    assert.equal(hit.headers.authorization, 'Bearer source-session');
    assert.equal(hit.headers['x-tenant-id'], undefined);
    if (hit.method === 'GET') {
      assert.equal(hit.url, '/api/service/authen/v1/account/context');
      return respond(res, behavior.context ?? { scope: 'tenant', tenantId: 'SOURCE', userId: 'same-person' });
    }
    assert.equal(hit.method, 'POST');
    assert.equal(hit.url, '/api/service/authen/v1/security/tenants/DESTINATION/switch');
    if (behavior.disconnect) return res.destroy();
    respond(res, behavior.response ?? { access_token: 'destination-session', tenantId: 'DESTINATION', userId: 'same-person',
      token_type: 'Bearer', expires_at_utc: new Date(Date.now() + 300000).toISOString() }, behavior.status ?? 200);
  });
  f.store.save({ activeProfile: 'Demo', profiles: { Demo: { server: service.url, tenant: 'SOURCE', runtime: service.url, applicationId: 'source-app' } } });
  f.store.saveSession('Demo', service.url, 'SOURCE', 'source-session', Date.now() + 300000);
  f.env.XRAIN_TOKEN = 'unrelated-api-token';
  return { ...f, service, run: (...args) => f.run(['auth', 'switch-tenant', 'DESTINATION', ...args, '--json']) };
}

test('tenant switching exchanges the saved session for the same person, selects the new tenant and clears unrelated Runtime/application settings', async t => {
  const f = await setup(t), result = await f.run();
  assert.equal(result.code, 0, result.stdout);
  assert.equal(output(result).data.userId, 'same-person');
  assert.equal(output(result).data.sourceTenantId, 'SOURCE');
  assert.equal(output(result).data.tenantId, 'DESTINATION');
  assert.equal(f.store.load().activeProfile, 'Demo');
  assert.deepEqual(f.store.load().profiles.Demo, { server: f.service.url, tenant: 'DESTINATION', scope: 'tenant' });
  assert.equal(f.store.loadSession('Demo', f.service.url, 'DESTINATION'), 'destination-session');
  assert.equal(f.store.loadSession('Demo', f.service.url, 'SOURCE'), null);
  assert.equal(f.service.hits.length, 2);
  assert.equal(result.stdout.includes('destination-session'), false);
});

test('saving the target separately preserves the source login and only reuses configuration bound to that destination', async t => {
  const f = await setup(t), before = f.store.load();
  before.profiles.Other = { server: f.service.url, tenant: 'DESTINATION', runtime: f.service.url, applicationId: 'destination-app' };
  f.store.save(before);
  const result = await f.run('--save-profile', 'other');
  assert.equal(result.code, 0, result.stdout);
  assert.equal(f.store.load().activeProfile, 'Other');
  assert.deepEqual(f.store.load().profiles.Demo, before.profiles.Demo);
  assert.equal(f.store.loadSession('Demo', f.service.url, 'SOURCE'), 'source-session');
  assert.equal(f.store.loadSession('Other', f.service.url, 'DESTINATION'), 'destination-session');
  assert.equal(f.store.load().profiles.Other.applicationId, 'destination-app');
});

for (const [label, behavior, expected] of [
  ['a changed source tenant', { context: { scope: 'tenant', tenantId: 'OTHER', userId: 'same-person' } }, 'identity_mismatch'],
  ['a different returned person', { response: { tenantId: 'DESTINATION', userId: 'someone-else', access_token: 'do-not-save', expires_at_utc: new Date(Date.now() + 300000).toISOString() } }, 'outcome_unknown'],
  ['a different returned tenant', { response: { tenantId: 'OTHER', userId: 'same-person', access_token: 'do-not-save', expires_at_utc: new Date(Date.now() + 300000).toISOString() } }, 'outcome_unknown'],
  ['an invalid receipt', { response: { tenantId: 'DESTINATION', userId: 'same-person' } }, 'outcome_unknown'],
  ['original permission denial', { status: 403, response: { errorCode: 'platform.authen.tenant_membership_required' } }, 'permission_denied'],
  ['server failure', { status: 503, response: { errorCode: 'platform.unavailable' } }, 'outcome_unknown'],
  ['a lost receipt', { disconnect: true }, 'outcome_unknown'],
]) test(`tenant switching preserves saved connections after ${label} without replaying`, async t => {
  const f = await setup(t, behavior), before = f.store.load();
  const result = await f.run('--save-profile', 'Other');
  assert.equal(result.code, 1, result.stdout);
  assert.equal(output(result).error.code, expected);
  assert.deepEqual(f.store.load(), before);
  assert.equal(f.store.loadSession('Demo', f.service.url, 'SOURCE'), 'source-session');
  assert.equal(f.store.loadSession('Other', f.service.url, 'DESTINATION'), null);
  assert.equal(f.service.hits.filter(hit => hit.method === 'POST').length, expected === 'identity_mismatch' ? 0 : 1);
  assert.equal(result.stdout.includes('do-not-save'), false);
});

test('tenant switching cannot borrow a service token, select another identity or overwrite the source via save-profile', async t => {
  const f = await setup(t);
  assert.equal(output(await f.run('--auth', 'auto')).error.code, 'invalid_arguments');
  assert.equal(output(await f.run('--user', 'other')).error.code, 'invalid_arguments');
  assert.equal(output(await f.run('--save-profile', 'demo')).error.code, 'invalid_arguments');
  f.store.deleteSession('Demo');
  assert.equal(output(await f.run()).error.code, 'authentication_required');
  assert.equal(f.service.hits.length, 0);
});
