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
  assert.equal((await run(f, [...prefix, '--native', '--user', 'admin', '--password-stdin', '--json'], Buffer.alloc(4097))).code, 1);
  assert.equal((await run(f, [...prefix, '--native', '--user', 'admin', '--password-stdin', '--json'], Buffer.from([0xff]))).code, 1);
  assert.equal(service.hits.length, 0);
});
