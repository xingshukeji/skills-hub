import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Store } from '../src/xrain-cli/store.mjs';
import { fixture, mockServer, PACKAGE_ID, respond, VERSION_ID } from './helpers.mjs';

const json = result => JSON.parse(result.stdout);

test('unknown explicit profiles and misplaced write options fail before any request', async t => {
  const f = fixture(t), service = await mockServer(t, (hit, res) => respond(res, {}));
  f.profile(service.url, 'tenant-demo', 'synthetic-profile-bearer');
  f.env.XRAIN_SERVER = service.url; f.env.XRAIN_TENANT = 'tenant-demo';
  for (const argv of [['profile', 'show', '--profile', 'Dmeo'], ['data', 'delete', 'customer', 'record1', '--profile', 'Dmeo']]) {
    const result = await f.run([...argv, '--json']);
    assert.equal(result.code, 1); assert.equal(json(result).error.code, 'profile_not_found');
  }
  const invalid = [
    ['data', 'delete', 'customer', 'record1', '--filter', '{"id":"other"}'],
    ['data', 'delete', 'customer', 'record1', 'extra'],
    ['data', 'delete', 'customer', 'record1', '--entity', 'other'],
    ['data', 'delete', 'customer', 'record1', '--id', 'other'],
    ['data', 'delete', 'customer', 'record1', '--id', 'other', '--id', 'third'],
    ['data', 'create', 'customer', '--values', '{}', '--values-json', 'not-read.json'],
    ['data', 'query', 'customer', '--query', '{"page":1}', '--page', '2'],
    ['data', 'query', 'customer', '--filter', '{}', '--filter-json', 'not-read.json'],
    ['security', 'user', 'revoke-role', '--user', 'test', '--permissions', 'wrong-kind'],
    ['security', 'user', 'revoke-role', '--user', 'test', '--names', 'a', '--roles', 'b'],
    ['app', 'status', '--source', 'not-read.json'],
    ['health', '--exchange', service.url],
  ];
  for (const argv of invalid) assert.equal((await f.run(argv)).code, 1, argv.join(' '));
  assert.equal(service.hits.length, 0);
});

test('subcommand help is scoped and lists only supported options', async t => {
  const f = fixture(t);
  const result = await f.run(['data', 'delete', '--help', '--json']);
  assert.equal(result.code, 0);
  assert.match(json(result).data, /data delete <entity> <id>/);
  assert.ok(!json(result).data.includes('app publish'));
  assert.ok(!json(result).data.includes('--filter'));
  const group = await f.run(['help', 'metadata']);
  assert.match(group.stdout, /metadata entities/); assert.match(group.stdout, /metadata describe/);
  assert.equal(existsSync(f.store.configPath), false);
});

test('machine errors carry stable codes, credential source and remediation without secrets', async t => {
  const f = fixture(t);
  const secret = 'synthetic-environment-token-that-must-be-hidden';
  const service = await mockServer(t, (hit, res) => respond(res, { errorCode: 'platform.authen.authentication_method_not_allowed', echo: hit.headers.authorization, password: 'server-password' }, 401, { 'X-Request-Id': 'audit-request-1' }));
  f.profile(service.url); f.env.XRAIN_TOKEN = secret;
  const result = await f.run(['health', '--json']);
  assert.equal(result.code, 1); assert.equal(result.stderr, '');
  const error = json(result).error;
  assert.equal(error.code, 'authentication_method_not_allowed'); assert.equal(error.httpStatus, 401);
  assert.equal(error.requestId, 'audit-request-1'); assert.equal(error.details.credentialSource, 'environment:XRAIN_TOKEN');
  assert.match(error.hint, /--auth session/);
  for (const value of [secret, 'server-password']) assert.ok(!result.stdout.includes(value));
  const local = await f.run(['--unknown', '--json']);
  assert.equal(local.code, 1); assert.equal(json(local).ok, false); assert.equal(local.stderr, '');
});

test('auth status is read only and explicit session selection bypasses stale environment tokens', async t => {
  const f = fixture(t), session = 'synthetic-selected-browser-session';
  const service = await mockServer(t, (hit, res) => {
    assert.equal(hit.headers.authorization, 'Bearer ' + session); respond(res, { ready: true });
  });
  f.profile(service.url);
  f.store.saveSession('Demo', service.url, 'tenant-demo', session, Date.now() + 300000);
  f.env.XRAIN_TOKEN = 'synthetic-stale-environment-token';
  const status = await f.run(['auth', 'status', '--json']);
  assert.equal(status.code, 0); assert.equal(json(status).data.session.status, 'valid');
  assert.equal(json(status).data.credentialSource, 'environment:XRAIN_TOKEN');
  assert.equal(json(status).data.remoteValidation, 'not_checked'); assert.equal(service.hits.length, 0);
  const selected = await f.run(['health', '--auth', 'session', '--json']);
  assert.equal(selected.code, 0, selected.stdout); assert.equal(json(selected).data.ready, true);
  const diagnosed = await f.run(['doctor', '--auth', 'session', '--json']);
  assert.equal(diagnosed.code, 0, diagnosed.stdout); assert.equal(json(diagnosed).data.remoteValidation, 'not_checked');
  assert.equal(json(diagnosed).data.credentialSource, 'application-session');
  const before = service.hits.length;
  const incompatible = await f.run(['health', '--auth', 'session', '--token-name', 'admin', '--json']);
  assert.equal(incompatible.code, 1); assert.equal(service.hits.length, before);
  assert.ok(!(status.stdout + selected.stdout + diagnosed.stdout).includes(session));
  assert.ok(!status.stdout.includes(f.env.XRAIN_TOKEN));
});

test('whoami reports the server identity using the same effective target and credential as business commands', async t => {
  const f = fixture(t), envToken = 'synthetic-env-credential', sessionToken = 'synthetic-browser-credential';
  const handler = (hit, res) => {
    if (hit.url === '/api/service/authen/v1/account/context') {
      const session = hit.headers.authorization === 'Bearer ' + sessionToken;
      return respond(res, { userId: session ? 'user-session' : 'user-env', tenantId: session ? 'tenant-demo' : 'tenant-other',
        scope: 'tenant', effectivePermissions: ['sensitive.permission'], access_token: 'server-echo-secret' });
    }
    if (hit.url.endsWith('/my-published')) return respond(res, []);
    return respond(res, { objects: [] });
  };
  const savedTarget = await mockServer(t, handler), envTarget = await mockServer(t, handler);
  f.profile(savedTarget.url, 'tenant-demo', 'synthetic-profile-credential');
  f.env.XRAIN_SERVER = envTarget.url; f.env.XRAIN_TENANT = 'tenant-expected'; f.env.XRAIN_TOKEN = envToken;
  f.store.saveSession('Demo', savedTarget.url, 'tenant-demo', sessionToken, Date.now() + 300000);
  const auto = await f.run(['auth', 'whoami', '--profile', 'Demo', '--json']);
  assert.equal(auto.code, 0, auto.stdout);
  assert.deepEqual(json(auto).data, { profile: 'Demo', server: envTarget.url, credentialSource: 'environment:XRAIN_TOKEN',
    configuredTenant: 'tenant-expected', userId: 'user-env', tenantId: 'tenant-other', scope: 'tenant', remoteValidation: 'identity_confirmed' });
  const data = await f.run(['metadata', 'entities', '--profile', 'Demo', '--json']);
  assert.equal(data.code, 0, data.stdout);
  assert.deepEqual(envTarget.hits.map(hit => [hit.method, hit.url, hit.headers.authorization]), [
    ['GET', '/api/service/authen/v1/account/context', 'Bearer ' + envToken],
    ['GET', '/api/metadata/v1/objects', 'Bearer ' + envToken],
  ]);
  const target = ['--profile', 'Demo', '--server', savedTarget.url, '--tenant', 'tenant-demo'];
  const session = await f.run(['auth', 'whoami', ...target, '--auth', 'session', '--json']);
  assert.equal(session.code, 0, session.stdout);
  assert.equal(json(session).data.userId, 'user-session'); assert.equal(json(session).data.tenantId, 'tenant-demo');
  assert.equal(json(session).data.credentialSource, 'application-session');
  const app = await f.run(['app', 'status', ...target, '--json']);
  assert.equal(app.code, 0, app.stdout);
  assert.deepEqual(savedTarget.hits.map(hit => hit.headers.authorization), ['Bearer ' + sessionToken, 'Bearer ' + sessionToken]);
  for (const value of [envToken, sessionToken, 'server-echo-secret', 'sensitive.permission']) assert.ok(!auto.stdout.includes(value) && !session.stdout.includes(value));
});

test('whoami reports host scope and rejects unverified or malformed identities without creating credentials', async t => {
  const f = fixture(t); let response = { userId: 'host-user', tenantId: null, scope: 'host' }, status = 200;
  const service = await mockServer(t, (_hit, res) => respond(res, response, status));
  f.profile(service.url, 'tenant-configured', 'synthetic-host-token');
  const host = await f.run(['auth', 'whoami', '--json']);
  assert.equal(host.code, 0, host.stdout); assert.equal(json(host).data.scope, 'host');
  assert.equal(json(host).data.tenantId, null); assert.equal(json(host).data.configuredTenant, 'tenant-configured');
  for (const invalid of [{ tenantId: 'tenant-a', scope: 'tenant' }, { userId: 'x', tenantId: null, scope: 'tenant' },
    { userId: 'x', tenantId: 'tenant-a', scope: 'host' }, { userId: 'x', tenantId: 'tenant-a', scope: 'unknown' },
    { userId: 'x', scope: 'host' }]) {
    response = invalid;
    const result = await f.run(['auth', 'whoami', '--json']);
    assert.equal(result.code, 1); assert.equal(json(result).error.code, 'invalid_response');
  }
  status = 401; response = { errorCode: 'platform.authen.unauthorized', authorization: 'synthetic-host-token' };
  const rejected = await f.run(['auth', 'whoami', '--json']);
  assert.equal(rejected.code, 1); assert.equal(json(rejected).error.code, 'authentication_failed');
  assert.ok(!rejected.stdout.includes('synthetic-host-token'));
  const before = service.hits.length;
  const mismatch = await f.run(['auth', 'whoami', '--auth', 'session', '--json']);
  assert.equal(mismatch.code, 1); assert.equal(json(mismatch).error.code, 'authentication_required');
  const market = await f.run(['auth', 'whoami', '--exchange', service.url, '--json']);
  assert.equal(market.code, 1); assert.equal(json(market).error.code, 'invalid_arguments');
  assert.equal(service.hits.length, before);
  const config = f.store.load(); config.profiles.Demo.bearerToken = undefined; config.profiles.Demo.tokenName = 'guest'; f.store.save(config);
  const missing = await f.run(['auth', 'whoami', '--json']);
  assert.equal(missing.code, 1); assert.equal(json(missing).error.code, 'authentication_required');
  assert.equal(existsSync(f.store.secretPath), false); assert.equal(service.hits.length, before);
});

test('doctor distinguishes a public readiness probe from an authenticated market probe', async t => {
  const f = fixture(t), fakeToken = 'synthetic-not-validated';
  const service = await mockServer(t, (_hit, res) => respond(res, { ready: true }));
  f.profile(service.url, 'tenant-demo', fakeToken);
  const readiness = await f.run(['doctor', '--json']);
  assert.equal(readiness.code, 0, readiness.stdout); assert.equal(json(readiness).data.probe.httpStatus, 200);
  assert.equal(json(readiness).data.remoteValidation, 'not_checked');
  assert.match(json(readiness).data.probe.scope, /does not validate/);
  const args = f.context(['doctor', '--exchange', service.url, '--profile', 'Market']).args;
  const marketProfile = f.store.market(args), marketToken = 'synthetic-market-session';
  f.store.saveSession(marketProfile.name, service.url, '', marketToken, Date.now() + 300000);
  const market = await f.run(['doctor', '--exchange', service.url, '--profile', 'Market', '--json']);
  assert.equal(market.code, 0, market.stdout); assert.equal(json(market).data.remoteValidation, 'accepted_by_probe');
  assert.equal(service.hits.at(-1).url, '/api/exchange/v1/my-published');
  assert.equal(service.hits.at(-1).headers.authorization, 'Bearer ' + marketToken);
  assert.ok(!readiness.stdout.includes(fakeToken) && !market.stdout.includes(marketToken));
});

test('auth diagnostics distinguish unavailable sessions and never generate test tokens', async t => {
  const f = fixture(t); f.profile('http://127.0.0.1:1');
  const config = f.store.load(); config.profiles.Demo.tokenName = 'guest'; f.store.save(config);
  const missing = await f.run(['auth', 'status', '--json']);
  assert.equal(json(missing).data.credentialConfigured, false); assert.equal(json(missing).data.session.status, 'missing');
  assert.equal(existsSync(f.store.secretPath), false);
  f.store.saveSession('Demo', 'http://127.0.0.1:1', 'tenant-demo', 'synthetic-expiring', Date.now() + 30000);
  const expiring = await f.run(['auth', 'status', '--auth', 'session', '--json']);
  assert.equal(json(expiring).data.session.status, 'expiring'); assert.equal(json(expiring).data.credentialConfigured, false);
  const wrongTenant = await f.run(['auth', 'status', '--tenant', 'different', '--json']);
  assert.equal(json(wrongTenant).data.session.status, 'tenant_mismatch');
  writeFileSync(f.store.sessionPath('Demo'), 'corrupt');
  const unreadable = await f.run(['auth', 'status', '--json']);
  assert.ok(['unreadable', 'protection_unavailable'].includes(json(unreadable).data.session.status));
  const request = await f.run(['health', '--auth', 'session', '--json']);
  assert.equal(json(request).error.code, 'authentication_required');
  assert.equal(existsSync(f.store.secretPath), false);
  const offline = await f.run(['doctor', '--json']);
  assert.equal(offline.code, 1); assert.equal(json(offline).error.code, 'network_error');
  assert.equal(json(offline).error.details.authentication.profile, 'Demo');
});

test('cached sessions observe external replacement and expiry and retain tenant binding', t => {
  const f = fixture(t), server = 'http://127.0.0.1:1';
  f.profile(server);
  f.store.saveSession('Demo', server, 'tenant-demo', 'synthetic-first-session', Date.now() + 300000);
  assert.equal(f.store.loadSession('Demo', server, 'tenant-demo'), 'synthetic-first-session');
  const writer = new Store(f.env);
  writer.saveSession('Demo', server, 'tenant-demo', 'synthetic-replaced-session', Date.now() + 300000);
  assert.equal(f.store.loadSession('Demo', server, 'tenant-demo'), 'synthetic-replaced-session');
  assert.equal(f.store.loadSession('Demo', server, 'different-tenant'), null);
  const future = Date.now() + 600000;
  t.mock.method(Date, 'now', () => future);
  assert.equal(f.store.loadSession('Demo', server, 'tenant-demo'), null);
  t.mock.restoreAll();
  writeFileSync(f.store.sessionPath('Demo'), 'corrupt');
  assert.equal(f.store.loadSession('Demo', server, 'tenant-demo'), null);
});

test('object discovery uses authorized metadata endpoints and preserves server field descriptions', async t => {
  const f = fixture(t);
  const service = await mockServer(t, (hit, res) => respond(res, hit.url.endsWith('/objects') ? { metadataRevision: 4, objects: [{ entityCode: 'order__c', schemaName: 'runtime' }] } : { fields: [{ fieldApiName: 'label__c', type: 'Text', required: true }] }));
  f.profile(service.url, 'tenant-demo', 'synthetic-discovery-token');
  const entities = await f.run(['metadata', 'entities', '--json']);
  assert.equal(entities.code, 0); assert.equal(json(entities).data.objects[0].entityCode, 'order__c');
  const describe = await f.run(['metadata', 'describe', 'order__c', '--json']);
  assert.equal(describe.code, 0); assert.equal(json(describe).data.fields[0].required, true);
  assert.deepEqual(service.hits.map(hit => [hit.method, hit.url]), [['GET', '/api/metadata/v1/objects'], ['GET', '/api/metadata/v1/entities/order__c/describe']]);
  assert.ok(service.hits.every(hit => hit.headers.authorization === 'Bearer synthetic-discovery-token'));
});

test('application status is one JSON document for multiple and zero applications', async t => {
  const f = fixture(t);
  const service = await mockServer(t, (hit, res) => respond(res, hit.url.endsWith('/my-published') ? [
    { id: PACKAGE_ID, namespace: 'firstapp' }, { id: 'apg99999999999999999', namespace: 'secondapp' },
  ] : [{ id: VERSION_ID, version: '1.0.0', publishedAt: '2026-01-01T00:00:00Z' }]));
  f.profile(service.url); f.store.saveSession('Demo', service.url, 'tenant-demo', 'synthetic-app-session', Date.now() + 300000);
  const multiple = await f.run(['app', 'status', '--json']);
  assert.equal(multiple.code, 0, multiple.stdout); assert.equal(json(multiple).data.length, 2);
  const legacy = await f.run(['app', 'status']); assert.equal(json(legacy).length, 2);
  const empty = await f.run(['app', 'status', '--package', 'not-published', '--json']);
  assert.deepEqual(json(empty).data, []);
  const single = await f.run(['app', 'status', '--package', 'firstapp', '--json']);
  assert.equal(json(single).data.length, 1);
});

test('batch validates all command shapes before writes and stops on the first server failure', async t => {
  const f = fixture(t);
  const service = await mockServer(t, (hit, res) => respond(res, { recordId: 'created', errorCode: 'synthetic.forbidden' }, hit.method === 'DELETE' ? 403 : 200));
  f.profile(service.url, 'tenant-demo', 'synthetic-batch-token');
  const path = join(f.directory, 'batch.json');
  writeFileSync(path, JSON.stringify([['data', 'create', 'customer', '--values', '{}'], ['data', 'delete', 'customer', 'r1', '--filter', '{}']]));
  const invalid = await f.run(['batch', '--file', path, '--json']);
  assert.equal(invalid.code, 1); assert.equal(service.hits.length, 0);
  writeFileSync(path, JSON.stringify([['data', 'create', 'customer', '--values', '{}'], ['data', 'delete', 'customer', 'r1'], ['data', 'query', 'customer']]));
  const stopped = await f.run(['batch', '--file', path, '--json']);
  assert.equal(stopped.code, 1); assert.equal(json(stopped).error.code, 'batch_failed');
  assert.equal(json(stopped).error.details.failedIndex, 1); assert.equal(json(stopped).error.details.results.length, 2);
  assert.deepEqual(service.hits.map(hit => hit.method), ['POST', 'DELETE']);
  assert.ok(!stopped.stdout.includes('synthetic-batch-token'));
});

test('batch session reuse observes logout immediately and never sends a cached token afterward', async t => {
  const f = fixture(t), service = await mockServer(t, (hit, res) => respond(res, { ready: true }));
  f.profile(service.url); f.store.saveSession('Demo', service.url, 'tenant-demo', 'synthetic-batch-session', Date.now() + 300000);
  const path = join(f.directory, 'batch.json');
  writeFileSync(path, JSON.stringify([['health', '--auth', 'session'], ['health', '--auth', 'session'], ['auth', 'logout'], ['health', '--auth', 'session']]));
  const result = await f.run(['batch', '--file', path, '--json']);
  assert.equal(result.code, 1); assert.equal(json(result).error.details.failedIndex, 3);
  assert.equal(json(result).error.details.results[3].error.code, 'authentication_required');
  assert.equal(service.hits.length, 2); assert.equal(existsSync(f.store.sessionPath('Demo')), false);
});
