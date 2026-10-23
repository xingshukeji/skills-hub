import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { request, prepareLab, verifyLab } from '../tools/capability-lab.mjs';
import { cases } from '../evals/workforce/capability-lab-cases.mjs';

test('lab state distinguishes waiting, failed and interrupted operations without hiding partial errors', () => {
  const waiting = structuredClone(cases.find(row => row.id === 'l01').seed);
  assert.equal(request(waiting, 'POST', '/api/application/v1/operations/apo-1/continue').status, 409);
  assert.equal(waiting.operation.status, 'WaitingForResolution');
  assert.equal(request(waiting, 'POST', '/api/application/v1/operations/apo-1/resolve', { expectedRevision: 7, resolutions: { 'apr-view/Label': 'KeepTenant' } }).data.errorCode, 'managed_property_read_only');
  assert.equal(request(waiting, 'POST', '/api/application/v1/operations/apo-1/resolve', { expectedRevision: 7, tenantBindings: { 'apr-connector/baseAddress': 'https://orders.example.invalid' }, configurationChanges: { 'apr-view/fieldNames': { present: true, value: ['name', 'amount'] } } }).status, 200);
  assert.equal(waiting.label, '租户自定义标题');
  assert.deepEqual(waiting.fieldNames, ['name', 'amount']);
  const failed = structuredClone(cases.find(row => row.id === 'l02').seed);
  assert.equal(request(failed, 'POST', '/api/application/v1/operations/apo-2/retry', { requestId: 'apo-2', expectedRevision: 7 }).status, 409);
  assert.equal(request(failed, 'POST', '/api/application/v1/operations/apo-2/retry', { requestId: 'retry-request', expectedRevision: 7 }).status, 200);
  assert.equal(failed.operations['apo-2'].status, 'Failed'); assert.equal(failed.operation.id, 'retry-request');
});
test('lab checks revision and execution grant eligibility before mutations', () => {
  const publication = structuredClone(cases.find(row => row.id === 'l07').seed);
  assert.equal(request(publication, 'PUT', '/api/xrain/v1/applications/app-sales/publication-scope', { ...publication.oldScreenshot, expectedRevision: 3 }).status, 409);
  assert.deepEqual(publication.publication.userIds, ['user-zhang', 'user-colleague']);
  const access = structuredClone(cases.find(row => row.id === 'l06').seed);
  assert.equal(request(access, 'PUT', '/api/xrain/v1/applications/app-orders/execution-authorization/grants', { permissionIds: ['application.messages.send'] }).status, 400);
  assert.deepEqual(access.granted, []);
});
test('lab evidence cannot be replaced by a completed prose claim or changed inputs', async t => {
  const root = await mkdtemp(join(tmpdir(), 'capability lab '));
  t.after(() => rm(root, { recursive: true, force: true }));
  const run = join(root, 'run'); const prepared = await prepareLab(run);
  await assert.rejects(prepareLab(run));
  for (const group of prepared.groups) await writeFile(join(run, group, 'output/answers.json'), JSON.stringify({ answers: cases.map(row => ({ id: row.id, skill: null, conclusion: 'Synthetic verifier fixture, not a skill evaluation.', actions: [], evidence: [], unresolved: [] })) }));
  const result = await verifyLab(run);
  assert.equal(result.semanticReview, 'required');
  assert(result.groups.every(group => Object.values(group.states).every(row => row.finished === false)));
  await writeFile(join(run, prepared.groups[0], 'input/api.json'), '{}');
  await assert.rejects(verifyLab(run), /input changed/);
});
