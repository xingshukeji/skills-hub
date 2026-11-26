import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, mockServer, respond } from './helpers.mjs';

const output = result => JSON.parse(result.stdout);

test('default create and revisioned changes use the configured Workforce origin and original Host identity', async t => {
  const f = fixture(t);
  const service = await mockServer(t, (hit, res) => respond(res, { tenantId: 'tenant-b', revision: 1, enabled: true }, hit.method === 'POST' ? 201 : 200));
  f.env.XRAIN_WORKFORCE_URL = service.url;
  f.store.save({ activeProfile: 'Host', profiles: { Host: { server: 'http://platform.invalid', scope: 'host', tenant: null, bearerToken: 'fixture' } } });
  const file = join(f.directory, 'input.json');
  writeFileSync(file, '{"name":"b"}');
  const create = await f.run(['host','tenant','create','--request-key','original-b','--request-json',file,'--json']);
  assert.equal(create.code, 0);
  assert.equal(service.hits.length, 1);
  assert.equal(service.hits[0].headers['idempotency-key'], 'original-b');
  assert.equal(service.hits[0].url, '/api/standard/tenants');
  assert.equal(service.hits[0].headers.authorization, 'Bearer fixture');
  assert.deepEqual(service.hits[0].json(), { name: 'b' });
  writeFileSync(file, '{"enabled":false,"expectedRevision":1}');
  const disable = await f.run(['host','tenant','workforce','set','tenant-b','--request-json',file,'--json']);
  assert.equal(disable.code, 0);
  assert.equal(service.hits[1].method, 'PUT');
  assert.equal(service.hits[1].url, '/api/standard/tenants/tenant-b');
  assert.deepEqual(service.hits[1].json(), { enabled:false, expectedRevision:1 });
});

test('tenant create preserves explicit Workforce choices and rejects conflicts before sending', async t => {
  const f = fixture(t);
  const service = await mockServer(t, (_hit, res) => respond(res, { tenantId: 'one' }, 201));
  f.store.save({ activeProfile: 'Host', profiles: { Host: { server: service.url, scope: 'host', tenant: null, bearerToken: 'fixture' } } });
  const file = join(f.directory, 'tenant.json');
  const create = (...flags) => f.run(['host', 'tenant', 'create', '--request-key', 'example', '--request-json', file, '--json', ...flags]);
  writeFileSync(file, '{"name":"example"}');
  assert.equal((await create('--no-standard-workforce')).code, 0);
  assert.equal((await create('--standard-workforce')).code, 0);
  writeFileSync(file, '{"name":"example","standardWorkforce":false}');
  assert.equal((await create()).code, 0);
  assert.deepEqual(service.hits.map(hit => hit.url), ['/api/service/authen/v1/host/tenants', '/api/standard/tenants', '/api/service/authen/v1/host/tenants']);
  assert.ok(service.hits.every(hit => !Object.hasOwn(hit.json(), 'standardWorkforce')));
  assert.equal(output(await create('--standard-workforce')).error.code, 'invalid_arguments');
  assert.equal(output(await create('--standard-workforce', '--no-standard-workforce')).error.code, 'invalid_arguments');
  writeFileSync(file, '{"name":"example","standardWorkforce":"false"}');
  assert.equal(output(await create()).error.code, 'invalid_arguments');
  assert.equal(service.hits.length, 3);
});

test('both tenant creation help forms explain defaults, the receipt and portal recovery without login', async t => {
  const f = fixture(t);
  const direct = await f.run(['host', 'tenant', 'create', '--help']);
  assert.equal(direct.code, 0);
  for (const args of [['help', 'host', 'tenant', 'create'], ['host', 'tenant', 'create', '-h']]) {
    const alias = await f.run(args);
    assert.equal(alias.code, 0);
    assert.equal(alias.stdout, direct.stdout);
  }
  for (const guidance of ['默认', 'xrain-cli host tenant create --request-key', '--no-standard-workforce',
    'standardWorkforce.enabled', 'workforce show <tenantId>', '继续开通 Workforce']) assert.ok(direct.stdout.includes(guidance), guidance);
  assert.match((await f.run(['host', 'tenant', '--help'])).stdout, /创建业务租户，默认/);
});

test('an offline portal preserves native creation and a pending handoff without re-enrolling an earlier native tenant', async t => {
  const f = fixture(t);
  const unavailable = await mockServer(t, (_hit, res) => respond(res, { error: 'workforce.unavailable' }, 503));
  let existed = false, grants = 0;
  const service = await mockServer(t, (hit, res) => {
    if (hit.url.includes('/members') && hit.method === 'POST') {
      assert.deepEqual(hit.json(), { userId: 'intake', isAdministrator: false });
      grants++; return respond(res, { userId: 'intake', isActive: true }, 201);
    }
    if (hit.method === 'POST') return respond(res, { tenantId: 'target' }, 201);
    let items = [];
    if (existed) items = hit.url.includes('/members') ? [{ userId: 'intake', isActive: true }] : [{ name: 'demo', tenantId: 'target' }];
    return respond(res, { items, totalCount: items.length });
  });
  f.env.XRAIN_WORKFORCE_URL = unavailable.url;
  f.env.XRAIN_WORKFORCE_ENROLLMENT_USER_ID = 'intake';
  f.store.save({ activeProfile: 'Host', profiles: { Host: { server: service.url, scope: 'host', tenant: null, bearerToken: 'host' } } });
  const file = join(f.directory, 'input.json');
  writeFileSync(file, '{"name":"demo"}');
  const run = () => f.run(['host','tenant','create','--request-key','original','--request-json',file,'--json']);
  assert.equal(output(await run()).data.standardWorkforce.state, 'pending');
  existed = true;
  const replay = output(await run()).data;
  assert.equal(replay.tenantId, 'target');
  assert.equal(replay.standardWorkforce.state, 'unconfirmed');
  assert.equal(grants, 1);
});
