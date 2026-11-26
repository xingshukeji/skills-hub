import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, mockServer, respond } from './helpers.mjs';

test('standard Workforce is requested in the original Host creation and service updates carry the observed revision', async t => {
  const f = fixture(t);
  const service = await mockServer(t, (hit, res) => respond(res, { tenantId: 'tenant-b', revision: 1, enabled: true }, hit.method === 'POST' ? 201 : 200));
  f.store.save({ activeProfile: 'Host', profiles: { Host: { server: service.url, scope: 'host', tenant: null, bearerToken: 'fixture' } } });
  const file = join(f.directory, 'input.json');
  writeFileSync(file, '{"name":"b"}');
  const create = await f.run(['host','tenant','create','--standard-workforce','--request-key','original-b','--request-json',file,'--json']);
  assert.equal(create.code, 0);
  assert.equal(service.hits.length, 1);
  assert.equal(service.hits[0].headers['idempotency-key'], 'original-b');
  assert.deepEqual(service.hits[0].json(), { name: 'b', standardWorkforce: true });
  writeFileSync(file, '{"enabled":false,"expectedRevision":1}');
  const disable = await f.run(['host','tenant','workforce','set','tenant-b','--request-json',file,'--json']);
  assert.equal(disable.code, 0);
  assert.equal(service.hits[1].method, 'PUT');
  assert(service.hits[1].url.endsWith('/host/tenants/tenant-b/standard-workforce'));
  assert.deepEqual(service.hits[1].json(), { enabled:false, expectedRevision:1 });
});
