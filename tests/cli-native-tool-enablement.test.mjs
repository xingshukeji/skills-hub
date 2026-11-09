import test from 'node:test';
import assert from 'node:assert/strict';
import { definitionFileChanges, exportDefinition, readDefinitionFile } from '../src/xrain-cli/definition-file.mjs';
import { fixture, mockServer, respond } from './helpers.mjs';

test('legacy disabled tool exports preserve the effective empty selection without a switch', () => {
  const source = { name: 'Fixture', enabled: false, instructions: 'Keep instructions', provider: '', model: '', agentPreset: 'standard', workspaceId: null,
    nativeTools: ['read'], nativeToolsEnabled: false, assistantTools: [] };
  const file = readDefinitionFile(exportDefinition(source, []));
  const changes = definitionFileChanges(file, source, [], true).changes;
  assert.equal(changes.nativeToolsEnabled, undefined);
  assert.deepEqual(changes.nativeTools, []);
  assert.throws(() => readDefinitionFile({ ...file, definition: { ...file.definition, nativeToolsEnabled: 'false' } }));
});

test('CLI tool updates save exact arrays, reject the old switch and preserve other fields', async t => {
  const f = fixture(t);
  let current = { aiUserId: '', agentId: 'fixed', name: 'Fixture', revision: 1, enabled: true, instructions: 'Keep instructions', provider: 'p', model: 'm',
    workspaceId: 'work', agentPreset: 'standard', nativeTools: ['read'], assistantTools: [] };
  const service = await mockServer(t, (hit, res) => {
    if (hit.method === 'GET') return respond(res, current);
    const body = hit.json(); assert.equal(body.revision, current.revision);
    current = { ...body, revision: current.revision + 1 }; return respond(res, current);
  });
  f.profile(service.url, 'tenant', 'synthetic');
  for (const nativeTools of [[], ['read']]) {
    const result = await f.run(['agent', 'tool', 'set', 'fixed', '--runtime', service.url, '--expected-revision', String(current.revision), '--values', JSON.stringify({ nativeTools }), '--json']);
    assert.equal(result.code, 0, result.stdout);
    assert.deepEqual(JSON.parse(result.stdout).data.nativeTools, nativeTools);
    assert.equal(current.instructions, 'Keep instructions'); assert.equal(current.enabled, true);
  }
  const revision = current.revision;
  const rejected = await f.run(['agent', 'tool', 'set', 'fixed', '--runtime', service.url, '--expected-revision', String(revision), '--values', JSON.stringify({ nativeToolsEnabled: false }), '--json']);
  assert.notEqual(rejected.code, 0); assert.equal(current.revision, revision);
});
