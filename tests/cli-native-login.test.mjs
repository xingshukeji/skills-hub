import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { main } from '../src/xrain-cli/main.mjs';
import { fixture, mockServer, respond } from './helpers.mjs';

async function run(f, args, input = '') {
  let stdout = '', stderr = '';
  const stdin = typeof input === 'string' || Buffer.isBuffer(input) ? Readable.from([input]) : input;
  const code = await main(args, { env: f.env, stdin, stdout: { write(value) { stdout += value; } }, stderr: { write(value) { stderr += value; } } });
  return { code, stdout, stderr };
}

test('native tenant login reuses the protected session and retains the matching agent target', async t => {
  const f = fixture(t), password = '  native-pass-字  ', token = 'native-tenant-session-token';
  const service = await mockServer(t, (hit, res) => {
    if (hit.url === '/api/service/authen/v1/account/login') {
      assert.equal(hit.method, 'POST');
      assert.deepEqual(hit.json(), { userName: 'tenant-admin', password, tenantId: 'tenant-demo' });
      return respond(res, { access_token: token, token_type: 'Bearer', tenantId: 'tenant-demo', expires_at_utc: new Date(Date.now() + 300000).toISOString() });
    }
    if (hit.url === '/api/service/authen/v1/account/context') {
      assert.equal(hit.headers.authorization, `Bearer ${token}`);
      return respond(res, { userId: 'admin-id', tenantId: 'tenant-demo', scope: 'tenant' });
    }
    return respond(res, {}, 404);
  });
  f.store.save({ activeProfile: 'Demo', profiles: { Demo: { server: service.url, tenant: 'tenant-demo', runtime: 'https://runtime.example', applicationId: 'app-one' } } });
  const login = await run(f, ['auth', 'login', '--profile', 'Demo', '--native', '--user', 'tenant-admin', '--password-stdin', '--json'], password);
  assert.equal(login.code, 0, login.stdout + login.stderr);
  assert.equal(JSON.parse(login.stdout).data.authenticated, true);
  assert.equal(f.store.loadSession('Demo', service.url, 'tenant-demo'), token);
  assert.equal(f.store.load().profiles.Demo.runtime, 'https://runtime.example');
  assert.equal(f.store.load().profiles.Demo.applicationId, 'app-one');
  assert.ok(!(login.stdout + login.stderr).includes(password));
  assert.ok(!(login.stdout + login.stderr).includes(token));
  const identity = await run(f, ['auth', 'whoami', '--profile', 'Demo', '--auth', 'session', '--json']);
  assert.equal(identity.code, 0, identity.stdout);
  assert.equal(JSON.parse(identity.stdout).data.userId, 'admin-id');
  assert.ok(!identity.stdout.includes(token));
});

test('native login rejects failed or mismatched sessions without replacing the previous login', async t => {
  const f = fixture(t), password = 'password-that-must-not-leak';
  let fail = true;
  const service = await mockServer(t, (hit, res) => fail
    ? respond(res, { errorCode: 'platform.authen.login_failed', message: `bad ${password}` }, 401)
    : respond(res, { access_token: 'wrong-tenant-token', token_type: 'Bearer', tenantId: 'other-tenant', expires_at_utc: new Date(Date.now() + 300000).toISOString() }));
  f.profile(service.url, 'tenant-demo');
  f.store.saveSession('Demo', service.url, 'tenant-demo', 'previous-session', Date.now() + 300000);
  const before = f.store.load();
  const argv = ['auth', 'login', '--profile', 'Demo', '--native', '--user', 'tenant-admin', '--password-stdin', '--json'];
  const rejected = await run(f, argv, password);
  assert.equal(rejected.code, 1);
  assert.ok(!(rejected.stdout + rejected.stderr).includes(password));
  assert.equal(f.store.loadSession('Demo', service.url, 'tenant-demo'), 'previous-session');
  fail = false;
  const mismatch = await run(f, argv, password);
  assert.equal(mismatch.code, 1);
  assert.match(mismatch.stdout, /different tenant/);
  assert.equal(f.store.loadSession('Demo', service.url, 'tenant-demo'), 'previous-session');
  assert.deepEqual(f.store.load(), before);
});

test('native login requires safe stdin and rejects incompatible modes before making a request', async t => {
  const f = fixture(t), service = await mockServer(t, (_hit, res) => respond(res, {}, 500));
  f.profile(service.url);
  const prefix = ['auth', 'login', '--profile', 'Demo'];
  for (const args of [
    ['--native', '--user', 'admin'], ['--native', '--password-stdin'],
    ['--user', 'admin', '--password-stdin'], ['--native', '--user', 'admin', '--password-stdin', '--device'],
    ['--native', '--user', 'admin', '--password-stdin', '--exchange', service.url],
  ]) assert.equal((await run(f, [...prefix, ...args, '--json'], 'secret')).code, 1);
  const tty = Readable.from([]); tty.isTTY = true;
  assert.equal((await run(f, [...prefix, '--native', '--user', 'admin', '--password-stdin', '--json'], tty)).code, 1);
  assert.equal((await run(f, [...prefix, '--native', '--user', 'admin', '--password-stdin', '--json'], '')).code, 1);
  assert.equal((await run(f, [...prefix, '--native', '--user', 'admin', '--password-stdin', '--json'], Buffer.from([0xff]))).code, 1);
  assert.equal(service.hits.length, 0);
});

test('password change uses the saved tenant login and requires a fresh login after the server confirms it', async t => {
  const f = fixture(t), token = 'synthetic-saved-tenant-token';
  const currentPassword = '  original-password-字  ', newPassword = 'h7r4d6ak';
  let password = currentPassword;
  const service = await mockServer(t, (hit, res) => {
    if (hit.url === '/api/service/authen/v1/account/password') {
      assert.equal(hit.method, 'POST');
      assert.equal(hit.headers.authorization, 'Bearer ' + token);
      assert.deepEqual(hit.json(), { currentPassword, newPassword });
      password = newPassword;
      return res.writeHead(204).end();
    }
    assert.equal(hit.url, '/api/service/authen/v1/account/login');
    assert.deepEqual(hit.json(), { userName: 'member', password, tenantId: 'tenant-demo' });
    return respond(res, { access_token: 'fresh-tenant-login', token_type: 'Bearer', tenantId: 'tenant-demo',
      expires_at_utc: new Date(Date.now() + 300000).toISOString() });
  });
  f.profile(service.url, 'tenant-demo');
  f.store.saveSession('Demo', service.url, 'tenant-demo', token, Date.now() + 300000);
  f.env.XRAIN_TOKEN = 'unrelated-api-token';
  const args = ['auth', 'password', 'change', '--profile', 'Demo', '--auth', 'session', '--request-json', '-', '--json'];
  const result = await run(f, args, JSON.stringify({ currentPassword, newPassword }));
  assert.equal(result.code, 0);
  assert.deepEqual(JSON.parse(result.stdout).data, { changed: true, reauthenticationRequired: true });
  assert.equal(service.hits.length, 1);
  for (const secret of [currentPassword, newPassword, token, f.env.XRAIN_TOKEN])
    assert.ok(!(result.stdout + result.stderr).includes(secret));
  const logged = await run(f, ['auth', 'login', '--native', '--user', 'member', '--password-stdin', '--json'], newPassword);
  assert.equal(logged.code, 0);
  assert.equal(f.store.loadSession('Demo', service.url, 'tenant-demo'), 'fresh-tenant-login');
});

test('password change distinguishes unsupported targets, rejected credentials and unknown write outcomes without replay', async t => {
  const f = fixture(t), currentPassword = 'private-current-pass', newPassword = 'x7c3t6me';
  let resultMode = 404;
  const service = await mockServer(t, (_hit, res) => {
    if (resultMode === 'disconnect') return res.destroy();
    return respond(res, { errorCode: 'platform.authen.current_password_invalid',
      message: currentPassword + ' ' + newPassword, echo: { currentPassword, newPassword } }, resultMode);
  });
  f.profile(service.url);
  f.store.saveSession('Demo', service.url, 'tenant-demo', 'known-session', Date.now() + 300000);
  const args = ['auth', 'password', 'change', '--request-json', '-', '--json'];
  for (const [mode, code] of [[404, 'password_change_unavailable'], [405, 'password_change_unavailable'],
    [400, 'http_error'], [403, 'permission_denied'], [200, 'outcome_unknown'], ['disconnect', 'outcome_unknown']]) {
    resultMode = mode;
    const count = service.hits.length;
    const result = await run(f, args, JSON.stringify({ currentPassword, newPassword }));
    const error = JSON.parse(result.stdout).error;
    assert.equal(result.code, 1);
    assert.equal(error.code, code);
    if (mode === 400) assert.equal(error.serverCode, 'platform.authen.current_password_invalid');
    if (code === 'outcome_unknown') assert.match(error.hint, /fresh login/);
    assert.equal(service.hits.length, count + 1);
    assert.ok(!(result.stdout + result.stderr).includes(currentPassword));
    assert.ok(!(result.stdout + result.stderr).includes(newPassword));
  }
  const touches = service.hits.length;
  const extraUser = await run(f, args, JSON.stringify({ currentPassword, newPassword, userName: 'another-user' }));
  assert.equal(JSON.parse(extraUser.stdout).error.code, 'invalid_arguments');
  const host = await run(f, [...args, '--scope', 'host'], JSON.stringify({ currentPassword, newPassword }));
  assert.equal(JSON.parse(host.stdout).error.code, 'tenant_required');
  f.store.deleteSession('Demo');
  f.env.XRAIN_TOKEN = 'unrelated-api-token';
  const noSession = await run(f, args, JSON.stringify({ currentPassword, newPassword }));
  assert.equal(JSON.parse(noSession.stdout).error.code, 'authentication_required');
  assert.equal(service.hits.length, touches);
});

test('explicit Host login binds scope, ignores an inherited tenant, and cannot reuse its session for a tenant', async t => {
  const f = fixture(t), token = 'synthetic-host-session', password = 'synthetic-host-password';
  let wrongScope = false;
  const service = await mockServer(t, (hit, res) => {
    if (hit.url.endsWith('/login')) {
      assert.deepEqual(hit.json(), { userName: 'fixed-host', password, scope: 'host' });
      return respond(res, { access_token: token, token_type: 'Bearer', tenantId: wrongScope ? 'tenant-demo' : null,
        scope: wrongScope ? 'tenant' : 'host', expires_at_utc: new Date(Date.now() + 300000).toISOString() });
    }
    assert.equal(hit.headers.authorization, `Bearer ${token}`);
    return respond(res, { userId: 'host-user', tenantId: null, scope: 'host' });
  });
  f.env.XRAIN_TENANT = 'tenant-demo';
  f.store.save({ activeProfile: 'Demo', profiles: { Demo: { server: service.url, tenant: 'tenant-demo', runtime: 'https://runtime.example' } } });
  const argv = ['auth', 'login', '--profile', 'Demo', '--scope', 'host', '--native', '--user', 'fixed-host', '--password-stdin', '--json'];
  const logged = await run(f, argv, password);
  assert.equal(logged.code, 0, logged.stdout);
  assert.deepEqual(f.store.load().profiles.Demo, { server: service.url, tenant: null, scope: 'host' });
  assert.equal(f.store.loadSession('Demo', service.url, null, 'host'), token);
  assert.equal(f.store.loadSession('Demo', service.url, null, 'tenant'), null);
  assert.equal(f.store.loadSession('Demo', service.url, 'tenant-demo', 'tenant'), null);
  const identity = await run(f, ['auth', 'whoami', '--scope', 'host', '--auth', 'session', '--json']);
  assert.equal(JSON.parse(identity.stdout).data.scope, 'host');
  const tenant = await run(f, ['auth', 'whoami', '--tenant', 'tenant-demo', '--auth', 'session', '--json']);
  assert.equal(JSON.parse(tenant.stdout).error.code, 'authentication_required');
  wrongScope = true;
  assert.equal((await run(f, argv, password)).code, 1);
  assert.equal(f.store.loadSession('Demo', service.url, null, 'host'), token);
  const before = service.hits.length;
  for (const options of [ ['--scope', 'host'], ['--scope', 'host', '--native', '--user', 'fixed-host', '--password-stdin', '--tenant', 'tenant-demo'] ])
    assert.equal((await run(f, ['auth', 'login', ...options, '--json'], password)).code, 1);
  assert.equal(service.hits.length, before);
  assert.ok(!logged.stdout.includes(token) && !logged.stdout.includes(password));
});
