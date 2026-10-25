import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, mockServer, PACKAGE_ID, respond, VERSION_ID } from './helpers.mjs';

const ROOT = '/api/application/v1';
const INSTALLATION = 'api0123456789abcdefg';
const OPERATION = 'apo0123456789abcdefg';
const NEXT_OPERATION = 'apo11111111111111111';
const SESSION = 'synthetic-application-management-session';
const CONFIRMATION = { recordId: 'apr0123456789abcdefg', unit: '$security', token: 'synthetic-impact-decision' };
const json = result => JSON.parse(result.stdout);
const op = (status = 'Succeeded', overrides = {}) => ({ id: OPERATION, installationId: INSTALLATION,
  sourceVersionId: null, targetVersionId: VERSION_ID, sourceRevision: 0, status, errorCode: null,
  details: { schemaVersion: 1, requiredBindings: [], requiredConfirmations: [], conflicts: [], resolutions: {}, plan: null, result: null },
  ...overrides });

async function service(t, f, handler) {
  const server = await mockServer(t, (hit, res) => {
    assert.equal(hit.headers.authorization, 'Bearer ' + SESSION);
    assert.equal(hit.headers['x-tenant-id'], undefined);
    return handler(hit, res);
  });
  f.profile(server.url, 'tenant-demo', 'synthetic-obsolete-api-token');
  f.env.XRAIN_TOKEN = 'synthetic-obsolete-environment-token';
  f.store.saveSession('Demo', server.url, 'tenant-demo', SESSION, Date.now() + 300000);
  return server;
}

function requestFile(f, body, name = 'request.json') {
  const path = join(f.directory, name);
  writeFileSync(path, JSON.stringify(body));
  return path;
}

test('catalog and versions expose platform installation pointers and use an independent market session when selected', async t => {
  const f = fixture(t);
  const server = await service(t, f, (hit, res) => respond(res, hit.url.endsWith('/versions')
    ? [{ id: VERSION_ID, version: '1.0.0', digest: 'package-digest' }]
    : [{ id: PACKAGE_ID, namespace: 'myapp', installationId: INSTALLATION, installedVersionId: VERSION_ID, revision: 4 }]));
  const listed = await f.run(['app', 'list', '--json']);
  assert.equal(listed.code, 0, listed.stdout); assert.equal(json(listed).data[0].revision, 4);
  assert.equal((await f.run(['app', 'versions', PACKAGE_ID, '--json'])).code, 0);
  assert.deepEqual(server.hits.map(hit => [hit.method, hit.url]), [['GET', ROOT + '/packages'], ['GET', `${ROOT}/packages/${PACKAGE_ID}/versions`]]);
  const market = f.store.market(f.context(['--exchange', server.url, '--profile', 'Market']).args);
  f.store.saveSession(market.name, server.url, '', SESSION, Date.now() + 300000);
  for (const command of [['list'], ['versions', '--package', PACKAGE_ID]]) {
    const result = await f.run(['app', ...command, '--exchange', server.url, '--profile', 'Market', '--json']);
    assert.equal(result.code, 0, result.stdout); assert.ok(Array.isArray(json(result).data));
    assert.ok(server.hits.at(-1).url.startsWith('/api/exchange/v1/packages'));
  }
});

test('import uses the platform-configured exchange path and neither publishes nor installs', async t => {
  const f = fixture(t);
  const server = await service(t, f, (hit, res) => respond(res, { packageId: PACKAGE_ID, versionId: VERSION_ID, alreadyExisted: true, digest: 'imported-digest' }));
  const result = await f.run(['app', 'import', '--package', PACKAGE_ID, '--version-id', VERSION_ID, '--json']);
  assert.equal(result.code, 0, result.stdout); assert.equal(json(result).data.alreadyExisted, true);
  assert.deepEqual(server.hits.map(hit => [hit.method, hit.url, hit.body.length]), [['POST', `${ROOT}/exchange/packages/${PACKAGE_ID}/versions/${VERSION_ID}:import`, 0]]);
});

test('preview preserves current impact confirmations while removing credential fields and known session values', async t => {
  const f = fixture(t);
  const body = { tenantBindings: { 'apr-connector/baseAddress': 'http://service.local' }, confirmations: [CONFIRMATION] };
  const server = await service(t, f, (hit, res) => respond(res, { targetVersionId: VERSION_ID, revision: 0, ready: false,
    requiredBindings: [{ recordId: 'apr-connector', binding: 'credentialId' }], requiredConfirmations: [CONFIRMATION, { ...CONFIRMATION, token: SESSION }],
    token: 'unrelated-token', password: 'server-password', nested: { requiredConfirmations: [CONFIRMATION] } }));
  const result = await f.run(['app', 'preview', PACKAGE_ID, '--version-id', VERSION_ID, '--expected-revision', '0',
    '--maintain-installed-version', '--request-json', requestFile(f, body), '--json']);
  assert.equal(result.code, 0, result.stdout);
  assert.equal(json(result).data.ready, false);
  assert.deepEqual(server.hits[0].json(), { ...body, versionId: VERSION_ID, expectedRevision: 0, maintainInstalledVersion: true });
  assert.equal(server.hits[0].url, `${ROOT}/packages/${PACKAGE_ID}/preview`);
  assert.equal(server.hits.length, 1);
  assert.equal(json(result).data.requiredConfirmations[0].token, CONFIRMATION.token);
  assert.equal(json(result).data.requiredConfirmations[1].token, '[REDACTED]');
  assert.equal(json(result).data.nested.requiredConfirmations[0].token, '[REDACTED]');
  for (const secret of [SESSION, 'server-password', 'unrelated-token']) assert.ok(!result.stdout.includes(secret));
});

test('install performs server preflight once, generates a recoverable request ID and supports an exact upgrade target', async t => {
  const f = fixture(t);
  const server = await service(t, f, (hit, res) => {
    assert.match(hit.json().requestId, /^apo[a-z0-9]{17}$/);
    respond(res, op('Succeeded', { id: hit.json().requestId, sourceVersionId: 'apv00000000000000000', sourceRevision: 5 }));
  });
  const input = { versionId: VERSION_ID, expectedRevision: 5, confirmations: [CONFIRMATION], tenantBindings: { 'connector/Credential': 'credential-reference' } };
  const result = await f.run(['app', 'install', PACKAGE_ID, '--request-json', requestFile(f, input), '--json']);
  assert.equal(result.code, 0, result.stdout);
  const requestId = server.hits[0].json().requestId;
  assert.deepEqual(server.hits[0].json(), { ...input, requestId });
  assert.deepEqual(server.hits.map(hit => [hit.method, hit.url]), [['POST', `${ROOT}/packages/${PACKAGE_ID}/install`]]);
  assert.equal(json(result).data.id, requestId); assert.equal(json(result).data.status, 'Succeeded');
  assert.ok(result.stderr.includes(requestId));
});

test('non-waiting install reports the accepted Pending operation without claiming completion', async t => {
  const f = fixture(t), server = await service(t, f, (hit, res) => respond(res, op('Pending')));
  const result = await f.run(['app', 'install', PACKAGE_ID, '--version-id', VERSION_ID, '--request-id', OPERATION, '--json']);
  assert.equal(result.code, 0, result.stdout); assert.equal(json(result).data.status, 'Pending');
  assert.equal(server.hits.length, 1);
});

test('install --wait follows the same operation through execution and finalization using GET only', async t => {
  const f = fixture(t), states = ['Pending', 'Running', 'Finalizing', 'Succeeded'];
  const server = await service(t, f, (hit, res) => respond(res, op(states.shift())));
  const result = await f.run(['app', 'install', PACKAGE_ID, '--version-id', VERSION_ID, '--request-id', OPERATION,
    '--wait', '--wait-timeout', '10', '--poll-interval', '1', '--json']);
  assert.equal(result.code, 0, result.stdout); assert.equal(json(result).data.status, 'Succeeded');
  assert.deepEqual(server.hits.map(hit => [hit.method, hit.url]), [['POST', `${ROOT}/packages/${PACKAGE_ID}/install`],
    ...Array.from({ length: 3 }, () => ['GET', `${ROOT}/operations/${OPERATION}`])]);
  for (const status of ['Pending', 'Running', 'Finalizing']) assert.ok(result.stderr.includes(status));
});

test('waiting for input returns the original operation and usable confirmations without automatically resolving it', async t => {
  const f = fixture(t);
  const waiting = op('WaitingForResolution', { details: { requiredBindings: [{ recordId: 'apr-connector', binding: 'baseAddress' }], requiredConfirmations: [CONFIRMATION], conflicts: [] } });
  const server = await service(t, f, (hit, res) => respond(res, waiting));
  const result = await f.run(['app', 'install', PACKAGE_ID, '--version-id', VERSION_ID, '--request-id', OPERATION, '--wait', '--json']);
  assert.equal(result.code, 1); assert.equal(json(result).error.code, 'operation_requires_resolution');
  assert.equal(json(result).error.details.operation.id, OPERATION);
  assert.equal(json(result).error.details.operation.details.requiredConfirmations[0].token, CONFIRMATION.token);
  assert.equal(server.hits.length, 1);
});

test('inspection succeeds for every operation status while waiting distinguishes failure, cancellation and required input', async t => {
  const f = fixture(t);
  let status = 'Failed';
  const server = await service(t, f, (hit, res) => respond(res, op(status, { errorCode: status === 'Failed' ? 'application_test_failure' : null })));
  for (const [next, errorCode] of [['Failed', 'operation_failed'], ['Cancelled', 'operation_cancelled'], ['WaitingForResolution', 'operation_requires_resolution'], ['Succeeded', undefined]]) {
    status = next;
    const shown = await f.run(['app', 'operation', 'show', OPERATION, '--json']);
    assert.equal(shown.code, 0, shown.stdout); assert.equal(json(shown).data.status, status);
    const waited = await f.run(['app', 'operation', 'wait', OPERATION, '--json']);
    assert.equal(waited.code, errorCode ? 1 : 0, waited.stdout);
    if (errorCode) assert.equal(json(waited).error.code, errorCode);
  }
  assert.ok(server.hits.every(hit => hit.method === 'GET'));
});

test('lost install responses retain the submitted request identity and are never automatically replayed', async t => {
  const f = fixture(t), server = await service(t, f, (hit, res) => res.destroy());
  const result = await f.run(['app', 'install', PACKAGE_ID, '--version-id', VERSION_ID, '--json']);
  assert.equal(result.code, 1); assert.equal(json(result).error.code, 'network_error');
  const requestId = server.hits[0].json().requestId;
  assert.equal(json(result).error.details.operationId, requestId);
  assert.equal(json(result).error.details.requestId, requestId);
  assert.ok(result.stderr.includes(requestId)); assert.ok(json(result).error.hint.includes(requestId));
  assert.equal(server.hits.length, 1);
});

test('waiting timeout preserves the latest observation and does not cancel or continue the server operation', async t => {
  const f = fixture(t), server = await service(t, f, (hit, res) => respond(res, op('Running')));
  const result = await f.run(['app', 'operation', 'wait', OPERATION, '--wait-timeout', '1', '--json']);
  assert.equal(result.code, 1); assert.equal(json(result).error.code, 'operation_wait_timeout');
  assert.equal(json(result).error.details.operation.status, 'Running');
  assert.match(json(result).error.hint, /app operation wait/);
  assert.deepEqual(server.hits.map(hit => hit.method), ['GET']);
});

test('the total wait deadline also bounds a stalled polling request', async t => {
  const f = fixture(t);
  let requests = 0;
  const server = await service(t, f, (hit, res) => { if (++requests === 1) respond(res, op('Pending')); });
  const started = Date.now();
  const result = await f.run(['app', 'operation', 'wait', OPERATION, '--wait-timeout', '2', '--poll-interval', '1', '--timeout', '100', '--json']);
  assert.equal(result.code, 1); assert.equal(json(result).error.code, 'operation_wait_timeout');
  assert.ok(Date.now() - started < 5000); assert.equal(server.hits.length, 2);
  assert.equal(json(result).error.details.operation.id, OPERATION);
});

test('a polling failure retains the most recent status rather than the older POST response', async t => {
  const f = fixture(t);
  let step = 0;
  const server = await service(t, f, (hit, res) => {
    if (++step === 1) return respond(res, op('Pending'));
    if (step === 2) return respond(res, op('Finalizing'));
    res.destroy();
  });
  const result = await f.run(['app', 'install', PACKAGE_ID, '--version-id', VERSION_ID, '--request-id', OPERATION,
    '--wait', '--wait-timeout', '10', '--poll-interval', '1', '--json']);
  assert.equal(result.code, 1); assert.equal(json(result).error.details.operation.status, 'Finalizing');
  assert.equal(server.hits.filter(hit => hit.method === 'POST').length, 1);
});

test('mismatched operation identities and target versions fail without following another operation', async t => {
  const f = fixture(t);
  let response = op('Pending', { id: NEXT_OPERATION });
  const server = await service(t, f, (hit, res) => respond(res, response));
  for (const mismatch of [response, op('Succeeded', { targetVersionId: 'apv11111111111111111' }), op('Unexpected')]) {
    response = mismatch;
    const result = await f.run(['app', 'install', PACKAGE_ID, '--version-id', VERSION_ID, '--request-id', OPERATION, '--wait', '--json']);
    assert.equal(result.code, 1); assert.equal(json(result).error.code, 'invalid_response');
    assert.equal(json(result).error.details.operationId, OPERATION);
  }
  assert.equal(server.hits.length, 3); assert.ok(server.hits.every(hit => hit.method === 'POST'));
});

test('stale revisions and permission failures preserve server errors and do not refresh or retry the write', async t => {
  const f = fixture(t);
  let status = 409;
  const server = await service(t, f, (hit, res) => respond(res,
    { errorCode: status === 409 ? 'application_revision_conflict' : 'application_forbidden', operationId: NEXT_OPERATION, password: 'hidden-server-secret' }, status, { 'X-Request-Id': 'http-trace-1' }));
  for (const httpStatus of [409, 403, 401]) {
    status = httpStatus;
    const result = await f.run(['app', 'install', PACKAGE_ID, '--version-id', VERSION_ID, '--expected-revision', '4', '--request-id', OPERATION, '--json']);
    assert.equal(result.code, 1); assert.equal(json(result).error.httpStatus, httpStatus);
    assert.equal(json(result).error.requestId, 'http-trace-1');
    assert.equal(json(result).error.details.requestId, OPERATION);
    assert.equal(json(result).error.details.response.operationId, NEXT_OPERATION);
    assert.ok(!result.stdout.includes('hidden-server-secret'));
  }
  assert.equal(server.hits.length, 3); assert.ok(server.hits.every(hit => hit.json().expectedRevision === 4));
});

test('resolve submits only selected bindings, configuration and confirmations with the inspected revision', async t => {
  const f = fixture(t);
  const server = await service(t, f, (hit, res) => respond(res, op()));
  const body = { tenantBindings: { 'apr-connector/baseAddress': 'http://orders.local' }, confirmations: [CONFIRMATION],
    configurationChanges: { 'apr-view/fieldNames': { present: true, value: ['name', 'amount'] }, 'apr-view/label': { present: false } } };
  const result = await f.run(['app', 'operation', 'resolve', OPERATION, '--expected-revision', '3', '--file', requestFile(f, body), '--wait', '--json']);
  assert.equal(result.code, 0, result.stdout);
  assert.deepEqual(server.hits.map(hit => [hit.method, hit.url]), [['POST', `${ROOT}/operations/${OPERATION}/resolve`]]);
  assert.deepEqual(server.hits[0].json(), { ...body, expectedRevision: 3 });
});

test('retry uses a new request identity and exposes resubmission requirements without creating further operations', async t => {
  const f = fixture(t);
  let reject = false;
  const server = await service(t, f, (hit, res) => reject
    ? respond(res, { errorCode: 'application_operation_resubmission_required', operationId: OPERATION }, 409)
    : respond(res, op('Succeeded', { id: hit.json().requestId })));
  const result = await f.run(['app', 'operation', 'retry', OPERATION, '--json']);
  assert.equal(result.code, 0, result.stdout);
  const submittedId = server.hits[0].json().requestId;
  assert.match(submittedId, /^apo[a-z0-9]{17}$/); assert.notEqual(submittedId, OPERATION);
  assert.equal(json(result).data.id, submittedId);
  reject = true;
  const rejected = await f.run(['app', 'operation', 'retry', OPERATION, '--request-id', NEXT_OPERATION, '--json']);
  assert.equal(rejected.code, 1); assert.equal(json(rejected).error.serverCode, 'application_operation_resubmission_required');
  assert.equal(json(rejected).error.details.sourceOperationId, OPERATION);
  assert.equal(json(rejected).error.details.operationId, NEXT_OPERATION);
  assert.equal(server.hits.length, 2); assert.ok(server.hits.every(hit => hit.url === `${ROOT}/operations/${OPERATION}/retry`));
});

test('continue and cancel remain explicit commands against the original operation', async t => {
  const f = fixture(t);
  const server = await service(t, f, (hit, res) => respond(res, op(hit.url.endsWith('/cancel') ? 'Cancelled' : 'Succeeded')));
  for (const action of ['continue', 'cancel']) {
    const result = await f.run(['app', 'operation', action, OPERATION, '--json']);
    assert.equal(result.code, 0, result.stdout);
    assert.equal(server.hits.at(-1).url, `${ROOT}/operations/${OPERATION}/${action}`);
    assert.equal(server.hits.at(-1).method, 'POST'); assert.equal(server.hits.at(-1).body.length, 0);
  }
  assert.equal(server.hits.length, 2);
});

test('installation show reads the selected record and rejects a different installation', async t => {
  const f = fixture(t);
  let id = INSTALLATION;
  const server = await service(t, f, (hit, res) => respond(res, { id, tenantId: 'tenant-demo', packageId: PACKAGE_ID,
    installedVersionId: VERSION_ID, revision: 8, activeOperationId: null, latestOperationId: OPERATION }));
  const result = await f.run(['app', 'installation', 'show', INSTALLATION, '--json']);
  assert.equal(result.code, 0, result.stdout); assert.equal(json(result).data.revision, 8);
  assert.equal(server.hits[0].url, `${ROOT}/installations/${INSTALLATION}`);
  id = 'api11111111111111111';
  assert.equal((await f.run(['app', 'installation', 'show', INSTALLATION, '--json'])).code, 1);
});

test('invalid lifecycle arguments and payloads fail before any HTTP request', async t => {
  const f = fixture(t), server = await service(t, f, (hit, res) => respond(res, op()));
  const file = requestFile(f, { versionId: VERSION_ID });
  const cases = [
    ['app', 'import', PACKAGE_ID],
    ['app', 'import', PACKAGE_ID, '--version-id', VERSION_ID, '--exchange', server.url],
    ['app', 'install', PACKAGE_ID],
    ['app', 'install', PACKAGE_ID, '--request-json', file, '--file', file],
    ['app', 'install', PACKAGE_ID, '--request-json', file, '--version-id', VERSION_ID],
    ['app', 'install', PACKAGE_ID, '--version-id', VERSION_ID, '--expected-revision', '-1'],
    ['app', 'install', PACKAGE_ID, '--version-id', VERSION_ID, '--expected-revision', '9007199254740992'],
    ['app', 'install', PACKAGE_ID, '--version-id', VERSION_ID, '--request-id', 'random-date'],
    ['app', 'install', PACKAGE_ID, '--version-id', VERSION_ID, '--wait-timeout', '1'],
    ['app', 'install', PACKAGE_ID, '--version-id', VERSION_ID, '--wait', '--poll-interval', '0'],
    ['app', 'install', PACKAGE_ID, '--version-id', VERSION_ID, '--wait', '--wait-timeout', '86401'],
    ['app', 'operation', 'resolve', OPERATION],
    ['app', 'operation', 'retry', OPERATION, '--request-id', OPERATION],
    ['app', 'operation', 'continue', OPERATION, '--request-json', file],
    ['app', 'operation', 'cancel', OPERATION, '--wait'],
    ['app', 'operation', 'wait', OPERATION, '--exchange', server.url],
    ['app', 'installation', 'show', INSTALLATION, '--bearer', 'unused'],
  ];
  for (const argv of cases) assert.equal((await f.run([...argv, '--json'])).code, 1, argv.join(' '));
  for (const body of [[], { versionId: VERSION_ID, expectedRevison: 4 }, { versionId: null }, { versionId: VERSION_ID, expectedRevision: '4' },
    { versionId: VERSION_ID, tenantBindings: [] }, { versionId: VERSION_ID, confirmations: [{ recordId: 'x', unit: 'y' }] },
    { versionId: VERSION_ID, configurationChanges: {} }, { versionId: VERSION_ID, maintainInstalledVersion: 'true' }]) {
    assert.equal((await f.run(['app', 'install', PACKAGE_ID, '--request-json', requestFile(f, body), '--json'])).code, 1);
  }
  assert.equal(server.hits.length, 0);
});

test('management commands cannot borrow credentials from another tenant or replace a browser session with API tokens', async t => {
  const f = fixture(t), server = await service(t, f, (hit, res) => respond(res, op()));
  const wrongTenant = await f.run(['app', 'install', PACKAGE_ID, '--version-id', VERSION_ID, '--tenant', 'different', '--json']);
  assert.equal(wrongTenant.code, 1); assert.equal(json(wrongTenant).error.code, 'authentication_required');
  f.store.deleteSession('Demo');
  const noSession = await f.run(['app', 'list', '--json']);
  assert.equal(noSession.code, 1); assert.equal(json(noSession).error.code, 'authentication_required');
  assert.equal(server.hits.length, 0);
});

test('batch rejects shared lifecycle stdin before writes and keeps impact tokens only for application DTOs', async t => {
  const f = fixture(t);
  const server = await service(t, f, (hit, res) => respond(res, { targetVersionId: VERSION_ID, ready: false, requiredConfirmations: [CONFIRMATION] }));
  const batch = rows => requestFile(f, rows, 'batch.json');
  const invalid = await f.run(['batch', '--file', batch([
    ['app', 'install', PACKAGE_ID, '--version-id', VERSION_ID],
    ['app', 'operation', 'resolve', OPERATION, '--request-json', '-'],
  ]), '--json']);
  assert.equal(invalid.code, 1); assert.equal(server.hits.length, 0);
  const result = await f.run(['batch', '--file', batch([
    ['--profile', 'Demo', 'app', 'preview', PACKAGE_ID, '--version-id', VERSION_ID],
    ['data', 'query', 'customer', '--auth', 'session'],
  ]), '--json']);
  assert.equal(result.code, 0, result.stdout);
  assert.equal(json(result).data[0].data.requiredConfirmations[0].token, CONFIRMATION.token);
  assert.equal(json(result).data[1].data.requiredConfirmations[0].token, '[REDACTED]');
});

test('batch stops on an installation needing resolution and preserves its recovery information', async t => {
  const f = fixture(t);
  const waiting = op('WaitingForResolution', { details: { requiredConfirmations: [CONFIRMATION] } });
  const server = await service(t, f, (hit, res) => respond(res, waiting));
  const path = requestFile(f, [
    ['app', 'install', PACKAGE_ID, '--version-id', VERSION_ID, '--request-id', OPERATION], ['app', 'list'],
  ]);
  const result = await f.run(['batch', '--file', path, '--json']);
  assert.equal(result.code, 1); assert.equal(json(result).error.code, 'batch_failed');
  const error = json(result).error.details.results[0].error;
  assert.equal(error.code, 'operation_requires_resolution');
  assert.equal(error.details.operation.details.requiredConfirmations[0].token, CONFIRMATION.token);
  assert.equal(server.hits.length, 1);
});
