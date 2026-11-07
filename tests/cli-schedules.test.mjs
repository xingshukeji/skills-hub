import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, mockServer, respond } from './helpers.mjs';

const output = result => JSON.parse(result.stdout);
function login(f, server) {
  f.store.save({ activeProfile: 'Demo', profiles: { Demo: { server, tenant: 'TEN', applicationId: 'APP' } } });
  f.store.saveSession('Demo', server, 'TEN', 'member-session', Date.now() + 300000);
}
function input(f, name, body) { const path = join(f.directory, name + '.json'); writeFileSync(path, JSON.stringify(body)); return path; }

test('schedule preview is read-only, preserves normalized timing and reports a failed read without claiming an unknown write', async t => {
  const f = fixture(t), platform = await mockServer(t, (_hit, res) => respond(res, { tenantId: 'TEN', userId: 'human' }));
  const body = { timeZoneId: 'Asia/Shanghai', timingDraft: { type: 'Once', localDateTime: '2026-11-08T09:00' } };
  const preview = { timing: { type: 'Once', at: '2026-11-08T01:00:00.000Z' }, nextRunAt: '2026-11-08T01:00:00.000Z' };
  let unavailable = false;
  const host = await mockServer(t, (hit, res) => {
    assert.equal(hit.url, '/api/cli/v1/task-schedules/preview'); assert.equal(hit.method, 'POST');
    assert.equal(hit.headers.authorization, 'Bearer member-session'); assert.equal(hit.headers['x-xrain-expected-user-id'], 'human');
    assert.deepEqual(hit.json(), body);
    respond(res, unavailable ? { code: 'schedule.unavailable' } : preview, unavailable ? 503 : 200);
  });
  login(f, platform.url);
  const args = ['workforce', 'schedule', 'preview', '--workforce', host.url, '--request-json', input(f, 'preview', body), '--json'];
  const result = await f.run(args); assert.equal(result.code, 0, result.stdout); assert.deepEqual(output(result).data, preview);
  unavailable = true; const failed = await f.run(args);
  assert.equal(failed.code, 1); assert.equal(output(failed).error.serverCode, 'schedule.unavailable');
  assert.notEqual(output(failed).error.code, 'outcome_unknown'); assert.equal(host.hits.length, 2);
});

test('schedule exact lookup uses the original key and identity, preserves current edits and never creates on not found', async t => {
  const f = fixture(t), platform = await mockServer(t, (_hit, res) => respond(res, { tenantId: 'TEN', userId: 'human' }));
  let missing = false;
  const current = { id: 'original', creationRequestId: 'original-key', revision: 'later-edit', status: 'Paused', nextRunAt: null, name: 'human edit' };
  const host = await mockServer(t, (hit, res) => {
    assert.equal(hit.method, 'GET'); assert.equal(hit.headers['x-xrain-application-id'], 'APP');
    assert.equal(hit.headers['x-xrain-expected-tenant-id'], 'TEN'); assert.equal(hit.headers['x-xrain-expected-user-id'], 'human');
    respond(res, missing ? { code: 'schedule.not_found' } : current, missing ? 404 : 200);
  });
  login(f, platform.url);
  for (const command of [['show', 'original'], ['lookup', '--request-id', 'original-key']]) {
    const result = await f.run(['workforce', 'schedule', ...command, '--workforce', host.url, '--json']);
    assert.equal(result.code, 0, result.stdout); assert.deepEqual(output(result).data, current);
  }
  assert.deepEqual(host.hits.map(hit => hit.url), ['/api/cli/v1/task-schedules/original', '/api/cli/v1/task-schedules/lookup?requestId=original-key']);
  missing = true;
  const failed = await f.run(['workforce', 'schedule', 'lookup', 'not&another=target', '--workforce', host.url, '--json']);
  assert.equal(output(failed).error.serverCode, 'schedule.not_found');
  assert.equal(host.hits.at(-1).url, '/api/cli/v1/task-schedules/lookup?requestId=not%26another%3Dtarget');
  assert.equal(host.hits.length, 3, 'failed recovery is read-only and is never followed by a replacement');
});

test('enable transmits the observed revision, preserves conflicts and unknown receipts and recovers by reading without another enable', async t => {
  const f = fixture(t), platform = await mockServer(t, (_hit, res) => respond(res, { tenantId: 'TEN', userId: 'human' }));
  let mode = 'ok', writes = 0;
  const host = await mockServer(t, (hit, res) => {
    if (hit.method === 'GET') return respond(res, { id: 'original', revision: 'manual-pause', status: 'Paused', nextRunAt: null });
    assert.equal(hit.url, '/api/cli/v1/task-schedules/original/enable'); writes++;
    assert.deepEqual(hit.json(), { expectedRevision: 'observed' });
    if (mode === 'drop') return res.destroy();
    respond(res, mode === 'conflict' ? { code: 'schedule.changed' } : { id: 'original', status: 'Enabled' }, mode === 'conflict' ? 409 : 200);
  });
  login(f, platform.url);
  const args = ['workforce', 'schedule', 'enable', 'original', '--workforce', host.url, '--json'];
  assert.equal((await f.run([...args, '--expected-revision', 'observed'])).code, 0);
  const file = input(f, 'enable', { expectedRevision: 'observed' });
  assert.equal((await f.run([...args, '--request-json', file])).code, 0);
  mode = 'conflict'; const conflict = await f.run([...args, '--expected-revision', 'observed']);
  assert.equal(conflict.code, 1); assert.equal(output(conflict).error.serverCode, 'schedule.changed');
  assert.notEqual(output(conflict).error.code, 'outcome_unknown');
  mode = 'drop'; const unknown = await f.run([...args, '--expected-revision', 'observed']);
  assert.equal(output(unknown).error.code, 'outcome_unknown'); assert.equal(output(unknown).error.details.expectedRevision, 'observed');
  assert.equal(output(unknown).error.details.target['schedule-id'], 'original');
  const recovered = await f.run(['workforce', 'schedule', 'show', 'original', '--workforce', host.url, '--json']);
  assert.equal(output(recovered).data.status, 'Paused'); assert.equal(writes, 4, 'no replay after conflict, response loss or lookup');
  for (const invalid of [
    [...args, '--expected-revision', 'observed', '--request-json', file],
    [...args, '--request-json', input(f, 'empty', {})],
    [...args, '--request-json', input(f, 'other', { expectedRevision: 'observed', assigneeId: 'another' })],
  ]) assert.equal((await f.run(invalid)).code, 1);
  assert.equal(writes, 4, 'ambiguous or invalid revision input is never written');
});
