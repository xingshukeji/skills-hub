import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, mockServer, respond, zip } from './helpers.mjs';

const output = value => JSON.parse(value.stdout);
const mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

test('native collection writes keep allOrNone and expected values in one transaction request', async t => {
  const f = fixture(t), persisted = new Map([['one', 'old'], ['two', 'old']]); let mutations = 0;
  const service = await mockServer(t, (hit, res) => {
    const body = hit.json(); mutations++;
    assert.equal(hit.url, '/api/data/v1/entities/customer/records:batchUpdate');
    assert.deepEqual(body.records[0], { recordId: 'one', values: { name: 'new' }, expectedValues: { name: 'old' } });
    if (body.allOrNone) { respond(res, { errorCode: 'record.conflict' }, 409); return; }
    persisted.set('one', 'new');
    respond(res, { allOrNone: false, commitState: 'partial', results: [
      { index: 0, success: true, recordId: 'one', errors: [] }, { index: 1, success: false, recordId: 'two', errors: [{ code: 'conflict' }] },
    ] });
  });
  f.profile(service.url, 'tenant-one', 'synthetic-token');
  const file = join(f.directory, 'update.json'), body = { allOrNone: true, records: [
    { recordId: 'one', values: { name: 'new' }, expectedValues: { name: 'old' } }, { recordId: 'two', values: { name: 'bad' }, expectedValues: { name: 'different' } },
  ] };
  writeFileSync(file, JSON.stringify(body));
  const atomic = await f.run(['data', 'batch-update', 'customer', '--request-json', file, '--json']);
  assert.equal(output(atomic).error.code, 'conflict');
  assert.deepEqual([...persisted.values()], ['old', 'old']);
  body.allOrNone = false; writeFileSync(file, JSON.stringify(body));
  const partial = await f.run(['data', 'batch-update', 'customer', '--request-json', file, '--json']);
  assert.equal(output(partial).error.code, 'collection_failed');
  assert.equal(output(partial).error.details.result.results[0].success, true);
  assert.deepEqual([...persisted.values()], ['new', 'old']);
  assert.equal(mutations, 2);
});

test('record inspection, sharing and owner operations preserve native paths, subjects and request bodies', async t => {
  const f = fixture(t), service = await mockServer(t, (_hit, res) => respond(res, { result: 'native' }));
  f.profile(service.url, 'tenant-one', 'synthetic-token');
  const file = join(f.directory, 'request.json');
  const cases = [
    [['data', 'capabilities'], 'GET', '/api/data/v1/query-capabilities'],
    [['data', 'query-batch', '--request-json', file], 'POST', '/api/data/v1/records:queryBatch', { queries: [{ entityCode: 'customer', query: { page: 2 } }] }],
    [['data', 'field-options', 'customer', 'account/name', '--search', '张三'], 'GET', '/api/data/v1/entities/customer/fields/account%2Fname/options?page=1&pageSize=25&search=%E5%BC%A0%E4%B8%89'],
    [['data', 'original-values', 'customer', 'one', '--fields', 'name,status'], 'POST', '/api/data/v1/entities/customer/records/one/original-values', { fields: ['name', 'status'] }],
    [['data', 'history', 'customer', 'one'], 'GET', '/api/data/v1/entities/customer/records/one/history?page=1&pageSize=25'],
    [['data', 'owner-transfer', 'customer', 'one', '--request-json', file], 'POST', '/api/data/v1/entities/customer/records/one:transferOwner', { ownerId: 'new-owner' }],
    [['data', 'share', 'list', 'customer', 'one'], 'GET', '/api/data/v1/entities/customer/records/one/shares?page=1&pageSize=25'],
    [['data', 'share', 'recipients', 'customer', 'one'], 'GET', '/api/data/v1/entities/customer/records/one/shares/recipients?page=1&pageSize=25'],
    [['data', 'share', 'capability', 'customer', 'one'], 'GET', '/api/data/v1/entities/customer/records/one/shares/capability'],
    [['data', 'share', 'eligibility', 'customer', 'one', '--user-id', 'user-one'], 'GET', '/api/data/v1/entities/customer/records/one/shares/eligibility?userId=user-one'],
    [['data', 'share', 'grant', 'customer', 'one', '--request-json', file], 'POST', '/api/data/v1/entities/customer/records/one/shares', { userId: 'user-one', readable: true, updateable: false, deleteable: false }],
    [['data', 'share', 'update', 'customer', 'one', 'share-one', '--request-json', file], 'PATCH', '/api/data/v1/entities/customer/records/one/shares/share-one', { userId: 'user-one', readable: true, updateable: true }],
    [['data', 'share', 'revoke', 'customer', 'one', 'share-one'], 'DELETE', '/api/data/v1/entities/customer/records/one/shares/share-one'],
    [['data', 'batch-create', 'customer', '--request-json', file], 'POST', '/api/data/v1/entities/customer/records:batchCreate', { records: [{ values: { name: 'one' } }] }],
    [['data', 'batch-delete', 'customer', '--request-json', file], 'POST', '/api/data/v1/entities/customer/records:batchDelete', { recordIds: ['one'], allOrNone: false }],
  ];
  for (const [args, method, url, body] of cases) {
    if (body) writeFileSync(file, JSON.stringify(body));
    const result = await f.run([...args, '--json']);
    assert.equal(result.code, 0, result.stdout);
    const hit = service.hits.at(-1); assert.equal(hit.method, method); assert.equal(hit.url, url);
    if (body) assert.deepEqual(hit.json(), body); else assert.equal(hit.body.length, 0);
    assert.equal(hit.headers.authorization, 'Bearer synthetic-token');
    assert.ok(!Object.keys(hit.headers).some(key => /tenant|actor|user-id/.test(key)));
  }
});

test('file export preserves the exact authorized request and never replaces or leaves an incomplete destination', async t => {
  const f = fixture(t), workbook = zip([['[Content_Types].xml', '<Types/>'], ['xl/workbook.xml', '<workbook/>']]); let mode = 'ok';
  const service = await mockServer(t, (hit, res) => {
    if (hit.method === 'GET') { respond(res, { maximumFileBytes: 1024 * 1024 }); return; }
    assert.equal(hit.url, '/api/data/v1/entities/customer/records:exportFile');
    assert.deepEqual(hit.json(), { query: { fields: ['name'], pageSize: 10 }, selectedRecordIds: ['visible-record'], exportPurpose: 'roundTrip' });
    if (mode === 'denied') { respond(res, { error: 'FORBIDDEN' }, 403); return; }
    if (mode === 'wrong') { respond(res, { notAWorkbook: true }); return; }
    res.writeHead(200, { 'Content-Type': mime, 'Content-Length': workbook.length });
    if (mode === 'drop') { res.write(workbook.subarray(0, 10)); setImmediate(() => res.destroy()); }
    else res.end(workbook);
  });
  f.profile(service.url, 'tenant-one', 'synthetic-token');
  const file = join(f.directory, 'export.json'), out = join(f.directory, 'records.xlsx');
  writeFileSync(file, JSON.stringify({ query: { fields: ['name'], pageSize: 10 }, selectedRecordIds: ['visible-record'], exportPurpose: 'roundTrip' }));
  const args = ['data', 'export-file', 'customer', '--request-json', file, '--out', out, '--json'];
  const result = await f.run(args); assert.equal(result.code, 0, result.stdout); assert.deepEqual(readFileSync(out), workbook);
  const requests = service.hits.filter(hit => hit.method === 'POST').length;
  assert.equal(output(await f.run(args)).error.code, 'output_exists');
  assert.equal(service.hits.filter(hit => hit.method === 'POST').length, requests);
  assert.deepEqual(readFileSync(out), workbook);
  for (const value of ['denied', 'wrong', 'drop']) {
    mode = value; const target = join(f.directory, value + '.xlsx');
    const failed = await f.run(['data', 'export-file', 'customer', '--request-json', file, '--out', target, '--json']);
    assert.equal(failed.code, 1, failed.stdout); assert.equal(existsSync(target), false);
    if (value === 'denied') assert.equal(output(failed).error.code, 'permission_denied');
    assert.ok(!readdirSync(f.directory).some(name => name.endsWith('.part')));
  }
});
