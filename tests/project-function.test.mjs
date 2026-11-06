import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import vm from 'node:vm';
import { fixture, mockServer, respond, PACKAGE_ID, VERSION_ID } from './helpers.mjs';
import { expectedDifferences } from '../src/xrain-cli/project-function.mjs';

const key = 'tenant.sealed.price';
const sourceText = 'function(ctx) { return { status: "ready", amount: ctx.input.amount + 2, questions: [] }; }';
const contract = { schemaVersion: 1, input: { type: 'object', fields: [{ name: 'amount', type: 'number', required: true, description: '' }] },
  output: { type: 'object', fields: [{ name: 'status', type: 'string', required: true, description: '' },
    { name: 'amount', type: 'number', required: true, description: '' }, { name: 'questions', type: 'array', required: true, description: '', items: { type: 'string' } }] } };
function setup(t) {
  const f = fixture(t), root = join(f.directory, 'project'); mkdirSync(root);
  const put = (name, value) => writeFileSync(join(root, name), JSON.stringify(value));
  put('xrain-project.json', { schemaVersion: 1, package: { packageId: PACKAGE_ID, namespace: 'myapp', label: 'Example', baseVersion: '1.0.0', releaseVersionId: VERSION_ID },
    records: [], tenantFunctions: [{ definition: 'definition.json', script: { mode: 'frozen', file: 'source.json' }, contract: 'contract.json' }] });
  put('definition.json', { key, label: 'Price', isActive: true }); put('source.json', sourceText); put('contract.json', contract);
  put('cases.json', { schemaVersion: 1, cases: [{ name: 'zero', input: { amount: 0 }, expected: { status: 'ready', amount: 2, questions: [] } },
    { name: 'positive', input: { amount: 3 }, expected: { amount: 5 } }] });
  return { ...f, root, put, runFunction(action, extra = []) { return f.run(['project', 'function', action, '--project', root, '--key', key, '--auth', 'session', '--json', ...extra]); } };
}
async function server(t, f, options = {}) {
  let source = options.source ?? null, versions = options.versions ?? [];
  const s = await mockServer(t, (hit, res) => {
    assert.equal(hit.headers.authorization, 'Bearer function-session');
    if (hit.url === '/api/service/authen/v1/account/context') return respond(res, { tenantId: 'tenant-demo', userId: 'publisher', scope: 'tenant' });
    if (hit.url === '/api/orchestration/v1/functions' && hit.method === 'GET') return respond(res, source ? [source] : []);
    if (hit.url === '/api/orchestration/v1/functions' && hit.method === 'POST') {
      if (options.rejectCreate) return respond(res, { errorCode: 'platform.integration.http_request.invalid', detail: 'Tenant function keys must use the tenant.<name> prefix.' }, 400);
      source = { ...hit.json(), id: 'function-1', tenantId: 'tenant-demo', isSystem: false };
      if (options.unknownCreate) { res.destroy(); return; }
      return respond(res, source, 201);
    }
    if (hit.url === '/api/orchestration/v1/functions/function-1' && hit.method === 'PUT') {
      source = { ...source, ...hit.json() }; return respond(res, source);
    }
    if (hit.url === '/api/xrain/v1/functions/function-1/versions') {
      if (hit.method === 'GET') return respond(res, versions);
      const version = { id: 'version-' + (versions.length + 1), functionId: 'function-1', source: options.racingSource ?? source.source, contractJson: source.contractJson };
      versions.push(version); return respond(res, version);
    }
    if (hit.url.startsWith('/api/xrain/v1/function-versions/') && hit.url.endsWith(':test')) {
      if (options.deniedTest) return respond(res, { errorCode: 'test.denied' }, 403);
      const version = versions.find(v => hit.url.includes('/' + v.id + ':'));
      return respond(res, vm.runInNewContext('(' + version.source + ')')({ input: hit.json().input }));
    }
    assert.fail('Unexpected request ' + hit.method + ' ' + hit.url);
  });
  f.profile(s.url); f.store.saveSession('Demo', s.url, 'tenant-demo', 'function-session', Date.now() + 300000);
  return { ...s, getSource: () => source, getVersions: () => versions };
}
function existing(overrides = {}) { return { key, label: 'Price', helpText: null, signature: null, isActive: true, id: 'function-1', tenantId: 'tenant-demo', isSystem: false, source: sourceText, contractJson: contract, ...overrides }; }

test('publish current project source, reuse its version and test business cases without app or record writes', async t => {
  const f = setup(t), s = await server(t, f);
  const first = await f.runFunction('publish'); assert.equal(first.code, 0, first.stdout);
  const receipt = JSON.parse(first.stdout).data;
  assert.equal(receipt.versionId, 'version-1'); assert.equal(receipt.selectionChanged, false);
  assert.equal(JSON.parse(readFileSync(receipt.functionInput)).source, sourceText);
  assert.equal(receipt.reused, false);
  const second = JSON.parse((await f.runFunction('publish')).stdout).data;
  assert.equal(second.reused, true); assert.equal(s.getVersions().length, 1);
  const tested = await f.runFunction('test', ['--version-id', receipt.versionId, '--cases', 'cases.json']);
  assert.equal(tested.code, 0, tested.stdout); assert.equal(JSON.parse(tested.stdout).data.passed, 2);
  assert.equal(JSON.parse(tested.stdout).data.matchesProject, true);
  assert.equal(s.hits.filter(h => h.method === 'POST' && h.url.endsWith('/functions')).length, 1);
});

test('changed source updates the same identity and produces a new exact immutable version', async t => {
  const f = setup(t), s = await server(t, f, { source: existing(), versions: [{ id: 'version-1', functionId: 'function-1', source: sourceText, contractJson: contract }] });
  f.put('source.json', sourceText.replace('+ 2', '+ 4'));
  const refused = await f.runFunction('publish'); assert.equal(JSON.parse(refused.stdout).error.code, 'function_update_required');
  assert.equal(s.getSource().source, sourceText); assert.equal(s.getVersions().length, 1);
  const result = await f.runFunction('publish', ['--update']); assert.equal(result.code, 0, result.stdout);
  assert.equal(JSON.parse(result.stdout).data.versionId, 'version-2'); assert.equal(s.getSource().id, 'function-1');
  assert.equal(s.getVersions()[0].source, sourceText);
  assert.equal(s.hits.filter(h => h.method === 'PUT').length, 1);
});

test('update refusal names the target and exact definition changes in JSON and human output without any platform write', async t => {
  const f = setup(t), remoteContract = structuredClone(contract);
  remoteContract.input.fields[0].required = false;
  remoteContract.input.fields[0].example = 'tenant-only';
  const before = existing({ label: 'Tenant Price', helpText: '租户说明', signature: 'tenant signature', isActive: false,
    source: sourceText.replace('+ 2', '+ 3'), contractJson: remoteContract });
  const s = await server(t, f, { source: before });
  const refusal = await f.runFunction('publish'); assert.equal(refusal.code, 1);
  const error = JSON.parse(refusal.stdout).error;
  assert.equal(error.code, 'function_update_required');
  for (const value of ['tenant-demo', s.url, 'Tenant Price', key, '本次未向平台写入']) assert.ok(error.message.includes(value), value);
  for (const value of ['--update', '本地项目定义', '目标租户', '创建或复用', '不会自动切换应用选版', '宿主配置', '业务记录', '停用会使已关联应用的当前调用不可用', '旧不可变版本内容不变']) assert.ok(error.hint.includes(value), value);
  assert.equal(error.details.functionName, 'Tenant Price'); assert.equal(error.details.writePerformed, false);
  assert.equal(error.details.updateDirection, 'project_to_tenant');
  assert.deepEqual(error.details.updateImpact, { functionSource: 'replace_definition', version: 'create_or_reuse', activeStateAppliedFromProject: true, applicationSelectionChanged: false, hostConfigurationChanged: false, businessRecordsChanged: false });
  const diffs = Object.fromEntries(error.details.differences.map(item => [item.field, item]));
  assert.deepEqual(Object.keys(diffs), ['label', 'helpText', 'signature', 'isActive', 'source', 'contractJson']);
  assert.equal(diffs.label.current, 'Tenant Price'); assert.equal(diffs.label.project, 'Price');
  assert.equal(diffs.isActive.current, false); assert.equal(diffs.isActive.project, true);
  assert.equal(diffs.source.firstDifferingLine, 1); assert.notEqual(diffs.source.current.sha256, diffs.source.project.sha256);
  assert.equal(diffs.source.project.bytes, Buffer.byteLength(sourceText));
  assert.deepEqual(diffs.contractJson.changes, [
    { path: 'contractJson["input"]["fields"][0]["example"]', current: 'tenant-only', projectMissing: true },
    { path: 'contractJson["input"]["fields"][0]["required"]', current: false, project: true },
  ]);
  assert.ok(!refusal.stdout.includes(sourceText), 'source contents are summarized, not dumped');
  const plain = await f.run(['project', 'function', 'publish', '--project', f.root, '--key', key, '--auth', 'session']);
  assert.equal(plain.code, 1);
  for (const value of ['tenant-demo', 'Tenant Price', '本次未向平台写入', '--update', 'firstDifferingLine']) assert.ok(plain.stderr.includes(value), value);
  assert.deepEqual(s.getSource(), before); assert.deepEqual(s.getVersions(), []);
  assert.ok(s.hits.every(hit => hit.method === 'GET'), 'both refusal formats must be produced before platform mutation');
});

test('unknown source creation and racing version receipts stop without replay or selecting a version', async t => {
  for (const options of [{ unknownCreate: true }, { racingSource: 'function(ctx) { return 999; }' }]) {
    const f = setup(t), s = await server(t, f, options);
    const result = await f.runFunction('publish'); assert.equal(result.code, 1);
    const error = JSON.parse(result.stdout).error; assert.equal(error.code, options.unknownCreate ? 'outcome_unknown' : 'function_source_changed');
    if (options.racingSource) assert.equal(error.details.versionId, 'version-1');
    assert.equal(error.details.key, key); assert.ok(error.details.assembly);
    assert.equal(s.hits.filter(h => h.url.endsWith('/functions') && h.method === 'POST').length, 1);
    assert.ok(!s.hits.some(h => h.url.includes('/applications/')));
  }
});

test('foreign and system functions cannot be overwritten', async t => {
  for (const overrides of [{ tenantId: 'other' }, { isSystem: true }]) {
    const f = setup(t), s = await server(t, f, { source: existing(overrides) });
    assert.equal((await f.runFunction('publish')).code, 1);
    assert.ok(s.hits.every(h => h.method === 'GET'));
  }
});

test('an older platform refusing a protected key preserves the refusal without renaming or creating a version', async t => {
  const f = setup(t), s = await server(t, f, { rejectCreate: true });
  const result = await f.runFunction('publish'); assert.equal(result.code, 1);
  const error = JSON.parse(result.stdout).error;
  assert.equal(error.httpStatus, 400); assert.equal(error.serverCode, 'platform.integration.http_request.invalid');
  assert.equal(error.details.key, key); assert.equal(error.details.stage, 'create-source');
  assert.equal(s.hits.filter(h => h.method !== 'GET').length, 1); assert.equal(s.getVersions().length, 0);
});

test('case assertions expose incorrect money, empty arrays and missing fields with a failing exit', async t => {
  const f = setup(t); await server(t, f, { source: existing(), versions: [{ id: 'version-1', functionId: 'function-1', source: sourceText, contractJson: contract }] });
  f.put('cases.json', { schemaVersion: 1, cases: [{ name: 'bad expectation', input: { amount: 0 }, expected: { amount: 3, absent: false } }] });
  const result = await f.runFunction('test', ['--version-id', 'version-1', '--cases', 'cases.json']);
  assert.equal(result.code, 1); const report = JSON.parse(result.stdout).data;
  assert.equal(report.failed, 1); assert.equal(report.cases[0].differences[0].path, '$.amount');
  assert.equal(report.cases[0].differences[1].missing, true);
  assert.equal(expectedDifferences({ q: [1] }, { q: [] }).length, 1);
});

test('test validates all cases before requests, binds versions to the function, and preserves access failure', async t => {
  const f = setup(t), s = await server(t, f, { source: existing(), versions: [{ id: 'wrong', functionId: 'other', source: sourceText, contractJson: contract }] });
  f.put('invalid.json', { schemaVersion: 1, cases: [{ name: 'weak', input: {}, expected: {} }] });
  assert.equal((await f.runFunction('test', ['--version-id', 'wrong', '--cases', 'invalid.json'])).code, 1); assert.equal(s.hits.length, 0);
  assert.equal((await f.runFunction('test', ['--version-id', 'wrong', '--cases', 'cases.json'])).code, 1);
  assert.ok(s.hits.every(h => h.method === 'GET'));
  const g = setup(t), denied = await server(t, g, { source: existing(), versions: [{ id: 'version-1', functionId: 'function-1', source: sourceText, contractJson: contract }], deniedTest: true });
  const result = await g.runFunction('test', ['--version-id', 'version-1', '--cases', 'cases.json']);
  assert.equal(JSON.parse(result.stdout).error.code, 'permission_denied');
  assert.equal(denied.hits.filter(h => h.method === 'POST').length, 1);
});

test('the independently copied bundled CLI publishes and tests without repository runtime imports', async t => {
  const f = setup(t), s = await server(t, f);
  const binary = join(f.directory, 'xrain-cli.mjs');
  copyFileSync(new URL('../skills/shzw-xrain-cli/scripts/xrain-cli.mjs', import.meta.url), binary);
  const run = async (action, extra = []) => {
    const { stdout } = await promisify(execFile)(process.execPath, [binary, 'project', 'function', action, '--project', f.root,
      '--key', key, '--auth', 'session', '--json', ...extra], { env: f.env, cwd: f.directory });
    return JSON.parse(stdout);
  };
  const published = await run('publish'); assert.equal(published.ok, true);
  const tested = await run('test', ['--version-id', published.data.versionId, '--cases', 'cases.json']);
  assert.equal(tested.data.passed, 2); assert.equal(s.getVersions().length, 1);
});
