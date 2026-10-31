import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Args } from '../src/xrain-cli/core.mjs';
import { readCredentialFile, saveCredentialFile } from '../src/xrain-cli/store.mjs';
import { fixture, mockServer, respond } from './helpers.mjs';

const output = value => JSON.parse(value.stdout);

test('API tokens are saved privately and used only for their original platform target', async t => {
  const f = fixture(t), token = 'synthetic-issued-private-api-token';
  const service = await mockServer(t, (hit, res) => {
    if (hit.method === 'POST') {
      assert.equal(hit.headers.authorization, 'Bearer admin-session');
      respond(res, { api_token: token, expires_at_utc: '2099-01-01T00:00:00Z', subjectUserId: 'service-subject', note: token }, 201);
    } else { assert.equal(hit.headers.authorization, 'Bearer ' + token); respond(res, { recordId: 'one', values: {} }); }
  });
  f.profile(service.url, 'tenant-one', 'admin-session');
  const file = join(f.directory, 'request.json'), out = join(f.directory, 'token.json');
  writeFileSync(file, '{"subjectUserId":"service-subject","expiresAtUtc":"2099-01-01T00:00:00Z"}');
  const created = await f.run(['security', 'api-token', 'create', '--request-json', file, '--out', out, '--json']);
  assert.equal(created.code, 0, created.stdout);
  assert.ok(!created.stdout.includes(token)); assert.ok(!created.stderr.includes(token));
  if (process.platform === 'win32') assert.ok(!readFileSync(out, 'utf8').includes(token));
  f.env.XRAIN_TOKEN = 'stale-env-token';
  const read = await f.run(['data', 'get', 'customer', 'one', '--token-file', out, '--json']);
  assert.equal(read.code, 0, read.stdout);
  const count = service.hits.length;
  for (const args of [['--tenant', 'tenant-two'], ['--server', 'http://127.0.0.1:1']]) {
    const mismatch = await f.run(['data', 'get', 'customer', 'one', '--token-file', out, ...args, '--json']);
    assert.equal(output(mismatch).error.code, 'credential_target_mismatch');
  }
  assert.equal(service.hits.length, count);
  const profile = { server: service.url, tenant: 'tenant-one', scope: 'tenant' };
  assert.equal(f.store.credential(new Args(['--token-file', out]), profile).token, token);
  assert.equal(output(await f.run(['data', 'get', 'customer', 'one', '--token-file', out, '--auth', 'session', '--json'])).error.code, 'invalid_arguments');
});

test('a late destination collision preserves the other file and never reissues a token', async t => {
  const f = fixture(t), out = join(f.directory, 'token.json'); let issued = 0;
  const service = await mockServer(t, (_hit, res) => {
    issued++; writeFileSync(out, 'another writer'); respond(res, { api_token: 'synthetic-issued-token', subjectUserId: 'one' }, 201);
  });
  f.profile(service.url, 'tenant-one', 'admin-session');
  const file = join(f.directory, 'request.json'); writeFileSync(file, '{"subjectUserId":"one"}');
  const result = await f.run(['security', 'api-token', 'create', '--request-json', file, '--out', out, '--json']);
  assert.equal(output(result).error.code, 'credential_save_failed');
  assert.equal(readFileSync(out, 'utf8'), 'another writer'); assert.equal(issued, 1);
  assert.ok(!result.stdout.includes('synthetic-issued-token'));
  assert.ok(!readdirSync(f.directory).some(name => name.endsWith('.tmp')));
  assert.equal(output(await f.run(['security', 'api-token', 'create', '--request-json', file, '--out', out, '--json'])).error.code, 'output_exists');
  assert.equal(issued, 1);
});

test('an issued token with a lost receipt remains unknown and creates no local credential artifact', async t => {
  const f = fixture(t); let issued = 0;
  const service = await mockServer(t, (_hit, res) => { issued++; res.destroy(); });
  f.profile(service.url, 'tenant-one', 'admin-session');
  const file = join(f.directory, 'request.json'), out = join(f.directory, 'token.json'); writeFileSync(file, '{"subjectUserId":"one"}');
  const result = await f.run(['security', 'api-token', 'create', '--request-json', file, '--out', out, '--json']);
  assert.equal(output(result).error.code, 'outcome_unknown'); assert.equal(issued, 1);
  assert.equal(existsSync(out), false); assert.deepEqual(output(result).error.details.readback, ['security', 'api-token', 'list']);
});

test('credential receipts bind to the target used for the request even when the active profile changes', async t => {
  const f = fixture(t);
  const service = await mockServer(t, (_hit, res) => {
    f.profile('http://127.0.0.1:1', 'other-tenant', 'other-token');
    respond(res, { apiToken: 'synthetic-revealed-private-token' });
  });
  f.profile(service.url, 'tenant-one', 'admin-session');
  const out = join(f.directory, 'revealed.json');
  const result = await f.run(['security', 'api-token', 'reveal', 'token-id', '--out', out, '--json']);
  assert.equal(result.code, 0, result.stdout);
  assert.equal(readCredentialFile(out, { server: service.url, tenant: 'tenant-one', scope: 'tenant' }), 'synthetic-revealed-private-token');
  const expired = join(f.directory, 'expired.json');
  saveCredentialFile(expired, 'synthetic-expired-token', { server: service.url, tenant: 'tenant-one', scope: 'tenant' }, { expiresAtUtc: '2000-01-01T00:00:00Z' });
  assert.throws(() => readCredentialFile(expired, { server: service.url, tenant: 'tenant-one', scope: 'tenant' }), { code: 'credential_expired' });
});
