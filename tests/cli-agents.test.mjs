import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, mockServer, respond } from './helpers.mjs';

const output = value => JSON.parse(value.stdout);
const json = value => ['--values', JSON.stringify(value)];

test('sidebar commands change only the chosen entry at the observed definition revision', async t => {
  const f = fixture(t), secret = 'synthetic-token';
  let item = { agentId: 'sales', aiUserId: '', name: 'Sales', revision: 4, enabled: true,
    instructions: 'keep', provider: 'provider', model: 'model', agentPreset: 'normal',
    uiPlugins: [{ pluginId: 'assistant-guide', entryId: 'guide', availability: 'always' },
      { pluginId: 'quote', entryId: 'quote-custom', availability: 'always', initiallyLoaded: false }] };
  const service = await mockServer(t, (hit, res) => {
    if (hit.method === 'GET') return respond(res, item);
    const body = hit.json();
    if (body.revision !== item.revision) return respond(res, { error: 'CONFLICT' }, 409);
    item = { ...body, revision: body.revision + 1 }; return respond(res, item);
  });
  f.profile(service.url, 'tenant-demo', secret);
  const run = async args => f.run(['agent', 'sidebar', ...args, '--runtime', service.url, '--json']);
  assert.equal(output(await run(['show', 'sales'])).data.revision, 4);
  let result = await run(['remove', 'sales', '--entry-id', 'guide', '--expected-revision', '4']);
  assert.equal(result.code, 0, result.stdout);
  assert.deepEqual(item.uiPlugins.map(row => row.entryId), ['quote-custom']);
  assert.equal(item.instructions, 'keep'); assert.deepEqual(item.workspaceChange, { operation: 'keep' });
  result = await run(['update', 'sales', '--entry-id', 'quote-custom', '--expected-revision', '5', ...json({ initiallyLoaded: true })]);
  assert.equal(result.code, 0, result.stdout); assert.equal(item.uiPlugins[0].initiallyLoaded, true);
  const writes = service.hits.filter(hit => hit.method === 'POST').length;
  result = await run(['remove', 'sales', '--entry-id', 'quote-custom', '--expected-revision', '4']);
  assert.equal(output(result).error.code, 'conflict'); assert.equal(service.hits.filter(hit => hit.method === 'POST').length, writes);
  result = await run(['add', 'sales', '--expected-revision', '6', ...json({ pluginId: 'other', availability: 'always' })]);
  assert.equal(result.code, 0, result.stdout); assert.match(item.uiPlugins[1].entryId, /^entry-[a-f0-9]{32}$/);
  result = await run(['set', 'sales', '--expected-revision', '7', ...json(null)]);
  assert.equal(result.code, 0, result.stdout); assert.equal(item.uiPlugins, undefined);
  result = await run(['add', 'sales', '--expected-revision', '8', ...json({ pluginId: 'other', availability: 'always' })]);
  assert.equal(output(result).error.code, 'invalid_arguments');
  result = await run(['set', 'sales', '--expected-revision', '8', ...json([])]);
  assert.equal(result.code, 0, result.stdout); assert.deepEqual(item.uiPlugins, []);
});

test('sidebar catalog uses the original member and installed Workforce contributions', async t => {
  const f = fixture(t), secret = 'synthetic-session';
  const service = await mockServer(t, (hit, res) => {
    assert.equal(hit.headers.authorization, `Bearer ${secret}`);
    if (hit.url === '/api/service/authen/v1/account/context') return respond(res, { tenantId: 'tenant-demo', userId: 'member-a' });
    assert.equal(hit.url, '/api/workbench/sidebar-plugins');
    assert.equal(hit.headers['x-xrain-expected-user-id'], 'member-a');
    return respond(res, { items: [{ id: 'quote', label: '报价', kind: 'custom' }] });
  });
  f.profile(service.url, 'tenant-demo');
  f.store.saveSession('Demo', service.url, 'tenant-demo', secret, Date.now() + 300000);
  const result = await f.run(['agent', 'sidebar', 'catalog', '--workforce', service.url, '--auth', 'session', '--json']);
  assert.equal(result.code, 0, result.stdout);
  assert.equal(output(result).data.items[0].id, 'quote');
  assert.ok(!result.stdout.includes(secret));
});

test('definition lifecycle preserves settings, requires explicit revisions and reports lost write results', async t => {
  const f = fixture(t), secret = 'synthetic-platform-credential', records = new Map();
  let loseResult = false;
  const service = await mockServer(t, (hit, res) => {
    assert.equal(hit.headers.authorization, `Bearer ${secret}`);
    assert.equal(hit.headers['x-xrain-authorization'], `Bearer ${secret}`);
    if (hit.url === '/v1/dsh/agent-definitions/limits') return respond(res, { maxDefinitionBytes: 16777216, supportsDefinitionStatusUpdate: true });
    if (hit.url === '/v1/dsh/agent-definitions/options') return respond(res, { workspaces: [{ id: 'ws' }], presets: ['normal'], models: {} });
    if (hit.url.startsWith('/v1/dsh/agent-definitions/items/')) {
      const item = records.get(hit.url.split('/').at(-1));
      return respond(res, item ?? { error: 'AGENT_DEFINITION_NOT_FOUND' }, item ? 200 : 404);
    }
    if (hit.method !== 'POST' || !['/v1/dsh/agent-definitions', '/v1/dsh/agent-definitions/enabled'].includes(hit.url)) return respond(res, { error: 'NOT_FOUND' }, 404);
    const value = hit.json(), old = records.get(value.agentId);
    if ((old?.revision ?? null) !== value.revision) return respond(res, { error: 'AGENT_DEFINITION_CONFLICT' }, 409);
    if (value.revision === null && value.enabled) return respond(res, { error: 'INVALID_AGENT_DEFINITION' }, 422);
    const { workspaceChange, ...stored } = value;
    records.set(value.agentId, { ...(hit.url.endsWith('/enabled') ? old : {}), ...stored, revision: (value.revision ?? 0) + 1 });
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
  assert.equal(output(stale).error.code, 'conflict'); assert.equal(output(stale).error.serverCode, 'AGENT_DEFINITION_CONFLICT');
  assert.equal(records.get(id).revision, 2);
  assert.equal(service.hits.at(-1).url, '/v1/dsh/agent-definitions/enabled');
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

test('platform configuration reads and writes retain full bindings, defaults, visibility and each approval decision', async t => {
  const f = fixture(t), policies = [{ agentId: 'a', visibility: 'private' }, { agentId: 'b', visibility: 'public' }];
  const requests = [
    { id: 'approve', agentId: 'a', selected: true, approvalStatus: 'pending' },
    { id: 'reject', agentId: 'a', selected: true, approvalStatus: 'pending' },
    { id: 'revoke', agentId: 'b', selected: true, approvalStatus: 'approved' },
  ];
  let selection = { bindings: [{ agentId: 'a', requireUserSubscription: false }, { agentId: 'b', requireUserSubscription: false }], defaultAgentId: 'b' };
  const service = await mockServer(t, (hit, res) => {
    if (hit.url.endsWith('/policies')) return respond(res, policies);
    if (hit.url.endsWith('/a/policy')) { policies[0].visibility = hit.json().visibility; return respond(res, policies[0]); }
    if (hit.url.endsWith('/subscription-requests')) return respond(res, requests);
    if (hit.url.includes('/subscription-requests/')) {
      const item = requests.find(item => hit.url.includes(`/${item.id}/decision`)); item.approvalStatus = hit.json().decision; return respond(res, item);
    }
    if (hit.url.endsWith('/applications/app/agents')) {
      if (hit.method === 'PUT') { const body = hit.json(); selection = { ...body, bindings: body.bindings.map(item => ({ agentId: item.agentId, requireUserSubscription: false })) }; }
      return respond(res, selection);
    }
    assert.ok(hit.url.includes('/qualifications?applicationId=app'));
    return respond(res, { applicationId: 'app', items: selection.bindings.map(item => ({ ...item, selected: false, canUse: true, approvalStatus: null })), defaultAgentId: selection.defaultAgentId });
  });
  f.profile(service.url, 'tenant-demo', 'synthetic');
  const run = async args => { const result = await f.run(['agent', ...args, '--json']); assert.equal(result.code, 0, result.stdout); return output(result).data; };
  assert.deepEqual(await run(['policy', 'list']), policies);
  await run(['policy', 'set', 'a', '--visibility', 'public']); assert.equal((await run(['policy', 'list']))[0].visibility, 'public');
  assert.deepEqual(await run(['application', 'show', 'app']), selection);
  const updated = await run(['application', 'set', 'app', ...json({ bindings: [{ agentId: 'a' }, { agentId: 'b' }], defaultAgentId: 'a' })]);
  assert.equal(updated.bindings.length, 2); assert.equal(updated.defaultAgentId, 'a'); assert.equal(updated.bindings[1].agentId, 'b');
  assert.deepEqual(await run(['application', 'show', 'app']), updated);
  assert.deepEqual((await run(['qualifications', '--application-id', 'app'])).items.map(item => item.selected), [false, false]);
  for (const [id, decision] of [['approve', 'approved'], ['reject', 'rejected'], ['revoke', 'revoked']]) {
    assert.equal((await run(['subscription', 'decide', id, '--decision', decision])).approvalStatus, decision);
    assert.equal((await run(['subscription', 'list'])).find(item => item.id === id).approvalStatus, decision);
  }
});

test('discovery, tools and workspace operations use the explicit Runtime and reject invalid inputs before writes', async t => {
  const f = fixture(t), runtime = await mockServer(t, (hit, res) => hit.url.endsWith('/limits')
    ? respond(res, { maxDefinitionBytes: 16777216, supportsDefinitionStatusUpdate: true })
    : respond(res, { path: hit.url, method: hit.method, application: hit.headers['x-xrain-application-id'] ?? null, body: hit.body.length ? hit.json() : null }));
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
  const runtime = await mockServer(t, (hit, res) => hit.url.endsWith('/limits')
    ? respond(res, { maxDefinitionBytes: 16777216, supportsDefinitionStatusUpdate: true })
    : respond(res, { error: hit.method === 'POST' ? 'AGENT_DEFINITION_CONFLICT' : 'AGENT_DEFINITIONS_FORBIDDEN' }, hit.method === 'POST' ? 409 : 403));
  f.profile(runtime.url, 'tenant-demo', 'synthetic-token');
  const create = await f.run(['agent', 'definition', 'create', '--agent-id', 'fixed-id', '--name', 'Existing', '--runtime', runtime.url, '--json']);
  assert.equal(output(create).error.code, 'conflict'); assert.equal(output(create).error.serverCode, 'AGENT_DEFINITION_CONFLICT');
  assert.equal(runtime.hits.length, 1);
  const denied = await f.run(['agent', 'definition', 'list', '--runtime', runtime.url, '--json']);
  assert.equal(output(denied).error.code, 'permission_denied'); assert.equal(output(denied).error.serverCode, 'AGENT_DEFINITIONS_FORBIDDEN');
});

test('successful HTTP responses with invalid write receipts do not claim that an operation completed', async t => {
  const f = fixture(t);
  const service = await mockServer(t, (hit, res) => hit.url.endsWith('/limits') ? respond(res, { maxDefinitionBytes: 16777216 }) : hit.url.includes('/b/subscription') ? respond(res, { error: 'request_timeout' }, 408) : respond(res, hit.url.endsWith('/subscription')
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
