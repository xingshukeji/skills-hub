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


test('manual execution keeps its stable key and original run while reads of failed runs remain successful', async t => {
  const f = fixture(t), platform = await mockServer(t, (_hit, res) => respond(res, { tenantId: 'TEN', userId: 'human' }));
  const receipt = { id: 'manual-original', scheduleId: 'schedule', trigger: 'Manual', status: 'Running' }; let writes = 0;
  const host = await mockServer(t, (hit, res) => {
    assert.equal(hit.headers.authorization, 'Bearer member-session'); assert.equal(hit.headers['x-xrain-expected-user-id'], 'human');
    if (hit.method === 'POST') { writes++; assert.equal(hit.url, '/api/cli/v1/task-schedules/schedule/run-once'); assert.deepEqual(hit.json(), { requestId: 'stable-click' }); return respond(res, receipt); }
    assert.equal(hit.url, '/api/cli/v1/task-schedules/schedule/runs/manual-original'); respond(res, { ...receipt, status: 'Failed', failureCode: 'business.rejected' });
  }); login(f, platform.url);
  const args = ['workforce', 'schedule', 'run-once', 'schedule', '--workforce', host.url, '--request-json', input(f, 'manual', { requestId: 'stable-click' }), '--json'];
  for (let attempt = 0; attempt < 2; attempt++) assert.deepEqual(output(await f.run(args)).data, receipt);
  const read = await f.run(['workforce', 'schedule', 'run', 'show', 'schedule', 'manual-original', '--workforce', host.url, '--json']);
  assert.equal(read.code, 0); assert.equal(output(read).data.status, 'Failed'); assert.equal(writes, 2);
  for (const body of [{}, { requestId: '' }, { requestId: 'bad/key' }, { requestId: 'stable-click', userId: 'someone' }]) {
    const invalid = await f.run(['workforce', 'schedule', 'run-once', 'schedule', '--workforce', host.url, '--request-json', input(f, 'invalid-manual', body), '--json']);
    assert.equal(output(invalid).error.code, 'invalid_arguments');
  } assert.equal(writes, 2, 'invalid manual requests never reach the write route');
});

test('manual execution preserves its key after unknown receipts and retains real permission and overlap failures', async t => {
  const f = fixture(t), platform = await mockServer(t, (_hit, res) => respond(res, { tenantId: 'TEN', userId: 'human' }));
  let mode = 'drop', writes = 0;
  const host = await mockServer(t, (hit, res) => {
    if (hit.method === 'GET') return respond(res, { id: 'original', revision: 'unchanged', status: 'Enabled', nextRunAt: '2026-12-01T01:00:00Z' });
    writes++;
    if (mode === 'drop') return res.destroy();
    if (mode === 'invalid') return respond(res, { id: 'wrong-run', scheduleId: 'another', trigger: 'Manual', status: 'Running' });
    return respond(res, { code: mode === 'forbidden' ? 'schedule.assignee_required' : 'schedule.already_running' }, mode === 'forbidden' ? 403 : 409);
  }); login(f, platform.url);
  const args = ['workforce', 'schedule', 'run-once', 'original', '--workforce', host.url, '--request-json', input(f, 'manual-key', { requestId: 'keep-key' }), '--json'];
  for (mode of ['drop', 'invalid']) { const failed = output(await f.run(args)).error; assert.equal(failed.code, 'outcome_unknown'); assert.equal(failed.details.requestId, 'keep-key'); assert.equal(failed.details.target['schedule-id'], 'original'); }
  for (mode of ['forbidden', 'overlap']) { const failed = output(await f.run(args)).error; assert.notEqual(failed.code, 'outcome_unknown'); assert.equal(failed.serverCode, mode === 'forbidden' ? 'schedule.assignee_required' : 'schedule.already_running'); }
  assert.equal((await f.run(['workforce', 'schedule', 'show', 'original', '--workforce', host.url, '--json'])).code, 0); assert.equal(writes, 4);
});


test('history forwards each original cursor and failed run inspection is read-only', async t => {
  const f = fixture(t), platform = await mockServer(t, (_hit, res) => respond(res, { tenantId: 'TEN', userId: 'human' }));
  const first = { items: [{ id: 'newer', scheduleId: 'original', status: 'Succeeded' }], nextCursor: '2026-11-08T09:00:00.000Z' };
  const last = { items: [{ id: 'failed', scheduleId: 'original', status: 'Failed' }], nextCursor: null };
  const host = await mockServer(t, (hit, res) => { assert.equal(hit.method, 'GET'); const url = new URL(hit.url, 'http://local');
    if (url.pathname.endsWith('/history')) return respond(res, url.searchParams.has('before') ? last : first);
    assert.equal(url.pathname, '/api/cli/v1/task-schedules/original/runs/failed'); respond(res, last.items[0]); });
  login(f, platform.url); const base = ['--workforce', host.url, '--json'];
  const page = output(await f.run(['workforce', 'schedule', 'history', 'original', ...base])).data;
  const second = output(await f.run(['workforce', 'schedule', 'history', 'original', '--query-json', input(f, 'cursor', { before: page.nextCursor }), ...base])).data;
  assert.deepEqual([...page.items, ...second.items].map(run => run.id), ['newer', 'failed']); assert.equal(second.nextCursor, null);
  assert.equal(new URL(host.hits[1].url, 'http://local').searchParams.get('before'), first.nextCursor);
  const inspected = await f.run(['workforce', 'schedule', 'run', 'show', 'original', 'failed', ...base]); assert.equal(inspected.code, 0); assert.equal(output(inspected).data.status, 'Failed'); assert.equal(host.hits.length, 3);
});
