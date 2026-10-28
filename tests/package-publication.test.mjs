import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const python = process.env.PYTHON ?? 'python';
const username = 'package-maintainer';
const password = 'fixture-upload-secret';
const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
const tarScript = `
import io, json, sys, tarfile
settings = json.load(sys.stdin)
with tarfile.open(settings['path'], 'w:gz') as archive:
    for name, value in settings['entries']:
        raw = value.encode()
        entry = tarfile.TarInfo('package/' + name)
        entry.size = len(raw)
        archive.addfile(entry, io.BytesIO(raw))
`;

async function tarball(f, { name = f.name, version = '1.2.3', buildName = name, extra = [] } = {}) {
  const metadata = JSON.stringify({ name, version });
  const entries = [['package.json', metadata], [f.buildMetadata, JSON.stringify({ name: buildName, version })], ...extra];
  const output = spawnSync(python, ['-c', tarScript], { input: JSON.stringify({ path: f.package, entries }), encoding: 'utf8', windowsHide: true });
  assert.equal(output.status, 0, output.stderr);
  const bytes = await readFile(f.package);
  f.sha256 = createHash('sha256').update(bytes).digest('hex');
  f.integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
  return bytes;
}

async function fixture(t, kind = 'runtime') {
  const root = await mkdtemp(join(tmpdir(), 'standalone package publication '));
  const installed = join(root, 'installed delivery skill');
  const project = join(root, 'product checkout');
  const other = join(root, 'different working directory');
  await cp(new URL('../skills/shzw-delivery/', import.meta.url), installed, { recursive: true });
  await mkdir(join(project, 'scripts'), { recursive: true });
  await mkdir(other);
  const f = { root, project, other, script: join(installed, 'scripts/publish-package.py'),
    package: join(project, 'original package.tgz'), evidence: join(project, '.local/operation'),
    name: kind === 'runtime' ? '@xrain/xrain-agent-runtime' : '@xrain/workforce-application',
    buildMetadata: kind === 'runtime' ? 'lib/build.json' : 'build.json',
    requests: [], remote: undefined, putStatus: 201, brokenReadback: false, dropAfterPut: false };
  const server = createServer(async (req, res) => {
    f.requests.push({ method: req.method, authorization: req.headers.authorization, url: req.url });
    if (req.method === 'PUT') {
      if (req.headers.authorization !== authorization) { res.writeHead(403).end(); return; }
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      if (f.putStatus === 201) f.remote = Buffer.concat(chunks);
      if (f.afterPut) await f.afterPut();
      if (f.dropAfterPut) { req.socket.destroy(); return; }
      res.writeHead(f.putStatus).end();
      return;
    }
    if (req.headers.authorization) { res.writeHead(400).end(); return; }
    if (f.remote === undefined) res.writeHead(404).end();
    else res.writeHead(200).end(f.brokenReadback ? 'incorrect bytes' : f.remote);
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  f.registry = join(project, 'scripts/versions.json');
  f.declaration = { schemaVersion: 1, name: f.name, filenamePrefix: 'product-', buildMetadata: f.buildMetadata,
    releaseRoot: `http://127.0.0.1:${server.address().port}/repository/releases`,
    forbiddenPathFragments: ['anbang', '.appkg'], delivered: { path: 'scripts/versions.json', key: 'delivered' } };
  await writeFile(join(project, 'scripts/package-publication.json'), JSON.stringify(f.declaration));
  await writeFile(f.registry, JSON.stringify({ unrelated: 'preserve', delivered: {} }));
  f.raw = await tarball(f);
  t.after(async () => {
    await new Promise(done => server.close(done));
    const inside = relative(resolve(tmpdir()), resolve(root));
    assert.ok(inside && !inside.startsWith('..') && !isAbsolute(inside));
    await rm(root, { recursive: true, force: true });
  });
  return f;
}

function run(f, { execute = true, extra = [], credentials = true, env = {} } = {}) {
  const args = [f.script, '--project', f.project, '--package', f.package, '--expected-sha256', f.sha256,
    '--expected-integrity', f.integrity, '--evidence-directory', f.evidence, ...extra];
  if (execute) args.push('--execute', '--authorization-ref', 'user:publish-isolated-fixture');
  const childEnv = { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONUTF8: '1', ...env };
  delete childEnv.XRAIN_PACKAGE_PUBLISHER;
  delete childEnv.XRAIN_NEXUS_PUBLISH_USER;
  delete childEnv.XRAIN_NEXUS_PUBLISH_PASSWORD;
  if (credentials) Object.assign(childEnv, { XRAIN_NEXUS_PUBLISH_USER: username, XRAIN_NEXUS_PUBLISH_PASSWORD: password });
  return new Promise((done, reject) => {
    const child = spawn(python, args, { cwd: f.other, env: childEnv, windowsHide: true });
    let stdout = '', stderr = '';
    child.stdout.on('data', value => { stdout += value; });
    child.stderr.on('data', value => { stderr += value; });
    child.on('error', reject);
    child.on('close', code => done({ code, stdout, stderr, result: stdout.trim() ? JSON.parse(stdout) : undefined }));
  });
}

for (const kind of ['runtime', 'workforce']) test(`copied skill publishes ${kind} with member credentials and no CI checkout or consumer lock`, async t => {
  const f = await fixture(t, kind);
  assert.deepEqual((await readdir(f.root)).sort(), ['different working directory', 'installed delivery skill', 'product checkout']);
  const prepared = await run(f, { execute: false, credentials: false });
  assert.equal(prepared.code, 0, prepared.stdout + prepared.stderr);
  assert.equal(prepared.result.networkAccessed, false);
  assert.equal(f.requests.length, 0);
  const output = await run(f);
  assert.equal(output.code, 0, output.stdout + output.stderr);
  assert.equal(output.result.name, f.name);
  assert.equal(output.result.deliveredRegistered, true);
  assert.equal(output.result.anonymousDownload, true);
  assert.deepEqual(f.remote, f.raw);
  assert.deepEqual(f.requests.map(request => request.method), ['GET', 'PUT', 'GET']);
  assert.equal(f.requests[1].authorization, authorization);
  assert.ok(f.requests.filter(request => request.method === 'GET').every(request => request.authorization === undefined));
  const registry = JSON.parse(await readFile(f.registry));
  assert.equal(registry.unrelated, 'preserve');
  assert.equal(registry.delivered['1.2.3'].integrity, f.integrity);
  const receipt = await readFile(join(f.evidence, 'publication.json'), 'utf8');
  assert.ok(![output.stdout, output.stderr, receipt].some(text => text.includes(password) || text.includes(authorization)));
});

test('wrong approved hashes fail before any network access', async t => {
  const f = await fixture(t);
  for (const extra of [['--expected-sha256', '0'.repeat(64)], ['--expected-integrity', 'sha512-wrong']]) {
    const output = await run(f, { extra });
    assert.equal(output.code, 1);
    assert.match(output.result.reason, /differs/);
  }
  assert.equal(f.requests.length, 0);
});

test('package name, build identity, exact version and forbidden contents are checked before upload', async t => {
  const f = await fixture(t);
  for (const options of [{ name: '@other/package' }, { buildName: '@other/build' }, { extra: [['anbang/private.json', '{}']] },
    { extra: [['same.txt', 'first'], ['same.txt', 'second']] }]) {
    await tarball(f, options);
    assert.equal((await run(f)).code, 1);
  }
  await tarball(f);
  assert.equal((await run(f, { extra: ['--version', '1.2.4'] })).code, 1);
  assert.equal(f.requests.length, 0);
});

test('missing member credentials fail without an upload or operation journal', async t => {
  const f = await fixture(t);
  const output = await run(f, { credentials: false });
  assert.equal(output.code, 1);
  assert.match(output.result.reason, /credentials/);
  assert.equal(f.requests.length, 0);
  await assert.rejects(readFile(join(f.evidence, 'publication.json')), { code: 'ENOENT' });
});

test('same remote bytes are reused while a different immutable release cannot be overwritten', async t => {
  const f = await fixture(t);
  f.remote = f.raw;
  assert.equal((await run(f)).result.reused, true);
  f.remote = Buffer.from('another release');
  const output = await run(f);
  assert.equal(output.code, 1);
  assert.match(output.result.reason, /cannot be overwritten/);
  assert.ok(f.requests.every(request => request.method === 'GET'));
});

for (const status of [403, 507]) test(`HTTP ${status} preserves the failed operation and does not register a delivery`, async t => {
  const f = await fixture(t);
  f.putStatus = status;
  const output = await run(f);
  assert.equal(output.code, 1);
  assert.match(output.result.reason, new RegExp(`HTTP ${status}`));
  assert.equal(JSON.parse(await readFile(join(f.evidence, 'publication.json'))).status, 'started-result-unknown');
  assert.deepEqual(JSON.parse(await readFile(f.registry)).delivered, {});
  const puts = f.requests.filter(request => request.method === 'PUT').length;
  assert.equal((await run(f)).code, 1);
  assert.equal(f.requests.filter(request => request.method === 'PUT').length, puts);
});

test('a lost upload response recovers only by anonymous readback of the original bytes', async t => {
  const f = await fixture(t);
  f.dropAfterPut = true;
  assert.equal((await run(f)).code, 1);
  assert.deepEqual(f.remote, f.raw);
  assert.deepEqual(JSON.parse(await readFile(f.registry)).delivered, {});
  f.dropAfterPut = false;
  const output = await run(f);
  assert.equal(output.code, 0, output.stdout);
  assert.equal(output.result.reused, true);
  assert.equal(f.requests.filter(request => request.method === 'PUT').length, 1);
});

test('wrong anonymous readback cannot mark the package delivered', async t => {
  const f = await fixture(t);
  f.brokenReadback = true;
  const output = await run(f);
  assert.equal(output.code, 1);
  assert.match(output.result.reason, /readback differs/);
  assert.deepEqual(JSON.parse(await readFile(f.registry)).delivered, {});
});

test('a delivered version with different integrity fails before any network operation', async t => {
  const f = await fixture(t);
  await writeFile(f.registry, JSON.stringify({ delivered: { '1.2.3': { integrity: 'sha512-different' } } }));
  const output = await run(f);
  assert.equal(output.code, 1);
  assert.match(output.result.reason, /Delivered version/);
  assert.equal(f.requests.length, 0);
});

test('a local registration failure is repaired by readback without a second upload', async t => {
  const f = await fixture(t);
  f.afterPut = () => writeFile(f.registry, 'not valid json');
  assert.equal((await run(f)).code, 1);
  assert.deepEqual(f.remote, f.raw);
  await writeFile(f.registry, JSON.stringify({ delivered: {} }));
  f.afterPut = undefined;
  const output = await run(f);
  assert.equal(output.code, 0, output.stdout);
  assert.equal(output.result.deliveredRegistered, true);
  assert.equal(f.requests.filter(request => request.method === 'PUT').length, 1);
});
