import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, mockServer, respond } from './helpers.mjs';

const output = value => JSON.parse(value.stdout);
const json = value => ['--values', JSON.stringify(value)];

test('definition lifecycle preserves settings, requires explicit revisions and reports lost write results', async t => {
  const f = fixture(t), secret = 'synthetic-platform-credential', records = new Map();
  let loseResult = false;
  const service = await mockServer(t, (hit, res) => {
    assert.equal(hit.headers.authorization, `Bearer ${secret}`);
    assert.equal(hit.headers['x-xrain-authorization'], `Bearer ${secret}`);
    if (hit.url === '/v1/dsh/agent-definitions/options') return respond(res, { workspaces: [{ id: 'ws' }], presets: ['normal'], models: {} });
    if (hit.url !== '/v1/dsh/agent-definitions') return respond(res, { error: 'NOT_FOUND' }, 404);
    if (hit.method === 'GET') return respond(res, { items: [...records.values()], canManage: true });
    const value = hit.json(), old = records.get(value.agentId);
    if ((old?.revision ?? null) !== value.revision) return respond(res, { error: 'AGENT_DEFINITION_CONFLICT' }, 409);
    if (value.revision === null && value.enabled) return respond(res, { error: 'INVALID_AGENT_DEFINITION' }, 422);
    const { workspaceChange, ...stored } = value;
    records.set(value.agentId, { ...stored, revision: (value.revision ?? 0) + 1 });
    if (loseResult) { loseResult = false; hit && res.destroy(); return; }
    respond(res, records.get(value.agentId), old ? 200 : 201);
  });
  f.profile(service.url, 'tenant-demo', secret);
  const target = ['--runtime', service.url, '--json'];
  const options = await f.run(['agent', 'definition', 'options', ...target]);
  assert.equal(output(options).data.workspaces[0].id, 'ws');
  const initial = { instructions: 'Review', provider: 'p', model: 'm',
    workspaceChange: { operation: 'bind', workspaceId: 'ws', agentPreset: 'normal' }, assistantTools: [{ name: 'tool' }] };
  const created = await f.run(['agent', 'definition', 'create', '--name', 'Reviewer', ...json(initial), ...target]);
  assert.equal(created.code, 0, created.stdout);
  const saved = output(created).data, id = saved.agentId;
  assert.match(id, /^agent-[a-f0-9]{32}$/); assert.match(created.stderr, new RegExp(id));
  assert.equal(saved.enabled, false); assert.equal(saved.revision, 1); assert.equal(saved.aiUserId, '');
  assert.equal(saved.workspaceId, 'ws'); assert.equal(saved.agentPreset, 'normal');
  const show = await f.run(['agent', 'definition', 'show', id, ...target]);
  assert.equal(output(show).data.agentId, id);
  const updated = await f.run(['agent', 'definition', 'update', id, '--expected-revision', '1', ...json({ instructions: 'Updated' }), ...target]);
  assert.equal(updated.code, 0, updated.stdout);
  assert.equal(output(updated).data.revision, 2); assert.equal(output(updated).data.instructions, 'Updated');
  assert.deepEqual(output(updated).data.assistantTools, initial.assistantTools);
  assert.deepEqual(service.hits.at(-1).json().workspaceChange, { operation: 'keep' });
  const stale = await f.run(['agent', 'definition', 'enable', id, '--expected-revision', '1', ...target]);
  assert.equal(output(stale).error.code, 'conflict'); assert.equal(output(stale).error.details.currentRevision, 2);
  assert.equal(service.hits.at(-1).method, 'GET');
  const enabled = await f.run(['agent', 'definition', 'enable', id, '--expected-revision', '2', ...target]);
  assert.equal(output(enabled).data.enabled, true); assert.equal(output(enabled).data.revision, 3);
  loseResult = true;
  const unknown = await f.run(['agent', 'definition', 'disable', id, '--expected-revision', '3', ...target]);
  assert.equal(output(unknown).error.code, 'outcome_unknown'); assert.equal(output(unknown).error.details.agentId, id);
  assert.match(output(unknown).error.hint, /Read the same agent ID/);
  const observed = await f.run(['agent', 'definition', 'show', id, ...target]);
  assert.equal(output(observed).data.enabled, false); assert.equal(output(observed).data.revision, 4);
  assert.ok(![created.stdout, created.stderr, unknown.stdout].some(text => text.includes(secret)));
});

test('platform commands keep personal subscriptions, approvals and application selection distinct', async t => {
  const f = fixture(t), hits = [];
  const service = await mockServer(t, (hit, res) => {
    hits.push([hit.method, hit.url, hit.body.length ? hit.json() : null]);
    if (hit.url.includes('/subscription-requests/request-1/decision')) return respond(res, { id: 'request-1', approvalStatus: hit.json().decision });
    if (hit.url.endsWith('/subscription')) return respond(res, hit.method === 'POST' ? { id: 'request-1', agentId: 'a', selected: true, approvalStatus: 'pending' } : { cancelled: true });
    if (hit.url.includes('/qualifications')) return respond(res, { tenantId: 'tenant-demo', userId: 'person', items: [], applicationId: null });
    if (hit.url.endsWith('/policy')) return respond(res, { agentId: 'a', ...hit.json() });
    if (hit.url.endsWith('/app-1/agents')) return respond(res, hit.method === 'PUT' ? hit.json() : { bindings: [{ agentId: 'a' }], defaultAgentId: 'a' });
    return respond(res, []);
  });
  f.profile(service.url, 'tenant-demo', 'synthetic-token');
  const run = async argv => { const r = await f.run([...argv, '--json']); assert.equal(r.code, 0, r.stdout); return output(r).data; };
  assert.equal((await run(['agent', 'qualifications'])).applicationId, null);
  assert.equal((await run(['agent', 'subscribe', 'a'])).approvalStatus, 'pending');
  assert.equal((await run(['agent', 'subscription', 'decide', 'request-1', '--decision', 'approved'])).approvalStatus, 'approved');
  await run(['agent', 'policy', 'set', 'a', '--visibility', 'private']);
  const selection = { bindings: [{ agentId: 'a' }, { agentId: 'b' }], defaultAgentId: 'b' };
  await run(['agent', 'application', 'set', 'app-1', ...json(selection)]);
  assert.equal((await run(['agent', 'unsubscribe', 'a'])).cancelled, true);
  assert.deepEqual(hits, [
    ['GET', '/api/xrain/v1/agents/qualifications', null],
    ['POST', '/api/xrain/v1/agents/a/subscription', null],
    ['POST', '/api/xrain/v1/agents/subscription-requests/request-1/decision', { decision: 'approved' }],
    ['PUT', '/api/xrain/v1/agents/a/policy', { visibility: 'private' }],
    ['PUT', '/api/xrain/v1/applications/app-1/agents', selection],
    ['DELETE', '/api/xrain/v1/agents/a/subscription', null],
  ]);
});

test('discovery, tools and workspace operations use the explicit Runtime and reject invalid inputs before requests', async t => {
  const f = fixture(t), runtime = await mockServer(t, (hit, res) => respond(res, { path: hit.url, method: hit.method, application: hit.headers['x-xrain-application-id'] ?? null, body: hit.body.length ? hit.json() : null }));
  const platform = await mockServer(t, (_hit, res) => respond(res, {}));
  f.profile(platform.url, 'tenant-demo', 'synthetic-token');
  const target = ['--runtime', runtime.url, '--json'];
  const directory = await f.run(['agent', 'directory', '--application-id', 'app-1', ...target]);
  assert.equal(output(directory).data.application, 'app-1'); assert.equal(output(directory).data.path, '/v1/dsh/workbench-agents?mine=false');
  const tools = await f.run(['agent', 'tool', 'native', '--workspace-id', 'ws', '--preset', 'normal', ...target]);
  assert.deepEqual(output(tools).data.body, { workspaceId: 'ws', agentPreset: 'normal' });
  const business = await f.run(['agent', 'tool', 'business', ...target]); assert.deepEqual(output(business).data.body, {});
  const browse = await f.run(['agent', 'workspace', 'browse', ...json({ path: '/approved' }), ...target]);
  assert.equal(output(browse).data.path, '/v1/dsh/agent-definitions/directories/list');
  const before = runtime.hits.length + platform.hits.length;
  for (const bad of [
    ['agent', 'directory', '--mine', '--application-id', 'app-1', ...target],
    ['agent', 'definition', 'enable', 'a', ...target],
    ['agent', 'definition', 'create', '--name', 'Name', ...json({ enabled: true }), ...target],
    ['agent', 'definition', 'update', 'a', '--expected-revision', '1', ...json({ workspaceId: 'other' }), ...target],
    ['agent', 'definition', 'create', '--name', 'Name', ...json({ tenantId: 'forged' }), ...target],
    ['agent', 'policy', 'set', 'a', '--visibility', 'everyone', '--json'],
    ['agent', 'subscription', 'decide', 'r', '--decision', 'other', '--json'],
    ['agent', 'definition', 'list', '--json'],
  ]) { const result = await f.run(bad); assert.equal(result.code, 1, bad.join(' ')); }
  assert.equal(runtime.hits.length + platform.hits.length, before);
});

test('Runtime conflicts and permission failures preserve real error codes without automatic retries', async t => {
  const f = fixture(t);
  const runtime = await mockServer(t, (hit, res) => respond(res, { error: hit.method === 'POST' ? 'AGENT_DEFINITION_CONFLICT' : 'AGENT_DEFINITIONS_FORBIDDEN' }, hit.method === 'POST' ? 409 : 403));
  f.profile(runtime.url, 'tenant-demo', 'synthetic-token');
  const create = await f.run(['agent', 'definition', 'create', '--agent-id', 'fixed-id', '--name', 'Existing', '--runtime', runtime.url, '--json']);
  assert.equal(output(create).error.code, 'conflict'); assert.equal(output(create).error.serverCode, 'AGENT_DEFINITION_CONFLICT');
  assert.equal(runtime.hits.length, 1);
  const denied = await f.run(['agent', 'definition', 'list', '--runtime', runtime.url, '--json']);
  assert.equal(output(denied).error.code, 'permission_denied'); assert.equal(output(denied).error.serverCode, 'AGENT_DEFINITIONS_FORBIDDEN');
});

test('successful HTTP responses with invalid write receipts do not claim that an operation completed', async t => {
  const f = fixture(t);
  const service = await mockServer(t, (hit, res) => hit.url.includes('/b/subscription') ? respond(res, { error: 'request_timeout' }, 408) : respond(res, hit.url.endsWith('/subscription')
    ? { id: 'other', agentId: 'someone-else', selected: true, approvalStatus: 'approved' }
    : { agentId: 'someone-else', revision: 1, enabled: false }));
  f.profile(service.url, 'tenant-demo', 'synthetic-token');
  const subscribe = await f.run(['agent', 'subscribe', 'a', '--json']);
  assert.equal(output(subscribe).error.code, 'outcome_unknown'); assert.equal(output(subscribe).error.details.agentId, 'a');
  const create = await f.run(['agent', 'definition', 'create', '--name', 'Example', '--agent-id', 'a', '--runtime', service.url, '--json']);
  assert.equal(output(create).error.code, 'outcome_unknown'); assert.equal(output(create).error.details.agentId, 'a');
  const timeout = await f.run(['agent', 'subscribe', 'b', '--json']);
  assert.equal(output(timeout).error.code, 'outcome_unknown'); assert.equal(output(timeout).error.httpStatus, 408);
  assert.equal(service.hits.length, 3);
});

test('batch validates required agent arguments before executing an earlier write', async t => {
  const f = fixture(t), service = await mockServer(t, (_hit, res) => respond(res, {}));
  f.profile(service.url, 'tenant-demo', 'synthetic-token');
  const file = join(f.directory, 'batch.json');
  writeFileSync(file, JSON.stringify([
    ['agent', 'subscribe', 'a'],
    ['agent', 'definition', 'enable', 'a', '--runtime', service.url],
  ]));
  const result = await f.run(['batch', '--file', file, '--json']);
  assert.equal(result.code, 1); assert.match(output(result).error.message, /expected-revision/);
  assert.equal(service.hits.length, 0);
});
