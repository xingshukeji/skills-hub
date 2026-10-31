import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, mockServer, respond } from './helpers.mjs';

const output = value => JSON.parse(value.stdout);

test('metadata reads expose real ETags and stale mutations never refresh or retry them', async t => {
  const f = fixture(t); let revision = '"observed-tag"', changes = 0;
  const service = await mockServer(t, (hit, res) => {
    if (hit.method === 'GET') { respond(res, { fields: [], metadataRevision: 8 }, 200, { ETag: revision }); return; }
    assert.equal(hit.headers['if-match'], '"observed-tag"');
    if (revision !== hit.headers['if-match']) { respond(res, { errorCode: 'metadata.conflict' }, 409); return; }
    changes++; respond(res, { etag: '"changed-tag"', metadataRevision: 9 });
  });
  f.profile(service.url, 'tenant-one', 'own-token');
  const observed = await f.run(['metadata', 'entity', 'show', 'customer', '--json']);
  assert.equal(output(observed).data.headers.etag, revision);
  assert.equal(output(observed).data.value.metadataRevision, 8);
  revision = '"concurrent-change"';
  const file = join(f.directory, 'field.json'); writeFileSync(file, '{"label":"Updated"}');
  const result = await f.run(['metadata', 'field', 'update', 'customer', 'name', '--if-match', '"observed-tag"', '--request-json', file, '--json']);
  assert.equal(output(result).error.code, 'conflict'); assert.equal(changes, 0); assert.equal(service.hits.length, 2);
});

test('metadata deletion and failed field recovery retain explicit impact and version decisions', async t => {
  const f = fixture(t), service = await mockServer(t, (hit, res) => {
    assert.equal(hit.headers['if-match'], '"field-7"');
    if (hit.method === 'DELETE') { assert.equal(hit.headers['x-impact-token'], 'observed-impact'); res.writeHead(204); res.end(); }
    else { assert.equal(hit.headers['idempotency-key'], 'same-correction'); assert.deepEqual(hit.json(), { label: 'Corrected' }); respond(res, {
      metadataRevision: 8, etag: '"field-8"', object: { objectId: 'object-one', entityCode: 'customer', entityApiName: 'customer' },
      field: { fieldId: 'field-one', fieldApiName: 'amount' },
    }); }
  });
  f.profile(service.url, 'tenant-one', 'own-token');
  assert.equal((await f.run(['metadata', 'field', 'delete', 'customer', 'amount', '--if-match', '"field-7"', '--impact-token', 'observed-impact', '--json'])).code, 0);
  const file = join(f.directory, 'correction.json'); writeFileSync(file, '{"label":"Corrected"}');
  const result = await f.run(['metadata', 'field', 'revise-deployment', 'customer', 'amount', '--if-match', '"field-7"', '--request-key', 'same-correction', '--request-json', file, '--json']);
  assert.equal(result.code, 0, result.stdout);
  assert.equal(service.hits[1].url, '/api/metadata/v1/entities/customer/fields/amount/failed-deployment');
});

test('missing metadata control arguments fail the whole batch before an earlier write', async t => {
  const f = fixture(t), service = await mockServer(t, (_hit, res) => respond(res, {}));
  f.profile(service.url, 'tenant-one', 'own-token');
  const file = join(f.directory, 'batch.json'); writeFileSync(file, JSON.stringify([
    ['data', 'delete', 'customer', 'one'], ['metadata', 'field', 'delete', 'customer', 'amount', '--impact-token', 'impact'],
  ]));
  assert.equal((await f.run(['batch', '--file', file, '--json'])).code, 1); assert.equal(service.hits.length, 0);
});

test('metadata creation keys use the metadata header contract rather than the record creation limit', async t => {
  const f = fixture(t), key = 'metadata:original/'.repeat(120), file = join(f.directory, 'definition.json');
  let status = 200, disconnected = false;
  const service = await mockServer(t, (hit, res) => {
    assert.equal(hit.headers['idempotency-key'], key);
    assert.equal(hit.headers['if-match'], '"metadata-7"');
    if (disconnected) return res.destroy();
    if (status !== 200) return respond(res, { errorCode: 'metadata.rejected' }, status);
    respond(res, { metadataRevision: 8, etag: '"metadata-8"', object: { objectId: 'original-object', entityApiName: 'customer__c' },
      ...(hit.url === '/api/metadata/v1/entities' ? {} : { field: { fieldId: 'original-field', fieldApiName: 'amount__c' } }) });
  });
  f.profile(service.url, 'tenant-one', 'own-token');
  const commands = [
    ['metadata', 'entity', 'create'],
    ['metadata', 'field', 'create', 'customer__c'],
    ['metadata', 'field', 'revise-deployment', 'customer__c', 'amount__c'],
  ];
  const target = ['--if-match', '"metadata-7"', '--request-key', key, '--request-json', file, '--json'];
  for (const argv of commands) {
    writeFileSync(file, JSON.stringify(argv[1] === 'entity' ? { entityApiName: 'customer__c', label: 'Customer' }
      : argv[2] === 'create' ? { fieldApiName: 'amount__c', label: 'Amount', type: 'Text', length: 255 } : { label: 'Amount' }));
    const result = await f.run([...argv, ...target]);
    assert.equal(result.code, 0, result.stdout);
  }
  assert.equal(service.hits.length, 3);
  status = 403;
  const refused = await f.run([...commands[0], ...target]);
  assert.equal(output(refused).error.code, 'permission_denied');
  disconnected = true;
  const lost = await f.run([...commands[0], ...target]);
  assert.equal(output(lost).error.code, 'outcome_unknown');
  assert.equal(output(lost).error.details.requestKey, key);
  assert.equal(service.hits.length, 5);
  // This is a different native protocol: its original 160-character key limit remains.
  const record = await f.run(['data', 'create', 'customer__c', '--request-key', key, '--values', '{"name":"Customer"}', '--json']);
  assert.equal(record.code, 1);
  assert.equal(output(record).error.code, 'invalid_arguments');
  assert.equal(service.hits.length, 5);
  const invalidHeader = await f.run([...commands[0], ...target.map(value => value === key ? 'original\r\nInjected: value' : value)]);
  assert.equal(invalidHeader.code, 1);
  assert.equal(output(invalidHeader).error.code, 'invalid_arguments');
  assert.equal(service.hits.length, 5);
});
