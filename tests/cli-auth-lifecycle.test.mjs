import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { browserLogin, DeviceLogin, OidcLogin, REDIRECT_URI, listenForCallback } from '../src/xrain-cli/auth.mjs';
import { fixture, mockServer, respond } from './helpers.mjs';

const pair = await generateKeyPair('RS256');
const jwk = { ...await exportJWK(pair.publicKey), kid: 'lifetime-key', alg: 'RS256', use: 'sig' };
const paths = { config: '/api/application/v1/cli-config', metadata: '/.well-known/openid-configuration', keys: '/jwks', device: '/device', token: '/token', tenant: '/api/service/authen/v1/account/sso/tenant' };
async function service(t, options = {}) {
  let server, nonce;
  const entered = Promise.withResolvers(), release = Promise.withResolvers(), closed = Promise.withResolvers();
  t.after(() => release.resolve());
  server = await mockServer(t, async (hit, res) => {
    if (hit.url === paths[options.block]) { res.once('close', closed.resolve); entered.resolve(); await release.promise; }
    let value;
    if (hit.url === paths.config) value = config();
    else if (hit.url === paths.metadata) value = { issuer: server.url + '/', authorization_endpoint: server.url + '/authorize', token_endpoint: server.url + '/token', jwks_uri: server.url + '/jwks', device_authorization_endpoint: server.url + '/device', grant_types_supported: ['urn:ietf:params:oauth:grant-type:device_code'] };
    else if (hit.url === paths.keys) value = { keys: [jwk] };
    else if (hit.url === paths.device) value = { device_code: 'fixture-device', user_code: 'ABCD-EFGH', verification_uri: server.url + '/verify', expires_in: options.expiresIn ?? 120, interval: 1 };
    else if (hit.url === paths.token) {
      const now = Math.floor(Date.now() / 1000), id = await new SignJWT({ iss: server.url + '/', aud: 'lifetime-cli', sub: 'person', iat: now, exp: now + 300, ...(nonce ? { nonce } : {}) }).setProtectedHeader({ alg: 'RS256', kid: 'lifetime-key' }).sign(pair.privateKey);
      value = { access_token: 'fixture-oidc', id_token: id, token_type: 'Bearer' };
    } else if (hit.url === paths.tenant) {
      assert.equal(hit.headers.authorization, 'Bearer fixture-oidc');
      value = { tenantId: 'tenant', access_token: 'fixture-session', expires_at_utc: new Date(Date.now() + 300000).toISOString() };
    } else return respond(res, { errorCode: 'fixture.unexpected' }, 404);
    const body = JSON.stringify(value);
    if (options.partial) { res.writeHead(200, { 'content-type': 'application/json' }); res.write(body.slice(0, 1)); await delay(35); res.end(body.slice(1)); }
    else respond(res, value);
  });
  function config() { return { authority: server.url + '/', clientId: 'lifetime-cli', scope: 'openid profile', redirectUri: REDIRECT_URI }; }
  return { ...server, config, entered: entered.promise, closed: closed.promise, release: release.resolve,
    callback(url) { const parsed = new URL(url); nonce = parsed.searchParams.get('nonce'); return REDIRECT_URI + '?code=fixture-code&state=' + parsed.searchParams.get('state'); } };
}
function originalLogin(f, url) {
  f.profile(url, 'tenant'); f.store.saveSession('Demo', url, 'tenant', 'original-session', new Date(Date.now() + 300000).toISOString());
  const bytes = readFileSync(f.store.configPath), session = readFileSync(f.store.sessionPath('Demo'));
  return () => { assert.deepEqual(readFileSync(f.store.configPath), bytes); assert.deepEqual(readFileSync(f.store.sessionPath('Demo')), session); assert.equal(f.store.loadSession('Demo', url, 'tenant'), 'original-session'); };
}

for (const mode of ['browser', 'device']) test(`${mode} OIDC completes partial bodies without creating a default network timer`, async t => {
  const s = await service(t, { partial: true }), timer = t.mock.method(AbortSignal, 'timeout');
  const login = mode === 'browser' ? new OidcLogin(s.config()) : new DeviceLogin(s.config(), undefined, { wait: async () => {} });
  const preparation = await login.prepare();
  const value = await login.complete(mode === 'browser' ? s.callback(preparation) : undefined);
  assert.equal(value.accessToken, 'fixture-oidc'); assert.equal(timer.mock.callCount(), 0);
});

for (const stage of Object.keys(paths)) test(`cancellation during ${stage} closes its request and preserves the previous protected login`, { timeout: 6000 }, async t => {
  const s = await service(t, { block: stage }), f = fixture(t), unchanged = originalLogin(f, s.url), controller = new AbortController();
  const before = [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')];
  const pending = browserLogin({ ...f.context(['auth', 'login', '--device', '--server', s.url, '--tenant', 'tenant', '--profile', 'Demo']), signal: controller.signal });
  const observed = pending.then(value => ({ value }), error => ({ error })); await s.entered; controller.abort();
  assert.equal((await observed).error, controller.signal.reason); await s.closed; s.release();
  unchanged(); assert.deepEqual([process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')], before);
  const index = Object.keys(paths).indexOf(stage);
  for (const later of Object.keys(paths).slice(index + 1)) assert.equal(s.hits.filter(hit => hit.url === paths[later]).length, 0);
});

test('the actual command handles an interrupt during discovery without saving or retaining process listeners', { timeout: 4000 }, async t => {
  const s = await service(t, { block: 'keys' }), f = fixture(t), unchanged = originalLogin(f, s.url);
  const before = [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')];
  const pending = f.run(['auth', 'login', '--device', '--server', s.url, '--tenant', 'tenant', '--profile', 'Demo', '--json']);
  await s.entered; process.emit('SIGINT'); const result = await pending; await s.closed; s.release();
  assert.equal(result.code, 130); assert.equal(JSON.parse(result.stdout).error.code, 'interrupted'); unchanged();
  assert.deepEqual([process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')], before);
});

test('an explicit HTTP timeout still limits login and preserves the previous protected session', { timeout: 4000 }, async t => {
  const s = await service(t, { block: 'config' }), f = fixture(t), unchanged = originalLogin(f, s.url);
  const result = await f.run(['auth', 'login', '--device', '--server', s.url, '--tenant', 'tenant', '--profile', 'Demo', '--timeout', '1', '--json']);
  assert.equal(result.code, 1); assert.equal(JSON.parse(result.stdout).error.code, 'timeout'); await s.closed; s.release(); unchanged();
});

test('device expiry cancels a pending token response without retry or a saved login', { timeout: 5000 }, async t => {
  const s = await service(t, { block: 'token', expiresIn: 2 }), f = fixture(t), unchanged = originalLogin(f, s.url);
  const result = await f.run(['auth', 'login', '--device', '--server', s.url, '--tenant', 'tenant', '--profile', 'Demo', '--json']);
  assert.equal(result.code, 1); assert.equal(JSON.parse(result.stdout).error.code, 'device_login_expired'); await s.closed; s.release(); unchanged();
  assert.equal(s.hits.filter(hit => hit.url === paths.token).length, 1); assert.equal(s.hits.filter(hit => hit.url === paths.tenant).length, 0);
});

test('device expiry beyond one native timer interval rearms without becoming an immediate timeout', async t => {
  const now = 1700000000000, maximum = 2147483647; t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now });
  const entered = Promise.withResolvers(); let owner;
  const login = new DeviceLogin({}, undefined, { wait: async (_ms, _value, { signal }) => { owner = signal; entered.resolve(); return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })); } });
  login.deviceCode = 'fixture-code'; login.interval = 1; login.expiresAt = now + maximum + 5000; login.metadata = { token_endpoint: 'http://fixture.invalid/token' };
  const pending = login.complete().then(value => ({ value }), error => ({ error })); await entered.promise;
  t.mock.timers.tick(maximum); assert.equal(owner.aborted, false); t.mock.timers.tick(4999); assert.equal(owner.aborted, false);
  t.mock.timers.tick(1); assert.equal((await pending).error.code, 'device_login_expired');
});

async function callbackUri() {
  const socket = createServer(); await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve)); const port = socket.address().port; await new Promise(resolve => socket.close(resolve)); return `http://127.0.0.1:${port}/callback/`;
}
test('callback waiting has no private deadline and cancellation releases an accepted unfinished response', { timeout: 3000 }, async t => {
  const uri = await callbackUri(), controller = new AbortController(), timer = t.mock.method(globalThis, 'setTimeout');
  const listener = await listenForCallback(uri, { signal: controller.signal }); t.after(() => listener.close());
  const pending = fetch(uri + '?state=fixture&code=fixture').catch(error => error); await listener.callback;
  assert.equal(timer.mock.calls.filter(call => call.arguments[1] === 180000).length, 0);
  controller.abort(); const result = await pending; assert.equal(result instanceof Error, true);
  const replacement = await listenForCallback(uri); replacement.close();
});

test('closing a pending callback rejects its wait and releases the listening port', async () => {
  const uri = await callbackUri(), listener = await listenForCallback(uri); listener.close();
  await assert.rejects(listener.callback, { code: 'interrupted' }); const replacement = await listenForCallback(uri); replacement.close();
});
