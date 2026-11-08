import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, mockServer, respond } from './helpers.mjs';

const parse = result => JSON.parse(result.stdout);
const row = status => ({ id: 'original-run', scheduleId: 'original', status, deadlineAt: '2099-01-01T09:00:00Z', failureCode: status === 'Failed' ? 'business.rejected' : null });
function login(f, server) {
  f.store.save({ activeProfile: 'Demo', profiles: { Demo: { server, tenant: 'TEN', applicationId: 'APP' } } });
  f.store.saveSession('Demo', server, 'TEN', 'member-session', Date.now() + 300000);
}
const args = host => ['workforce', 'schedule', 'run', 'wait', 'original', 'original-run', '--workforce', host, '--json'];

test('wait follows only the original run and retains failed, skipped and cancelled terminals as readable outcomes', async t => {
  const f = fixture(t), platform = await mockServer(t, (_hit, res) => respond(res, { tenantId: 'TEN', userId: 'human' }));
  let status = 'Running', reads = 0;
  const host = await mockServer(t, (hit, res) => {
    assert.equal(hit.method, 'GET'); assert.equal(hit.url, '/api/cli/v1/task-schedules/original/runs/original-run');
    assert.equal(hit.headers.authorization, 'Bearer member-session'); assert.equal(hit.headers['x-xrain-application-id'], 'APP'); assert.equal(hit.headers['x-xrain-expected-user-id'], 'human');
    reads++; respond(res, row(status === 'Running' && reads > 1 ? 'Succeeded' : status));
  }); login(f, platform.url);
  const completed = await f.run([...args(host.url), '--wait-timeout', '4']);
  assert.equal(completed.code, 0); assert.equal(parse(completed).data.run.status, 'Succeeded'); assert.equal(reads, 2);
  for (status of ['Failed', 'Cancelled', 'Skipped']) {
    const result = await f.run(args(host.url)); assert.equal(result.code, 0);
    const data = parse(result).data; assert.equal(data.run.status, status); assert.equal(data.run.deadlineAt, row(status).deadlineAt);
    assert.equal(data.waitStatus, 'terminal'); assert.equal(data.businessSuccess, 'unverified'); assert.equal(data.serverCancelled, false);
  }
});

test('local budget includes identity lookup and never reaches the host when identity stalls', async t => {
  const f = fixture(t), platform = await mockServer(t, () => {}), host = await mockServer(t, () => assert.fail('host must not be reached'));
  login(f, platform.url); const start = performance.now();
  const result = await f.run([...args(host.url), '--wait-timeout', '1']);
  assert.equal(parse(result).error.code, 'schedule_wait_timeout'); assert.ok(performance.now() - start < 2500);
  assert.equal(host.hits.length, 0); assert.equal(parse(result).error.details.lastRun, null);
  assert.equal(parse(result).error.details.workforce, host.url); assert.equal(parse(result).error.details.waitTimeoutSeconds, 1);
  assert.ok(Number.isFinite(Date.parse(parse(result).error.details.waitDeadlineAt)));
});

test('budget aborts a stalled response body, preserves the original target and never cancels server work', async t => {
  const f = fixture(t), platform = await mockServer(t, (_hit, res) => respond(res, { tenantId: 'TEN', userId: 'human' }));
  const host = await mockServer(t, (_hit, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.write('{"id":'); });
  login(f, platform.url); const start = performance.now(); const result = await f.run([...args(host.url), '--wait-timeout', '4']);
  assert.equal(parse(result).error.code, 'schedule_wait_timeout'); assert.ok(performance.now() - start < 6000);
  assert.equal(parse(result).error.details.runId, 'original-run'); assert.equal(parse(result).error.details.serverCancelled, false);
  assert.deepEqual(host.hits.map(hit => hit.method), ['GET']);
});

test('polling timeout retains the latest running receipt and the same command can later observe success', async t => {
  const f = fixture(t), platform = await mockServer(t, (_hit, res) => respond(res, { tenantId: 'TEN', userId: 'human' }));
  let status = 'Running'; const host = await mockServer(t, (hit, res) => { assert.equal(hit.method, 'GET'); respond(res, row(status)); }); login(f, platform.url);
  const stopped = parse(await f.run([...args(host.url), '--wait-timeout', '4', '--poll-interval', '10']));
  assert.equal(stopped.error.code, 'schedule_wait_timeout'); assert.equal(stopped.error.details.lastRun.status, 'Running'); assert.equal(host.hits.length, 1);
  status = 'Succeeded'; const recovered = await f.run(args(host.url)); assert.equal(recovered.code, 0); assert.equal(parse(recovered).data.run.id, 'original-run'); assert.equal(host.hits.length, 2);
});

test('real read failures and foreign or unknown receipts remain failures without implying not executed', async t => {
  const f = fixture(t), platform = await mockServer(t, (_hit, res) => respond(res, { tenantId: 'TEN', userId: 'human' }));
  let mode; const host = await mockServer(t, (hit, res) => { assert.equal(hit.method, 'GET');
    if (mode === 'drop') return res.destroy();
    if (typeof mode === 'number') return respond(res, { code: mode === 404 ? 'schedule.run_not_found' : 'schedule.assignee_required' }, mode);
    respond(res, { ...row('Succeeded'), ...(mode === 'foreign' ? { scheduleId: 'another' } : { status: 'Invented' }) });
  }); login(f, platform.url);
  for (mode of [404, 403, 502, 'drop', 'foreign', 'unknown-status']) {
    const result = await f.run(args(host.url)); assert.equal(result.code, 1);
    const error = parse(result).error; assert.equal(error.code, typeof mode === 'number' ? mode === 404 ? 'not_found' : mode === 403 ? 'permission_denied' : 'http_error' : mode === 'drop' ? 'network_error' : 'invalid_response');
    assert.equal(error.details.runId, 'original-run'); assert.equal(error.details.lastRun, null); assert.equal(error.details.serverCancelled, false);
  }
  assert.equal(host.hits.length, 6);
});

test('Ctrl+C stops only observation, disposes the listener and permits same-run recovery', async t => {
  const f = fixture(t), platform = await mockServer(t, (_hit, res) => respond(res, { tenantId: 'TEN', userId: 'human' }));
  let interrupt = true; const host = await mockServer(t, (hit, res) => { assert.equal(hit.method, 'GET');
    if (interrupt) { setImmediate(() => process.emit('SIGINT')); return; } respond(res, row('Succeeded'));
  }); login(f, platform.url); const before = process.listenerCount('SIGINT');
  const result = await f.run(args(host.url)); assert.equal(parse(result).error.code, 'schedule_wait_interrupted'); assert.equal(process.listenerCount('SIGINT'), before);
  interrupt = false; assert.equal((await f.run(args(host.url))).code, 0); assert.equal(host.hits.length, 2);
});

test('invalid observation budgets are rejected before any network request', async t => {
  const f = fixture(t), platform = await mockServer(t, () => assert.fail('must not contact platform')); login(f, platform.url);
  for (const options of [['--wait-timeout', '0'], ['--wait-timeout', '2147484'], ['--poll-interval', '-1'], ['--poll-interval', '0.1']]) {
    assert.equal((await f.run([...args('http://127.0.0.1:1'), ...options])).code, 1);
  }
  assert.equal(platform.hits.length, 0);
});

test('a shorter explicit HTTP limit retains its read error without consuming the total budget or retrying', async t => {
  const f = fixture(t), platform = await mockServer(t, (_hit, res) => respond(res, { tenantId: 'TEN', userId: 'human' }));
  const host = await mockServer(t, () => {}); login(f, platform.url);
  const result = await f.run([...args(host.url), '--wait-timeout', '8', '--timeout', '1']);
  assert.equal(parse(result).error.code, 'timeout'); assert.equal(parse(result).error.details.runId, 'original-run');
  assert.equal(host.hits.length, 1); assert.equal(host.hits[0].method, 'GET');
});
