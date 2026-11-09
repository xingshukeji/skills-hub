import test from 'node:test';
import assert from 'node:assert/strict';
import { definitionFileChanges, exportDefinition, readDefinitionFile } from '../src/xrain-cli/definition-file.mjs';
import { fixture, mockServer, respond } from './helpers.mjs';

test('definition files retain an independent disabled switch and selection through import and export', () => {
  const source = { name: 'Fixture', enabled: false, instructions: 'Keep instructions', provider: '', model: '', agentPreset: 'standard', workspaceId: null,
    nativeTools: ['read'], nativeToolsEnabled: false, assistantTools: [] };
  const file = readDefinitionFile(exportDefinition(source, []));
  const changes = definitionFileChanges(file, source, [], true).changes;
  assert.equal(changes.nativeToolsEnabled, false);
  assert.deepEqual(changes.nativeTools, ['read']);
  assert.throws(() => readDefinitionFile({ ...file, definition: { ...file.definition, nativeToolsEnabled: 'false' } }));
});

test('CLI tool updates toggle the group without clearing the stored choices or changing other fields', async t => {
  const f = fixture(t);
  let current = { aiUserId: '', agentId: 'fixed', name: 'Fixture', revision: 1, enabled: true, instructions: 'Keep instructions', provider: 'p', model: 'm',
    workspaceId: 'work', agentPreset: 'standard', nativeTools: ['read'], assistantTools: [] };
  const service = await mockServer(t, (hit, res) => {
    if (hit.method === 'GET') return respond(res, current);
    const body = hit.json(); assert.equal(body.revision, current.revision);
    current = { ...body, revision: current.revision + 1 }; return respond(res, current);
  });
  f.profile(service.url, 'tenant', 'synthetic');
  for (const enabled of [false, true]) {
    const result = await f.run(['agent', 'tool', 'set', 'fixed', '--runtime', service.url, '--expected-revision', String(current.revision), '--values', JSON.stringify({ nativeToolsEnabled: enabled }), '--json']);
    assert.equal(result.code, 0, result.stdout);
    assert.equal(JSON.parse(result.stdout).data.nativeToolsEnabled, enabled);
    assert.deepEqual(current.nativeTools, ['read']); assert.equal(current.instructions, 'Keep instructions'); assert.equal(current.enabled, true);
  }
});
