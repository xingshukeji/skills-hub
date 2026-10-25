import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, mockServer, respond } from './helpers.mjs';

const security = '/api/service/authen/v1/security';
const setName = 'custom.course.practice';
const setValues = JSON.stringify({ name: setName, label: '课程练习', helpText: '仅教学数据' });
const json = result => JSON.parse(result.stdout);

test('permission catalog and set ensure preserve an existing set instead of applying creation values', async t => {
  const f = fixture(t);
  const existing = { permissionSetName: setName, label: '现有名称', permissions: ['entity.note.read'], users: ['zhangsan'] };
  const server = await mockServer(t, (hit, res) => respond(res, hit.url.endsWith('/catalog') ? { permissions: [{ name: 'entity.note.read' }] } : existing));
  f.profile(server.url, 'tenant-a', 'synthetic-bearer');
  assert.equal((await f.run(['security', 'permissions', 'catalog'])).code, 0);
  const result = await f.run(['security', 'permission-sets', 'ensure', setName, '--values', setValues, '--json']);
  assert.equal(result.code, 0, result.stdout);
  assert.deepEqual(json(result).data, { created: false, permissionSet: existing });
  assert.deepEqual(server.hits.map(hit => [hit.method, hit.url]), [['GET', security + '/permissions/catalog'], ['GET', security + '/permission-sets/' + setName]]);
});

test('missing permission set is created exactly once with the named platform input', async t => {
  const f = fixture(t);
  let created;
  const server = await mockServer(t, (hit, res) => {
    if (hit.method === 'GET') return created ? respond(res, created) : respond(res, { errorCode: 'platform.authen.permission_set_not_found' }, 404);
    created = { permissionSetName: hit.json().name, permissions: [], users: [], label: hit.json().label };
    respond(res, created, 201);
  });
  f.profile(server.url, 'tenant-a', 'synthetic-bearer');
  const result = await f.run(['security', 'permission-set', 'ensure', setName, '--values', setValues, '--json']);
  assert.equal(result.code, 0, result.stdout);
  assert.equal(json(result).data.created, true);
  const reused = await f.run(['security', 'permission-set', 'ensure', setName, '--json']);
  assert.equal(reused.code, 0, reused.stdout);
  assert.equal(json(reused).data.created, false);
  assert.equal(server.hits.filter(hit => hit.method === 'POST').length, 1);
  assert.deepEqual(server.hits.find(hit => hit.method === 'POST').json(), JSON.parse(setValues));
});

test('permission-set lookup denial and unrelated 404 never become create requests', async t => {
  const f = fixture(t);
  let status, errorCode;
  const server = await mockServer(t, (hit, res) => respond(res, { errorCode }, status));
  f.profile(server.url, 'tenant-a', 'synthetic-bearer');
  for ([status, errorCode] of [[401, 'platform.authen.authentication_failed'], [403, 'platform.authen.forbidden'], [404, 'platform.business_tenant.not_found'], [404, undefined], [500, 'platform.authen.permission_set_not_found']]) {
    const result = await f.run(['security', 'permission-set', 'ensure', setName, '--values', setValues, '--json']);
    assert.equal(result.code, 1);
    assert.equal(json(result).error.httpStatus, status);
  }
  assert.ok(server.hits.every(hit => hit.method === 'GET'));
});

test('permission-set creation conflict is reported without retries or overwriting an existing set', async t => {
  const f = fixture(t);
  const server = await mockServer(t, (hit, res) => hit.method === 'GET'
    ? respond(res, { errorCode: 'platform.authen.permission_set_not_found' }, 404)
    : respond(res, { errorCode: 'platform.authen.permission_set_conflict' }, 409));
  f.profile(server.url, 'tenant-a', 'synthetic-bearer');
  const result = await f.run(['security', 'permission-set', 'ensure', setName, '--values', setValues, '--json']);
  assert.equal(result.code, 1);
  assert.equal(json(result).error.httpStatus, 409);
  assert.deepEqual(server.hits.map(hit => hit.method), ['GET', 'POST']);
  for (const values of ['[]', 'null', '{invalid', '{"name":"custom.another"}']) {
    assert.equal((await f.run(['security', 'permission-set', 'create', setName, '--values', values])).code, 1);
  }
  assert.equal(server.hits.length, 2);
});

test('Host member listing names a resource without requiring or forging a tenant credential', async t => {
  const f = fixture(t);
  const server = await mockServer(t, (hit, res) => respond(res, { items: [], totalCount: 0, page: 2, pageSize: 5 }));
  f.store.save({ activeProfile: 'Host', profiles: { Host: { server: server.url, bearerToken: 'synthetic-host-bearer' } } });
  const result = await f.run(['host', 'tenant', 'member', 'list', '--tenant-id', 'tenant/one', '--page', '2', '--page-size', '5', '--search', '张三']);
  assert.equal(result.code, 0, result.stdout);
  const hit = server.hits[0];
  const url = new URL(hit.url, server.url);
  assert.equal(url.pathname, '/api/service/authen/v1/host/tenants/tenant%2Fone/members');
  assert.deepEqual(Object.fromEntries(url.searchParams), { page: '2', pageSize: '5', search: '张三' });
  assert.equal(hit.headers.authorization, 'Bearer synthetic-host-bearer');
  assert.ok(!Object.keys(hit.headers).some(name => /tenant|actor|user-id/.test(name)));
  const count = server.hits.length;
  assert.equal((await f.run(['host', 'tenant', 'member', 'list', '--tenant', 'other'])).code, 1);
  assert.equal(server.hits.length, count);
});

test('member ensure scans matching pages and preserves the exact existing inactive member and roles', async t => {
  const f = fixture(t);
  const member = { userId: 'user-id', userName: 'zhangsan', isActive: false, roles: ['existing-admin'], isDefaultTenant: true };
  const server = await mockServer(t, (hit, res) => {
    assert.equal(hit.method, 'GET');
    const query = new URL(hit.url, 'http://local.test').searchParams;
    assert.equal(query.get('search'), 'USER-ID');
    respond(res, { items: query.get('page') === '1' ? [{ userId: 'another', name: 'USER-ID' }] : [member], totalCount: 2, pageSize: 1 });
  });
  f.profile(server.url, '', 'synthetic-host-bearer');
  const result = await f.run(['host', 'tenant', 'member', 'ensure', '--tenant-id', 'tenant-a', '--user-id', 'USER-ID', '--json']);
  assert.equal(result.code, 0, result.stdout);
  assert.deepEqual(json(result).data, { created: false, member });
  assert.equal(server.hits.length, 2);
});

test('member ensure adds only an ordinary same-ID membership and does not replay a conflict', async t => {
  const f = fixture(t);
  let conflict = false;
  const server = await mockServer(t, (hit, res) => hit.method === 'GET'
    ? respond(res, { items: [], totalCount: 0, pageSize: 100 })
    : conflict ? respond(res, { errorCode: 'platform.business_tenant.member_exists' }, 409) : respond(res, { userId: hit.json().userId, roles: [] }, 201));
  f.profile(server.url, '', 'synthetic-host-bearer');
  const argv = ['host', 'tenant', 'member', 'ensure', 'tenant-a', 'same-global-user', '--json'];
  const result = await f.run(argv);
  assert.equal(result.code, 0, result.stdout);
  assert.equal(json(result).data.created, true);
  assert.deepEqual(server.hits[1].json(), { userId: 'same-global-user', isAdministrator: false });
  conflict = true;
  const rejected = await f.run(argv);
  assert.equal(rejected.code, 1);
  assert.equal(json(rejected).error.httpStatus, 409);
  assert.deepEqual(server.hits.map(hit => hit.method), ['GET', 'POST', 'GET', 'POST']);
});

test('member lookup failures or incomplete pages never create a member', async t => {
  const f = fixture(t);
  let value, status;
  const server = await mockServer(t, (hit, res) => respond(res, value, status));
  f.profile(server.url, '', 'synthetic-host-bearer');
  for ([status, value] of [[403, { errorCode: 'platform.authen.forbidden' }], [404, { errorCode: 'platform.business_tenant.not_found' }], [200, {}], [200, { items: [], totalCount: 2, pageSize: 1 }]]) {
    const result = await f.run(['host', 'tenant', 'member', 'ensure', 'tenant-a', 'known-user', '--json']);
    assert.equal(result.code, 1);
  }
  assert.equal(server.hits.length, 4);
  assert.ok(server.hits.every(hit => hit.method === 'GET'));
});
