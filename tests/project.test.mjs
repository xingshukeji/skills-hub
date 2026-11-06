import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, symlinkSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import { assembleProject, projectVersion } from '../src/xrain-cli/project-source.mjs';
import { sha256 } from '../src/xrain-cli/core.mjs';
import { fixture, mockServer, respond, zip, PACKAGE_ID, VERSION_ID } from './helpers.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const encode = value => JSON.stringify(value, null, 2) + '\n';
function put(root, path, value) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), typeof value === 'string' ? value : encode(value));
}
function project(t, extra = {}) {
  const f = fixture(t), root = join(f.directory, 'project');
  const descriptor = { schemaVersion: 1, package: { packageId: PACKAGE_ID, namespace: 'myapp', label: 'Test app', baseVersion: '1.2.3', releaseVersionId: VERSION_ID },
    records: [{ file: 'platform/metadata/status.json' }], tenantFunctions: [], ...extra };
  put(root, 'xrain-project.json', descriptor);
  put(root, '.gitignore', '/.artifacts/\n/.local/\n/node_modules/\n');
  put(root, 'platform/metadata/status.json', { id: '0060123456789abcdefg', kind: 'BizPicklist', values: { name: 'myapp__status', label: 'Status', isActive: true } });
  return { ...f, root, descriptor, save() { put(root, 'xrain-project.json', descriptor); }, runProject(action, options = []) { return f.run(['project', action, '--project', root, '--json', ...options]); } };
}
function modules(f) {
  const esbuild = JSON.parse(readFileSync(join(repository, 'node_modules/esbuild/package.json')));
  put(f.root, 'package.json', { private: true, devDependencies: { esbuild: esbuild.version } });
  put(f.root, 'package-lock.json', { lockfileVersion: 3, packages: { '': { devDependencies: { esbuild: esbuild.version } }, 'node_modules/esbuild': { version: esbuild.version } } });
  mkdirSync(join(f.root, 'node_modules'), { recursive: true });
  symlinkSync(join(repository, 'node_modules/esbuild'), join(f.root, 'node_modules/esbuild'), process.platform === 'win32' ? 'junction' : 'dir');
  put(f.root, 'platform/functions/price/math.mjs', 'export const add = (a,b) => a+b;');
  put(f.root, 'platform/functions/price/index.mjs', "import { add } from './math.mjs'; export function execute(ctx) { return { amount: add(ctx.input.amount, 2) }; }");
  return { mode: 'module', file: 'platform/functions/price/index.mjs', export: 'execute' };
}
async function service(t, f, { fail = false, mismatch = false, metadata = true } = {}) {
  const server = await mockServer(t, (hit, res) => {
    assert.equal(hit.method, 'POST'); assert.equal(hit.url, '/api/application/v1/packages:build');
    assert.equal(hit.headers.authorization, 'Bearer test-project-session');
    if (fail) return respond(res, { errorCode: 'application.invalid_source', message: 'Rejected source.' }, 400);
    const input = hit.json(), digest = sha256(encode(input.records));
    const bytes = zip([['manifest.json', { packageId: input.packageId, versionId: input.versionId, version: input.version, digest }], ['records.json', input.records]]);
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'X-Appkg-Source-Sha256': sha256(hit.body),
      'X-Appkg-File-Sha256': sha256(bytes), 'X-Appkg-Package-Id': input.packageId, 'X-Appkg-Version': input.version,
      ...(metadata ? { 'X-Appkg-Version-Id': mismatch ? 'apv99999999999999999' : input.versionId,
        'X-Appkg-Package-Digest': digest, 'X-Appkg-Builder-Version': '1.0.0', 'X-Appkg-Builder-Digest': 'a'.repeat(64) } : {}) });
    res.end(bytes);
  });
  f.profile(server.url); f.store.saveSession('Demo', server.url, 'tenant-demo', 'test-project-session', Date.now() + 300000);
  return server;
}

test('project init preserves existing files, adds effective ignore rules and invents no business records', async t => {
  const f = fixture(t), root = join(f.directory, 'new');
  put(root, 'README.md', 'owned readme'); put(root, '.gitignore', '*.local');
  const args = ['project', 'init', '--dir', root, '--namespace', 'myapp', '--label', 'My app', '--json'];
  assert.equal((await f.run(args)).code, 0);
  const before = readFileSync(join(root, 'xrain-project.json'));
  assert.equal(JSON.parse(before).records.length, 0);
  assert.equal(JSON.parse(before).tenantFunctions.length, 0);
  assert.equal(readFileSync(join(root, 'README.md'), 'utf8'), 'owned readme');
  assert.match(readFileSync(join(root, '.gitignore'), 'utf8'), /^\*\.local\n/);
  assert.equal((await f.run(args)).code, 1);
  assert.deepEqual(readFileSync(join(root, 'xrain-project.json')), before);
  execFileSync('git', ['init', root], { stdio: 'pipe' });
  assert.match(execFileSync('git', ['-C', root, 'check-ignore', '.artifacts/appkg/a.appkg', '.local/settings.json']).toString(), /a.appkg/);
});

test('candidate identity preserves SemVer metadata and release declarations, with unique parallel candidates', () => {
  assert.match(projectVersion('1.2.3-beta.2+linux.4'), /^1\.2\.3-beta\.2\.dev\.r[a-f0-9]{16}\+linux\.4$/);
  assert.equal(projectVersion('1.2.3+meta', true), '1.2.3+meta');
  assert.equal(new Set(Array.from({ length: 100 }, () => projectVersion('1.0.0'))).size, 100);
  for (const value of ['01.2.3', '1.0.0-01', '1.0.0\n', '1.0', '1.0.0+' + 'x'.repeat(45)]) assert.throws(() => projectVersion(value));
});

test('explicit records, frozen versions and cross-package references are preserved; unrelated files stay out', async t => {
  const f = project(t);
  const original = 'function execute(ctx) {\r\n return { value: "原文" };\r\n}\n';
  put(f.root, 'platform/orchestrations/old/record.json', { id: '0ov0123456789abcdefg', kind: 'BizOrchestrationVersion', values: { refOrchestrationId: '0or0123456789abcdefg', versionNo: 1, inputModel: {} } });
  put(f.root, 'platform/orchestrations/old/source.json', encode(original));
  put(f.root, 'platform/metadata/lookup.json', { id: '0050123456789abcdefg', kind: 'BizField', values: { targetEntityDefinitionId: '00499999999999999999' } });
  put(f.root, 'data/seeds/record.json', { id: '1aa0123456789abcdefg', kind: 'RuntimeRecord', values: { refObjectId: '0040123456789abcdefg', values: { label: 'Seed' } } });
  for (const file of ['data/samples/private.json', 'agents/sales/definition.json', 'backend/service.mjs', 'clients/web/index.ts', '.local/state.json']) put(f.root, file, 'must not enter appkg');
  f.descriptor.records.push({ file: 'platform/orchestrations/old/record.json', script: { mode: 'frozen', file: 'platform/orchestrations/old/source.json' } },
    { file: 'platform/metadata/lookup.json' }, { file: 'data/seeds/record.json' }); f.save();
  const result = await assembleProject(f.root);
  assert.equal(result.source.records.length, 4);
  assert.equal(result.source.records[1].values.source, original);
  assert.equal(result.source.records[2].values.targetEntityDefinitionId, '00499999999999999999');
  assert.equal(result.inputs.list().some(item => /private|definition|service|index|state/.test(item.file)), false);
  assert.notEqual(result.source.versionId, VERSION_ID);
  assert.equal(JSON.parse(readFileSync(join(f.root, 'xrain-project.json'))).package.releaseVersionId, VERSION_ID);
});

test('module compilation shares one source across package functions, tenant functions and orchestration entrypoints', async t => {
  const f = project(t), script = modules(f);
  put(f.root, 'platform/functions/price/record.json', { id: '0of0123456789abcdefg', kind: 'BizOrchestrationFunction', values: { key: 'myapp.price', label: 'Price', isActive: true } });
  put(f.root, 'platform/functions/price/definition.json', { key: 'tenant.price', label: 'Price', isActive: true });
  put(f.root, 'platform/functions/price/contract.json', { input: { type: 'object' }, output: { type: 'object' } });
  put(f.root, 'platform/orchestrations/current.json', { id: '0ov0123456789abcdefg', kind: 'BizOrchestrationVersion', values: { versionNo: 2 } });
  f.descriptor.records.push({ file: 'platform/functions/price/record.json', script, contract: 'platform/functions/price/contract.json' }, { file: 'platform/orchestrations/current.json', script });
  f.descriptor.tenantFunctions.push({ definition: 'platform/functions/price/definition.json', script, contract: 'platform/functions/price/contract.json' }); f.save();
  const result = await assembleProject(f.root);
  assert.equal(result.source.records[1].values.source, result.tenantFunctions[0].source);
  assert.equal(vm.runInNewContext(`(${result.tenantFunctions[0].source})({input:{amount:5}})`).amount, 7);
  assert.equal(vm.runInNewContext(`${result.source.records[2].values.source}; execute({input:{amount:10}})`).amount, 12);
  assert.equal(result.inputs.list().filter(item => item.file.endsWith('math.mjs')).length, 1);
  const output = await f.runProject('assemble'); assert.equal(output.code, 0, output.stdout);
  const receipt = JSON.parse(output.stdout).data;
  assert.equal(receipt.status, 'assembled'); assert.equal(receipt.functions.length, 1);
  assert.match(receipt.functions[0].output, /\.artifacts[\\/]functions[\\/]/);
  assert.equal(JSON.parse(readFileSync(receipt.functions[0].output)).key, 'tenant.price');
});

test('project validation reports duplicates, unknown fields, conflicting source, missing exports and dependency gaps', async t => {
  for (const mutation of [
    f => { f.descriptor.records.push(f.descriptor.records[0]); },
    f => { f.descriptor.recrod = []; },
    f => { f.descriptor.records[0].unknown = true; },
    f => { f.descriptor.records[0].file = '../outside.json'; },
    f => { put(f.root, 'platform/metadata/other.json', JSON.parse(readFileSync(join(f.root, 'platform/metadata/status.json')))); f.descriptor.records.push({ file: 'platform/metadata/other.json' }); },
    f => { const script = modules(f); script.export = 'missing'; put(f.root, 'platform/functions/record.json', { id: '0of0123456789abcdefg', kind: 'BizOrchestrationFunction', values: {} }); f.descriptor.records = [{ file: 'platform/functions/record.json', script }]; },
    f => { put(f.root, 'platform/functions/record.json', { id: '0of0123456789abcdefg', kind: 'BizOrchestrationFunction', values: { source: 'function(ctx){}' } }); f.descriptor.records = [{ file: 'platform/functions/record.json', script: { mode: 'frozen', file: 'unused.json' } }]; },
    f => { put(f.root, 'platform/functions/definition.json', { key: 'tenant.price', label: 'Price' }); put(f.root, 'platform/functions/index.mjs', 'export function execute(ctx){return ctx.input}'); f.descriptor.tenantFunctions = [{ definition: 'platform/functions/definition.json', script: { mode: 'module', file: 'platform/functions/index.mjs', export: 'execute' } }]; },
  ]) await t.test(String(mutation).slice(0, 85), async sub => {
    const f = project(sub); mutation(f); f.save();
    const result = await f.runProject('assemble');
    assert.equal(result.code, 1); assert.equal(existsSync(join(f.root, '.artifacts')), false);
  });
});

test('project build uses fresh source, saves complete metadata and never overwrites repeated or concurrent originals', async t => {
  const f = project(t), server = await service(t, f);
  const build = async () => { const r = await f.runProject('build'); assert.equal(r.code, 0, r.stdout); return JSON.parse(r.stdout).data; };
  const first = await build(), original = readFileSync(first.output);
  const resource = JSON.parse(readFileSync(join(f.root, 'platform/metadata/status.json')));
  resource.values.label = 'Changed'; put(f.root, 'platform/metadata/status.json', resource);
  const next = await Promise.all([build(), build()]);
  assert.equal(new Set([first.versionId, ...next.map(item => item.versionId)]).size, 3);
  assert.deepEqual(readFileSync(first.output), original);
  for (const receipt of next) {
    assert.equal(receipt.packageId, PACKAGE_ID); assert.equal(receipt.status, 'built');
    assert.match(receipt.output, /\.artifacts[\\/]appkg[\\/]/);
    assert.equal(receipt.packageSha256, sha256(readFileSync(receipt.output)));
    assert.equal(receipt.builderDigest, 'a'.repeat(64));
    assert.equal(JSON.parse(readFileSync(receipt.source)).records[0].values.label, 'Changed');
    assert.equal(JSON.parse(readFileSync(receipt.metadata)).sourceSha256, receipt.sourceSha256);
    assert.equal(JSON.parse(readFileSync(join(dirname(receipt.source), 'inputs/platform/metadata/status.json'))).values.label, 'Changed');
  }
  assert.equal(server.hits.length, 3);
});

test('failed, incomplete and mismatched platform builds do not report old packages as new results', async t => {
  for (const options of [{ fail: true }, { mismatch: true }, { metadata: false }]) await t.test(encode(options), async sub => {
    const f = project(sub); await service(sub, f, options);
    put(f.root, '.artifacts/appkg/old.appkg', 'old original');
    const result = await f.runProject('build'); assert.equal(result.code, 1);
    assert.equal(readFileSync(join(f.root, '.artifacts/appkg/old.appkg'), 'utf8'), 'old original');
    const [attempt] = readdirSync(join(f.root, '.artifacts/appkg'), { withFileTypes: true }).filter(item => item.isDirectory());
    const dir = join(f.root, '.artifacts/appkg', attempt.name);
    assert.equal(existsSync(join(dir, 'build.json')), false);
    assert.equal(readdirSync(dir).some(name => name.endsWith('.appkg')), false);
    assert.equal(JSON.parse(readFileSync(join(dir, 'failure.json'))).status, 'failed');
  });
});

test('offline assembly needs no platform credentials; a build without credentials remains incomplete', async t => {
  const f = project(t);
  assert.equal((await f.runProject('assemble')).code, 0);
  const build = await f.runProject('build'); assert.equal(build.code, 1);
  assert.equal(JSON.parse(build.stdout).ok, false);
});

test('release fixes committed inputs with Git line endings and formal identity, preserving repeated attempts', async t => {
  const f = project(t);
  const git = args => execFileSync('git', ['-C', f.root, ...args], { stdio: 'pipe' });
  put(f.root, '.gitattributes', '*.json text eol=crlf\n');
  git(['init']); git(['add', '.']); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'fixture']);
  for (const file of ['xrain-project.json', 'platform/metadata/status.json'])
    put(f.root, file, readFileSync(join(f.root, file), 'utf8').replaceAll('\n', '\r\n'));
  const first = await f.runProject('assemble', ['--release']); assert.equal(first.code, 0, first.stdout);
  const receipt = JSON.parse(first.stdout).data;
  assert.equal(receipt.version, '1.2.3'); assert.equal(receipt.versionId, VERSION_ID); assert.equal(receipt.git.inputsCommitted, true);
  const second = await f.runProject('assemble', ['--release']); assert.equal(second.code, 0, second.stdout);
  assert.notEqual(JSON.parse(second.stdout).data.source, receipt.source);
  put(f.root, 'platform/metadata/status.json', { id: '0060123456789abcdefg', kind: 'BizPicklist', values: { label: 'dirty' } });
  assert.equal((await f.runProject('assemble', ['--release'])).code, 1);
  assert.equal((await f.runProject('assemble')).code, 0);
});

test('release detects a changed input even when Git is told to assume it is unchanged', async t => {
  const f = project(t), git = args => execFileSync('git', ['-C', f.root, ...args], { stdio: 'pipe' });
  git(['init']); git(['add', '.']); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'fixture']);
  const file = 'platform/metadata/status.json';
  git(['update-index', '--assume-unchanged', file]);
  put(f.root, file, { id: '0060123456789abcdefg', kind: 'BizPicklist', values: { label: 'uncommitted' } });
  assert.equal(git(['status', '--porcelain']).toString(), '');
  const result = await assembleProject(f.root);
  assert.equal(result.git.inputsCommitted, false);
  assert.ok(result.git.uncommittedInputs.includes(file));
  await assert.rejects(assembleProject(f.root, { release: true }), /not committed/);
});

test('ignored project inputs are marked uncommitted even when git status is clean', async t => {
  const f = project(t), git = args => execFileSync('git', ['-C', f.directory, ...args], { stdio: 'pipe' });
  put(f.directory, '.gitignore', '/project/\n/state/\n');
  git(['init']); git(['add', '.gitignore']); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'fixture']);
  const result = await assembleProject(f.root);
  assert.equal(result.git.dirty, true); assert.equal(result.git.inputsCommitted, false);
  assert.ok(result.git.uncommittedInputs.includes('xrain-project.json'));
  await assert.rejects(assembleProject(f.root, { release: true }), /not committed/);
});
