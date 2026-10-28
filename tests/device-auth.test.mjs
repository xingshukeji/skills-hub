import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { DeviceLogin, REDIRECT_URI } from '../src/xrain-cli/auth.mjs';
import { fixture, mockServer, respond } from './helpers.mjs';

const pair = await generateKeyPair('RS256');
const jwk = { ...await exportJWK(pair.publicKey), kid: 'device-test', alg: 'RS256', use: 'sig' };
const grant = 'urn:ietf:params:oauth:grant-type:device_code';

async function deviceServer(t, options = {}) {
  let server, attempts = 0;
  const errors = [...(options.errors ?? [])];
  server = await mockServer(t, async (hit, res) => {
    if (hit.url.endsWith('/cli-config')) return respond(res, config());
    if (hit.url === '/.well-known/openid-configuration') return respond(res, {
      issuer: server.url + '/', authorization_endpoint: server.url + '/authorize', token_endpoint: server.url + '/token',
      jwks_uri: server.url + '/jwks', ...(options.unsupported ? {} : { device_authorization_endpoint: server.url + '/device', grant_types_supported: [grant] }),
    });
    if (hit.url === '/jwks') return respond(res, { keys: [jwk] });
    if (hit.url === '/device') {
      const body = new URLSearchParams(hit.body.toString());
      assert.equal(body.get('client_id'), 'test-client'); assert.equal(body.get('scope'), 'openid profile');
      return respond(res, { device_code: 'synthetic-device-secret', user_code: 'ABCD-EFGH', verification_uri: server.url + '/verify', expires_in: 90, interval: 1, ...options.device });
    }
    if (hit.url === '/token') {
      const body = new URLSearchParams(hit.body.toString());
      assert.equal(body.get('grant_type'), grant); assert.equal(body.get('device_code'), 'synthetic-device-secret');
      assert.equal(body.get('client_id'), 'test-client'); attempts++;
      if (errors.length) return respond(res, { error: errors.shift() }, 400);
      const now = Math.floor(Date.now() / 1000);
      const payload = { iss: options.wrongIssuer ? 'https://wrong.example/' : server.url + '/', aud: 'test-client', sub: 'device-user', iat: now, exp: now + 300 };
      const idToken = await new SignJWT(payload).setProtectedHeader({ alg: 'RS256', kid: 'device-test' }).sign(pair.privateKey);
      return respond(res, { access_token: 'synthetic-oidc-access', id_token: idToken, token_type: 'Bearer' });
    }
    if (hit.url === '/api/service/authen/v1/account/sso/tenant') {
      assert.equal(hit.headers.authorization, 'Bearer synthetic-oidc-access');
      assert.deepEqual(hit.json(), { tenantId: 'tenant-demo' });
      return respond(res, { access_token: 'synthetic-tenant-session', tenantId: options.wrongTenant ? 'other-tenant' : 'tenant-demo', expires_at_utc: new Date(Date.now() + 300000).toISOString() });
    }
    return respond(res, { errorCode: 'unknown.test.endpoint' }, 404);
  });
  function config() { return { authority: server.url + '/', clientId: 'test-client', scope: 'openid profile', redirectUri: REDIRECT_URI }; }
  return { ...server, config, get attempts() { return attempts; } };
}

test('device flow respects pending and slow-down intervals and verifies the identity token', async t => {
  const service = await deviceServer(t, { errors: ['authorization_pending', 'slow_down'] }), waits = [], secrets = [];
  const login = new DeviceLogin(service.config(), { secret: value => secrets.push(value) }, { wait: async value => { waits.push(value); } });
  assert.deepEqual(await login.prepare(), { verificationUri: service.url + '/verify', userCode: 'ABCD-EFGH' });
  const result = await login.complete();
  assert.equal(result.accessToken, 'synthetic-oidc-access'); assert.equal(service.attempts, 3);
  assert.deepEqual(waits, [1000, 1000, 6000]); assert.ok(secrets.includes('synthetic-device-secret'));
  await assert.rejects(login.complete(), /already used/);
});

test('device login stores a matching tenant session without displaying credentials', async t => {
  const f = fixture(t), service = await deviceServer(t);
  const result = await f.run(['auth', 'login', '--device', '--server', service.url, '--tenant', 'tenant-demo', '--profile', 'Remote', '--json']);
  assert.equal(result.code, 0, result.stdout); assert.equal(JSON.parse(result.stdout).data.authenticated, true);
  assert.match(result.stderr, /ABCD-EFGH/); assert.equal(f.store.loadSession('Remote', service.url, 'tenant-demo'), 'synthetic-tenant-session');
  for (const secret of ['synthetic-device-secret', 'synthetic-oidc-access', 'synthetic-tenant-session']) assert.ok(!(result.stdout + result.stderr).includes(secret));
});

test('unsupported or declined device login preserves the existing profile and creates no session', async t => {
  for (const options of [{ unsupported: true }, { errors: ['access_denied'] }, { wrongTenant: true }]) await t.test(JSON.stringify(options), async sub => {
    const f = fixture(sub), service = await deviceServer(sub, options);
    const result = await f.run(['auth', 'login', '--device', '--server', service.url, '--tenant', 'tenant-demo', '--profile', 'Remote', '--json']);
    assert.equal(result.code, 1); assert.equal(JSON.parse(result.stdout).ok, false);
    assert.equal(existsSync(f.store.configPath), false); assert.equal(existsSync(f.store.sessionPath('Remote')), false);
  });
});

test('device tokens reject an incorrect issuer and market device login is rejected before network access', async t => {
  const service = await deviceServer(t, { wrongIssuer: true });
  const login = new DeviceLogin(service.config(), undefined, { wait: async () => {} });
  await login.prepare(); await assert.rejects(login.complete(), /identity validation failed/);
  const f = fixture(t), before = service.hits.length;
  const result = await f.run(['auth', 'login', '--device', '--exchange', service.url, '--json']);
  assert.equal(result.code, 1); assert.equal(JSON.parse(result.stdout).error.code, 'invalid_arguments');
  assert.equal(service.hits.length, before);
});

test('malformed device codes cannot inject terminal output', async t => {
  const service = await deviceServer(t, { device: { user_code: 'ABCD\nspoofed-output' } });
  const login = new DeviceLogin(service.config());
  await assert.rejects(login.prepare(), /invalid device request/);
});
