import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, mockServer, respond } from './helpers.mjs';

const out = result => JSON.parse(result.stdout);
const hostPath = '/api/host/v1/settings/agent-definition-limit';
test('Host limits preserve null, convert MiB, compare old values and skip unchanged writes', async t => {
  const f = fixture(t);
  let current = null, conflict = false;
  const server = await mockServer(t, (hit, res) => {
    assert.equal(hit.url, hostPath);
    if (hit.method === 'PUT') {
      const request = hit.json();
      if (conflict) current = 99;
      if (request.expectedMaxDefinitionBytes !== current) return respond(res, { errorCode: 'agent_definition_limit_conflict' }, 409);
      assert.ok(Number.isSafeInteger(request.maxDefinitionBytes)); current = request.maxDefinitionBytes;
    }
    respond(res, { maxDefinitionBytes: current, defaultMaxDefinitionBytes: 16777216 });
  });
  f.profile(server.url, null, 'synthetic-host-token');
  const run = (...argv) => f.run(['host', 'settings', ...argv, '--json']);
  const initial = out(await run('get', 'agent-definition-limit')).data;
  assert.equal(initial.maxDefinitionBytes, null); assert.equal(initial.maxDefinitionMiB, null); assert.equal(initial.scope, 'host');
  const saved = out(await run('set', 'agent-definition-limit', '--mib', '16')).data;
  assert.equal(saved.changed, true); assert.equal(saved.maxDefinitionBytes, 16777216); assert.equal(saved.maxDefinitionMiB, 16);
  assert.deepEqual(server.hits.at(-1).json(), { maxDefinitionBytes: 16777216, expectedMaxDefinitionBytes: null });
  const unchanged = out(await run('set', 'agent-definition-limit', '--bytes', '16777216'));
  assert.equal(unchanged.data.changed, false); assert.equal(server.hits.at(-1).method, 'GET');
  const stale = out(await run('set', 'agent-definition-limit', '--mib', '17', '--expected-bytes', 'null'));
  assert.equal(stale.error.code, 'conflict'); assert.equal(server.hits.at(-1).method, 'GET');
  const fractional = out(await run('set', 'agent-definition-limit', '--mib', '0.000001'));
  assert.equal(fractional.data.maxDefinitionBytes, 1);
  conflict = true;
  const before = server.hits.length;
  const concurrent = out(await run('set', 'agent-definition-limit', '--bytes', '10', '--expected-bytes', '1'));
  assert.equal(concurrent.error.code, 'conflict'); assert.equal(concurrent.error.details.request.expectedMaxDefinitionBytes, 1);
  assert.equal(server.hits.length - before, 2); assert.equal(current, 99);
  const last = server.hits.length;
  for (const options of [['--mib', 'NaN'], ['--mib', 'Infinity'], ['--mib', '0.000000001'], ['--bytes', '1.5'], ['--bytes', '9007199254740992'], ['--mib', '1', '--bytes', '1'], ['--mib', '1', '--expected-bytes', '-1']]) {
    assert.equal((await run('set', 'agent-definition-limit', ...options)).code, 1);
  }
  assert.equal(server.hits.length, last);
});

test('Host denied, unavailable and malformed reads never trigger another endpoint or mutation', async t => {
  const f = fixture(t);
  let mode = 403;
  const server = await mockServer(t, (_hit, res) => mode === 200 ? respond(res, { maxDefinitionBytes: '16' }) : respond(res, { errorCode: 'agent_definition_limit_forbidden' }, mode));
  f.profile(server.url, 'tenant-admin', 'synthetic-tenant-token');
  for (const [status, code] of [[401, 'authentication_failed'], [403, 'permission_denied'], [503, 'http_error'], [200, 'invalid_response']]) {
    mode = status;
    const result = out(await f.run(['host', 'settings', 'set', 'agent-definition-limit', '--mib', '16', '--json']));
    assert.equal(result.error.code, code);
  }
  assert.equal(server.hits.length, 4);
  assert.ok(server.hits.every(hit => hit.method === 'GET' && hit.url === hostPath));
});

test('Host lost, malformed and oversized save receipts remain unknown after a matching readback without resubmission', async t => {
  const f = fixture(t);
  let value = 1, mode = 'lost', writes = 0;
  const server = await mockServer(t, (hit, res) => {
    if (hit.method === 'PUT') {
      writes++; value = hit.json().maxDefinitionBytes;
      if (mode === 'lost') return res.destroy();
      if (mode === 'oversized') { res.writeHead(200, { 'Content-Length': 2 * 1024 * 1024 }); return res.end('x'); }
      res.writeHead(200); return res.end('{invalid');
    }
    respond(res, { maxDefinitionBytes: value, defaultMaxDefinitionBytes: 16777216 });
  });
  f.profile(server.url, null, 'synthetic-host');
  for (const [index, kind] of ['lost', 'invalid', 'oversized'].entries()) {
    mode = kind;
    const result = out(await f.run(['host', 'settings', 'set', 'agent-definition-limit', '--bytes', String(index + 2), '--json']));
    assert.equal(result.error.code, 'outcome_unknown');
    assert.equal(result.error.details.readBack.matchesRequested, true); assert.equal(result.error.details.readBack.provesThisWrite, false);
    assert.equal(writes, index + 1);
  }
});

test('personal preferences use USER endpoints and preserve explicit values and unknown writes', async t => {
  const f = fixture(t), values = new Map();
  let lose = false;
  const server = await mockServer(t, (hit, res) => {
    const key = hit.url.split('/').at(-1);
    assert.ok(hit.url.startsWith('/api/tenant/v1/settings/workforce/'));
    if (hit.method === 'PUT') { values.set(key, hit.json().value); if (lose) return res.destroy(); }
    if (!values.has(key)) return respond(res, {}, 404);
    respond(res, { settingApp: 'workforce', key, value: values.get(key) });
  });
  f.profile(server.url, 'tenant-demo', 'synthetic-user');
  const run = (...args) => f.run(['user', 'settings', ...args, '--json']);
  assert.equal(out(await run('get', 'send-shortcut')).data.configured, false);
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
