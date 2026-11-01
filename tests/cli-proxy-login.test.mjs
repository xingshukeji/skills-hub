import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, mockServer, respond } from './helpers.mjs';

const expiry = () => new Date(Date.now() + 300000).toISOString();

test('tenant administrator proxy login saves a separate member session and retains the administrator', async t => {
  const f = fixture(t), adminToken = 'administrator-session', memberToken = 'delegated-member-session';
  const service = await mockServer(t, (hit, res) => {
    if (hit.url.endsWith('/login-as')) {
      assert.equal(hit.method, 'POST');
      assert.equal(hit.headers.authorization, `Bearer ${adminToken}`);
      assert.deepEqual(hit.json(), { userName: 'lisi' });
      return respond(res, { access_token: memberToken, token_type: 'Bearer', tenantId: 'tenant-demo',
        scope: 'tenant', userId: 'member-id', proxyByUserId: 'admin-id', expires_at_utc: expiry() });
    }
    assert.equal(hit.url, '/api/service/authen/v1/account/context');
    assert.equal(hit.headers.authorization, `Bearer ${memberToken}`);
    return respond(res, { userId: 'member-id', tenantId: 'tenant-demo', scope: 'tenant' });
  });
  f.store.save({ activeProfile: 'Administrator', profiles: { Administrator: { server: service.url,
    tenant: 'tenant-demo', runtime: 'https://runtime.example', applicationId: 'app-one' } } });
  f.store.saveSession('Administrator', service.url, 'tenant-demo', adminToken, expiry());
  f.env.XRAIN_TOKEN = 'unrelated-environment-token';
  const result = await f.run(['auth', 'login-as', '--profile', 'administrator', '--user', 'lisi', '--save-profile', 'Member', '--json']);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  const data = JSON.parse(result.stdout).data;
  assert.deepEqual({ userId: data.userId, proxyByUserId: data.proxyByUserId, profile: data.profile },
    { userId: 'member-id', proxyByUserId: 'admin-id', profile: 'Member' });
  assert.equal(f.store.load().activeProfile, 'Administrator');
  assert.equal(f.store.loadSession('Administrator', service.url, 'tenant-demo'), adminToken);
  assert.equal(f.store.loadSession('Member', service.url, 'tenant-demo'), memberToken);
  assert.deepEqual(f.store.load().profiles.Member, { server: service.url, tenant: 'tenant-demo', scope: 'tenant',
    runtime: 'https://runtime.example', applicationId: 'app-one' });
  const identity = await f.run(['auth', 'whoami', '--profile', 'Member', '--auth', 'session', '--json']);
  assert.equal(identity.code, 0, identity.stdout);
  assert.equal(JSON.parse(identity.stdout).data.userId, 'member-id');
  for (const secret of [adminToken, memberToken, f.env.XRAIN_TOKEN]) assert.ok(!(result.stdout + result.stderr + identity.stdout).includes(secret));
});

test('proxy login keeps both prior sessions on permission, membership and invalid-response failures', async t => {
  const f = fixture(t), previousToken = 'previous-member-session';
  let scenario;
  const service = await mockServer(t, (_hit, res) => {
    if (scenario.status) return respond(res, { errorCode: scenario.code, message: 'Rejected by the original service.' }, scenario.status);
    return respond(res, { access_token: 'unaccepted-proxy-token', tenantId: 'tenant-demo', scope: 'tenant',
      userId: 'member-id', proxyByUserId: 'admin-id', expires_at_utc: expiry(), ...scenario });
  });
  f.store.save({ activeProfile: 'Admin', profiles: {
    Admin: { server: service.url, tenant: 'tenant-demo' },
    Member: { server: service.url, tenant: 'tenant-demo', runtime: 'https://member-runtime.example' },
  } });
  f.store.saveSession('Admin', service.url, 'tenant-demo', 'admin-token', expiry());
  f.store.saveSession('Member', service.url, 'tenant-demo', previousToken, expiry());
  const before = f.store.load();
  for (scenario of [
    { status: 403, code: 'platform.authen.tenant_administrator_required' },
    { status: 404, code: 'platform.authen.user_not_found' },
    { status: 409, code: 'platform.authen.business_user_not_ready' },
    { tenantId: 'different-tenant' }, { scope: 'host' }, { userId: null }, { proxyByUserId: null },
    { expires_at_utc: new Date(Date.now() - 1000).toISOString() },
  ]) {
    const result = await f.run(['auth', 'login-as', '--profile', 'Admin', '--user', 'lisi', '--save-profile', 'Member', '--json']);
    assert.equal(result.code, 1, JSON.stringify(scenario));
    assert.deepEqual(f.store.load(), before);
    assert.equal(f.store.loadSession('Admin', service.url, 'tenant-demo'), 'admin-token');
    assert.equal(f.store.loadSession('Member', service.url, 'tenant-demo'), previousToken);
    assert.ok(!result.stdout.includes('unaccepted-proxy-token'));
  }
});

test('proxy login rejects unsafe local targets and missing administrator sessions before a request', async t => {
  const f = fixture(t), service = await mockServer(t, (_hit, res) => respond(res, {}, 500));
  f.store.save({ activeProfile: 'Admin', profiles: { Admin: { server: service.url, tenant: 'tenant-demo' },
    Host: { server: service.url, tenant: null, scope: 'host' } } });
  const prefix = ['auth', 'login-as', '--profile', 'Admin', '--json'];
  for (const options of [
    ['--user', 'lisi'], ['--save-profile', 'Member'], ['--user', 'lisi', '--save-profile', 'aDmIn'],
    ['--user', 'lisi', '--save-profile', 'Member', '--auth', 'auto'],
    ['--user', 'lisi', '--save-profile', 'Member'],
  ]) assert.equal((await f.run([...prefix, ...options])).code, 1);
  assert.equal((await f.run(['auth', 'login-as', '--profile', 'Host', '--user', 'lisi', '--save-profile', 'Member', '--json'])).code, 1);
  assert.equal(service.hits.length, 0);
  assert.equal(f.store.load().activeProfile, 'Admin');
});

test('proxy login retains an existing member profile application target on the same platform', async t => {
  const f = fixture(t);
  const service = await mockServer(t, (_hit, res) => respond(res, { access_token: 'member-token', tenantId: 'tenant-demo',
    userId: 'member-id', proxyByUserId: 'admin-id', scope: 'tenant', expires_at_utc: expiry() }));
  f.store.save({ activeProfile: 'Admin', profiles: {
    Admin: { server: service.url, tenant: 'tenant-demo', runtime: 'https://admin-runtime.example', applicationId: 'admin-app' },
    Member: { server: service.url, tenant: 'tenant-demo', runtime: 'https://member-runtime.example', applicationId: 'member-app' },
  } });
  f.store.saveSession('Admin', service.url, 'tenant-demo', 'admin-token', expiry());
  const result = await f.run(['auth', 'login-as', '--profile', 'Admin', '--user', 'lisi', '--save-profile', 'member', '--auth', 'session', '--json']);
  assert.equal(result.code, 0, result.stdout);
  assert.equal(f.store.load().profiles.Member.applicationId, 'member-app');
  assert.equal(f.store.load().profiles.Member.runtime, 'https://member-runtime.example');
  assert.equal(f.store.load().activeProfile, 'Admin');
});
