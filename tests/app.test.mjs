import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { sha256 } from '../src/xrain-cli/core.mjs';
import { readManifest } from '../src/xrain-cli/archive.mjs';
import { appArchive, fixture, mockServer, PACKAGE_ID, respond, VERSION_ID, zip } from './helpers.mjs';

test('app init generates valid source and refuses to overwrite user edits', async t => {
  const f = fixture(t), dir = join(f.directory, 'myapp');
  const args = ['app', 'init', '--namespace', 'myapp', '--label', '我的应用', '--dir', dir];
  assert.equal((await f.run(args)).code, 0);
  const path = join(dir, 'source.json'), source = JSON.parse(readFileSync(path));
  assert.match(source.packageId, /^apg[a-z0-9]{17}$/); assert.match(source.versionId, /^apv[a-z0-9]{17}$/);
  assert.equal(source.namespace, 'myapp'); assert.equal(source.label, '我的应用');
  assert.equal(source.records[1].values.refPicklistId, source.records[0].id);
  const before = readFileSync(path);
  assert.equal((await f.run(args)).code, 1); assert.deepEqual(readFileSync(path), before);
  assert.equal((await f.run(['app', 'init', '--namespace', 'Bad_Name', '--label', 'test', '--dir', dir])).code, 1);
});

test('ZIP reader accepts stored and deflated manifests and ignores unrelated large entries', () => {
  const manifest = { packageId: PACKAGE_ID, versionId: VERSION_ID, version: '1.0.0' };
  for (const deflate of [false, true]) assert.deepEqual(readManifest(zip([['manifest.json', manifest]], { deflate })), manifest);
  assert.equal(readManifest(zip([['manifest.json', manifest], ['unused.bin', Buffer.alloc(2 * 1024 * 1024)]])).packageId, PACKAGE_ID);
});

test('ZIP reader rejects missing, duplicate, corrupt, oversized and deceptive manifests', () => {
  const invalid = [
    Buffer.from('not-a-zip'),
    appArchive().subarray(0, -1),
    zip([['nested/manifest.json', {}]]),
    zip([['manifest.json', { packageId: PACKAGE_ID, versionId: VERSION_ID }], ['manifest.json', { packageId: PACKAGE_ID, versionId: VERSION_ID }]]),
    zip([['manifest.json', 'invalid json']]),
    zip([['manifest.json', []]]),
    appArchive({ packageId: PACKAGE_ID + '\n' }),
    appArchive({ versionId: 'bad' }),
    zip([['manifest.json', 'x'.repeat(1024 * 1024 + 1)]]),
  ];
  const corrupted = appArchive(); corrupted[45] ^= 0xff; invalid.push(corrupted);
  const badCrc = appArchive();
  const central = badCrc.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  badCrc.writeUInt32LE(0, central + 16); invalid.push(badCrc);
  const bomb = zip([['manifest.json', 'x'.repeat(2 * 1024 * 1024)]]);
  const bombCentral = bomb.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  bomb.writeUInt32LE(10, bombCentral + 24); bomb.writeUInt32LE(10, 22); invalid.push(bomb);
  for (const archive of invalid) assert.throws(() => readManifest(archive), /ZIP or manifest is invalid/);
});

async function applicationService(t, f, options = {}) {
  const bytes = options.archive ?? appArchive();
  const service = await mockServer(t, (hit, res) => {
    assert.equal(hit.headers.authorization, 'Bearer test-browser-app-session');
    assert.equal(hit.headers['x-tenant-id'], undefined);
    if (hit.url.endsWith('/packages:build')) {
      assert.equal(hit.headers['content-type'], 'application/json');
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'X-Appkg-Source-Sha256': options.wrongSource ? '0'.repeat(64) : sha256(hit.body),
        'X-Appkg-File-Sha256': options.wrongArchive ? '0'.repeat(64) : sha256(bytes), 'X-Appkg-Package-Id': options.packageId ?? PACKAGE_ID, 'X-Appkg-Version': '1.0.0' });
      res.end(bytes); return;
    }
    if (hit.url.endsWith('/my-published')) return respond(res, [{ id: PACKAGE_ID, namespace: 'myapp', label: 'My app', publishedVersionId: 'apv00000000000000000' }]);
    if (hit.url.endsWith('/packages:publish')) {
      assert.deepEqual(hit.body, bytes);
      assert.equal(hit.headers['content-type'], 'application/octet-stream');
      assert.equal(hit.headers['x-appkg-expected-published-version'], 'apv00000000000000000');
      if (options.dropPublishResponse) { res.destroy(); return; }
      if (options.conflict) return respond(res, { errorCode: 'application.publish_conflict' }, 409);
      return respond(res, { packageId: PACKAGE_ID, versionId: options.wrongPublishedVersion ? 'apv99999999999999999' : VERSION_ID, version: '1.0.0' });
    }
    if (hit.url.endsWith('/versions')) return respond(res, [
      { id: VERSION_ID, version: '1.0.0', digest: sha256(bytes), publishedAt: '2026-01-01T00:00:00Z' },
      { id: 'apv99999999999999999', version: '2.0.0', digest: sha256(bytes), createdAt: '2026-01-02T00:00:00Z' },
    ]);
    respond(res, {}, 404);
  });
  f.profile(service.url, 'tenant-demo', 'test-admin-api-token-must-not-be-used');
  f.store.saveSession('Demo', service.url, 'tenant-demo', 'test-browser-app-session', Date.now() + 300000);
  return { ...service, bytes };
}

test('app check/build validate digests, use browser session and never overwrite output', async t => {
  const f = fixture(t), service = await applicationService(t, f);
  const source = join(f.directory, 'source.json'), output = join(f.directory, 'built.appkg');
  writeFileSync(source, '{"packageId":"' + PACKAGE_ID + '","records":[]}');
  const check = await f.run(['app', 'check', '--source', source]);
  assert.equal(check.code, 0, check.stderr); assert.match(check.stdout, /Validated/);
  assert.equal(readdirSync(f.directory).some(file => file.endsWith('.appkg')), false);
  const build = await f.run(['app', 'build', '--source', source, '--output', output]);
  assert.equal(build.code, 0, build.stderr); assert.deepEqual(readFileSync(output), service.bytes);
  assert.equal(JSON.parse(build.stdout).sourceSha256, sha256(readFileSync(source)));
  writeFileSync(output, 'user-owned-original-content');
  const callsBefore = service.hits.length;
  const again = await f.run(['app', 'build', '--source', source, '--output', output]);
  assert.equal(again.code, 1); assert.equal(readFileSync(output, 'utf8'), 'user-owned-original-content');
  assert.equal(service.hits.length, callsBefore);
  assert.ok(!readdirSync(f.directory).some(file => file.endsWith('.part')));
});

test('build refuses digest, identity or manifest mismatches before writing any output', async t => {
  for (const [name, options, pattern] of [
    ['source digest', { wrongSource: true }, /source digest/],
    ['archive digest', { wrongArchive: true }, /archive digest/],
    ['header identity', { packageId: 'invalid' }, /package identity/],
    ['manifest identity', { archive: appArchive({ packageId: 'apg99999999999999999' }) }, /manifest does not match/],
    ['invalid zip', { archive: Buffer.from('bad-zip') }, /ZIP or manifest/],
  ]) await t.test(name, async sub => {
    const f = fixture(sub); await applicationService(sub, f, options);
    const source = join(f.directory, 'source.json'), output = join(f.directory, 'invalid.appkg');
    writeFileSync(source, '{}');
    const result = await f.run(['app', 'build', '--source', source, '--output', output]);
    assert.equal(result.code, 1); assert.match(result.stderr, pattern);
    assert.equal(existsSync(output), false); assert.ok(!readdirSync(f.directory).some(file => file.endsWith('.part')));
  });
});

test('known default outputs and malformed source are rejected before remote building', async t => {
  const f = fixture(t), service = await applicationService(t, f);
  const source = join(f.directory, 'source.json'), output = join(f.directory, PACKAGE_ID + '-1.0.0.appkg');
  writeFileSync(source, JSON.stringify({ packageId: PACKAGE_ID, version: '1.0.0', records: [] }));
  writeFileSync(output, 'existing-user-content');
  const existing = await f.run(['app', 'build', '--source', source, '--json']);
  assert.equal(existing.code, 1); assert.equal(JSON.parse(existing.stdout).error.code, 'output_exists');
  assert.equal(readFileSync(output, 'utf8'), 'existing-user-content');
  writeFileSync(source, 'not JSON');
  const invalid = await f.run(['app', 'build', '--source', source, '--output', join(f.directory, 'new.appkg'), '--json']);
  assert.equal(invalid.code, 1); assert.equal(service.hits.length, 0);
});

test('app commands cannot substitute an API bearer for the browser session', async t => {
  const f = fixture(t), service = await mockServer(t, (hit, res) => respond(res, {}));
  f.profile(service.url, 'tenant-demo', 'test-admin-api-token');
  const source = join(f.directory, 'source.json'); writeFileSync(source, '{}');
  const result = await f.run(['app', 'check', '--source', source]);
  assert.equal(result.code, 1); assert.match(result.stderr, /App login is required/); assert.equal(service.hits.length, 0);
  const exchange = await f.run(['app', 'build', '--source', source, '--exchange', service.url]);
  assert.equal(exchange.code, 1); assert.match(exchange.stderr, /--exchange is not supported by 'app build'/); assert.equal(service.hits.length, 0);
});

test('publish sends optimistic concurrency header and status filters unpublished platform versions', async t => {
  const f = fixture(t), service = await applicationService(t, f);
  const path = join(f.directory, 'test.appkg'); writeFileSync(path, service.bytes);
  const result = await f.run(['app', 'publish', '--file', path]);
  assert.equal(result.code, 0, result.stderr); assert.equal(JSON.parse(result.stdout).published, true);
  const status = await f.run(['app', 'status', '--package', 'myapp']);
  assert.equal(status.code, 0, status.stderr); assert.equal(JSON.parse(status.stdout).versions.length, 1);
  assert.equal(service.hits.filter(hit => hit.url.endsWith('/packages:publish')).length, 1);
});

test('publish conflict, lost response and unexpected identity are never automatically retried', async t => {
  for (const [name, options] of [['conflict', { conflict: true }], ['lost response', { dropPublishResponse: true }], ['identity mismatch', { wrongPublishedVersion: true }]]) await t.test(name, async sub => {
    const f = fixture(sub), service = await applicationService(sub, f, options);
    const path = join(f.directory, 'test.appkg'); writeFileSync(path, service.bytes);
    const result = await f.run(['app', 'publish', '--file', path]);
    assert.equal(result.code, 1); assert.match(result.stderr, /Run app status before retrying/);
    assert.equal(service.hits.filter(hit => hit.url.endsWith('/packages:publish')).length, 1);
  });
});

test('invalid package is rejected locally before querying or publishing', async t => {
  const f = fixture(t), service = await mockServer(t, (hit, res) => respond(res, {}));
  const path = join(f.directory, 'invalid.appkg'); writeFileSync(path, appArchive({ versionId: 'bad' }));
  const result = await f.run(['app', 'publish', '--file', path, '--server', service.url]);
  assert.equal(result.code, 1); assert.match(result.stderr, /ZIP or manifest/); assert.equal(service.hits.length, 0);
});

test('market publish/status use independent endpoint and session and include market versions', async t => {
  const f = fixture(t), service = await applicationService(t, f);
  const ctx = f.context(['app', 'status', '--exchange', service.url, '--profile', 'Market']);
  const market = f.store.market(ctx.args);
  f.store.saveSession(market.name, service.url, '', 'test-browser-app-session', Date.now() + 300000);
  const path = join(f.directory, 'test.appkg'); writeFileSync(path, service.bytes);
  const publish = await f.run(['app', 'publish', '--file', path, '--exchange', service.url, '--profile', 'Market']);
  assert.equal(publish.code, 0, publish.stderr);
  const status = await f.run(['app', 'status', '--exchange', service.url, '--profile', 'Market']);
  assert.equal(status.code, 0, status.stderr); assert.equal(JSON.parse(status.stdout).versions.length, 2);
  assert.ok(service.hits.every(hit => hit.url.startsWith('/api/exchange/v1/')));
});
