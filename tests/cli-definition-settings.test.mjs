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

async function definitions(t, options = {}) {
  const f = fixture(t), records = new Map(), state = { maxDefinitionBytes: 16777216, supportsDefinitionStatusUpdate: true, inheritance: true, lose: false, ...options };
  const server = await mockServer(t, (hit, res) => {
    if (hit.url === root + '/limits') return respond(res, { maxDefinitionBytes: state.maxDefinitionBytes, supportsDefinitionStatusUpdate: state.supportsDefinitionStatusUpdate });
    if (hit.url === root + '/options') return respond(res, { workspaces: [{ id: 'registered', cwd: '/same', agentPresets: ['standard'] }], presets: ['standard'], models: {},
      maxDefinitionBytes: state.maxDefinitionBytes, supportsNativeToolInheritanceReset: state.inheritance });
    if (hit.url === root + '/summaries') return respond(res, { canManage: true, items: [...records.values()].map(({ agentId, revision, name, enabled }) => ({ agentId, revision, name, enabled })) });
    if (hit.url.startsWith(root + '/items/')) {
      const item = records.get(decodeURIComponent(hit.url.split('/').at(-1)));
      return respond(res, item ?? { error: 'AGENT_DEFINITION_NOT_FOUND' }, item ? 200 : 404);
    }
    if (hit.url === root && hit.method === 'GET') throw new Error('Modern CLI must not download the full list');
    if (hit.method !== 'POST' || ![root, root + '/enabled'].includes(hit.url)) return respond(res, { error: 'NOT_FOUND' }, 404);
    const body = hit.json(), old = records.get(body.agentId), statusOnly = hit.url.endsWith('/enabled');
    if (body.revision !== (old?.revision ?? null)) return respond(res, { error: 'AGENT_DEFINITION_CONFLICT' }, 409);
    if (statusOnly) assert.deepEqual(Object.keys(body).sort(), ['agentId', 'enabled', 'revision']);
    else if (hit.body.length > state.maxDefinitionBytes) return respond(res, { error: 'INVALID_AGENT_DEFINITION' }, 413);
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

test('lightweight status keeps a large definition stoppable after limit decreases and never replays unknown writes', async t => {
  const { records, state, server, run } = await definitions(t, { maxDefinitionBytes: 100 });
  records.set('large', { ...empty, agentId: 'large', revision: 6, enabled: true, instructions: '字'.repeat(10000) });
  const stopped = output(await run(['disable', 'large', '--expected-revision', '6']));
  assert.equal(stopped.data.enabled, false); assert.equal(records.get('large').instructions.length, 10000);
  assert.deepEqual(server.hits.map(hit => hit.url), [root + '/limits', root + '/enabled']);
  const conflict = output(await run(['enable', 'large', '--expected-revision', '6']));
  assert.equal(conflict.error.code, 'conflict'); assert.equal(records.get('large').revision, 7);
  state.lose = true;
  const unknown = output(await run(['enable', 'large', '--expected-revision', '7']));
  assert.equal(unknown.error.code, 'outcome_unknown'); assert.equal(records.get('large').revision, 8);
  assert.equal(server.hits.filter(hit => hit.method === 'POST').length, 3);
  assert.equal(output(await run(['show', 'large'])).data.revision, 8);
  assert.equal(server.hits.at(-1).url, root + '/items/large');
});

test('UTF-8 input and complete serialized save boundaries apply to inline, file and stdin while patches preserve other fields', async t => {
  const { f, records, state, server, run } = await definitions(t);
  const content = { instructions: '中文\n"\\'.repeat(30), nativeTools: null };
  const body = { ...empty, agentId: 'boundary', revision: null, ...content, name: 'Boundary' };
  state.maxDefinitionBytes = Buffer.byteLength(JSON.stringify(body), 'utf8');
  const create = output(await run(['create', '--agent-id', 'boundary', '--name', 'Boundary', ...inline(content)]));
  assert.equal(create.ok, true, JSON.stringify(create));
  assert.equal(server.hits.at(-1).body.length, state.maxDefinitionBytes);
  const requestBytes = server.hits.at(-1).body.length;
  state.maxDefinitionBytes = requestBytes - 1;
  const tooLarge = output(await run(['create', '--agent-id', 'boundary', '--name', 'Boundary', ...inline(content)]));
  assert.equal(tooLarge.error.code, 'definition_too_large'); assert.equal(records.get('boundary').revision, 1);
  state.maxDefinitionBytes = 4096;
  const path = join(f.directory, 'patch.json');
  writeFileSync(path, JSON.stringify({ instructions: '新指令' }));
  records.get('boundary').assistantTools = sample.definition.assistantTools;
  assert.equal(output(await run(['update', 'boundary', '--expected-revision', '1', '--values-json', path])).ok, true);
  assert.deepEqual(records.get('boundary').assistantTools, sample.definition.assistantTools);
  assert.equal(output(await run(['update', 'boundary', '--expected-revision', '2', '--values-json', '-'], { stdin: Readable.from(['{"nativeTools":', '[]}']) })).ok, true);
  assert.deepEqual(records.get('boundary').nativeTools, []);
  state.maxDefinitionBytes = 24;
  for (const args of [inline({ instructions: '字'.repeat(20) }), ['--values-json', '-']]) {
    const result = output(await run(['update', 'boundary', '--expected-revision', '3', ...args], { stdin: Readable.from([JSON.stringify({ instructions: '字'.repeat(20) })]) }));
    assert.equal(result.ok, false); assert.match(result.error.code, /input_too_large/);
  }
  const writes = server.hits.filter(hit => hit.method === 'POST').length;
  state.maxDefinitionBytes = 4096;
  assert.equal(output(await run(['update', 'boundary', '--expected-revision', '3', '--values-json', '-'], { stdin: Readable.from([Buffer.from([0xff])]) })).error.code, 'invalid_arguments');
  assert.equal(server.hits.filter(hit => hit.method === 'POST').length, writes);
});

test('files larger than 32 MiB use dynamic write limits; single reads and exports remain available when that limit drops', async t => {
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
  const rejected = output(await run(['update', 'large', '--expected-revision', '1', ...inline({ name: 'Rename' })]));
  assert.equal(rejected.error.code, 'definition_too_large'); assert.equal(records.get('large').name, 'Large');
});

test('page exchange file import/export preserves identity, revision, enabled state, fields and inheritance without changing usage relations', async t => {
  const { f, records, state, server, run } = await definitions(t);
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
  state.inheritance = false;
  records.get(id).nativeTools = ['keep-tool'];
  const unmatched = structuredClone(sample); unmatched.definition.workspace = { kind: 'registered', id: 'registered', path: '/different' };
  writeFileSync(path, JSON.stringify(unmatched));
  const preserved = output(await run(['import', '--agent-id', id, '--expected-revision', '2', '--file', path]));
  assert.equal(preserved.data.warnings.length, 2);
  assert.deepEqual(records.get(id).nativeTools, ['keep-tool']); assert.equal(records.get(id).workspacePath, sample.definition.workspace.path);
  assert.ok(server.hits.every(hit => hit.url.startsWith(root)));
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
