import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createLocalJWKSet, jwtVerify } from 'jose';
import { CliError, equalIgnoreCase, httpUrl, nonempty } from './core.mjs';
import { request, requireSuccess } from './http.mjs';
import { samePlatformTarget } from './agent-target.mjs';

export const REDIRECT_URI = 'http://127.0.0.1:38749/callback/';
const secureEqual = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export class OidcLogin {
  constructor(config, reporter) { this.config = config; this.reporter = reporter; this.consumed = false; }
  async discover() {
    const { authority, metadataUrl } = this.config;
    httpUrl(authority, 'OIDC authority');
    const address = metadataUrl || (authority === 'https://localhost:5443/' ? 'http://localhost:5080/.well-known/openid-configuration' : new URL('.well-known/openid-configuration', authority.endsWith('/') ? authority : authority + '/').href);
    const metadata = requireSuccess(await request(address, { timeout: 30000, limit: 1024 * 1024 })).json();
    if (metadata.issuer !== authority || !nonempty(metadata.authorization_endpoint) || !nonempty(metadata.token_endpoint) || !nonempty(metadata.jwks_uri))
      throw new CliError('OIDC discovery is invalid.');
    for (const key of ['authorization_endpoint', 'token_endpoint', 'jwks_uri']) httpUrl(metadata[key], 'OIDC endpoint');
    const jwks = requireSuccess(await request(metadata.jwks_uri, { timeout: 30000, limit: 1024 * 1024 })).json();
    if (!Array.isArray(jwks.keys) || !jwks.keys.length) throw new CliError('OIDC signing keys are unavailable.');
    this.metadata = metadata;
    this.keys = createLocalJWKSet(jwks);
  }
  async prepare() {
    await this.discover();
    this.state = randomBytes(32).toString('base64url');
    this.nonce = randomBytes(32).toString('base64url');
    this.verifier = randomBytes(32).toString('base64url');
    const url = new URL(this.metadata.authorization_endpoint);
    for (const [key, value] of Object.entries({ client_id: this.config.clientId, scope: this.config.scope, redirect_uri: this.config.redirectUri, response_type: 'code', state: this.state, nonce: this.nonce, code_challenge: createHash('sha256').update(this.verifier).digest('base64url'), code_challenge_method: 'S256' })) url.searchParams.set(key, value);
    return url.href;
  }
  async verifyIdentity(identityToken, accessToken, { nonceRequired = true } = {}) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const { payload } = await jwtVerify(identityToken, this.keys, {
          algorithms: ['RS256'], issuer: this.config.authority, audience: this.config.clientId,
          requiredClaims: ['sub', 'iat', 'exp', ...(nonceRequired ? ['nonce'] : [])], clockTolerance: 0,
        });
        const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
        if (!nonempty(payload.sub) || !Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp) ||
            payload.iat > Math.floor(Date.now() / 1000) || (nonceRequired && !secureEqual(payload.nonce, this.nonce)) ||
            !audiences.length || audiences.some(a => a !== this.config.clientId) ||
            (payload.azp !== undefined && payload.azp !== this.config.clientId)) throw new Error('Invalid claims');
        if (payload.at_hash !== undefined) {
          const expected = createHash('sha256').update(accessToken).digest().subarray(0, 16).toString('base64url');
          if (!secureEqual(payload.at_hash, expected)) throw new Error('Invalid access token hash');
        }
        return;
      } catch (error) {
        if (attempt === 0 && error.code === 'ERR_JWKS_NO_MATCHING_KEY') { await this.discover(); continue; }
        throw new CliError('OIDC identity validation failed. Retry app login.');
      }
    }
  }
  async complete(callbackUrl) {
    if (this.consumed) throw new CliError('This login response was already used.');
    this.consumed = true;
    const callback = httpUrl(callbackUrl, 'Login callback');
    const expected = new URL(this.config.redirectUri);
    if (callback.origin !== expected.origin || callback.pathname !== expected.pathname || callback.searchParams.getAll('state').length !== 1 ||
        !secureEqual(callback.searchParams.get('state'), this.state)) throw new CliError('OIDC login state is invalid. Retry app login.');
    if (callback.searchParams.has('error') || callback.searchParams.getAll('code').length !== 1 || !nonempty(callback.searchParams.get('code')))
      throw new CliError('OIDC login was rejected or returned no code.');
    const body = new URLSearchParams({ grant_type: 'authorization_code', client_id: this.config.clientId, redirect_uri: this.config.redirectUri,
      code: callback.searchParams.get('code'), code_verifier: this.verifier }).toString();
    const tokens = requireSuccess(await request(this.metadata.token_endpoint, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 30000, limit: 1024 * 1024 })).json();
    for (const key of ['access_token', 'id_token', 'refresh_token']) this.reporter?.secret(tokens[key]);
    if (!nonempty(tokens.id_token) || !nonempty(tokens.access_token) || (tokens.token_type && !equalIgnoreCase(tokens.token_type, 'Bearer')))
      throw new CliError('OIDC login returned invalid tokens.');
    await this.verifyIdentity(tokens.id_token, tokens.access_token);
    return { accessToken: tokens.access_token, identityToken: tokens.id_token };
  }
}

export class DeviceLogin extends OidcLogin {
  constructor(config, reporter, { wait = delay } = {}) { super(config, reporter); this.wait = wait; }
  async prepare() {
    await this.discover();
    const endpoint = this.metadata.device_authorization_endpoint;
    if (!nonempty(endpoint) || !Array.isArray(this.metadata.grant_types_supported) ||
        !this.metadata.grant_types_supported.includes('urn:ietf:params:oauth:grant-type:device_code'))
      throw new CliError('The authentication server does not support device login.', { code: 'device_login_unavailable', hint: 'Use browser login on the CLI host or update the authentication server.' });
    httpUrl(endpoint, 'Device authorization endpoint');
    const body = new URLSearchParams({ client_id: this.config.clientId, scope: this.config.scope }).toString();
    const response = requireSuccess(await request(endpoint, { method: 'POST', body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 30000, limit: 1024 * 1024 }));
    const value = response.json();
    if (!nonempty(value?.device_code) || !nonempty(value?.user_code) || value.user_code.length > 128 || /[\p{Cc}]/u.test(value.user_code) || !nonempty(value?.verification_uri) ||
        !Number.isSafeInteger(value?.expires_in) || value.expires_in <= 0 ||
        (value.interval !== undefined && (!Number.isSafeInteger(value.interval) || value.interval <= 0)))
      throw new CliError('The authentication server returned an invalid device request.', { code: 'invalid_response' });
    const uri = httpUrl(value.verification_uri, 'Device verification URL');
    this.reporter?.secret(value.device_code);
    this.deviceCode = value.device_code;
    this.interval = value.interval ?? 5;
    this.expiresAt = Math.min(Number.MAX_SAFE_INTEGER, Date.now() + value.expires_in * 1000);
    return { verificationUri: uri.href, userCode: value.user_code };
  }
  async complete() {
    if (!this.deviceCode || this.consumed) throw new CliError('Device login was not started or was already used.');
    this.consumed = true;
    const body = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      client_id: this.config.clientId, device_code: this.deviceCode }).toString();
    for (;;) {
      let remaining = this.expiresAt - Date.now();
      if (remaining <= 0) throw new CliError('Device login expired.', { code: 'device_login_expired' });
      await this.wait(Math.min(this.interval * 1000, remaining, 2147483647));
      remaining = this.expiresAt - Date.now();
      if (remaining <= 0) throw new CliError('Device login expired.', { code: 'device_login_expired' });
      const response = await request(this.metadata.token_endpoint, { method: 'POST', body,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: Math.min(30000, remaining), limit: 1024 * 1024 });
      if (!response.ok) {
        let value;
        try { value = response.json(); } catch {}
        if (response.status === 400 && value?.error === 'authorization_pending') continue;
        if (response.status === 400 && value?.error === 'slow_down') { this.interval += 5; continue; }
        if (response.status === 400 && value?.error === 'access_denied') throw new CliError('Device login was declined.', { code: 'device_login_denied' });
        if (response.status === 400 && value?.error === 'expired_token') throw new CliError('Device login expired.', { code: 'device_login_expired' });
        requireSuccess(response);
      }
      const tokens = response.json();
      for (const key of ['access_token', 'id_token', 'refresh_token']) this.reporter?.secret(tokens?.[key]);
      if (!nonempty(tokens?.id_token) || !nonempty(tokens?.access_token) || (tokens.token_type && !equalIgnoreCase(tokens.token_type, 'Bearer')))
        throw new CliError('Device login returned invalid tokens.', { code: 'invalid_response' });
      await this.verifyIdentity(tokens.id_token, tokens.access_token, { nonceRequired: false });
      return { accessToken: tokens.access_token, identityToken: tokens.id_token };
    }
  }
}

export async function listenForCallback(redirectUri = REDIRECT_URI, timeout = 180000) {
  const expected = new URL(redirectUri);
  let accept, fail, timer, consumed = false;
  const callback = new Promise((resolve, reject) => { accept = resolve; fail = reject; });
  callback.catch(() => {});
  const server = createServer((req, res) => {
    let url;
    try { url = new URL(req.url, expected); }
    catch { res.writeHead(400); res.end(); return; }
    if (req.method !== 'GET' || req.headers.host !== expected.host || url.pathname !== expected.pathname || url.origin !== expected.origin || consumed) {
      res.writeHead(404); res.end(); return;
    }
    consumed = true;
    clearTimeout(timer);
    accept({ url: url.href, reply(message) {
      if (res.destroyed) return;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'" });
      res.end(`<meta charset="utf-8"><title>XRain CLI</title><p>${message}</p>`);
    } });
  });
  server.headersTimeout = 10000;
  server.requestTimeout = 10000;
  await new Promise((resolve, reject) => {
    server.once('error', () => reject(new CliError('The local login callback port 38749 is unavailable.')));
    server.listen(Number(expected.port), expected.hostname, resolve);
  });
  timer = setTimeout(() => { fail(new CliError('Browser login timed out. Retry app login.')); server.closeAllConnections(); server.close(); }, timeout);
  return { callback, close() { clearTimeout(timer); server.close(); server.closeIdleConnections(); } };
}

async function openBrowser(url) {
  let executable, args;
  if (process.platform === 'win32') {
    executable = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const script = "$ErrorActionPreference='Stop'; Start-Process -FilePath ([Console]::In.ReadToEnd())";
    args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')];
  } else { executable = process.platform === 'darwin' ? 'open' : 'xdg-open'; args = [url]; }
  return new Promise(resolve => {
    const child = spawn(executable, args, { windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] });
    child.on('error', () => resolve(false));
    child.stdin.on('error', () => {});
    child.stdin.end(process.platform === 'win32' ? url : undefined);
    child.on('exit', code => resolve(code === 0));
  });
}

function tenantSession(response, scope = 'tenant') {
  const data = requireSuccess(response).json();
  if (!nonempty(data.access_token) || (data.token_type !== undefined && !equalIgnoreCase(data.token_type, 'Bearer')) ||
      (scope === 'host' ? data.scope !== 'host' || data.tenantId != null : !nonempty(data.tenantId) || data.scope !== undefined && data.scope !== 'tenant') ||
      !Number.isFinite(Date.parse(data.expires_at_utc)) || Date.parse(data.expires_at_utc) <= Date.now())
    throw new CliError(`XRain returned an invalid ${scope} session.`);
  return { token: data.access_token, tenant: data.tenantId ?? null, scope, expiry: data.expires_at_utc };
}

export async function exchangeTenant(server, accessToken, requestedTenant) {
  const send = (suffix, json) => request(new URL('/api/service/authen/v1/account/sso' + suffix, server), { method: 'POST', token: accessToken, json, timeout: 30000, limit: 1024 * 1024 });
  const selectedSession = response => {
    const session = tenantSession(response);
    if (!equalIgnoreCase(session.tenant, requestedTenant)) throw new CliError('The server returned a different tenant session.');
    return session;
  };
  if (nonempty(requestedTenant)) {
    const selected = await send('/tenant', { tenantId: requestedTenant });
    if (selected.ok) return selectedSession(selected);
    let code;
    try { code = selected.json().errorCode; } catch {}
    if (selected.status !== 403 || code !== 'platform.authen.tenant_membership_required') requireSuccess(selected);
  }
  const initial = tenantSession(await send('', {}));
  if (!nonempty(requestedTenant) || equalIgnoreCase(initial.tenant, requestedTenant)) return initial;
  return selectedSession(await send('/tenant', { tenantId: requestedTenant }));
}

function savePlatformLogin(ctx, profile, session) {
  ctx.store.saveSession(profile.name, profile.server, session.tenant, session.token, session.expiry, session.scope);
  const saved = ctx.store.load();
  const existing = saved.profiles[profile.name] ?? {};
  const sameTarget = samePlatformTarget(existing, profile.server, session.tenant, session.scope);
  const clearedAgentSettings = !sameTarget && !!(existing.runtime || existing.applicationId);
  saved.activeProfile = profile.name;
  saved.profiles[profile.name] = { server: profile.server, tenant: session.tenant, scope: session.scope,
    ...(sameTarget && existing.runtime ? { runtime: existing.runtime } : {}),
    ...(sameTarget && existing.applicationId ? { applicationId: existing.applicationId } : {}) };
  ctx.store.save(saved);
  if (clearedAgentSettings) ctx.reporter.progress('Platform or tenant changed; previous agent connection settings were not reused.');
}

export async function nativeLogin(ctx) {
  if (ctx.stdin.isTTY) throw new CliError('Pipe the password into stdin for native login; do not put it in command arguments.', { code: 'invalid_arguments' });
  const profile = ctx.store.resolve(ctx.args, false, { allowMissing: true });
  const chunks = [];
  let size = 0;
  for await (const chunk of ctx.stdin) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > 4096) throw new CliError('Password input exceeds its size limit.', { code: 'invalid_arguments' });
    chunks.push(bytes);
  }
  let password;
  try { password = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)); }
  catch { throw new CliError('Password input must be UTF-8.', { code: 'invalid_arguments' }); }
  ctx.reporter.secret(password);
  if (!nonempty(password)) throw new CliError('Password input is empty.', { code: 'invalid_arguments' });
  const session = tenantSession(await request(new URL('/api/service/authen/v1/account/login', profile.server), {
    method: 'POST', json: { userName: ctx.args.required('user'), password, ...(profile.scope === 'host' ? { scope: 'host' } : profile.tenant ? { tenantId: profile.tenant } : {}) },
    timeout: ctx.args.timeout(), limit: 1024 * 1024,
  }), profile.scope);
  if (nonempty(profile.tenant) && !equalIgnoreCase(session.tenant, profile.tenant))
    throw new CliError('The server returned a different tenant session.');
  savePlatformLogin(ctx, profile, session);
  ctx.reporter.print(ctx.reporter.json ? { profile: profile.name, server: profile.server, authenticated: true } : `Logged in with profile '${profile.name}'.`);
  return 0;
}

export async function browserLogin(ctx) {
  const market = ctx.args.has('exchange');
  const profile = market ? ctx.store.market(ctx.args) : ctx.store.resolve(ctx.args, false, { allowMissing: true });
  if (profile.scope === 'host') throw new CliError('Host login requires --native --user and --password-stdin.', { code: 'invalid_arguments' });
  const apiRoot = market ? '/api/exchange/v1' : '/api/application/v1';
  const config = requireSuccess(await request(new URL(apiRoot + '/cli-config', profile.server), { timeout: 30000, limit: 1024 * 1024 })).json();
  if (!nonempty(config.authority) || !nonempty(config.clientId) || !nonempty(config.scope) || config.redirectUri !== REDIRECT_URI || (market && config.scope !== 'openid profile'))
    throw new CliError('XRain CLI login configuration is invalid.');
  let callback, listener;
  try {
    let login;
    if (ctx.args.has('device')) {
      const oidc = new DeviceLogin(config, ctx.reporter);
      const device = await oidc.prepare();
      ctx.reporter.progress(`Open ${device.verificationUri} in a browser and enter code: ${device.userCode}`);
      login = await oidc.complete();
    } else {
      listener = await listenForCallback();
      const oidc = new OidcLogin(config, ctx.reporter);
      const url = await oidc.prepare();
      if (ctx.args.has('no-browser') || !await openBrowser(url)) ctx.reporter.progress(`Open this login URL in your browser: ${url}`);
      ctx.reporter.progress('Complete XRain login in your browser. Waiting for the local callback...');
      callback = await listener.callback;
      login = await oidc.complete(callback.url);
    }
    if (market) {
      const data = requireSuccess(await request(new URL('/api/session/sso', profile.server), { method: 'POST', json: { idToken: login.identityToken }, timeout: 30000, limit: 1024 * 1024 })).json();
      if (!Number.isSafeInteger(data.expiresAt)) throw new CliError('The market returned an invalid expiry.');
      ctx.store.saveSession(profile.name, profile.server, '', data.token, data.expiresAt);
    } else {
      const session = await exchangeTenant(profile.server, login.accessToken, profile.tenant);
      savePlatformLogin(ctx, profile, session);
    }
    callback?.reply('登录已完成，可以返回终端。');
    ctx.reporter.print(ctx.reporter.json ? { profile: profile.name, server: profile.server, authenticated: true } :
      market ? 'Logged in to the independent application market.' : `Logged in with profile '${profile.name}'.`);
    return 0;
  } catch (error) { callback?.reply('登录失败，请返回终端查看。'); throw error; }
  finally { listener?.close(); }
}
