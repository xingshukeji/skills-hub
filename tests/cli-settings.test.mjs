import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, mockServer, respond } from './helpers.mjs';

const out = result => JSON.parse(result.stdout);
test('retired Host definition-size setting commands never reach a server', async t => {
  const f = fixture(t), server = await mockServer(t, (_hit, res) => respond(res, {}));
  f.profile(server.url, null, 'synthetic-host');
  for (const args of [['get', 'agent-definition-limit'], ['set', 'agent-definition-limit', '--mib', '16']]) {
    const result = await f.run(['host', 'settings', ...args, '--json']);
    assert.equal(result.code, 1);
    assert.equal(out(result).error.code, 'invalid_command');
  }
  assert.equal(server.hits.length, 0);
});

test('personal preferences use USER endpoints and preserve explicit values and unknown writes', async t => {
  const f = fixture(t), values = new Map();
  let lose = false, missingEndpoint = false;
  const server = await mockServer(t, (hit, res) => {
    const key = hit.url.split('/').at(-1);
    assert.ok(hit.url.startsWith('/api/tenant/v1/settings/workforce/'));
    if (hit.method === 'PUT') { values.set(key, hit.json().value); if (lose) return res.destroy(); }
    if (missingEndpoint) return respond(res, {}, 404);
    if (!values.has(key)) return respond(res, { errorCode: 'platform.tenant_user_setting.not_found' }, 404);
    respond(res, { settingApp: 'workforce', key, value: values.get(key) });
  });
  f.profile(server.url, 'tenant-demo', 'synthetic-user');
  const run = (...args) => f.run(['user', 'settings', ...args, '--json']);
  assert.equal(out(await run('get', 'send-shortcut')).data.configured, false);
  missingEndpoint = true;
  const unavailable = await run('get', 'send-shortcut');
  assert.equal(unavailable.code, 1);
  assert.equal(out(unavailable).error.httpStatus, 404);
  missingEndpoint = false;
  const result = out(await run('set', 'send-shortcut', '--value', 'ctrlEnter')).data;
  assert.equal(result.scope, 'user'); assert.equal(result.tenantId, 'tenant-demo'); assert.equal(result.value, 'ctrlEnter');
  assert.equal(out(await run('get', 'send-shortcut')).data.value, 'ctrlEnter');
  lose = true;
  assert.equal(out(await run('set', 'unread-badge', '--value', 'false')).error.code, 'outcome_unknown');
  assert.equal(server.hits.filter(hit => hit.method === 'PUT').length, 2);
  const before = server.hits.length;
  assert.equal((await run('set', 'unread-badge', '--value', 'yes')).code, 1);
  assert.equal((await run('set', 'agents.maxDefinitionBytes', '--value', '1')).code, 1);
  assert.equal(server.hits.length, before);
});
