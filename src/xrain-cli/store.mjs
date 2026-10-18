import { mkdirSync, writeFileSync, renameSync, unlinkSync, chmodSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { CliError, DEFAULT_SERVER, equalIgnoreCase, isObject, nonempty, origin, parseJson, readLimited, sha256 } from './core.mjs';

export function writePrivate(path, bytes) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomBytes(8).toString('hex')}.tmp`;
  try {
    writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o600 });
    renameSync(temporary, path);
    if (process.platform !== 'win32') chmodSync(path, 0o600);
  } finally { if (existsSync(temporary)) unlinkSync(temporary); }
}

// Windows ships this DPAPI bridge in Windows PowerShell. Secrets travel over stdin,
// never process arguments; there is deliberately no plaintext fallback on failure.
export function dpapi(data, entropy, operation) {
  const script = "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $r=[Console]::In.ReadToEnd()|ConvertFrom-Json; $d=[Convert]::FromBase64String($r.data); $e=[Convert]::FromBase64String($r.entropy); if($r.operation -eq 'protect'){$o=[Security.Cryptography.ProtectedData]::Protect($d,$e,[Security.Cryptography.DataProtectionScope]::CurrentUser)}else{$o=[Security.Cryptography.ProtectedData]::Unprotect($d,$e,[Security.Cryptography.DataProtectionScope]::CurrentUser)}; [Console]::Out.Write([Convert]::ToBase64String($o))";
  const executable = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const result = spawnSync(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
    input: JSON.stringify({ data: Buffer.from(data).toString('base64'), entropy: Buffer.from(entropy).toString('base64'), operation }),
    encoding: 'utf8', windowsHide: true, timeout: 15000, maxBuffer: 2 * 1024 * 1024,
  });
  if (result.error || result.status !== 0 || !/^[A-Za-z0-9+/=]+$/.test(result.stdout.trim()))
    throw new CliError('Windows session protection is unavailable. Check Windows PowerShell and your current user account.', { code: 'session_protection_unavailable' });
  return Buffer.from(result.stdout.trim(), 'base64');
}

export class Store {
  constructor(env = process.env, reporter) {
    this.env = env;
    this.reporter = reporter;
    const home = env.XRAIN_HOME ? resolve(env.XRAIN_HOME) : join(homedir(), '.xrain');
    this.configPath = resolve(env.XRAIN_CONFIG_PATH || join(home, 'profiles.json'));
    this.secretPath = resolve(env.XRAIN_LOCAL_TEST_SECRETS_PATH || env.XRain__Security__SeedApiTokens__Path || join(home, 'local-test-secrets.json'));
    this.sessionDir = resolve(env.XRAIN_SESSION_DIR || join(home, 'sessions'));
    this.sessionCache = new Map();
  }
  load() {
    if (!existsSync(this.configPath)) return { activeProfile: 'default', profiles: Object.create(null) };
    const data = parseJson(readLimited(this.configPath, 1024 * 1024, 'Profile store'), 'Profile store');
    if (!isObject(data) || !isObject(data.profiles) || (data.activeProfile !== undefined && !nonempty(data.activeProfile)))
      throw new CliError('Profile store has an invalid structure.');
    const profiles = Object.create(null);
    for (const [key, value] of Object.entries(data.profiles)) {
      if (!nonempty(key) || !isObject(value) || Object.values(value).some(v => v !== null && typeof v !== 'string'))
        throw new CliError('Profile store has an invalid profile.');
      if (Object.keys(profiles).some(existing => equalIgnoreCase(existing, key))) throw new CliError('Profile names must be unique ignoring case.');
      profiles[key] = value;
      this.reporter?.secret(value.bearerToken);
    }
    return { activeProfile: data.activeProfile ?? 'default', profiles };
  }
  save(config) { writePrivate(this.configPath, JSON.stringify(config, null, 2) + '\n'); }
  canonical(name, config = this.load()) {
    return Object.keys(config.profiles).find(key => equalIgnoreCase(key, name)) ?? name;
  }
  resolve(args, requireTenant = false, { allowMissing = false } = {}) {
    const config = this.load();
    const name = this.canonical(args.value('profile') ?? config.activeProfile, config);
    if (args.has('profile') && !allowMissing && !Object.hasOwn(config.profiles, name))
      throw new CliError(`Profile '${name}' does not exist.`, { code: 'profile_not_found', hint: 'Run profile list, or create the connection with auth login/profile set.' });
    const saved = config.profiles[name] ?? {};
    const profile = {
      name,
      server: origin(args.value('server') ?? this.env.XRAIN_SERVER ?? saved.server ?? DEFAULT_SERVER),
      tenant: args.value('tenant') ?? this.env.XRAIN_TENANT ?? saved.tenant,
      bearerToken: args.value('bearer') ?? this.env.XRAIN_TOKEN ?? saved.bearerToken,
      tokenName: args.value('token-name') ?? this.env.XRAIN_TOKEN_NAME ?? saved.tokenName,
    };
    this.reporter?.secret(profile.bearerToken);
    if (requireTenant && !nonempty(profile.tenant)) throw new CliError('Tenant is required. Run auth login --tenant <tenantId>.', { code: 'tenant_required' });
    return profile;
  }
  secrets(create = false) {
    const data = existsSync(this.secretPath) ? parseJson(readLimited(this.secretPath, 1024 * 1024, 'Local token store'), 'Local token store') : {};
    if (!isObject(data)) throw new CliError('Local token store has an invalid structure.');
    for (const [key, envKey] of [['adminApiToken', 'Admin'], ['guestApiToken', 'Guest']]) {
      if (create) data[key] = this.env[`XRain__Security__SeedApiTokens__${envKey}`] || data[key] || randomBytes(32).toString('base64url');
      if (data[key] !== undefined && !nonempty(data[key])) throw new CliError('Local token store has an invalid token.');
      this.reporter?.secret(data[key]);
    }
    if (create) writePrivate(this.secretPath, JSON.stringify(data, null, 2) + '\n');
    return data;
  }
  sessionPath(name) { return join(this.sessionDir, sha256(this.canonical(name)) + '.bin'); }
  saveSession(name, server, tenantId, token, expiry) {
    if (!nonempty(token) || !Number.isFinite(new Date(expiry).getTime()) || new Date(expiry).getTime() <= Date.now()) throw new CliError('The server returned an invalid session.');
    name = this.canonical(name);
    this.reporter?.secret(token);
    let bytes = Buffer.from(JSON.stringify({ server: origin(server), tenantId, token, expiresAtUtc: new Date(expiry).toISOString() }));
    if (process.platform === 'win32') bytes = dpapi(bytes, name, 'protect');
    mkdirSync(this.sessionDir, { recursive: true, mode: 0o700 });
    if (process.platform !== 'win32') chmodSync(this.sessionDir, 0o700);
    writePrivate(this.sessionPath(name), bytes);
    this.sessionCache.delete(this.sessionPath(name));
  }
  inspectSession(name, server, tenantId) {
    name = this.canonical(name);
    try {
      const path = this.sessionPath(name), bytes = readLimited(path, 1024 * 1024, 'Session'), digest = sha256(bytes);
      let session = this.sessionCache.get(path)?.digest === digest ? this.sessionCache.get(path).session : undefined;
      if (!session) {
        session = parseJson(process.platform === 'win32' ? dpapi(bytes, name, 'unprotect') : bytes, 'Session');
        if (!isObject(session) || !nonempty(session.token) || !Number.isFinite(Date.parse(session.expiresAtUtc))) return { status: 'unreadable' };
        origin(session.server);
        this.sessionCache.set(path, { digest, session });
      }
      this.reporter?.secret(session.token);
      const info = { expiresAtUtc: session.expiresAtUtc };
      if (origin(session.server) !== origin(server)) return { ...info, status: 'server_mismatch' };
      if (!equalIgnoreCase(session.tenantId, tenantId)) return { ...info, status: 'tenant_mismatch' };
      if (Date.parse(session.expiresAtUtc) <= Date.now()) return { ...info, status: 'expired' };
      if (Date.parse(session.expiresAtUtc) <= Date.now() + 60000) return { ...info, status: 'expiring' };
      return { ...info, status: 'valid', token: session.token };
    } catch (error) {
      if (error.code === 'ENOENT') return { status: 'missing' };
      return { status: error.code === 'session_protection_unavailable' ? 'protection_unavailable' : 'unreadable' };
    }
  }
  loadSession(name, server, tenantId) { return this.inspectSession(name, server, tenantId).token ?? null; }
  deleteSession(name) {
    try { unlinkSync(this.sessionPath(name)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    this.sessionCache.delete(this.sessionPath(name));
  }
  market(args) {
    const server = origin(args.required('exchange'));
    const name = args.value('profile') ?? 'default';
    return { server, name: `exchange:${sha256(server)}:${name}`, tenant: '' };
  }
  credential(args, profile, { createSecrets = true } = {}) {
    if (args.value('auth') === 'session') return { token: this.loadSession(profile.name, profile.server, profile.tenant), source: 'application-session' };
    if (nonempty(args.value('bearer'))) return { token: this.reporter?.secret(args.value('bearer')) ?? args.value('bearer'), source: 'option:bearer' };
    if (nonempty(this.env.XRAIN_TOKEN)) return { token: this.reporter?.secret(this.env.XRAIN_TOKEN) ?? this.env.XRAIN_TOKEN, source: 'environment:XRAIN_TOKEN' };
    if (nonempty(profile.bearerToken)) return { token: profile.bearerToken, source: 'profile:bearer' };
    if (nonempty(profile.tokenName)) {
      const key = new Map([['admin', 'adminApiToken'], ['guest', 'guestApiToken']]).get(profile.tokenName.trim().toLowerCase());
      if (!key) throw new CliError('Local token name must be admin or guest.');
      const token = this.secrets(createSecrets)[key];
      return { token, source: `local-secret-store:${profile.tokenName}` };
    }
    const token = this.loadSession(profile.name, profile.server, profile.tenant);
    return { token, source: token ? 'application-session' : 'none' };
  }
  authStatus(args, profile, market = false) {
    const { token: sessionToken, ...session } = this.inspectSession(profile.name, profile.server, profile.tenant);
    const selected = market ? { token: sessionToken, source: 'application-session' } : this.credential(args, profile, { createSecrets: false });
    return { profile: profile.name, server: profile.server, tenant: profile.tenant, mode: market ? 'session' : args.value('auth') ?? 'auto',
      credentialSource: selected.source, credentialConfigured: !!selected.token, session,
      remoteValidation: 'not_checked',
      hints: sessionToken && selected.source !== 'application-session' ? ['The browser session is not selected. Use --auth session to select it explicitly.'] :
        !sessionToken && selected.source === 'application-session' ? ['Run auth login for this server, tenant and profile.'] : [] };
  }
}
