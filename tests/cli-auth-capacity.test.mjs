import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { readFileSync } from 'node:fs';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { DeviceLogin, REDIRECT_URI } from '../src/xrain-cli/auth.mjs';
import { fixture, mockServer, respond } from './helpers.mjs';

const pair = await generateKeyPair('RS256');
const jwk = { ...await exportJWK(pair.publicKey), kid: 'capacity-key', alg: 'RS256', use: 'sig' };
const claims = Array.from({ length: 26000 }, (_, i) => `claim-${i}-${'字'.repeat(12)}`);
const extension = { claims_supported: claims };
const expiry = () => new Date(Date.now() + 300000).toISOString();
const nativeArgs = ['auth', 'login', '--native', '--user', 'original-person', '--password-stdin', '--profile', 'Demo', '--json'];
const session = (overrides = {}) => ({ access_token: 'capacity-session', tenantId: 'tenant', expires_at_utc: expiry(), ...overrides });

function send(res, value, framed = false, status = 200) {
  const bytes = Buffer.from(JSON.stringify(value));
  res.writeHead(status, { 'content-type': 'application/json', ...(framed ? { 'content-length': bytes.length } : {}) });
  if (framed) res.end(bytes);
  else { res.write(bytes.subarray(0, 65539)); res.end(bytes.subarray(65539)); }
  return bytes.length;
}

async function oidcService(t, stage, framed = false, extra = {}) {
  let server, measured = 0;
  const deviceCode = stage === 'device' ? 'opaque-device-'.repeat(90000) : 'capacity-device';
  server = await mockServer(t, async (hit, res) => {
    let value;
    if (hit.url.endsWith('/cli-config')) value = config();
    else if (hit.url === '/metadata') value = { issuer: server.url + '/', authorization_endpoint: server.url + '/authorize',
      token_endpoint: server.url + '/token', jwks_uri: server.url + '/keys', device_authorization_endpoint: server.url + '/device',
      grant_types_supported: ['urn:ietf:params:oauth:grant-type:device_code'] };
    else if (hit.url === '/keys') value = { keys: stage === 'keys'
      ? [...Array.from({ length: 2800 }, (_, i) => ({ ...jwk, kid: `other-${i}` })), jwk] : [jwk] };
    else if (hit.url === '/device') value = { device_code: deviceCode, user_code: extra.userCode ?? 'CAPACITY-CODE',
      verification_uri: server.url + '/verify', expires_in: 120, interval: 1 };
    else if (hit.url === '/token') {
      assert.equal(new URLSearchParams(hit.body.toString()).get('device_code'), deviceCode);
      const now = Math.floor(Date.now() / 1000);
      const token = await new SignJWT({ ...(stage === 'token' ? { groups: claims } : {}), sub: 'original-person', iat: now, exp: now + 300,
        iss: server.url + '/', aud: 'capacity-cli' }).setProtectedHeader({ alg: 'RS256', kid: jwk.kid }).sign(pair.privateKey);
      value = { access_token: 'capacity-access', id_token: token, token_type: 'Bearer' };
    } else if (hit.url.endsWith('/sso/tenant')) {
      assert.equal(hit.headers.authorization, 'Bearer capacity-access'); assert.equal(hit.json().tenantId, 'tenant'); value = session();
    } else return respond(res, {}, 404);
    const current = hit.url.endsWith('/cli-config') ? 'config' : hit.url.endsWith('/sso/tenant') ? 'tenant' : hit.url.slice(1);
    if (current === stage && ['config', 'metadata', 'tenant'].includes(stage)) value = { ...extension, ...value };
    const size = send(res, value, framed); if (current === stage) measured = size;
  });
  function config() { return { authority: server.url + '/', metadataUrl: server.url + '/metadata', clientId: 'capacity-cli', scope: 'openid profile', redirectUri: REDIRECT_URI }; }
  return { ...server, config, size: () => measured };
}

for (const framed of [false, true]) for (const stage of ['config', 'metadata', 'keys', 'device', 'token', 'tenant'])
  test(`device login consumes a complete ${stage} response above 1 MiB with ${framed ? 'Content-Length' : 'chunked framing'}`, async t => {
    const s = await oidcService(t, stage, framed), f = fixture(t);
    const result = await f.run(['auth', 'login', '--device', '--server', s.url, '--tenant', 'tenant', '--profile', 'Demo', '--json']);
    assert.equal(result.code, 0, result.stdout + result.stderr); assert.ok(s.size() > 1024 * 1024, `${stage}: ${s.size()}`);
    assert.equal(f.store.loadSession('Demo', s.url, 'tenant'), 'capacity-session');
    assert.equal(s.hits.length, 6); assert.equal(new Set(s.hits.map(h => h.url)).size, 6);
    assert.ok(!result.stdout.includes('capacity-session') && !result.stderr.includes('capacity-access'));
  });

test('device display codes retain their complete value above 128 characters and still reject terminal controls', async t => {
  const userCode = 'ABCD-'.repeat(30), s = await oidcService(t, 'ordinary', false, { userCode });
  assert.equal((await new DeviceLogin(s.config()).prepare()).userCode, userCode);
  const invalid = await oidcService(t, 'ordinary', false, { userCode: userCode + '\nspoofed' });
  await assert.rejects(new DeviceLogin(invalid.config()).prepare(), /invalid device request/);
});

test('native password stdin preserves more than 4096 UTF-8 bytes across chunk boundaries and defers credential rejection to the server', async t => {
  const f = fixture(t), password = '  ' + '字🔑'.repeat(701) + '\n', bytes = Buffer.from(password);
  let reject = false;
  const s = await mockServer(t, (hit, res) => {
    assert.equal(hit.json().password, password); assert.equal(hit.json().userName, 'original-person');
    send(res, { ...extension, ...(reject ? { errorCode: 'platform.authen.login_failed', message: password } : session()) }, true, reject ? 401 : 200);
  });
  f.profile(s.url, 'tenant');
  const input = () => Readable.from([bytes.subarray(0, 3), bytes.subarray(3, 4097), bytes.subarray(4097)]);
  const success = await f.run(nativeArgs, { stdin: input() }); assert.equal(success.code, 0, success.stdout);
  assert.equal(f.store.loadSession('Demo', s.url, 'tenant'), 'capacity-session');
  const config = readFileSync(f.store.configPath), protectedBytes = readFileSync(f.store.sessionPath('Demo'));
  reject = true; const denied = await f.run(nativeArgs, { stdin: input() });
  assert.equal(denied.code, 1); assert.equal(JSON.parse(denied.stdout).error.code, 'authentication_failed');
  assert.deepEqual(readFileSync(f.store.configPath), config); assert.deepEqual(readFileSync(f.store.sessionPath('Demo')), protectedBytes);
  assert.ok(!(success.stdout + success.stderr + denied.stdout + denied.stderr).includes(password)); assert.equal(s.hits.length, 2);
});

test('large delegated login and tenant-switch receipts preserve the same person, scope and original administrator', async t => {
  const f = fixture(t); let mismatch = false;
  const s = await mockServer(t, (hit, res) => {
    assert.equal(hit.headers.authorization, hit.url.endsWith('/login-as') ? 'Bearer admin-session' : 'Bearer member-session');
    if (hit.url.endsWith('/login-as')) return send(res, { ...extension, ...session({ access_token: 'member-session', userId: 'member', proxyByUserId: 'admin' }) });
    if (hit.url.endsWith('/context')) return send(res, { ...extension, userId: 'member', tenantId: 'tenant', scope: 'tenant' });
    send(res, { ...extension, ...session({ tenantId: 'destination', userId: mismatch ? 'different-person' : 'member' }) });
  });
  f.profile(s.url, 'tenant'); f.store.saveSession('Demo', s.url, 'tenant', 'admin-session', expiry());
  const proxy = await f.run(['auth', 'login-as', '--user', 'member', '--save-profile', 'Member', '--json']);
  assert.equal(proxy.code, 0, proxy.stdout); assert.equal(f.store.loadSession('Demo', s.url, 'tenant'), 'admin-session');
  const before = readFileSync(f.store.sessionPath('Member')); mismatch = true;
  const args = ['auth', 'switch-tenant', 'destination', '--profile', 'Member', '--json'];
  const rejected = await f.run(args); assert.equal(JSON.parse(rejected.stdout).error.code, 'outcome_unknown');
  assert.deepEqual(readFileSync(f.store.sessionPath('Member')), before);
  mismatch = false; assert.equal((await f.run(args)).code, 0); assert.equal(f.store.loadSession('Member', s.url, 'destination'), 'capacity-session');
  assert.equal(s.hits.filter(h => h.url.endsWith('/switch')).length, 2);
});

test('identity diagnostics, readiness and personal settings read complete responses without a private byte gate', async t => {
  const f = fixture(t); let s;
  s = await mockServer(t, (hit, res) => {
    assert.equal(hit.headers.authorization, 'Bearer saved-session');
    if (hit.url.endsWith('/context') || hit.url === '/v1/dsh/whoami') return send(res, { ...extension, userId: 'person', tenantId: 'tenant', scope: 'tenant' });
    if (hit.url === '/health/ready') return send(res, { ...extension, status: 'ready' });
    assert.equal(hit.url, '/api/tenant/v1/settings/workforce/sendShortcut');
    send(res, { ...extension, settingApp: 'workforce', key: 'sendShortcut', value: 'ctrlEnter' });
  });
  f.store.save({ activeProfile: 'Demo', profiles: { Demo: { server: s.url, tenant: 'tenant', runtime: s.url } } });
  f.store.saveSession('Demo', s.url, 'tenant', 'saved-session', expiry());
  const identity = await f.run(['auth', 'whoami', '--agent', '--json']); assert.equal(identity.code, 0, identity.stdout);
  assert.equal(JSON.parse(identity.stdout).data.agentContext.runtimeIdentity, 'identity_confirmed');
  assert.equal((await f.run(['doctor', '--json'])).code, 0);
  const settings = await f.run(['user', 'settings', 'get', 'send-shortcut', '--json']);
  assert.equal(settings.code, 0, settings.stdout); assert.equal(JSON.parse(settings.stdout).data.claims_supported.at(-1), claims.at(-1));
  assert.equal(s.hits.length, 4);
});
