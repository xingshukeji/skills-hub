import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { snapshotWorkspace } from '../src/xrain-cli/agent-publication.mjs';
import { fixture, mockServer, respond } from './helpers.mjs';

test('workspace snapshots retain hidden skills, binary bytes, empty folders and stable content identity', async t => {
  const f = fixture(t), source = join(f.directory, 'source');
  mkdirSync(join(source, '.agents', 'skills', 'demo'), { recursive: true }); mkdirSync(join(source, 'empty'));
  writeFileSync(join(source, '.agents', 'skills', 'demo', 'SKILL.md'), '完整技能');
  writeFileSync(join(source, 'data.bin'), Buffer.from([0, 255, 42]));
  const first = await snapshotWorkspace(source), second = await snapshotWorkspace(source);
  assert.equal(first.digest, second.digest); assert.equal(first.files.length, 2);
  assert.deepEqual(Buffer.from(first.files.find(file => file.path === 'data.bin').content, 'base64'), Buffer.from([0, 255, 42]));
  assert.ok(first.directories.includes('empty')); assert.ok(first.files.some(file => file.path === '.agents/skills/demo/SKILL.md'));
  writeFileSync(join(source, '.xrain-state'), 'reserved');
  await assert.rejects(snapshotWorkspace(source), error => error.code === 'invalid_workspace');
});

const exchange = JSON.parse(readFileSync('skills/shzw-xrain-cli/references/examples/definition-file-v1.json', 'utf8'));
function inputs(f) {
  const source = join(f.directory, 'source'), file = join(f.directory, 'definition.json');
  mkdirSync(source); writeFileSync(join(source, 'guide.txt'), 'workspace'); writeFileSync(file, JSON.stringify(exchange));
  return ['agent', 'publish', '--agent-id', 'fixed', '--file', file, '--source', source, '--workspace-path', '/target', '--json'];
}
test('publication does not replay a workspace write with a lost receipt and retains the exact recovery identity', async t => {
  const f = fixture(t), args = inputs(f);
  const service = await mockServer(t, (hit, res) => {
    if (hit.url.endsWith('/options')) return respond(res, { workspaces: [], supportsWorkspacePublication: true, supportsDefinitionValidation: true, supportsNativeToolInheritanceReset: true });
    if (hit.url.endsWith('/items/fixed')) return respond(res, { error: 'AGENT_DEFINITION_NOT_FOUND' }, 404);
    if (hit.url.endsWith('/workspace-publication/check')) {
      const body = hit.json(); return respond(res, { agentId: body.agentId, digest: body.digest, path: body.path, checked: true, exists: false, files: body.files.length, written: ['guide.txt'], removed: [], previousDigest: null });
    }
    assert.ok(hit.url.endsWith('/workspace-publication')); res.destroy();
  });
  f.profile(service.url, 'tenant', 'synthetic');
  const result = await f.run([...args, '--runtime', service.url]);
  const error = JSON.parse(result.stdout).error;
  assert.equal(error.code, 'outcome_unknown'); assert.equal(error.details.agentId, 'fixed');
  assert.equal(error.details.workspacePath, '/target'); assert.equal(error.details.stage, 'workspace');
  assert.equal(error.details.workspacePublished, 'unknown');
  assert.equal(service.hits.filter(hit => hit.url.endsWith('/workspace-publication')).length, 1);
  assert.equal(service.hits.filter(hit => hit.url.endsWith('/validate')).length, 0);
});
test('a definition refusal after file publication reports the partial result and never enables or saves another identity', async t => {
  const f = fixture(t), args = inputs(f);
  const service = await mockServer(t, (hit, res) => {
    if (hit.url.endsWith('/options')) return respond(res, { workspaces: [], supportsWorkspacePublication: true, supportsDefinitionValidation: true, supportsNativeToolInheritanceReset: true });
    if (hit.url.endsWith('/items/fixed')) return respond(res, { error: 'AGENT_DEFINITION_NOT_FOUND' }, 404);
    if (hit.url.includes('/workspace-publication')) {
      const body = hit.json(), check = hit.url.endsWith('/check');
      return respond(res, { agentId: body.agentId, digest: body.digest, path: body.path, checked: check, exists: !check, files: body.files.length, written: ['guide.txt'], removed: [], previousDigest: null });
    }
    assert.ok(hit.url.endsWith('/validate')); return respond(res, { error: 'INVALID_AGENT_DEFINITION', fields: { model: 'Unavailable' } }, 422);
  });
  f.profile(service.url, 'tenant', 'synthetic');
  const result = await f.run([...args, '--runtime', service.url, '--enable']);
  const error = JSON.parse(result.stdout).error;
  assert.equal(error.serverCode, 'INVALID_AGENT_DEFINITION'); assert.equal(error.details.workspacePublished, true);
  assert.equal(error.details.stage, 'definition-validation'); assert.equal(error.details.agentId, 'fixed');
  assert.equal(service.hits.some(hit => hit.url.endsWith('/enabled') || hit.url === '/v1/dsh/agent-definitions'), false);
});
test('tool-only updates preserve other settings and config aliases retain revision checks', async t => {
  const f = fixture(t); let current = { agentId: 'fixed', aiUserId: '', revision: 7, enabled: true, name: 'Keep', instructions: 'Keep instructions',
    provider: 'provider', model: 'model', agentPreset: 'standard', nativeTools: ['read_file'], assistantTools: [] };
  const service = await mockServer(t, (hit, res) => {
    if (hit.method === 'GET') return respond(res, current);
    const body = hit.json(); assert.equal(body.revision, current.revision);
    const { nativeTools, ...rest } = body;
    current = { ...rest, ...(nativeTools === null ? {} : { nativeTools }), revision: body.revision + 1 }; return respond(res, current);
  });
  f.profile(service.url, 'tenant', 'synthetic');
  const run = args => f.run(['agent', ...args, '--runtime', service.url, '--json']);
  assert.equal((await run(['tool', 'set', 'fixed', '--expected-revision', '7', '--values', '{"nativeTools":null}'])).code, 0);
  assert.equal(current.nativeTools, undefined); assert.equal(current.instructions, 'Keep instructions'); assert.equal(current.enabled, true);
  assert.equal((await run(['config', 'update', 'fixed', '--expected-revision', '8', '--values', '{"model":"changed"}'])).code, 0);
  assert.equal(current.model, 'changed'); assert.equal(current.name, 'Keep');
  const stale = await run(['config', 'update', 'fixed', '--expected-revision', '8', '--values', '{"name":"stale"}']);
  assert.equal(JSON.parse(stale.stdout).error.code, 'conflict'); assert.equal(current.name, 'Keep');
  const invalid = await run(['tool', 'set', 'fixed', '--expected-revision', '9', '--values', '{"instructions":"not a tool"}']);
  assert.equal(JSON.parse(invalid.stdout).error.code, 'invalid_arguments');
});
