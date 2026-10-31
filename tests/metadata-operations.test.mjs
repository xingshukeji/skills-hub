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
