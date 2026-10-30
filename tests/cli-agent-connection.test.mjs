import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, mockServer, respond } from './helpers.mjs';

const output = result => JSON.parse(result.stdout);

test('saved agent targets follow the selected platform, tenant, and explicit personal or application context', async t => {
  const f = fixture(t);
  const platform = await mockServer(t, (hit, res) => {
    if (hit.url.includes('/qualifications')) return respond(res, { items: [], applicationId: new URL(hit.url, 'http://local').searchParams.get('applicationId') });
    if (hit.url.endsWith('/subscription')) return respond(res, { id: 'request', agentId: 'agent-a', selected: true, approvalStatus: 'approved' });
    return respond(res, {});
  });
  const runtime = await mockServer(t, (hit, res) => respond(res, { items: [], applicationId: hit.headers['x-xrain-application-id'] ?? null }));
  const otherRuntime = await mockServer(t, (hit, res) => respond(res, { items: [], applicationId: hit.headers['x-xrain-application-id'] ?? null }));
  f.profile(platform.url, 'tenant-demo', 'synthetic-credential');
  const run = async args => f.run([...args, '--json']);
  const saved = await run(['profile', 'set', '--runtime', runtime.url, '--application-id', 'app-one']);
  assert.equal(saved.code, 0, saved.stdout);
  const shown = output(await run(['profile', 'show'])).data.profile;
  assert.equal(shown.agentRuntime, runtime.url); assert.equal(shown.agentApplicationId, 'app-one');
  const status = output(await run(['auth', 'status'])).data;
  assert.equal(status.agentRuntime, runtime.url); assert.equal(status.agentApplicationId, 'app-one');
  assert.equal(output(await run(['agent', 'directory'])).data.applicationId, 'app-one');
  assert.equal(output(await run(['agent', 'directory', '--mine'])).data.applicationId, null);
  assert.equal(output(await run(['agent', 'directory', '--personal'])).data.applicationId, null);
  assert.match(runtime.hits[1].url, /mine=true/);
  assert.equal(output(await run(['agent', 'directory', '--runtime', otherRuntime.url, '--application-id', 'app-two'])).data.applicationId, 'app-two');
  assert.equal(output(await run(['agent', 'qualifications'])).data.applicationId, 'app-one');
  assert.equal(output(await run(['agent', 'qualifications', '--personal'])).data.applicationId, null);
  assert.equal(output(await run(['agent', 'subscribe', 'agent-a'])).data.approvalStatus, 'approved');
  const before = runtime.hits.length;
  const mismatch = await run(['agent', 'directory', '--tenant', 'another-tenant']);
  assert.equal(mismatch.code, 1); assert.equal(output(mismatch).error.code, 'runtime_not_configured');
  assert.equal(runtime.hits.length, before);
  const explicit = await run(['agent', 'directory', '--tenant', 'another-tenant', '--runtime', otherRuntime.url]);
  assert.equal(explicit.code, 0, explicit.stdout); assert.equal(output(explicit).data.applicationId, null);
  const invalid = await run(['profile', 'set', '--personal', '--application-id', 'app-two']);
  assert.equal(output(invalid).error.code, 'invalid_arguments');
  await run(['profile', 'set', '--personal']);
  assert.equal(output(await run(['profile', 'show'])).data.profile.agentApplicationId, undefined);
  assert.equal(output(await run(['agent', 'directory'])).data.applicationId, null);
  const changed = await run(['profile', 'set', '--tenant', 'another-tenant']);
  assert.equal(output(changed).data.clearedAgentSettings, true);
  assert.equal(output(await run(['profile', 'show'])).data.profile.agentRuntime, undefined);
});

test('whoami distinguishes configured targets, matched identity and unverifiable Runtime failures', async t => {
  const f = fixture(t), secret = 'synthetic-agent-login-token';
  const platform = await mockServer(t, (hit, res) => {
    assert.equal(hit.headers.authorization, `Bearer ${secret}`);
    return respond(res, { userId: 'person-one', tenantId: 'tenant-demo', scope: 'tenant', effectivePermissions: ['private.permission'] });
  });
  let runtimeStatus = 200, runtimeBody = { userId: 'person-one', tenantId: 'tenant-demo' };
  const runtime = await mockServer(t, (hit, res) => {
    assert.equal(hit.url, '/v1/dsh/whoami');
    assert.equal(hit.headers.authorization, `Bearer ${secret}`);
    assert.equal(hit.headers['x-xrain-authorization'], `Bearer ${secret}`);
    return respond(res, runtimeBody, runtimeStatus);
  });
  f.profile(platform.url, 'tenant-demo', secret);
  await f.run(['profile', 'set', '--runtime', runtime.url, '--application-id', 'app-one']);
  const basic = await f.run(['auth', 'whoami', '--json']);
  assert.equal(basic.code, 0); assert.equal(output(basic).data.agentContext.runtimeIdentity, 'not_checked');
  assert.equal(runtime.hits.length, 0);
  const checked = await f.run(['auth', 'whoami', '--agent', '--json']);
  assert.equal(checked.code, 0, checked.stdout);
  assert.deepEqual(output(checked).data.agentContext, { runtime: runtime.url, applicationId: 'app-one', userId: 'person-one', tenantId: 'tenant-demo', runtimeIdentity: 'identity_confirmed' });
  assert.ok(!checked.stdout.includes(secret)); assert.ok(!checked.stdout.includes('private.permission'));
  runtimeBody = { userId: 'different', tenantId: 'tenant-demo' };
  const mismatch = await f.run(['auth', 'whoami', '--agent', '--json']);
  assert.equal(mismatch.code, 1); assert.equal(output(mismatch).error.code, 'identity_mismatch');
  assert.equal(output(mismatch).error.details.platformIdentity.userId, 'person-one');
  assert.equal(output(mismatch).error.details.agentContext.runtimeIdentity, 'mismatch');
  runtimeStatus = 404; runtimeBody = { error: 'NOT_FOUND' };
  const old = await f.run(['auth', 'whoami', '--agent', '--json']);
  assert.equal(old.code, 1); assert.equal(output(old).error.code, 'not_found');
  assert.equal(output(old).error.details.platformIdentity.remoteValidation, 'identity_confirmed');
  assert.equal(output(old).error.details.agentContext.runtimeIdentity, 'unverified');
  assert.match(output(old).error.hint, /does not provide the identity endpoint/);
  runtimeStatus = 200; runtimeBody = { userId: 'person-one' };
  const invalid = await f.run(['auth', 'whoami', '--agent', '--json']);
  assert.equal(output(invalid).error.code, 'invalid_response');
  assert.equal(output(invalid).error.details.platformIdentity.userId, 'person-one');
});

test('invalid saved agent settings do not prevent platform identity checks or explicit recovery', async t => {
  const f = fixture(t);
  const platform = await mockServer(t, (_hit, res) => respond(res, { userId: 'person-one', tenantId: 'tenant-demo', scope: 'tenant' }));
  const runtime = await mockServer(t, (_hit, res) => respond(res, { items: [] }));
  f.profile(platform.url, 'tenant-demo', 'synthetic-token');
  const config = f.store.load(); config.profiles.Demo.runtime = 'not a runtime URL'; config.profiles.Demo.applicationId = 'bad app'; f.store.save(config);
  const identity = await f.run(['auth', 'whoami', '--json']);
  assert.equal(identity.code, 0); assert.equal(output(identity).data.agentContext.runtimeConfiguration, 'invalid');
  assert.equal(output(identity).data.agentContext.applicationConfiguration, 'invalid');
  assert.equal(output(await f.run(['agent', 'directory', '--json'])).error.code, 'invalid_runtime_configuration');
  const selected = await f.run(['agent', 'directory', '--runtime', runtime.url, '--personal', '--json']);
  assert.equal(selected.code, 0, selected.stdout);
});
