import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { definitionFileChanges, exportDefinition, readDefinitionFile } from '../src/xrain-cli/definition-file.mjs';
import { fixture, mockServer, respond } from './helpers.mjs';

const sample = JSON.parse(readFileSync(new URL('../skills/shzw-xrain-cli/references/examples/definition-file-v1.json', import.meta.url), 'utf8'));
const root = '/v1/dsh/agent-definitions';
const output = result => JSON.parse(result.stdout);
const inline = value => ['--values', JSON.stringify(value)];
const empty = { aiUserId: '', name: 'Target', enabled: false, instructions: '', provider: '', model: '', agentPreset: '', workspaceId: null, nativeTools: [], allowedCallerUserIds: [] };

test('version 1 tools retain long descriptions, wide schemas and literal reference data', () => {
  const tool = { name: 'service_lookup', serviceId: 'records', operation: 'lookup', description: '完整业务说明。'.repeat(600),
    parameters: { type: 'object', properties: Object.fromEntries(Array.from({ length: 180 }, (_, index) => [
      `field_${index}`, { type: 'string', description: '完整字段说明。'.repeat(16), enum: ['ordinary', '$ref'], default: '$ref' },
    ])), additionalProperties: false } };
  assert.ok(tool.description.length > 4000);
  assert.ok(JSON.stringify(tool.parameters).length > 16000);
  const file = exportDefinition({ ...empty, assistantTools: [tool] }, []);
  const read = readDefinitionFile(JSON.parse(JSON.stringify(file)));
  const { changes, warnings } = definitionFileChanges(read, empty, []);
  assert.deepEqual(warnings, []);
  assert.deepEqual(changes.assistantTools, [tool]);
  assert.deepEqual(exportDefinition({ ...empty, ...changes }, []), file);
  assert.throws(() => readDefinitionFile({ ...file, definition: { ...file.definition, assistantTools: [{ ...tool, description: null }] } }));
});

test('version 1 questions and create fields retain complete text, ordering and conditions', () => {
  const long = '请核对以下事项：' + '当前资料与需求。'.repeat(80) + '保留完整末尾。';
  const suggestedQuestions = [long, { text: long + '继续核对。', when: { conversation: 'started', object: 'linked', businessSourceId: 'xrain', objectType: 'customer' } }];
  const businessActions = [{ businessSourceId: 'xrain', objectType: 'customer', action: 'create', createFields: Array.from({ length: 513 }, (_, index) => `Field${index}`) }];
  const file = exportDefinition({ ...empty, suggestedQuestions, businessActions }, []);
  const read = readDefinitionFile(JSON.parse(JSON.stringify(file)));
  const { changes, warnings } = definitionFileChanges(read, empty, []);
  assert.deepEqual(warnings, []);
  assert.deepEqual(changes.suggestedQuestions, suggestedQuestions);
  assert.deepEqual(changes.businessActions, businessActions);
  assert.deepEqual(exportDefinition({ ...empty, ...changes }, []), file);
  assert.throws(() => readDefinitionFile({ ...file, definition: { ...file.definition, suggestedQuestions: [{ text: long, when: { objectType: 'o'.repeat(161) } }] } }));
  assert.throws(() => readDefinitionFile({ ...file, definition: { ...file.definition, suggestedQuestions: [long + '\0'] } }));
  assert.throws(() => readDefinitionFile({ ...file, definition: { ...file.definition, suggestedQuestions: [{ text: null }] } }));
});

async function definitions(t, options = {}) {
  const f = fixture(t), records = new Map(), state = { maxDefinitionBytes: null, supportsDefinitionStatusUpdate: true, supportsNativeToolInheritanceReset: true, supportsDefinitionValidation: true,
    applicationId: 'sales-app', selectedAgentId: 'selected-runtime-agent', workspaces: [{ id: 'registered', cwd: '/same', agentPresets: ['standard'] }], lose: false, ...options };
  const server = await mockServer(t, (hit, res) => {
    if (hit.url === root + '/limits') return state.limitUnavailable
      ? respond(res, { error: 'AGENT_DEFINITION_LIMIT_UNAVAILABLE' }, 503)
      : respond(res, { maxDefinitionBytes: state.maxDefinitionBytes, supportsDefinitionStatusUpdate: state.supportsDefinitionStatusUpdate });
    if (hit.url.startsWith('/api/xrain/v1/agents/qualifications?')) return respond(res, state.selection ?? { applicationId: state.applicationId,
      defaultAgentId: state.selectedAgentId, items: state.selectedAgentId ? [{ agentId: state.selectedAgentId, selected: false, canUse: true, requireUserSubscription: false }] : [] });
    if (hit.url === root + '/options') return respond(res, { applicationId: state.applicationId, workspaces: state.workspaces, presets: ['standard'], models: {},
      maxDefinitionBytes: state.maxDefinitionBytes, supportsNativeToolInheritanceReset: state.supportsNativeToolInheritanceReset, supportsDefinitionValidation: state.supportsDefinitionValidation });
    if (hit.url === root + '/summaries') return respond(res, { canManage: true, items: [...records.values()].map(({ agentId, revision, name, enabled }) => ({ agentId, revision, name, enabled })) });
    if (hit.url.startsWith(root + '/items/')) {
      const item = records.get(decodeURIComponent(hit.url.split('/').at(-1)));
      return respond(res, item ?? { error: 'AGENT_DEFINITION_NOT_FOUND' }, item ? 200 : 404);
    }
    if (hit.url === root && hit.method === 'GET') throw new Error('Modern CLI must not download the full list');
    if (hit.url === root + '/validate' && hit.method === 'POST') {
      const body = hit.json();
      if (body.revision !== (records.get(body.agentId)?.revision ?? null)) return respond(res, { error: 'AGENT_DEFINITION_CONFLICT' }, 409);
      return respond(res, { valid: true, agentId: body.agentId, revision: body.revision });
    }
    if (hit.method !== 'POST' || ![root, root + '/enabled'].includes(hit.url)) return respond(res, { error: 'NOT_FOUND' }, 404);
    const body = hit.json(), old = records.get(body.agentId), statusOnly = hit.url.endsWith('/enabled');
    if (body.revision !== (old?.revision ?? null)) return respond(res, { error: 'AGENT_DEFINITION_CONFLICT' }, 409);
    if (statusOnly) assert.deepEqual(Object.keys(body).sort(), ['agentId', 'enabled', 'revision']);
    else if (state.legacyReceiveLimit && hit.body.length > state.legacyReceiveLimit) return respond(res, { error: 'INVALID_AGENT_DEFINITION' }, 413);
    const saved = statusOnly ? { ...old, enabled: body.enabled, revision: old.revision + 1 } : { ...body, revision: (body.revision ?? 0) + 1 };
    if (!statusOnly) {
      if (body.nativeTools === null) delete saved.nativeTools;
      if (body.nativeTools === undefined && old?.nativeTools !== undefined) saved.nativeTools = old.nativeTools;
      if (body.workspaceChange?.operation === 'direct') Object.assign(saved, { workspaceDirect: true, workspacePath: body.workspaceChange.path });
      if (body.workspaceChange?.operation === 'keep') for (const key of ['workspaceId', 'workspaceDirect', 'workspacePath', 'agentPreset']) if (old && Object.hasOwn(old, key)) saved[key] = old[key];
      delete saved.workspaceChange;
    }
    records.set(body.agentId, saved);
    if (state.lose) { state.lose = false; return res.destroy(); }
    // A receipt need not repeat large definition content.
    respond(res, { agentId: saved.agentId, revision: saved.revision, enabled: saved.enabled }, old ? 200 : 201);
  });
  f.profile(server.url, 'tenant-demo', 'synthetic-token');
  const run = (args, io) => f.run(['agent', 'definition', ...args, '--runtime', server.url, '--json'], io);
  return { f, records, state, server, run };
}

test('status remains independent of retired limit metadata and never replays unknown writes', async t => {
  const { records, state, server, run } = await definitions(t, { maxDefinitionBytes: 100, limitUnavailable: true });
  records.set('large', { ...empty, agentId: 'large', revision: 6, enabled: true, instructions: '字'.repeat(10000) });
  const stopped = output(await run(['disable', 'large', '--expected-revision', '6']));
  assert.equal(stopped.data.enabled, false); assert.equal(records.get('large').instructions.length, 10000);
  assert.deepEqual(server.hits.map(hit => hit.url), [root + '/enabled']);
  const conflict = output(await run(['enable', 'large', '--expected-revision', '6']));
  assert.equal(conflict.error.code, 'conflict'); assert.equal(records.get('large').revision, 7);
  state.lose = true;
  const unknown = output(await run(['enable', 'large', '--expected-revision', '7']));
  assert.equal(unknown.error.code, 'outcome_unknown'); assert.equal(records.get('large').revision, 8);
  assert.equal(server.hits.filter(hit => hit.method === 'POST').length, 3);
  assert.equal(output(await run(['show', 'large'])).data.revision, 8);
  assert.equal(server.hits.at(-1).url, root + '/items/large');
});

test('complete UTF-8 inline, file and stdin definitions ignore retired byte declarations while patches preserve other fields', async t => {
  const { f, records, state, server, run } = await definitions(t);
  const content = { instructions: '中文\n"\\'.repeat(30), nativeTools: null };
  const body = { ...empty, agentId: 'boundary', revision: null, ...content, name: 'Boundary' };
  state.maxDefinitionBytes = Buffer.byteLength(JSON.stringify(body), 'utf8');
  const create = output(await run(['create', '--agent-id', 'boundary', '--name', 'Boundary', ...inline(content)]));
  assert.equal(create.ok, true, JSON.stringify(create));
  assert.equal(server.hits.at(-1).body.length, state.maxDefinitionBytes);
  state.maxDefinitionBytes = 1;
  state.limitUnavailable = true;
  const path = join(f.directory, 'patch.json');
  writeFileSync(path, JSON.stringify({ instructions: '新指令' }));
  records.get('boundary').assistantTools = sample.definition.assistantTools;
  assert.equal(output(await run(['update', 'boundary', '--expected-revision', '1', '--values-json', path])).ok, true);
  assert.deepEqual(records.get('boundary').assistantTools, sample.definition.assistantTools);
  assert.equal(output(await run(['update', 'boundary', '--expected-revision', '2', '--values-json', '-'], { stdin: Readable.from(['{"nativeTools":', '[]}']) })).ok, true);
  assert.deepEqual(records.get('boundary').nativeTools, []);
  state.maxDefinitionBytes = 24;
  for (const [index, args] of [inline({ instructions: '字'.repeat(20) }), ['--values-json', '-']].entries()) {
    const result = output(await run(['update', 'boundary', '--expected-revision', String(3 + index), ...args], { stdin: Readable.from([JSON.stringify({ instructions: '字'.repeat(20) })]) }));
    assert.equal(result.ok, true, JSON.stringify(result));
  }
  const writes = server.hits.filter(hit => hit.method === 'POST').length;
  state.maxDefinitionBytes = 4096;
  assert.equal(output(await run(['update', 'boundary', '--expected-revision', '5', '--values-json', '-'], { stdin: Readable.from([Buffer.from([0xff])]) })).error.code, 'invalid_arguments');
  assert.equal(server.hits.filter(hit => hit.method === 'POST').length, writes);
  assert.equal(server.hits.some(hit => hit.url === root + '/limits'), false);
  state.legacyReceiveLimit = 1;
  const rejected = output(await run(['update', 'boundary', '--expected-revision', '5', ...inline({ name: 'Must remain unchanged' })]));
  assert.equal(rejected.error.httpStatus, 413); assert.equal(records.get('boundary').revision, 5);
  assert.equal(server.hits.filter(hit => hit.method === 'POST').length, writes + 1);
});

test('complete files larger than 32 MiB remain readable, exportable and editable without fixed local admission', async t => {
  const { f, records, state, server, run } = await definitions(t, { maxDefinitionBytes: 36 * 1024 * 1024 });
  const path = join(f.directory, 'large.json'), contents = 'x'.repeat(33 * 1024 * 1024);
  writeFileSync(path, JSON.stringify({ instructions: contents }));
  const result = await run(['create', '--agent-id', 'large', '--name', 'Large', '--values-json', path]);
  assert.equal(result.code, 0, result.stdout);
  records.set('unrelated', { ...records.get('large'), agentId: 'unrelated' });
  state.maxDefinitionBytes = 1024;
  const summary = output(await run(['list'])).data;
  assert.equal(summary.items.length, 2); assert.equal(Object.hasOwn(summary.items[0], 'instructions'), false);
  const outputFile = join(f.directory, 'exchange.json');
  const exported = await run(['export', 'large', '--out', outputFile]);
  assert.equal(exported.code, 0, exported.stdout);
  assert.equal(JSON.parse(readFileSync(outputFile, 'utf8')).definition.instructions, contents);
  assert.equal(server.hits.at(-1).url, root + '/items/large');
  const updated = output(await run(['update', 'large', '--expected-revision', '1', ...inline({ name: 'Rename' })]));
  assert.equal(updated.ok, true, JSON.stringify(updated)); assert.equal(records.get('large').name, 'Rename');
  assert.equal(records.get('large').instructions, contents);
  assert.equal(server.hits.some(hit => hit.url === root + '/limits'), false);
});

test('a missing application-selected definition is created with its fixed ID before importing and enabling', async t => {
  const { f, records, server, run } = await definitions(t);
  const path = join(f.directory, 'exchange.json');
  const portable = structuredClone(sample);
  portable.definition.workspace = { kind: 'registered', id: 'enterprise' };
  writeFileSync(path, JSON.stringify(portable));
  const created = output(await run(['create', '--agent-id', 'sales-agent', '--name', 'Sales']));
  assert.equal(created.data.agentId, 'sales-agent');
  assert.equal(created.data.enabled, false);
  const imported = output(await run(['import', '--agent-id', 'sales-agent', '--expected-revision', String(created.data.revision), '--file', path]));
  assert.equal(imported.data.agentId, 'sales-agent');
  assert.equal(imported.data.enabled, false);
  assert.equal(imported.data.warnings.length, 1);
  assert.equal(records.get('sales-agent').instructions, sample.definition.instructions);
  const updated = output(await run(['update', 'sales-agent', '--expected-revision', String(imported.data.revision), '--workspace-path', '/local/workspace', '--preset', 'standard']));
  assert.equal(updated.data.agentId, 'sales-agent');
  assert.equal(records.get('sales-agent').workspacePath, '/local/workspace');
  const enabled = output(await run(['enable', 'sales-agent', '--expected-revision', String(updated.data.revision)]));
  assert.equal(enabled.data.enabled, true);
  assert.deepEqual([...records.keys()], ['sales-agent']);
  assert.ok(server.hits.every(hit => hit.url.startsWith(root)));
});

test('page exchange file import/export preserves identity, revision, enabled state, fields and inheritance without changing usage relations', async t => {
  const { f, records, server, run } = await definitions(t);
  const path = join(f.directory, 'page.json'); writeFileSync(path, JSON.stringify(sample));
  const created = output(await run(['import', '--file', path]));
  assert.equal(created.ok, true, JSON.stringify(created));
  const id = created.data.agentId, imported = records.get(id);
  assert.equal(imported.enabled, false); assert.equal(imported.workspacePath, sample.definition.workspace.path); assert.equal(imported.agentPreset, 'standard');
  assert.equal(Object.hasOwn(imported, 'nativeTools'), false);
  for (const key of ['assistantTools', 'suggestedQuestions', 'businessActions', 'uiPlugins']) assert.deepEqual(imported[key], sample.definition[key]);
  const exported = join(f.directory, 'cli.json');
  assert.equal((await run(['export', id, '--out', exported])).code, 0);
  assert.deepEqual(JSON.parse(readFileSync(exported, 'utf8')), { ...sample, definition: { ...sample.definition, enabled: false } });
  assert.equal(output(await run(['export', id, '--out', exported])).error.code, 'output_exists');
  imported.enabled = true;
  const applied = output(await run(['import', '--agent-id', id, '--expected-revision', '1', '--file', path]));
  assert.equal(applied.data.enabled, true); assert.equal(records.get(id).revision, 2);
  const before = server.hits.filter(hit => hit.method === 'POST').length;
  const stale = output(await run(['import', '--agent-id', id, '--expected-revision', '1', '--file', path]));
  assert.equal(stale.error.code, 'conflict');
  for (const invalid of [{ ...sample, version: 2 }, { instructions: 'update patch' }, { schema: 3, activeGeneration: 'storage' }]) {
    writeFileSync(path, JSON.stringify(invalid));
    assert.equal(output(await run(['import', '--agent-id', id, '--expected-revision', '2', '--file', path])).error.code, 'invalid_definition_file');
  }
  assert.equal(server.hits.filter(hit => hit.method === 'POST').length, before);
  records.get(id).nativeTools = ['keep-tool'];
  const unmatched = structuredClone(sample); unmatched.definition.workspace = { kind: 'registered', id: 'registered', path: '/different' };
  writeFileSync(path, JSON.stringify(unmatched));
  const preserved = output(await run(['import', '--agent-id', id, '--expected-revision', '2', '--file', path]));
  assert.equal(preserved.data.warnings.length, 1);
  assert.equal(Object.hasOwn(records.get(id), 'nativeTools'), false); assert.equal(records.get(id).workspacePath, sample.definition.workspace.path);
  assert.ok(server.hits.every(hit => hit.url.startsWith(root)));
});

test('missing current Runtime endpoints retain the original failure without alternate reads or full saves', async t => {
  const f = fixture(t), server = await mockServer(t, (_hit, res) => respond(res, { error: 'NOT_FOUND' }, 404));
  f.profile(server.url, 'tenant-demo', 'synthetic-token');
  for (const [args, path] of [
    [['list'], '/summaries'], [['show', 'a'], '/items/a'], [['limits'], '/limits'],
    [['create', '--name', 'Name'], ''], [['enable', 'a', '--expected-revision', '1'], '/enabled'],
  ]) {
    const before = server.hits.length;
    const failed = output(await f.run(['agent', 'definition', ...args, '--runtime', server.url, '--json']));
    assert.equal(failed.error.httpStatus, 404); assert.equal(failed.error.serverCode, 'NOT_FOUND');
    assert.deepEqual(server.hits.slice(before).map(hit => hit.url), [root + path]);
  }
});

test('an explicit definition capability read rejects malformed metadata', async t => {
  const f = fixture(t), server = await mockServer(t, (_hit, res) => respond(res, { supportsDefinitionStatusUpdate: true }));
  f.profile(server.url, 'tenant-demo', 'synthetic-token');
  const failed = output(await f.run(['agent', 'definition', 'limits', '--runtime', server.url, '--json']));
  assert.equal(failed.error.code, 'invalid_response');
  assert.deepEqual(server.hits.map(hit => [hit.method, hit.url]), [['GET', root + '/limits']]);
});

test('an explicit definition capability read reports unbounded saving without inventing a numeric default', async t => {
  const { run, state } = await definitions(t);
  assert.equal(output(await run(['limits'])).data.maxDefinitionBytes, null);
  state.maxDefinitionBytes = 1000;
  assert.equal(output(await run(['limits'])).data.maxDefinitionBytes, 1000);
});

test('direct directory selection only sends the explicit definition change, and omitted fields remain unchanged', async t => {
  const { records, server, run } = await definitions(t);
  records.set('a', { ...empty, agentId: 'a', revision: 1, workspaceId: 'old', agentPreset: 'old', instructions: 'keep', nativeTools: ['read'] });
  const result = output(await run(['update', 'a', '--expected-revision', '1', '--workspace-path', '/existing', '--preset', 'standard']));
  assert.equal(result.ok, true, JSON.stringify(result));
  const saved = server.hits.at(-1).json();
  assert.deepEqual(saved.workspaceChange, { operation: 'direct', path: '/existing', agentPreset: 'standard' });
  assert.equal(saved.workspaceId, null); assert.equal(saved.agentPreset, 'standard'); assert.equal(saved.instructions, 'keep'); assert.deepEqual(saved.nativeTools, ['read']);
  assert.ok(server.hits.every(hit => !hit.url.includes('/directories/') && !hit.url.includes('/workspaces/')));
});

test('version 1 file conversions match page semantics for registered, none and unavailable directories', () => {
  const file = readDefinitionFile(sample), current = { ...empty, enabled: true, workspaceDirect: true, workspacePath: '/keep', agentPreset: 'standard' };
  for (const workspace of [{ kind: 'none' }, { kind: 'unavailable' }, { kind: 'registered', id: 'other', path: '/different' }]) {
    const result = definitionFileChanges({ ...file, definition: { ...file.definition, workspace } }, current, []);
    assert.equal(Object.hasOwn(result.changes, 'workspaceChange'), false); assert.equal(result.warnings.length, 1);
  }
  const registered = { ...file, definition: { ...file.definition, workspace: { kind: 'registered', id: 'ws', path: 'C:\\Data\\' } } };
  const result = definitionFileChanges(registered, current, [{ id: 'ws', cwd: 'c:/data', agentPresets: ['standard'] }]);
  assert.deepEqual(result.changes.workspaceChange, { operation: 'bind', workspaceId: 'ws', agentPreset: 'standard' });
  const cleared = definitionFileChanges({ ...file, definition: { ...file.definition, workspace: { kind: 'none' } } }, { ...current, enabled: false }, []);
  assert.deepEqual(cleared.changes.workspaceChange, { operation: 'clear' });
  assert.equal(exportDefinition({ ...empty, nativeTools: undefined }, []).definition.nativeTools, null);
});

test('import checks a complete candidate and atomically creates a stable ID with an explicit target directory', async t => {
  const { f, records, server, run } = await definitions(t);
  const file = join(f.directory, 'portable.json');
  const portable = { ...sample, definition: { ...sample.definition, workspace: { kind: 'registered', id: 'enterprise' },
    reasoningEffort: null, nativeTools: null, suggestedQuestions: null, businessActions: null, uiPlugins: null,
    assistantTools: sample.definition.assistantTools.map(tool => ({ ...tool, resultReference: true })) } };
  writeFileSync(file, JSON.stringify(portable));
  const create = ['import', '--file', file, '--agent-id', 'fixed', '--create', '--workspace-path', 'D:/成员/工作区', '--preset', 'standard'];
  const checked = output(await run([...create, '--check']));
  assert.equal(checked.ok, true, JSON.stringify(checked)); assert.equal(checked.data.valid, true);
  assert.equal(checked.data.agentId, 'fixed'); assert.equal(checked.data.revision, null);
  assert.equal(records.size, 0);
  const candidate = server.hits.at(-1).json();
  assert.equal(server.hits.at(-1).url, root + '/validate');
  assert.equal(candidate.enabled, false); assert.equal(candidate.nativeTools, null);
  assert.equal(candidate.workspaceId, null); assert.equal(candidate.reasoningEffort, undefined);
  assert.equal(candidate.uiPlugins, undefined);
  assert.deepEqual(candidate.workspaceChange, { operation: 'direct', path: 'D:/成员/工作区', agentPreset: 'standard' });
  assert.deepEqual(candidate.assistantTools, portable.definition.assistantTools);
  assert.equal(output(await run(create)).ok, true);
  const before = structuredClone(records.get('fixed'));
  assert.equal(output(await run(create)).error.code, 'conflict');
  assert.deepEqual(records.get('fixed'), before);
  records.get('fixed').enabled = true;
  const update = ['import', '--file', file, '--agent-id', 'fixed', '--expected-revision', '1'];
  assert.equal(output(await run(update)).ok, true);
  assert.equal(records.get('fixed').enabled, true);
  assert.equal(records.get('fixed').workspacePath, 'D:/成员/工作区');
  assert.equal(records.get('fixed').agentPreset, 'standard');
  const writes = server.hits.filter(hit => hit.method === 'POST').length;
  assert.equal(output(await run(update)).error.code, 'conflict');
  assert.equal(server.hits.filter(hit => hit.method === 'POST').length, writes);
  for (const args of [create.concat('--expected-revision', '2'), ['import', '--file', file, '--create'], create.concat('--preset', 'other')]) {
    assert.ok(['invalid_arguments', 'invalid_input'].includes(output(await run(args)).error.code));
  }
});

test('old Runtime capabilities preserve native choices and do not substitute a save for full validation', async t => {
  const { f, records, server, run } = await definitions(t, { supportsNativeToolInheritanceReset: false, supportsDefinitionValidation: false });
  const file = join(f.directory, 'legacy-target.json');
  writeFileSync(file, JSON.stringify({ ...sample, definition: { ...sample.definition, nativeTools: null } }));
  records.set('old', { ...empty, agentId: 'old', revision: 1, nativeTools: ['read_file'] });
  const args = ['import', '--file', file, '--agent-id', 'old', '--expected-revision', '1'];
  assert.equal(output(await run([...args, '--check'])).error.code, 'unsupported_runtime');
  assert.equal(server.hits.filter(hit => hit.method === 'POST').length, 0);
  const imported = output(await run(args));
  assert.equal(imported.ok, true, JSON.stringify(imported)); assert.ok(imported.data.warnings.length);
  assert.deepEqual(records.get('old').nativeTools, ['read_file']);
  assert.deepEqual(server.hits.at(-1).json().nativeTools, ['read_file']);
  const hits = server.hits.length;
  writeFileSync(file, JSON.stringify({ ...sample, definition: { ...sample.definition,
    assistantTools: sample.definition.assistantTools.map(tool => ({ ...tool, resultReference: 'true' })) } }));
  assert.equal(output(await run(['import', '--file', file])).error.code, 'invalid_definition_file');
  assert.equal(server.hits.length, hits);
});

test('project preparation resolves the selected identity, current revision and local workspace without caller-supplied IDs or paths', async t => {
  for (const cwd of ['D:/成员甲/项目状态', '/members/b/another-checkout/state']) {
    const { f, records, state, server, run } = await definitions(t, { selectedAgentId: 'platform-renamed-agent', workspaces: [{ id: 'project', cwd, agentPresets: ['standard'] }] });
    const file = join(f.directory, 'project-definition.json');
    writeFileSync(file, JSON.stringify({ ...sample, definition: { ...sample.definition, workspace: { kind: 'registered', id: 'project' }, nativeTools: [] } }));
    const args = ['prepare', '--file', file];
    const checked = output(await run([...args, '--check']));
    assert.equal(checked.ok, true, JSON.stringify(checked)); assert.equal(checked.data.agentId, 'platform-renamed-agent');
    assert.equal(checked.data.workspace.path, cwd); assert.equal(records.size, 0);
    const created = output(await run([...args, '--enable']));
    assert.equal(created.ok, true, JSON.stringify(created));
    assert.equal(created.data.enabled, true); assert.equal(created.data.revision, 2); assert.equal(created.data.operation, 'created');
    assert.deepEqual(records.get('platform-renamed-agent').assistantTools, sample.definition.assistantTools);
    state.selection = { applicationId: state.applicationId, defaultAgentId: null,
      items: [{ agentId: 'platform-renamed-agent', selected: false, canUse: true, requireUserSubscription: false }] };
    const unchanged = output(await run([...args, '--enable']));
    assert.equal(unchanged.data.operation, 'unchanged'); assert.equal(unchanged.data.revision, 2);
    records.get('platform-renamed-agent').instructions = 'Local edit';
    assert.equal(output(await run(args)).error.code, 'definition_update_required');
    assert.equal(records.get('platform-renamed-agent').instructions, 'Local edit');
    const updated = output(await run([...args, '--update']));
    assert.equal(updated.data.operation, 'updated'); assert.equal(updated.data.revision, 3); assert.equal(updated.data.enabled, true);
    assert.equal(records.get('platform-renamed-agent').instructions, sample.definition.instructions);
    assert.ok(server.hits.filter(hit => hit.url.startsWith('/api/')).every(hit => hit.method === 'GET'));
    assert.equal(server.hits.some(hit => hit.url.includes('/workspaces/register') || hit.url.includes('/directories/create')), false);
  }
});

test('dynamic preparation preserves state when selection, workspace or validation capabilities cannot be resolved', async t => {
  const { f, records, state, server, run } = await definitions(t, { selectedAgentId: null });
  const file = join(f.directory, 'project-definition.json');
  writeFileSync(file, JSON.stringify({ ...sample, definition: { ...sample.definition, workspace: { kind: 'registered', id: 'registered' } } }));
  const args = ['prepare', '--file', file];
  assert.equal(output(await run(args)).error.code, 'agent_selection_required');
  state.selectedAgentId = 'selected'; state.workspaces = [];
  assert.equal(output(await run(args)).error.code, 'workspace_unavailable');
  state.supportsDefinitionValidation = false;
  assert.equal(output(await run(args)).error.code, 'unsupported_runtime');
  assert.equal(records.size, 0); assert.equal(server.hits.some(hit => hit.method !== 'GET'), false);
});

test('a lost dynamic creation receipt retains the resolved identity and never enables or creates again', async t => {
  const { f, records, state, server, run } = await definitions(t);
  const file = join(f.directory, 'project-definition.json');
  writeFileSync(file, JSON.stringify({ ...sample, definition: { ...sample.definition, workspace: { kind: 'registered', id: 'registered' }, nativeTools: [] } }));
  state.lose = true;
  const failed = output(await run(['prepare', '--file', file, '--enable']));
  assert.equal(failed.error.code, 'outcome_unknown'); assert.equal(failed.error.details.agentId, state.selectedAgentId);
  assert.equal(records.size, 1); assert.equal(records.get(state.selectedAgentId).enabled, false);
  assert.equal(server.hits.filter(hit => hit.url === root && hit.method === 'POST').length, 1);
  assert.equal(server.hits.some(hit => hit.url === root + '/enabled'), false);
});

test('service exclusions round trip and legacy imports preserve target exclusions', () => {
  const file = exportDefinition({ ...empty, disabledAssistantTools: ['service_schedule_create'] }, []);
  assert.deepEqual(definitionFileChanges(readDefinitionFile(JSON.parse(JSON.stringify(file))), empty, []).changes.disabledAssistantTools, ['service_schedule_create']);
  const legacy = exportDefinition(empty, []);
  assert.equal(Object.hasOwn(definitionFileChanges(legacy, { ...empty, disabledAssistantTools: ['service_schedule_create'] }, []).changes, 'disabledAssistantTools'), false);
  assert.throws(() => readDefinitionFile({ ...file, definition: { ...file.definition, disabledAssistantTools: ['service_a', 'service_a'] } }));
});
