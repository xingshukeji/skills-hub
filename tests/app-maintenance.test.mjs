import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, mockServer, respond, appArchive, PACKAGE_ID, VERSION_ID } from './helpers.mjs';

const output = value => JSON.parse(value.stdout);
const op = 'apo0123456789abcdefg';

test('uninstall is one DELETE and recovers the original operation without replay', async t => {
  const f = fixture(t); let writes = 0;
  const operation = { id: op, installationId: 'installation-one', targetVersionId: VERSION_ID, status: 'Succeeded' };
  const service = await mockServer(t, (hit, res) => {
    if (hit.method === 'DELETE') { writes++; assert.deepEqual(hit.json(), { requestId: op, expectedRevision: 7 }); res.destroy(); }
    else { assert.equal(hit.url, '/api/application/v1/operations/' + op); respond(res, operation); }
  });
  f.profile(service.url, 'tenant-one'); f.store.saveSession('Demo', service.url, 'tenant-one', 'session-token', Date.now() + 300000);
  const result = await f.run(['app', 'uninstall', 'installation-one', '--request-id', op, '--expected-revision', '7', '--json']);
  assert.equal(output(result).error.code, 'outcome_unknown'); assert.equal(output(result).error.details.operationId, op);
  assert.equal(writes, 1);
  const recovered = await f.run(['app', 'operation', 'show', op, '--json']);
  assert.equal(recovered.code, 0, recovered.stdout); assert.equal(output(recovered).data.id, op); assert.equal(writes, 1);
});

test('policy preview and apply preserve explicit impact tokens and resolve the same installation', async t => {
  const f = fixture(t); const token = 'observed-impact-token';
  const service = await mockServer(t, (hit, res) => {
    if (hit.url.endsWith('/policy:preview')) { respond(res, { installationId: 'installation-one', expectedRevision: 7, targetPolicyVersion: 2, requiredConfirmations: [{ recordId: 'one', unit: 'label', token }] }); return; }
    assert.deepEqual(hit.json(), { targetPolicyVersion: 2, expectedRevision: 7, confirmations: [{ recordId: 'one', unit: 'label', token }], requestId: op });
    respond(res, { id: op, installationId: 'installation-one', targetVersionId: VERSION_ID, status: 'Succeeded' });
  });
  f.profile(service.url, 'tenant-one'); f.store.saveSession('Demo', service.url, 'tenant-one', 'session-token', Date.now() + 300000);
  const preview = await f.run(['app', 'policy', 'preview', 'installation-one', '--json']);
  assert.equal(output(preview).data.requiredConfirmations[0].token, token);
  const file = join(f.directory, 'policy.json'); writeFileSync(file, JSON.stringify({ targetPolicyVersion: 2, expectedRevision: 7, confirmations: [{ recordId: 'one', unit: 'label', token }], requestId: op }));
  const applied = await f.run(['app', 'policy', 'apply', 'installation-one', '--request-json', file, '--json']);
  assert.equal(applied.code, 0, applied.stdout); assert.equal(service.hits.length, 2);
});

test('component restore preserves zero revisions and rejected input never touches a neighboring component', async t => {
  const f = fixture(t), service = await mockServer(t, (hit, res) => {
    assert.equal(hit.url, '/api/application/v1/installations/installation-one/components/original:restore');
    assert.deepEqual(hit.json(), { expectedRevision: 0 }); respond(res, { id: 'installation-one', revision: 1 });
  });
  f.profile(service.url, 'tenant-one'); f.store.saveSession('Demo', service.url, 'tenant-one', 'session-token', Date.now() + 300000);
  assert.equal((await f.run(['app', 'component', 'restore', 'installation-one', 'original', '--expected-revision', '0', '--json'])).code, 0);
  assert.equal((await f.run(['app', 'component', 'restore', 'installation-one', 'other', '--json'])).code, 1);
  assert.equal(service.hits.length, 1);
});

test('Host local import consumes a valid archive and its Host session without publishing or installing', async t => {
  const f = fixture(t), archive = appArchive();
  const service = await mockServer(t, (hit, res) => {
    assert.equal(hit.url, '/api/application/v1/packages:import'); assert.equal(hit.headers.authorization, 'Bearer host-session');
    assert.deepEqual(hit.body, archive); respond(res, { packageId: PACKAGE_ID, versionId: VERSION_ID });
  });
  f.store.save({ activeProfile: 'Host', profiles: { Host: { server: service.url, tenant: null, scope: 'host' } } });
  f.store.saveSession('Host', service.url, null, 'host-session', Date.now() + 300000, 'host');
  const file = join(f.directory, 'local.appkg'); writeFileSync(file, archive);
  const result = await f.run(['app', 'import-file', file, '--json']); assert.equal(result.code, 0, result.stdout); assert.equal(service.hits.length, 1);
});

test('damaged maintenance receipts remain unknown and batch policy previews preserve explicit confirmation tokens', async t => {
  const f = fixture(t); let invalid = false;
  const service = await mockServer(t, (hit, res) => {
    if (invalid) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{damaged'); return; }
    respond(res, { installationId: 'original', requiredConfirmations: [{ recordId: 'one', unit: 'label', token: 'explicit-impact' }] });
  });
  f.profile(service.url, 'tenant-one'); f.store.saveSession('Demo', service.url, 'tenant-one', 'caller', Date.now() + 300000);
  const file = join(f.directory, 'batch.json'); writeFileSync(file, JSON.stringify([['app', 'policy', 'preview', 'original']]));
  const preview = output(await f.run(['batch', file, '--json'])); assert.equal(preview.data[0].data.requiredConfirmations[0].token, 'explicit-impact');
  invalid = true;
  const result = await f.run(['app', 'component', 'restore', 'original', 'component', '--expected-revision', '1', '--json']);
  assert.equal(output(result).error.code, 'outcome_unknown'); assert.equal(service.hits.length, 2);
});
