import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, mockServer, respond } from './helpers.mjs';

const output = value => JSON.parse(value.stdout);

test('lost write receipts retain safe targets without resubmitting or claiming success', async t => {
  const f = fixture(t), committed = [];
  const service = await mockServer(t, (hit, res) => { committed.push([hit.method, hit.url]); res.destroy(); });
  f.profile(service.url, 'tenant-one', 'synthetic-private-bearer');
  const cases = [
    { args: ['data', 'update', 'customer', 'original-id', '--values', '{"note":"private-record-value"}'], resource: 'customer', id: 'original-id' },
    { args: ['data', 'delete', 'customer', 'original-id'], resource: 'customer', id: 'original-id' },
    { args: ['data', 'create', 'customer', '--values', '{"note":"private-record-value"}'], resource: 'customer' },
    { args: ['security', 'user', 'grant-role', 'zhangsan', '--names', 'reader'], resource: 'users' },
  ];
  for (const [index, item] of cases.entries()) {
    const result = await f.run([...item.args, '--json']);
    assert.equal(result.code, 1);
    const error = output(result).error;
    assert.equal(error.code, 'outcome_unknown', result.stdout);
    assert.equal(error.details.profile, 'Demo');
    assert.equal(error.details.server, service.url);
    assert.equal(error.details.tenant, 'tenant-one');
    assert.equal(error.details.entityCode ?? error.details.resource, item.resource);
    if (item.id) assert.equal(error.details.recordId, item.id);
    assert.ok(Array.isArray(error.details.readback));
    assert.equal(committed.length, index + 1);
    assert.equal(service.hits.length, index + 1);
    assert.ok(!result.stdout.includes('private-record-value'));
    assert.ok(!result.stdout.includes('synthetic-private-bearer'));
    assert.match(error.hint, /unknown/i);
  }
});

test('authentication, authorization and concurrency rejection remain definite failures', async t => {
  const f = fixture(t); let status = 401;
  const service = await mockServer(t, (_hit, res) => respond(res, { errorCode: 'record.rejected' }, status));
  f.profile(service.url, 'tenant-one', 'synthetic-token');
  for (const [value, code] of [[401, 'authentication_failed'], [403, 'permission_denied'], [409, 'conflict']]) {
    status = value;
    const result = await f.run(['data', 'update', 'customer', 'original', '--values', '{}', '--json']);
    assert.equal(output(result).error.code, code, result.stdout);
    assert.equal(output(result).error.httpStatus, value);
    assert.equal(output(result).error.details.recordId, 'original');
  }
  assert.equal(service.hits.length, 3);
});

test('an unusable receipt and a server error preserve recovery while read failures stay read failures', async t => {
  const f = fixture(t); let mode = 'malformed';
  const service = await mockServer(t, (_hit, res) => {
    if (mode === 'malformed') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{'); }
    else if (mode === 'error') respond(res, { errorCode: 'server.unknown' }, 500);
    else res.destroy();
  });
  f.profile(service.url, 'tenant-one', 'synthetic-token');
  for (const value of ['malformed', 'error']) {
    mode = value;
    const result = await f.run(['data', 'delete', 'customer', 'original', '--json']);
    assert.equal(output(result).error.code, 'outcome_unknown');
    assert.equal(output(result).error.details.recordId, 'original');
  }
  mode = 'drop';
  const query = await f.run(['data', 'query', 'customer', '--json']);
  assert.equal(output(query).error.code, 'network_error');
  assert.equal(service.hits.length, 3);
});

test('a connection failure before arrival is never treated as a successful write', async t => {
  const f = fixture(t), service = await mockServer(t, (_hit, res) => respond(res, {}));
  f.profile(service.url, 'tenant-one', 'synthetic-token');
  await new Promise(resolve => service.server.close(resolve));
  const result = await f.run(['data', 'delete', 'customer', 'original', '--json']);
  assert.equal(output(result).error.code, 'outcome_unknown');
  assert.equal(output(result).error.details.recordId, 'original');
  assert.equal(service.hits.length, 0);
});

test('batch recovery retains completed effects and the exact failed target without replaying later steps', async t => {
  const f = fixture(t), writes = [];
  const service = await mockServer(t, (hit, res) => {
    writes.push(hit.url);
    if (hit.method === 'PUT') res.destroy(); else respond(res, { recordId: 'created' }, 201);
  });
  f.profile(service.url, 'tenant-one', 'synthetic-token');
  const file = join(f.directory, 'batch.json');
  writeFileSync(file, JSON.stringify([
    ['data', 'create', 'customer', '--values', '{"name":"one"}'],
    ['data', 'update', 'customer', 'second', '--values', '{"name":"two"}'],
    ['data', 'delete', 'customer', 'third'],
  ]));
  const result = await f.run(['batch', '--file', file, '--json']);
  const error = output(result).error;
  assert.equal(error.code, 'batch_failed');
  assert.equal(error.details.failedIndex, 1);
  assert.equal(error.details.results[0].ok, true);
  assert.equal(error.details.results[1].error.code, 'outcome_unknown');
  assert.equal(error.details.results[1].error.details.recordId, 'second');
  assert.equal(writes.length, 2);
});
