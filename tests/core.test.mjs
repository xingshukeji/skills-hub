import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, statSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Args, Reporter, parseJson } from '../src/xrain-cli/core.mjs';
import { fixture } from './helpers.mjs';

test('argument parser preserves operands and handles flags before commands', () => {
  const args = new Args(['--no-browser', 'app', 'login', '--profile=MixedCase', '--timeout', '7']);
  assert.equal(args.command(0), 'app'); assert.equal(args.command(1), 'login');
  assert.equal(args.value('profile'), 'MixedCase'); assert.equal(args.timeout(), 7000);
  assert.throws(() => new Args(['--bearer']), /requires a value/);
  assert.throws(() => new Args(['--unknown=x']), /Unknown option/);
  assert.throws(() => new Args(['--check=false']), /does not take/);
  assert.throws(() => new Args(['--timeout', '0']).timeout(), /positive/);
  assert.throws(() => new Args(['--timeout', '0.5']).timeout(), /positive/);
  assert.throws(() => parseJson('test-secret invalid'), error => !error.message.includes('test-secret'));
});

test('help works without a profile and keeps --bearer option text intact', async t => {
  const f = fixture(t);
  const help = await f.run(['--help']);
  assert.equal(help.code, 0); assert.match(help.stdout, /--bearer to avoid/);
  assert.equal(existsSync(f.store.configPath), false);
});

test('profiles use case insensitive names, hide credentials and clear stored bearer for an alias', async t => {
  const f = fixture(t), secret = 'only-for-test-profile-token';
  assert.equal((await f.run(['login', '--profile', 'Demo', '--tenant', 't1', '--bearer', secret])).code, 0);
  const show = await f.run(['profile', 'show', '--profile', 'demo']);
  assert.equal(JSON.parse(show.stdout).activeProfile, 'Demo');
  assert.equal(JSON.parse(show.stdout).tokenSource, 'profile:bearer');
  assert.ok(!show.stdout.includes(secret));
  assert.equal((await f.run(['profile', 'set', '--profile', 'DEMO', '--token-name', 'guest'])).code, 0);
  const saved = f.store.load();
  assert.deepEqual(Object.keys(saved.profiles), ['Demo']);
  assert.equal(saved.profiles.Demo.bearerToken, undefined);
  assert.equal((await f.run(['profile', 'use', 'demo'])).code, 0);
  assert.equal((await f.run(['profile', 'remove', 'DEMO'])).code, 0);
  assert.deepEqual(Object.keys(f.store.load().profiles), []);
});

test('profile names cannot alter object prototypes and duplicate case spellings are rejected', async t => {
  const f = fixture(t);
  assert.equal((await f.run(['login', '--profile', '__proto__', '--tenant', 't1'])).code, 0);
  assert.equal(f.store.load().profiles.__proto__.tenant, 't1');
  assert.equal({}.tenant, undefined);
  writeFileSync(f.store.configPath, JSON.stringify({ profiles: { Demo: {}, demo: {} } }));
  assert.throws(() => f.store.load(), /unique/);
});

test('token ensure is repeatable, show is read only, aliases and environment overrides are supported', async t => {
  const f = fixture(t);
  const show = await f.run(['security', 'tokens', 'show']);
  assert.deepEqual(JSON.parse(show.stdout).configuredTokenNames, []);
  assert.equal(existsSync(f.store.secretPath), false);
  const first = await f.run(['security', 'tokens', 'ensure']);
  assert.equal(first.code, 0);
  const before = JSON.parse(readFileSync(f.store.secretPath));
  assert.equal(Buffer.from(before.adminApiToken, 'base64url').length, 32);
  assert.ok(!first.stdout.includes(before.adminApiToken));
  assert.equal((await f.run(['security', 'tokens', 'ensure'])).code, 0);
  assert.deepEqual(JSON.parse(readFileSync(f.store.secretPath)), before);
  f.env.XRain__Security__SeedApiTokens__Admin = 'test-admin-from-environment';
  assert.equal((await f.run(['security', 'tokens', 'ensure'])).code, 0);
  assert.equal(f.store.secrets().adminApiToken, f.env.XRain__Security__SeedApiTokens__Admin);
  assert.equal(f.store.secrets().guestApiToken, before.guestApiToken);
  assert.ok(!readdirSync(join(f.directory, 'state')).some(name => name.endsWith('.tmp')));
  if (process.platform !== 'win32') assert.equal(statSync(f.store.secretPath).mode & 0o777, 0o600);
});

test('browser sessions bind profile, server, tenant and expiry and are protected on disk', t => {
  const f = fixture(t), server = 'http://127.0.0.1:12345', token = 'test-browser-session-secret';
  f.profile(server, 'Tenant-A');
  f.store.saveSession('demo', server, 'Tenant-A', token, Date.now() + 120000);
  const path = f.store.sessionPath('Demo'), bytes = readFileSync(path);
  assert.equal(f.store.loadSession('DEMO', server + '/', 'tenant-a'), token);
  assert.equal(f.store.loadSession('Demo', 'http://127.0.0.1:12346', 'Tenant-A'), null);
  assert.equal(f.store.loadSession('Demo', server, 'Tenant-B'), null);
  assert.equal(f.store.loadSession('Other', server, 'Tenant-A'), null);
  if (process.platform === 'win32') assert.equal(bytes.includes(Buffer.from(token)), false);
  else {
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.equal(statSync(f.store.sessionDir).mode & 0o777, 0o700);
  }
  f.store.saveSession('Demo', server, 'Tenant-A', token, Date.now() + 30000);
  assert.equal(f.store.loadSession('Demo', server, 'Tenant-A'), null);
  writeFileSync(path, 'corrupt');
  assert.equal(f.store.loadSession('Demo', server, 'Tenant-A'), null);
  f.store.deleteSession('demo');
  assert.equal(existsSync(path), false);
});

test('redaction hides nested token fields and known secret echoes', () => {
  let output = '';
  const reporter = new Reporter({ write: value => { output += value; } });
  reporter.secret('test-secret-value');
  reporter.print({ rows: [{ access_token: 'other-test-value', note: 'prefix test-secret-value suffix', Authorization: 'Bearer abc' }], tokenSource: 'profile:bearer' });
  assert.ok(!output.includes('test-secret-value')); assert.ok(!output.includes('other-test-value'));
  assert.match(output, /profile:bearer/); assert.match(output, /REDACTED/);
});

test('redaction preserves bearer prose while hiding literal authorization values', () => {
  const reporter = new Reporter();
  assert.equal(reporter.clean('profile bearer request'), 'profile bearer request');
  assert.equal(reporter.clean('tenant flag cannot change bearer tenant'), 'tenant flag cannot change bearer tenant');
  assert.equal(reporter.clean('Authorization: Bearer abc'), 'Authorization: Bearer [REDACTED]');
  assert.equal(reporter.clean('bearer abc'), 'Bearer [REDACTED]');
  assert.equal(reporter.clean('echo Bearer long-token-value-for-testing'), 'echo Bearer [REDACTED]');
});

test('invalid URLs and corrupt profile state fail without leaking input', async t => {
  const f = fixture(t);
  for (const server of ['not-a-url', 'https://user:private-value@example.com', 'https://example.com/path', 'ftp://example.com']) {
    const result = await f.run(['login', '--server', server]);
    assert.equal(result.code, 1); assert.ok(!result.stderr.includes('private-value'));
  }
  f.profile('http://127.0.0.1:12345');
  writeFileSync(f.store.configPath, 'invalid-json-test-secret');
  const result = await f.run(['profile', 'show']);
  assert.equal(result.code, 1); assert.ok(!result.stderr.includes('invalid-json-test-secret'));
});
