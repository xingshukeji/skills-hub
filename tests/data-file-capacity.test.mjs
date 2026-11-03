import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { fixture, mockServer, respond } from './helpers.mjs';

const mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const entity = 'product__c', jobId = 'a'.repeat(32);
const payload = Buffer.from('完整_x0041_🙂 file content\n'.repeat(4096));
const digest = value => createHash('sha256').update(value).digest('hex');
const execute = promisify(execFile);

for (const purpose of ['result', 'issues', 'maintenance', 'remaining']) {
  test(`job ${purpose} download does not borrow an input file limit or capability permission`, async t => {
    const f = fixture(t);
    const service = await mockServer(t, (hit, res) => {
      if (hit.url.endsWith('/capabilities')) return respond(res, { message: 'Input capabilities are unavailable.' }, 403);
      assert.equal(hit.method, 'GET');
      assert.equal(hit.url, `/api/data/v1/entities/${entity}/imports/jobs/${jobId}/file?purpose=${purpose}`);
      assert.equal(hit.headers['x-xrain-import-application'], 'app-demo');
      res.writeHead(200, { 'content-type': mime, ...(service.hits.length === 1 ? { 'content-length': payload.length } : {}) });
      res.write(payload.subarray(0, 17)); res.end(payload.subarray(17));
    });
    f.profile(service.url);
    for (const framing of ['length', 'chunked']) {
      const out = join(f.directory, `${purpose}-${framing}.xlsx`);
      const result = await f.run(['data', 'import', 'download', '--entity', entity, '--application', 'app-demo',
        '--job', jobId, '--purpose', purpose, '--out', out, '--json']);
      assert.equal(result.code, 0, result.stdout);
      assert.equal(digest(await readFile(out)), digest(payload));
      assert.equal(JSON.parse(result.stdout).data.bytes, payload.length);
    }
    assert.equal(service.hits.length, 2);
    assert.ok((await readdir(f.directory)).every(name => !name.endsWith('.part')));
  });
}

test('ordinary record export uses the authorized file endpoint without borrowing import capabilities', async t => {
  const f = fixture(t);
  const body = { query: { pageSize: 20 }, exportPurpose: 'display', selectedRecordIds: ['visible-one'] };
  const service = await mockServer(t, (hit, res) => {
    if (hit.url.endsWith('/capabilities')) return respond(res, { maximumFileBytes: 0 });
    assert.equal(hit.method, 'POST');
    assert.equal(hit.url, `/api/data/v1/entities/${entity}/records:exportFile`);
    assert.deepEqual(hit.json(), body);
    res.writeHead(200, { 'content-type': mime, 'content-length': payload.length });
    res.end(payload);
  });
  f.profile(service.url);
  const request = join(f.directory, 'request.json'), out = join(f.directory, 'export.xlsx');
  await writeFile(request, JSON.stringify(body));
  const result = await f.run(['data', 'export-file', entity, '--request-json', request, '--out', out, '--json']);
  assert.equal(result.code, 0, result.stdout);
  assert.equal(digest(await readFile(out)), digest(payload));
  assert.equal(service.hits.length, 1);
});

test('standalone bundle downloads job and ordinary exports without input capability reads', async t => {
  const f = fixture(t);
  const service = await mockServer(t, (hit, res) => {
    assert.ok(!hit.url.includes('capabilities'));
    assert.ok(hit.url.endsWith(`/imports/jobs/${jobId}/file?purpose=remaining`) || hit.url.endsWith('/records:exportFile'));
    res.writeHead(200, { 'content-type': mime, 'content-length': payload.length }); res.end(payload);
  });
  f.profile(service.url);
  const request = join(f.directory, 'request.json');
  await writeFile(request, JSON.stringify({ query: {}, exportPurpose: 'display' }));
  const bundle = fileURLToPath(new URL('../skills/shzw-xrain-cli/scripts/xrain-cli.mjs', import.meta.url));
  const commands = [
    ['data', 'import', 'download', '--entity', entity, '--job', jobId, '--purpose', 'remaining'],
    ['data', 'export-file', entity, '--request-json', request]
  ];
  for (const [index, command] of commands.entries()) {
    const out = join(f.directory, `bundle-${index}.xlsx`);
    const result = await execute(process.execPath, [bundle, ...command, '--out', out, '--json'], { env: f.env });
    assert.equal(JSON.parse(result.stdout).ok, true, result.stdout);
    assert.equal(digest(await readFile(out)), digest(payload));
  }
  assert.equal(service.hits.length, 2);
});
