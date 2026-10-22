import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, mockServer, respond } from './helpers.mjs';
import { request } from '../src/xrain-cli/http.mjs';

test('runtime data, metadata and health commands use correct methods, paths and bodies', async t => {
  const f = fixture(t);
  const server = await mockServer(t, (req, res) => respond(res, { ok: true }));
  f.profile(server.url, 'tenant-demo', 'test-api-bearer');
  const valuesFile = join(f.directory, 'values.json');
  writeFileSync(valuesFile, JSON.stringify({ values: { status: 'active' }, expectedValues: { status: 'new' } }));
  const cases = [
    [['health'], 'GET', '/health/ready', undefined],
    [['health', 'live'], 'GET', '/health/live', undefined],
    [['health', 'healthz'], 'GET', '/healthz', undefined],
    [['metadata', 'standards'], 'GET', '/api/metadata/v1/standards/entity-design', undefined],
    [['data', 'query', 'customer', '--fields', 'name,status', '--sort', 'name:desc', '--page', '2', '--page-size', '10', '--search', 'Acme', '--filter', '{"status":"active"}', '--no-total'], 'POST', '/api/data/v1/entities/customer/records:query', { page: 2, pageSize: 10, includeTotalCount: false, search: 'Acme', fields: ['name', 'status'], filter: { status: 'active' }, sort: [{ field: 'name', direction: 'desc' }] }],
    [['data', 'get', '--entity', 'customer', 'rec/with space'], 'GET', '/api/data/v1/entities/customer/records/rec%2Fwith%20space', undefined],
    [['data', 'create', 'customer', '--values', '{"name":"Acme"}'], 'POST', '/api/data/v1/entities/customer/records', { values: { name: 'Acme' } }],
    [['data', 'update', 'customer', 'record1', '--values-json', valuesFile], 'PUT', '/api/data/v1/entities/customer/records/record1', { values: { status: 'active' }, expectedValues: { status: 'new' } }],
    [['data', 'delete', 'customer', 'record1'], 'DELETE', '/api/data/v1/entities/customer/records/record1', undefined],
  ];
  for (const [argv, method, path, body] of cases) {
    const result = await f.run(argv);
    assert.equal(result.code, 0, result.stderr);
    const hit = server.hits.at(-1);
    assert.equal(hit.method, method); assert.equal(hit.url, path);
    assert.equal(hit.headers.authorization, 'Bearer test-api-bearer');
    assert.ok(!Object.keys(hit.headers).some(key => /tenant|actor|user-id/.test(key)));
    if (body) assert.deepEqual(hit.json(), body); else assert.equal(hit.body.length, 0);
  }
});

test('query and values accept files and @file while malformed inputs never reach the server', async t => {
  const f = fixture(t);
  const server = await mockServer(t, (req, res) => respond(res, {}));
  f.profile(server.url, 't', 'test-bearer');
  const path = join(f.directory, 'query.json');
  writeFileSync(path, '{"page":5,"pageSize":7}');
  for (const args of [['--query-json', path], ['--query', '@' + path], ['--file', path]]) {
    assert.equal((await f.run(['data', 'query', 'customer', ...args])).code, 0);
    assert.deepEqual(server.hits.at(-1).json(), { page: 5, pageSize: 7 });
  }
  const count = server.hits.length;
  for (const args of [['data', 'create', 'customer', '--values', '[]'], ['data', 'query', 'customer', '--query', 'oops'], ['data', 'query', 'customer', '--query-json', path, '--page', '99'], ['data', 'query', 'customer', '--page', '-1'], ['data', 'query', 'customer', '--sort', 'name:wrong'], ['data', 'query', 'customer', '--sort', 'name:asc:extra'], ['data', 'update', 'customer'], ['data', 'delete', 'customer', '..'], ['data', 'query', '.'], ['health', 'constructor']])
    assert.equal((await f.run(args)).code, 1);
  assert.equal(server.hits.length, count);
});

test('invalid token aliases fail before creating state or making network requests', async t => {
  const f = fixture(t), server = await mockServer(t, (req, res) => respond(res, {}));
  f.profile(server.url, 't');
  for (const alias of ['unknown', 'constructor', '__proto__']) {
    const result = await f.run(['health', '--token-name', alias]);
    assert.equal(result.code, 1); assert.match(result.stderr, /admin or guest/);
  }
  assert.equal(server.hits.length, 0);
});

test('every supported security mutation maps to its resource and sends deduplicated names', async t => {
  const f = fixture(t);
  const server = await mockServer(t, (req, res) => respond(res, {}));
  f.profile(server.url, 't', 'test-bearer');
  const variants = [['user', 'role', 'users', 'roles'], ['user', 'permission-set', 'users', 'permission-sets'], ['role', 'permission-set', 'roles', 'permission-sets'], ['permission-set', 'permission', 'permission-sets', 'permissions']];
  for (const [kind, member, plural, members] of variants) {
    for (const verb of ['grant', 'revoke']) {
      assert.equal((await f.run(['security', kind, `${verb}-${member}`, '--' + kind, 'Target User', '--names', 'Alpha,alpha;Beta'])).code, 0);
      const hit = server.hits.at(-1);
      assert.equal(hit.method, verb === 'grant' ? 'POST' : 'DELETE');
      assert.equal(hit.url, `/api/service/authen/v1/security/${plural}/Target%20User/${members}`);
      assert.deepEqual(hit.json(), { names: ['Alpha', 'Beta'] });
    }
    assert.equal((await f.run(['security', plural, 'show', 'Target User'])).code, 0);
    assert.equal(server.hits.at(-1).url, `/api/service/authen/v1/security/${plural}/Target%20User`);
  }
  const count = server.hits.length;
  assert.equal((await f.run(['security', 'user', 'grant-permission', '--user', 'u', '--names', 'p'])).code, 1);
  assert.equal(server.hits.length, count);
});

test('user creation sends platform fields and redacts the password even when echoed in text', async t => {
  const f = fixture(t), password = 'synthetic-create-password';
  const server = await mockServer(t, (hit, res) => respond(res, { userName: hit.json().userName, note: 'received ' + (hit.json().password ?? hit.json().Password) }, 201));
  f.profile(server.url, 't', 'test-bearer');
  const path = join(f.directory, 'account.json');
  const values = { name: '张三', password, email: 'zhangsan@example.test', isAI: false };
  writeFileSync(path, JSON.stringify(values));
  const result = await f.run(['security', 'users', 'create', '--name', 'zhangsan', '--values-json', path, '--json']);
  assert.equal(result.code, 0, result.stdout);
  assert.equal(server.hits.length, 1);
  assert.equal(server.hits[0].method, 'POST');
  assert.equal(server.hits[0].url, '/api/service/authen/v1/security/users');
  assert.equal(server.hits[0].headers.authorization, 'Bearer test-bearer');
  assert.deepEqual(server.hits[0].json(), { ...values, userName: 'zhangsan' });
  assert.equal(JSON.parse(result.stdout).data.userName, 'zhangsan');
  assert.ok(!result.stdout.includes(password)); assert.ok(!result.stderr.includes(password));
  const capitalized = await f.run(['security', 'user', 'create', 'zhangsan', '--values', JSON.stringify({ Password: password }), '--json']);
  assert.equal(capitalized.code, 0, capitalized.stdout);
  assert.ok(!capitalized.stdout.includes(password)); assert.ok(!capitalized.stderr.includes(password));
});

test('ensuring an existing fixed user preserves all fields and accepts no creation credentials', async t => {
  const f = fixture(t), password = 'unused-replacement-password';
  const user = { userName: 'zhangsan', name: '原有姓名', roles: ['reader'], permissionSets: ['existing'], isActive: false };
  const server = await mockServer(t, (hit, res) => respond(res, user));
  f.profile(server.url, 't', 'test-bearer');
  for (const input of [[], ['--values', JSON.stringify({ name: '覆盖姓名', password })]]) {
    const result = await f.run(['security', 'user', 'ensure', 'zhangsan', ...input, '--json']);
    assert.equal(result.code, 0, result.stdout);
    assert.deepEqual(JSON.parse(result.stdout).data, { created: false, user });
    assert.ok(!result.stdout.includes(password));
  }
  assert.deepEqual(server.hits.map(hit => [hit.method, hit.url, hit.body.length]), [
    ['GET', '/api/service/authen/v1/security/users/zhangsan', 0],
    ['GET', '/api/service/authen/v1/security/users/zhangsan', 0],
  ]);
});

test('ensuring a missing fixed user creates it once and subsequent calls reuse its identity', async t => {
  const f = fixture(t);
  let user;
  const server = await mockServer(t, (hit, res) => {
    if (hit.method === 'GET') return respond(res, user ?? { errorCode: 'platform.authen.user_not_found' }, user ? 200 : 404);
    user = { id: 'fixed-user-id', userName: hit.json().userName, name: hit.json().name, roles: [] };
    respond(res, user, 201);
  });
  f.profile(server.url, 't', 'test-bearer');
  const first = await f.run(['security', 'user', 'ensure', 'zhangsan', '--values', '{"password":"synthetic-password","name":"张三"}', '--json']);
  assert.equal(first.code, 0, first.stdout);
  assert.deepEqual(JSON.parse(first.stdout).data, { created: true, user });
  const second = await f.run(['security', 'users', 'ensure', '--user', 'zhangsan', '--json']);
  assert.equal(second.code, 0, second.stdout);
  assert.deepEqual(JSON.parse(second.stdout).data, { created: false, user });
  assert.deepEqual(server.hits.map(hit => hit.method), ['GET', 'POST', 'GET']);
  assert.deepEqual(server.hits[1].json(), { userName: 'zhangsan', name: '张三', password: 'synthetic-password' });
});

test('ensure never creates on access failures, unknown routes or other missing resources', async t => {
  const f = fixture(t);
  let status, errorCode;
  const server = await mockServer(t, (hit, res) => respond(res, { errorCode }, status));
  f.profile(server.url, 't', 'test-bearer');
  for ([status, errorCode] of [[401, 'platform.authen.authentication_failed'], [403, 'platform.authen.forbidden'],
    [404, undefined], [404, 'platform.business_tenant.user_not_found'], [409, 'platform.authen.global_user_exists'], [500, 'platform.authen.user_not_found']]) {
    const result = await f.run(['security', 'user', 'ensure', 'zhangsan', '--values', '{"password":"not-submitted"}', '--json']);
    assert.equal(result.code, 1, result.stdout);
    assert.equal(JSON.parse(result.stdout).error.httpStatus, status);
  }
  assert.equal(server.hits.length, 6);
  assert.ok(server.hits.every(hit => hit.method === 'GET'));
});

test('creation conflicts do not replay writes or fall back to another identity', async t => {
  const f = fixture(t), password = 'conflict-test-password';
  const server = await mockServer(t, (hit, res) => hit.method === 'GET'
    ? respond(res, { errorCode: 'platform.authen.user_not_found' }, 404)
    : respond(res, { errorCode: 'platform.authen.global_user_exists', note: 'rejected ' + hit.json().password }, 409));
  f.profile(server.url, 't', 'test-bearer');
  const result = await f.run(['security', 'user', 'ensure', 'zhangsan', '--values', JSON.stringify({ password }), '--json']);
  assert.equal(result.code, 1, result.stdout);
  assert.equal(JSON.parse(result.stdout).error.serverCode, 'platform.authen.global_user_exists');
  assert.ok(!result.stdout.includes(password)); assert.ok(!result.stderr.includes(password));
  assert.deepEqual(server.hits.map(hit => hit.method), ['GET', 'POST']);
});

test('account input conflicts and malformed JSON are rejected before network access', async t => {
  const f = fixture(t);
  const server = await mockServer(t, (hit, res) => respond(res, { errorCode: 'platform.authen.user_not_found' }, 404));
  f.profile(server.url, 't', 'test-bearer');
  for (const argv of [
    ['security', 'user', 'create', 'zhangsan'],
    ['security', 'user', 'create', 'zhangsan', '--values', '[]'],
    ['security', 'user', 'ensure', 'zhangsan', '--values', 'null'],
    ['security', 'user', 'ensure', 'zhangsan', '--values', 'invalid JSON'],
    ['security', 'user', 'ensure', 'zhangsan', '--values', '{"userName":"lisi","password":"synthetic-secret"}'],
    ['security', 'user', 'ensure', 'zhangsan', '--values', '{}', '--values-json', 'not-read.json'],
    ['security', 'user', 'create', 'zhangsan', '--values', '{}', '--roles', 'admin'],
  ]) {
    const result = await f.run([...argv, '--json']);
    assert.equal(result.code, 1, result.stdout);
    assert.ok(!result.stdout.includes('synthetic-secret'));
  }
  assert.equal(server.hits.length, 0);
  const missing = await f.run(['security', 'user', 'ensure', 'zhangsan', '--json']);
  assert.equal(missing.code, 1);
  assert.equal(JSON.parse(missing.stdout).error.code, 'creation_input_required');
  assert.equal(server.hits.length, 1); assert.equal(server.hits[0].method, 'GET');
});

test('credential precedence, token binding and sanitized API error output', async t => {
  const f = fixture(t);
  let fail = false;
  const server = await mockServer(t, (req, res) => respond(res, { echo: req.headers.authorization, access_token: 'server-test-token', errorCode: 'test.forbidden' }, fail ? 403 : 200));
  f.profile(server.url, 't', 'test-profile-token');
  f.env.XRAIN_TOKEN = 'test-env-token';
  let result = await f.run(['health', '--bearer', 'test-option-token']);
  assert.equal(server.hits.at(-1).headers.authorization, 'Bearer test-option-token');
  assert.ok(!result.stdout.includes('test-option-token')); assert.ok(!result.stdout.includes('server-test-token'));
  await f.run(['health']); assert.equal(server.hits.at(-1).headers.authorization, 'Bearer test-env-token');
  delete f.env.XRAIN_TOKEN;
  await f.run(['health', '--token-name', 'guest']); assert.equal(server.hits.at(-1).headers.authorization, 'Bearer test-profile-token');
  await f.run(['login', '--token-name', 'guest']);
  await f.run(['health']); assert.equal(server.hits.at(-1).headers.authorization, 'Bearer ' + f.store.secrets().guestApiToken);
  fail = true;
  result = await f.run(['health']);
  assert.equal(result.code, 1); assert.match(result.stderr, /HTTP 403/); assert.match(result.stderr, /test.forbidden/);
  assert.ok(!result.stderr.includes(f.store.secrets().guestApiToken));
});

test('redirects are not followed, responses and timeouts are bounded', async t => {
  const destination = await mockServer(t, (req, res) => respond(res, {}));
  const server = await mockServer(t, (req, res) => {
    if (req.url === '/redirect') { res.writeHead(302, { Location: destination.url }); res.end(); }
    else if (req.url === '/large') res.end('x'.repeat(1024));
    else if (req.url === '/declared-large') { res.writeHead(200, { 'Content-Length': '100000' }); res.end(); }
    else { /* leave open to test timeout */ }
  });
  await assert.rejects(request(server.url + '/redirect', { token: 'test-token' }), /Redirects/);
  assert.equal(destination.hits.length, 0);
  await assert.rejects(request(server.url + '/large', { limit: 100 }), /size limit/);
  await assert.rejects(request(server.url + '/declared-large', { limit: 100 }), /size limit/);
  await assert.rejects(request(server.url + '/slow', { timeout: 40 }), /timed out/);
});
