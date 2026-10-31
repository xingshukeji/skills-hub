import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, mockServer, respond } from './helpers.mjs';

const output = value => JSON.parse(value.stdout);

test('member lifecycle stays on the tenant membership and hides credential echoes', async t => {
  const f = fixture(t), member = { userName: 'zhangsan', isActive: true, accountIsActive: true, name: '张三' };
  const service = await mockServer(t, (hit, res) => {
    if (hit.url.endsWith('/deactivate')) member.isActive = false;
    else if (hit.url.endsWith('/activate')) member.isActive = true;
    else if (hit.method === 'PUT') { member.name = hit.json().name; }
    const response = hit.method === 'GET' ? { items: [member], totalCount: 1 } : member;
    respond(res, { ...response, message: hit.method === 'PUT' ? 'received ' + hit.json().password : 'ok' });
  });
  f.profile(service.url, 'tenant-one', 'own-bearer');
  const file = join(f.directory, 'member.json'); writeFileSync(file, JSON.stringify({ name: 'Updated', password: 'synthetic-private-password' }));
  const update = await f.run(['security', 'user', 'update', 'zhangsan', '--request-json', file, '--json']);
  assert.equal(update.code, 0, update.stdout); assert.equal(member.name, 'Updated');
  assert.ok(!update.stdout.includes('synthetic-private-password')); assert.ok(!update.stdout.includes('accountIsActive'));
  assert.equal((await f.run(['security', 'user', 'deactivate', 'zhangsan', '--json'])).code, 0); assert.equal(member.isActive, false);
  assert.equal(member.accountIsActive, true);
  assert.equal((await f.run(['security', 'user', 'activate', 'zhangsan', '--json'])).code, 0); assert.equal(member.isActive, true);
  const listed = await f.run(['security', 'users', 'list', '--page', '2', '--page-size', '10', '--search', '张三', '--json']);
  assert.equal(listed.code, 0, listed.stdout); assert.ok(!listed.stdout.includes('accountIsActive'));
  assert.equal(service.hits.at(-1).url, '/api/service/authen/v1/security/users?page=2&pageSize=10&search=%E5%BC%A0%E4%B8%89');
  assert.ok(service.hits.every(hit => !Object.keys(hit.headers).some(key => /tenant|actor|user-id/.test(key))));
});

test('organization member arrays and permission grants retain exact subjects without replacing identities', async t => {
  const f = fixture(t), memberships = new Set(['existing']);
  const service = await mockServer(t, (hit, res) => {
    assert.equal(hit.url, '/api/service/authen/v1/security/org-trees/tree/nodes/node/members');
    assert.deepEqual(hit.json(), ['zhangsan', 'lisi']);
    if (hit.method === 'POST') for (const id of hit.json()) memberships.add(id); else for (const id of hit.json()) memberships.delete(id);
    respond(res, { members: [...memberships] });
  });
  f.profile(service.url, 'tenant-one', 'own-bearer');
  const file = join(f.directory, 'members.json'); writeFileSync(file, '["zhangsan","lisi"]');
  for (const action of ['add-members', 'remove-members']) assert.equal((await f.run(['security', 'org-node', action, 'tree', 'node', '--request-json', file, '--json'])).code, 0);
  assert.deepEqual([...memberships], ['existing']); assert.equal(service.hits.length, 2);
});

test('application impact digests, revisions and rejected authorization are never replaced or retried', async t => {
  const f = fixture(t); let writes = 0;
  const service = await mockServer(t, (hit, res) => {
    if (hit.url.endsWith('/authorization-impact')) { respond(res, { digest: 'current', affectedSourceCount: 1 }); return; }
    writes++; assert.deepEqual(hit.json(), { impactDigest: 'observed', decisions: [{ sourceId: 'one', decision: 'remove' }] });
    respond(res, { errorCode: 'application_management_conflict' }, 409);
  });
  f.profile(service.url, 'tenant-one', 'own-bearer');
  const file = join(f.directory, 'delete-role.json'); writeFileSync(file, JSON.stringify({ impactDigest: 'observed', decisions: [{ sourceId: 'one', decision: 'remove' }] }));
  const result = await f.run(['application', 'role', 'delete', 'app-one', 'role-one', '--request-json', file, '--json']);
  assert.equal(output(result).error.code, 'conflict'); assert.equal(writes, 1); assert.equal(service.hits.length, 1);
  assert.equal(service.hits[0].url, '/api/xrain/v1/applications/app-one/roles/role-one');
});

test('Host tenant writes preserve ETags and stable idempotency keys without tenant impersonation', async t => {
  const f = fixture(t); let creates = 0, changes = 0;
  const service = await mockServer(t, (hit, res) => {
    assert.equal(hit.headers.authorization, 'Bearer host-bearer');
    if (hit.method === 'POST') { creates++; assert.equal(hit.headers['idempotency-key'], 'original-create'); respond(res, { tenantId: 'tenant-one', etag: '"r1"' }, 201); }
    else { changes++; assert.equal(hit.headers['if-match'], '"observed"'); respond(res, { errorCode: 'tenant.conflict' }, 409); }
  });
  f.store.save({ activeProfile: 'Host', profiles: { Host: { server: service.url, scope: 'host', tenant: null, bearerToken: 'host-bearer' } } });
  const file = join(f.directory, 'tenant.json'); writeFileSync(file, '{"name":"Tenant"}');
  const missing = await f.run(['host', 'tenant', 'update', 'tenant-one', '--request-json', file, '--json']);
  assert.equal(output(missing).error.code, 'invalid_input'); assert.equal(service.hits.length, 0);
  const created = await f.run(['host', 'tenant', 'create', '--request-key', 'original-create', '--request-json', file, '--json']);
  assert.equal(created.code, 0, created.stdout);
  const changed = await f.run(['host', 'tenant', 'update', 'tenant-one', '--if-match', '"observed"', '--request-json', file, '--json']);
  assert.equal(output(changed).error.code, 'conflict');
  assert.equal(creates, 1); assert.equal(changes, 1);
  assert.ok(service.hits.every(hit => !Object.keys(hit.headers).some(key => /tenant|actor|user-id/.test(key))));
});

test('audit query parameters stay scalar and bounded to native temporal fields', async t => {
  const f = fixture(t), service = await mockServer(t, (_hit, res) => respond(res, { items: [] }));
  f.profile(service.url, 'tenant-one', 'own-bearer');
  const file = join(f.directory, 'audit.json'); writeFileSync(file, JSON.stringify({ from: '2026-10-01T00:00:00Z', to: '2026-10-31T00:00:00Z', resourceType: 'role', pageSize: 10 }));
  assert.equal((await f.run(['security', 'audit', '--query-json', file, '--json'])).code, 0);
  const hit = service.hits[0]; assert.match(hit.url, /from=2026-10-01T00%3A00%3A00Z/); assert.equal(hit.body.length, 0);
  writeFileSync(file, '{"from":"x","to":"y","resourceType":"role","tenantId":"other"}');
  assert.equal((await f.run(['security', 'audit', '--query-json', file, '--json'])).code, 1);
  assert.equal(service.hits.length, 1);
});
