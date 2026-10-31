import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, mockServer, respond } from './helpers.mjs';

const output = value => JSON.parse(value.stdout);

test('Routine commands keep the explicit execution identity and retain legacy Workforce refusal', async t => {
  const f = fixture(t); let executionUser = 'original-user', runs = 0;
  const service = await mockServer(t, (hit, res) => {
    if (hit.url === '/api/automation/routines/execution-user') {
      assert.deepEqual(hit.json(), { userId: 'selected-user' }); executionUser = hit.json().userId; respond(res, { userId: executionUser });
    } else if (hit.url.includes('/legacy/')) respond(res, { errorCode: 'routine.workforce_managed' }, 409);
    else { runs++; respond(res, { id: 'run-one', status: 'queued', executionUserId: executionUser }); }
  });
  f.profile(service.url, 'tenant-one', 'own-token');
  const file = join(f.directory, 'owner.json'); writeFileSync(file, '{"userId":"selected-user"}');
  assert.equal((await f.run(['routine', 'execution-user', 'set', '--request-json', file, '--json'])).code, 0);
  assert.equal((await f.run(['routine', 'run', 'original', '--json'])).code, 0); assert.equal(runs, 1);
  const legacy = await f.run(['routine', 'enable', 'legacy', '--json']);
  assert.equal(output(legacy).error.code, 'conflict'); assert.equal(runs, 1); assert.equal(service.hits.length, 3);
});

test('HTTP debug preserves a native JSON input and never repeats an unknown external action', async t => {
  const f = fixture(t); let effects = 0;
  const service = await mockServer(t, (hit, res) => {
    assert.equal(hit.url, '/api/integration/v1/http-requests/registered/request/debug');
    assert.deepEqual(hit.json(), ['native', { recordId: 'one' }]); effects++; res.destroy();
  });
  f.profile(service.url, 'tenant-one', 'own-token');
  const file = join(f.directory, 'input.json'); writeFileSync(file, '["native",{"recordId":"one"}]');
  const result = await f.run(['http', 'request', 'debug', 'registered', 'request', '--request-json', file, '--json']);
  assert.equal(output(result).error.code, 'outcome_unknown');
  assert.deepEqual(output(result).error.details.target, { connector: 'registered', name: 'request' });
  assert.equal(effects, 1);
});

test('variable secrets stay out of errors and Host maintenance retains the explicit target tenant', async t => {
  const f = fixture(t), secret = 'synthetic-private-variable-value';
  const service = await mockServer(t, (hit, res) => {
    assert.equal(hit.url, '/api/variables/items?tenantId=selected-tenant');
    assert.equal(hit.headers['x-tenant-id'], undefined);
    respond(res, { errorCode: 'server.unknown', message: 'received ' + hit.json().value }, 500);
  });
  f.store.save({ activeProfile: 'Host', profiles: { Host: { server: service.url, scope: 'host', tenant: null, bearerToken: 'host-token' } } });
  const file = join(f.directory, 'value.json'), query = join(f.directory, 'query.json');
  writeFileSync(file, JSON.stringify({ variableKey: 'registered-secret', value: secret })); writeFileSync(query, '{"tenantId":"selected-tenant"}');
  const result = await f.run(['variable', 'set', '--request-json', file, '--query-json', query, '--json']);
  assert.equal(output(result).error.code, 'outcome_unknown'); assert.equal(output(result).error.details.targetTenantId, 'selected-tenant');
  assert.ok(!result.stdout.includes(secret)); assert.equal(service.hits.length, 1);
});

test('time parsing uses native ambiguity results without treating a read-only POST failure as a write', async t => {
  const f = fixture(t); let mode = 'ambiguous';
  const service = await mockServer(t, (_hit, res) => {
    if (mode === 'ambiguous') respond(res, { status: 'ambiguous', candidates: ['first', 'second'] }); else res.destroy();
  });
  f.profile(service.url, 'tenant-one', 'own-token');
  const file = join(f.directory, 'time.json'); writeFileSync(file, '{"items":[]}');
  const result = await f.run(['time', 'resolve', '--request-json', file, '--json']);
  assert.deepEqual(output(result).data.candidates, ['first', 'second']);
  mode = 'drop';
  assert.equal(output(await f.run(['time', 'resolve', '--request-json', file, '--json'])).error.code, 'network_error');
  assert.equal(service.hits.length, 2);
});
