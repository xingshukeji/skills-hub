import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Args, sha256 } from '../src/xrain-cli/core.mjs';
import { fixture, mockServer, respond, appArchive, PACKAGE_ID, VERSION_ID } from './helpers.mjs';
const output = value => JSON.parse(value.stdout);
function login(f, url) {
  const profile = f.store.market(new Args(['--exchange', url]));
  f.store.saveSession(profile.name, url, '', 'independent-market-session', Date.now() + 300000);
}

test('market artifacts retain exact identity and digest and refuse an existing destination', async t => {
  const f = fixture(t), archive = appArchive(), hash = sha256(archive);
  const service = await mockServer(t, (hit, res) => {
    assert.equal(hit.headers.authorization, 'Bearer independent-market-session');
    if (hit.url.endsWith('/manifest')) return respond(res, { packageId: PACKAGE_ID, versionId: VERSION_ID, version: '1.0.0', fileSha256: hash, digest: 'package-digest' });
    assert.equal(hit.url, `/api/exchange/v1/packages/${PACKAGE_ID}/versions/${VERSION_ID}/artifact`);
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'x-appkg-file-sha256': hash, 'x-appkg-package-digest': 'package-digest', 'x-appkg-package-id': PACKAGE_ID, 'x-appkg-version-id': VERSION_ID }); res.end(archive);
  });
  login(f, service.url); const file = join(f.directory, 'exact.appkg');
  const argv = ['market', 'download', PACKAGE_ID, '--version-id', VERSION_ID, '--exchange', service.url, '--out', file, '--json'];
  assert.equal((await f.run(argv)).code, 0); assert.deepEqual(readFileSync(file), archive);
  assert.equal(output(await f.run(argv)).error.code, 'output_exists'); assert.equal(service.hits.length, 2);
});

test('market integrity failure and revoked publication never leave a local artifact', async t => {
  const f = fixture(t); let rejected = false;
  const service = await mockServer(t, (hit, res) => {
    if (hit.url.endsWith('/manifest')) return respond(res, { packageId: PACKAGE_ID, versionId: VERSION_ID, version: '1.0.0', fileSha256: '0'.repeat(64), digest: 'digest' });
    if (rejected) return respond(res, { error: 'application_not_published' }, 404);
    res.writeHead(200); res.end(appArchive());
  });
  login(f, service.url); const file = join(f.directory, 'bad.appkg');
  const argv = ['market', 'download', PACKAGE_ID, '--version-id', VERSION_ID, '--exchange', service.url, '--out', file, '--json'];
  assert.equal(output(await f.run(argv)).error.code, 'integrity_failed'); assert.equal(existsSync(file), false);
  rejected = true; assert.equal(output(await f.run(argv)).error.code, 'not_found'); assert.equal(existsSync(file), false);
});

test('publication keeps the observed comparison and never refreshes after a conflict or lost receipt', async t => {
  const f = fixture(t); let unknown = false;
  const service = await mockServer(t, (hit, res) => {
    assert.equal(hit.method, 'PUT'); assert.deepEqual(hit.json(), { versionId: null, expectedPublishedVersionId: VERSION_ID });
    if (unknown) res.destroy(); else respond(res, { error: 'application_publication_changed' }, 409);
  });
  login(f, service.url); const argv = ['market', 'unpublish', PACKAGE_ID, '--expected-published-version', VERSION_ID, '--exchange', service.url, '--json'];
  assert.equal(output(await f.run(argv)).error.code, 'conflict'); unknown = true;
  const dropped = output(await f.run(argv)); assert.equal(dropped.error.code, 'outcome_unknown'); assert.equal(dropped.error.details.packageId, PACKAGE_ID);
  assert.equal(service.hits.length, 2);
});

test('market cannot fall back to a platform credential or use missing output/comparison arguments', async t => {
  const f = fixture(t), service = await mockServer(t, (_hit, res) => respond(res, {}));
  f.profile(service.url, 'tenant', 'platform-token');
  assert.equal((await f.run(['market', 'show', PACKAGE_ID, '--exchange', service.url, '--json'])).code, 0);
  assert.equal(service.hits[0].headers.authorization, undefined, 'public reads never borrow the platform credential');
  assert.equal(output(await f.run(['market', 'show', PACKAGE_ID, '--exchange', service.url, '--auth', 'session', '--json'])).error.code, 'authentication_required');
  assert.equal((await f.run(['market', 'download', PACKAGE_ID, '--exchange', service.url, '--version-id', VERSION_ID, '--json'])).code, 1);
  assert.equal((await f.run(['market', 'unpublish', PACKAGE_ID, '--exchange', service.url, '--json'])).code, 1);
  assert.equal(service.hits.length, 1);
});
