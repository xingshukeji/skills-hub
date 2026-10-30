import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { OidcLogin, REDIRECT_URI, exchangeTenant, listenForCallback } from '../src/xrain-cli/auth.mjs';
import { fixture, mockServer, respond } from './helpers.mjs';

const key1 = await generateKeyPair('RS256'), key2 = await generateKeyPair('RS256');
const jwk1 = { ...await exportJWK(key1.publicKey), kid: 'test-key-1', alg: 'RS256', use: 'sig' };
const jwk2 = { ...await exportJWK(key2.publicKey), kid: 'test-key-2', alg: 'RS256', use: 'sig' };

async function identityServer(t, options = {}) {
  let server, nonce, challenge, jwksReads = 0;
  const authorizationTokens = [];
  server = await mockServer(t, async (hit, res) => {
    if (hit.url.endsWith('/cli-config')) return respond(res, config());
    if (hit.url === '/.well-known/openid-configuration') return respond(res, {
      issuer: options.wrongDiscoveryIssuer ? 'https://incorrect.example' : server.url + '/',
      authorization_endpoint: server.url + '/authorize', token_endpoint: server.url + '/token', jwks_uri: server.url + '/jwks',
    });
    if (hit.url === '/jwks') {
      jwksReads++;
      return respond(res, { keys: [options.rotate && jwksReads > 1 ? jwk2 : jwk1] });
    }
    if (hit.url === '/token') {
      assert.equal(hit.method, 'POST');
      assert.equal(hit.headers.authorization, undefined);
      const body = new URLSearchParams(hit.body.toString());
      assert.equal(body.get('grant_type'), 'authorization_code');
      assert.equal(body.get('client_id'), 'test-client');
      assert.equal(body.get('redirect_uri'), REDIRECT_URI);
      assert.equal(body.get('code'), 'test-authorization-code');
      assert.equal(createHash('sha256').update(body.get('code_verifier')).digest('base64url'), challenge);
      const now = Math.floor(Date.now() / 1000);
      const payload = { iss: server.url + '/', aud: 'test-client', sub: 'test-user', iat: now, exp: now + 300, nonce };
      options.mutate?.(payload);
      const privateKey = options.rotate || options.badSignature ? key2.privateKey : key1.privateKey;
      const idToken = options.unsigned ? Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url') + '.' + Buffer.from(JSON.stringify(payload)).toString('base64url') + '.' :
        await new SignJWT(payload).setProtectedHeader({ alg: 'RS256', kid: options.rotate ? 'test-key-2' : 'test-key-1' }).sign(privateKey);
      authorizationTokens.push(idToken);
      return respond(res, { access_token: options.noAccessToken ? '' : 'test-oidc-access-token', id_token: idToken, token_type: 'Bearer' });
    }
    if (hit.url === '/api/service/authen/v1/account/sso/tenant') {
      assert.equal(hit.headers.authorization, 'Bearer test-oidc-access-token');
      assert.deepEqual(hit.json(), { tenantId: 'tenant-demo' });
      if (options.forbid) return respond(res, { errorCode: 'platform.authen.sso_user_inactive' }, 403);
      return respond(res, { access_token: 'test-tenant-session-token', tenantId: 'tenant-demo', expires_at_utc: new Date(Date.now() + 300000).toISOString() });
    }
    if (hit.url === '/api/session/sso') {
      assert.equal(hit.json().idToken, authorizationTokens.at(-1));
      assert.equal(hit.headers.authorization, undefined);
      return respond(res, { token: 'test-market-session-token', expiresAt: Date.now() + 300000 });
    }
    respond(res, { errorCode: 'unknown.test.endpoint' }, 404);
  });
  function config() { return { authority: server.url + '/', clientId: 'test-client', scope: 'openid profile', redirectUri: REDIRECT_URI }; }
  return { ...server, config, authorizationTokens, get jwksReads() { return jwksReads; },
    authorize(url) {
      const parsed = new URL(url);
      nonce = parsed.searchParams.get('nonce'); challenge = parsed.searchParams.get('code_challenge');
      assert.equal(parsed.searchParams.get('code_challenge_method'), 'S256');
      assert.equal(parsed.searchParams.get('response_type'), 'code');
      return `${REDIRECT_URI}?code=test-authorization-code&state=${parsed.searchParams.get('state')}`;
    } };
}

test('OIDC verifies a real RSA signature, PKCE, nonce and a one-use response', async t => {
  const service = await identityServer(t), login = new OidcLogin(service.config());
  const callback = service.authorize(await login.prepare());
  const result = await login.complete(callback);
  assert.equal(result.accessToken, 'test-oidc-access-token');
  assert.equal(result.identityToken, service.authorizationTokens[0]);
  await assert.rejects(login.complete(callback), /already used/);
});

test('OIDC refuses state mismatch before sending the authorization code', async t => {
  const service = await identityServer(t), login = new OidcLogin(service.config());
  const callback = new URL(service.authorize(await login.prepare()));
  callback.searchParams.set('state', 'wrong');
  await assert.rejects(login.complete(callback.href), /state is invalid/);
  assert.equal(service.hits.filter(hit => hit.url === '/token').length, 0);
});

test('OIDC rejects invalid signatures, claims and missing access tokens', async t => {
  const cases = [
    ['bad signature', { badSignature: true }],
    ['unsigned', { unsigned: true }],
    ['expired', { mutate(p) { p.exp -= 600; } }],
    ['wrong issuer', { mutate(p) { p.iss = 'https://wrong.example'; } }],
    ['wrong audience', { mutate(p) { p.aud = 'other-client'; } }],
    ['additional audience', { mutate(p) { p.aud = ['test-client', 'other-client']; } }],
    ['empty audience', { mutate(p) { p.aud = []; } }],
    ['wrong nonce', { mutate(p) { p.nonce = 'other-nonce'; } }],
    ['nonce type', { mutate(p) { p.nonce = 123; } }],
    ['missing subject', { mutate(p) { delete p.sub; } }],
    ['empty subject', { mutate(p) { p.sub = '  '; } }],
    ['string iat', { mutate(p) { p.iat = String(p.iat); } }],
    ['future iat', { mutate(p) { p.iat += 600; } }],
    ['string exp', { mutate(p) { p.exp = String(p.exp); } }],
    ['fractional exp', { mutate(p) { p.exp += 0.5; } }],
    ['wrong authorized party', { mutate(p) { p.azp = 'other-client'; } }],
    ['future not-before', { mutate(p) { p.nbf = p.iat + 300; } }],
    ['bad access-token hash', { mutate(p) { p.at_hash = 'invalid'; } }],
    ['missing access token', { noAccessToken: true }],
  ];
  for (const [name, options] of cases) await t.test(name, async sub => {
    const service = await identityServer(sub, options), login = new OidcLogin(service.config());
    const callback = service.authorize(await login.prepare());
    await assert.rejects(login.complete(callback), /OIDC/);
    assert.equal(service.jwksReads, 1);
  });
});

test('OIDC refreshes discovery and JWKS exactly once for a rotated signing key', async t => {
  const service = await identityServer(t, { rotate: true }), login = new OidcLogin(service.config());
  const result = await login.complete(service.authorize(await login.prepare()));
  assert.equal(result.accessToken, 'test-oidc-access-token');
  assert.equal(service.jwksReads, 2);
});

test('OIDC rejects mismatched discovery issuer and duplicate state', async t => {
  const badService = await identityServer(t, { wrongDiscoveryIssuer: true });
  await assert.rejects(new OidcLogin(badService.config()).prepare(), /discovery is invalid/);
  const service = await identityServer(t), login = new OidcLogin(service.config());
  const callback = service.authorize(await login.prepare());
  await assert.rejects(login.complete(callback + '&state=duplicate'), /state is invalid/);
});

test('loopback listener ignores unrelated paths and closes after timeout', async () => {
  const listener = await listenForCallback(REDIRECT_URI, 80);
  const response = await fetch('http://127.0.0.1:38749/favicon.ico');
  assert.equal(response.status, 404);
  await assert.rejects(listener.callback, /timed out/);
  listener.close();
});

async function completeBrowserFlow(f, service, argv) {
  let browserRequest;
  const result = await f.run(argv, { onOutput(line) {
    const match = /Open this login URL in your browser: (\S+)/.exec(line);
    if (match) browserRequest = fetch(service.authorize(match[1])).then(response => response.text());
  } });
  const browser = await browserRequest;
  return { result, browser };
}

test('full platform browser login saves protected session before returning browser success', async t => {
  const f = fixture(t), service = await identityServer(t);
  const { result, browser } = await completeBrowserFlow(f, service, ['app', 'login', '--server', service.url, '--tenant', 'tenant-demo', '--profile', 'Browser', '--no-browser']);
  assert.equal(result.code, 0, result.stderr); assert.match(browser, /登录已完成/);
  assert.equal(f.store.load().profiles.Browser.tenant, 'tenant-demo');
  assert.equal(f.store.loadSession('browser', service.url, 'tenant-demo'), 'test-tenant-session-token');
  for (const token of ['test-oidc-access-token', 'test-tenant-session-token', ...service.authorizationTokens]) assert.ok(!(result.stdout + result.stderr).includes(token));
  assert.equal((await f.run(['app', 'logout', '--profile', 'browser'])).code, 0);
  assert.equal(existsSync(f.store.sessionPath('Browser')), false);
  assert.ok(f.store.load().profiles.Browser);
});

test('auth login supports machine output while browser progress stays on stderr', async t => {
  const f = fixture(t), service = await identityServer(t);
  const configured = await f.run(['profile', 'set', '--server', service.url, '--tenant', 'tenant-demo', '--profile', 'Machine', '--runtime', 'https://runtime.example', '--application-id', 'app-one', '--json']);
  assert.equal(configured.code, 0, configured.stdout);
  const { result, browser } = await completeBrowserFlow(f, service, ['auth', 'login', '--server', service.url, '--tenant', 'tenant-demo', '--profile', 'Machine', '--no-browser', '--json']);
  assert.equal(result.code, 0, result.stdout); assert.match(browser, /登录已完成/);
  const value = JSON.parse(result.stdout);
  assert.equal(value.ok, true); assert.equal(value.data.authenticated, true); assert.equal(value.data.profile, 'Machine');
  assert.equal(f.store.load().profiles.Machine.runtime, 'https://runtime.example');
  assert.equal(f.store.load().profiles.Machine.applicationId, 'app-one');
  assert.match(result.stderr, /Open this login URL/);
  for (const token of ['test-oidc-access-token', 'test-tenant-session-token', ...service.authorizationTokens]) assert.ok(!(result.stdout + result.stderr).includes(token));
});

test('browser login to a different platform clears the previously associated agent target', async t => {
  const f = fixture(t), service = await identityServer(t);
  f.store.save({ activeProfile: 'Machine', profiles: { Machine: { server: 'http://127.0.0.1:1', tenant: 'tenant-demo', runtime: 'https://runtime.example', applicationId: 'app-one' } } });
  const { result } = await completeBrowserFlow(f, service, ['auth', 'login', '--server', service.url, '--tenant', 'tenant-demo', '--profile', 'Machine', '--no-browser', '--json']);
  assert.equal(result.code, 0, result.stdout); assert.match(result.stderr, /previous agent connection settings were not reused/);
  assert.equal(f.store.load().profiles.Machine.runtime, undefined); assert.equal(f.store.load().profiles.Machine.applicationId, undefined);
});

test('failed tenant exchange produces browser failure and saves no session', async t => {
  const f = fixture(t), service = await identityServer(t, { forbid: true });
  const { result, browser } = await completeBrowserFlow(f, service, ['app', 'login', '--server', service.url, '--tenant', 'tenant-demo', '--no-browser']);
  assert.equal(result.code, 1); assert.match(result.stderr, /HTTP 403/); assert.match(browser, /登录失败/);
  assert.equal(existsSync(f.store.sessionPath('default')), false);
  assert.equal(existsSync(f.store.configPath), false);
  assert.equal(service.hits.filter(hit => hit.url === '/api/service/authen/v1/account/sso').length, 0);
});

test('independent market browser login remains separate from platform profile and session', async t => {
  const f = fixture(t), service = await identityServer(t);
  f.profile('http://127.0.0.1:1', 'platform-tenant');
  const before = f.store.load();
  const { result, browser } = await completeBrowserFlow(f, service, ['app', 'login', '--exchange', service.url, '--profile', 'market', '--no-browser']);
  assert.equal(result.code, 0, result.stderr); assert.match(browser, /登录已完成/);
  assert.deepEqual(f.store.load(), before);
  const args = f.context(['app', 'status', '--exchange', service.url, '--profile', 'market']).args;
  const market = f.store.market(args);
  assert.equal(f.store.loadSession(market.name, service.url, ''), 'test-market-session-token');
  assert.equal(f.store.loadSession('market', service.url, ''), null);
  assert.equal((await f.run(['app', 'logout', '--exchange', service.url, '--profile', 'market'])).code, 0);
  assert.equal(existsSync(f.store.sessionPath(market.name)), false);
});

test('tenant bootstrap occurs only for the designated membership error, then reselects requested tenant', async t => {
  let attempts = 0;
  const service = await mockServer(t, (hit, res) => {
    if (hit.url.endsWith('/tenant') && attempts++ === 0) return respond(res, { errorCode: 'platform.authen.tenant_membership_required' }, 403);
    const tenant = hit.url.endsWith('/tenant') ? 'requested' : 'default-tenant';
    respond(res, { access_token: 'test-session', tenantId: tenant, expires_at_utc: new Date(Date.now() + 300000).toISOString() });
  });
  const result = await exchangeTenant(service.url, 'test-oidc-token', 'requested');
  assert.equal(result.tenant, 'requested');
  assert.deepEqual(service.hits.map(hit => hit.url), ['/api/service/authen/v1/account/sso/tenant', '/api/service/authen/v1/account/sso', '/api/service/authen/v1/account/sso/tenant']);
});

test('tenant exchange rejects a successful response for the wrong tenant', async t => {
  const service = await mockServer(t, (hit, res) => respond(res, { access_token: 'test-session', tenantId: 'unexpected', expires_at_utc: new Date(Date.now() + 300000).toISOString() }));
  await assert.rejects(exchangeTenant(service.url, 'test-oidc-token', 'requested'), /different tenant/);
});
