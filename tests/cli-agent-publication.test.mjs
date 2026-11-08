import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { snapshotWorkspace } from '../src/xrain-cli/agent-publication.mjs';
import { applicationAgentIdentity } from '../src/xrain-cli/agent-target.mjs';
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
test('application binding identity follows the real qualifications DTO rather than personal subscription selection', () => {
  const item = agentId => ({ agentId, selected: false, canUse: true, approvalStatus: null, requireUserSubscription: false });
  const selection = { applicationId: 'app', defaultAgentId: 'default', items: [item('other'), item('default')] };
  assert.equal(applicationAgentIdentity(selection, 'app'), 'default');
  assert.equal(applicationAgentIdentity({ ...selection, defaultAgentId: null, items: [item('only')] }, 'app'), 'only');
  assert.throws(() => applicationAgentIdentity({ ...selection, defaultAgentId: null }, 'app'), error => error.code === 'agent_selection_required');
  assert.throws(() => applicationAgentIdentity(selection, 'other-app'), error => error.code === 'invalid_response');
});
function inputs(f) {
  const source = join(f.directory, 'source'), file = join(f.directory, 'definition.json');
  mkdirSync(source); writeFileSync(join(source, 'guide.txt'), 'workspace'); writeFileSync(file, JSON.stringify(exchange));
  return ['agent', 'publish', '--agent-id', 'fixed', '--file', file, '--source', source, '--workspace-path', '/target', '--json'];
}
test('publication does not replay a workspace write with a lost receipt and retains the exact recovery identity', async t => {
  const f = fixture(t), args = inputs(f);
  const service = await mockServer(t, (hit, res) => {
    if (hit.url.endsWith('/options')) return respond(res, { workspaces: [], supportsWorkspacePublication: true, supportsWorkspacePublicationPreconditions: true, supportsDefinitionValidation: true, supportsNativeToolInheritanceReset: true });
    if (hit.url.endsWith('/items/fixed')) return respond(res, { error: 'AGENT_DEFINITION_NOT_FOUND' }, 404);
    if (hit.url.endsWith('/workspace-publication/check')) {
      const body = hit.json(); return respond(res, { agentId: body.agentId, digest: body.digest, path: body.path, checked: true, exists: false, files: body.files.length, written: ['guide.txt'], removed: [], createdDirectories: [], previousDigest: null });
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
    if (hit.url.endsWith('/options')) return respond(res, { workspaces: [], supportsWorkspacePublication: true, supportsWorkspacePublicationPreconditions: true, supportsDefinitionValidation: true, supportsNativeToolInheritanceReset: true });
    if (hit.url.endsWith('/items/fixed')) return respond(res, { error: 'AGENT_DEFINITION_NOT_FOUND' }, 404);
    if (hit.url.includes('/workspace-publication')) {
      const body = hit.json(), check = hit.url.endsWith('/check');
      return respond(res, { agentId: body.agentId, digest: body.digest, path: body.path, checked: check, exists: !check, files: body.files.length, written: ['guide.txt'], removed: [], createdDirectories: [], previousDigest: null });
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

test('publication preserves a valid target registered binding when the source uses a different machine reference', async t => {
  const f = fixture(t), args = inputs(f), index = args.indexOf('--workspace-path'); args.splice(index, 2);
  const file = args[args.indexOf('--file') + 1], source = structuredClone(exchange);
  source.definition.workspace = { kind: 'registered', id: 'source-only', path: '/source-machine' }; writeFileSync(file, JSON.stringify(source));
  const current = { ...source.definition, agentId: 'fixed', revision: 4, workspaceId: 'target-workspace', enabled: true,
    nativeTools: source.definition.nativeTools ?? undefined };
  const service = await mockServer(t, (hit, res) => {
    if (hit.url.endsWith('/options')) return respond(res, { workspaces: [{ id: 'target-workspace', cwd: '/actual-target', agentPresets: [current.agentPreset] }],
      supportsWorkspacePublication: true, supportsWorkspacePublicationPreconditions: true, supportsDefinitionValidation: true, supportsNativeToolInheritanceReset: true });
    if (hit.url.endsWith('/items/fixed')) return respond(res, current);
    if (hit.url.endsWith('/workspace-publication/check')) {
      const body = hit.json(); assert.equal(body.path, '/actual-target');
      return respond(res, { agentId: body.agentId, digest: body.digest, path: body.path, checked: true, exists: true,
        files: body.files.length, written: [], removed: [], createdDirectories: [], previousDigest: body.digest });
    }
    assert.ok(hit.url.endsWith('/validate'));
    assert.deepEqual(hit.json().workspaceChange, { operation: 'bind', workspaceId: 'target-workspace', agentPreset: current.agentPreset });
    return respond(res, { valid: true, agentId: 'fixed', revision: 4 });
  });
  f.profile(service.url, 'tenant', 'synthetic');
  const result = await f.run([...args, '--runtime', service.url, '--check']);
  assert.equal(result.code, 0, result.stdout); assert.equal(JSON.parse(result.stdout).data.definitionValidated, true);
  assert.equal(service.hits.some(hit => hit.url.endsWith('/workspace-publication')), false);
});

test('publication carries the observed workspace digest and stops on a concurrent file publication', async t => {
  const f = fixture(t), args = inputs(f), observed = 'a'.repeat(64);
  const service = await mockServer(t, (hit, res) => {
    if (hit.url.endsWith('/options')) return respond(res, { workspaces: [], supportsWorkspacePublication: true, supportsWorkspacePublicationPreconditions: true, supportsDefinitionValidation: true, supportsNativeToolInheritanceReset: true });
    if (hit.url.endsWith('/items/fixed')) return respond(res, { error: 'AGENT_DEFINITION_NOT_FOUND' }, 404);
    if (hit.url.endsWith('/validate')) return respond(res, { valid: true, agentId: 'fixed', revision: null });
    if (hit.url.endsWith('/workspace-publication/check')) {
      const body = hit.json(); return respond(res, { agentId: body.agentId, digest: body.digest, path: body.path, checked: true, exists: true,
        files: body.files.length, written: ['guide.txt'], removed: [], createdDirectories: [], previousDigest: observed });
    }
    assert.ok(hit.url.endsWith('/workspace-publication')); assert.equal(hit.json().expectedDigest, observed);
    return respond(res, { error: 'WORKSPACE_PUBLICATION_CONFLICT' }, 409);
  });
  f.profile(service.url, 'tenant', 'synthetic');
  const result = await f.run([...args, '--runtime', service.url]);
  assert.equal(JSON.parse(result.stdout).error.serverCode, 'WORKSPACE_PUBLICATION_CONFLICT');
  assert.equal(service.hits.filter(hit => hit.url.endsWith('/workspace-publication')).length, 1);
  assert.equal(service.hits.some(hit => hit.url === '/v1/dsh/agent-definitions' || hit.url.endsWith('/enabled')), false);
});

test('tool inspection keeps saved choices and independent catalogs when a draft has no workspace or one catalog fails', async t => {
  const f = fixture(t), current = { agentId: 'fixed', revision: 7, enabled: false, name: 'Draft', agentPreset: '', nativeTools: [], assistantTools: [] };
  let nativeFails = false, businessFails = false;
  const service = await mockServer(t, (hit, res) => {
    if (hit.method === 'GET') return respond(res, current);
    if (hit.url.endsWith('/tools/native')) return nativeFails ? respond(res, { error: 'NATIVE_OFFLINE' }, 503) : respond(res, { items: [{ name: 'read_file' }] });
    assert.ok(hit.url.endsWith('/tools/business'));
    return businessFails ? respond(res, { error: 'BUSINESS_FORBIDDEN' }, 403) : respond(res, { items: [{ tool: { name: 'lookup' } }] });
  });
  f.profile(service.url, 'tenant', 'synthetic');
  const run = async () => { const result = await f.run(['agent', 'tool', 'show', 'fixed', '--runtime', service.url, '--json']); assert.equal(result.code, 0, result.stdout); return JSON.parse(result.stdout).data; };
  let data = await run();
  assert.equal(data.complete, false); assert.equal(data.catalogErrors.native.code, 'workspace_unavailable');
  assert.deepEqual(data.nativeTools, []); assert.equal(data.available.business[0].tool.name, 'lookup'); assert.equal(Object.hasOwn(data.available, 'native'), false);
  Object.assign(current, { workspaceDirect: true, workspacePath: '/target', agentPreset: 'standard' }); nativeFails = true;
  data = await run(); assert.equal(data.catalogErrors.native.serverCode, 'NATIVE_OFFLINE'); assert.equal(data.available.business.length, 1);
  nativeFails = false; businessFails = true;
  data = await run(); assert.equal(data.catalogErrors.business.serverCode, 'BUSINESS_FORBIDDEN'); assert.equal(data.available.native[0].name, 'read_file');
  businessFails = false; data = await run(); assert.equal(data.complete, true); assert.equal(data.catalogErrors, undefined);
  assert.equal(current.revision, 7); assert.deepEqual(current.nativeTools, []);
});

test('an old publication Runtime is rejected before any workspace mutation', async t => {
  const f = fixture(t), args = inputs(f);
  const service = await mockServer(t, (hit, res) => {
    assert.ok(hit.url.endsWith('/options'));
    return respond(res, { workspaces: [], supportsWorkspacePublication: true, supportsDefinitionValidation: true });
  });
  f.profile(service.url, 'tenant', 'synthetic');
  const result = await f.run([...args, '--runtime', service.url]);
  assert.equal(JSON.parse(result.stdout).error.code, 'unsupported_runtime'); assert.equal(service.hits.length, 1);
});
