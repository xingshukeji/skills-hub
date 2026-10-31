import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, mockServer, respond } from './helpers.mjs';

const output = value => JSON.parse(value.stdout);

test('managed files upload raw bytes and preserve authorized metadata on download, including an empty file', async t => {
  const f = fixture(t), bytes = Buffer.from('file-body'), files = new Map();
  const service = await mockServer(t, (hit, res) => {
    assert.equal(hit.headers.authorization, 'Bearer service-token');
    if (hit.method === 'POST') {
      assert.equal(hit.url, '/api/service/files/v1/files?uploaderId=known-uploader&fileName=original.txt');
      assert.equal(hit.headers['content-length'], String(bytes.length)); assert.deepEqual(hit.body, bytes);
      files.set('original', bytes); respond(res, { id: 'original', fileName: 'original.txt', length: bytes.length, contentType: 'text/plain', tenantId: 'tenant-one' });
    } else if (hit.url.endsWith('/content')) {
      const body = hit.url.includes('/empty/') ? Buffer.alloc(0) : files.get('original');
      res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Length': body.length }); res.end(body);
    } else {
      const empty = hit.url.endsWith('/empty'); respond(res, { id: empty ? 'empty' : 'original', fileName: 'original.txt', length: empty ? 0 : bytes.length, contentType: 'text/plain' });
    }
  });
  f.profile(service.url, 'tenant-one', 'service-token');
  const input = join(f.directory, 'original.txt'); writeFileSync(input, bytes);
  assert.equal((await f.run(['file', 'upload', input, '--uploader-id', 'known-uploader', '--json'])).code, 0);
  const out = join(f.directory, 'download.txt');
  assert.equal((await f.run(['file', 'download', 'original', '--out', out, '--json'])).code, 0);
  assert.deepEqual(readFileSync(out), bytes);
  const empty = join(f.directory, 'empty.txt');
  assert.equal((await f.run(['file', 'download', 'empty', '--out', empty, '--json'])).code, 0); assert.equal(readFileSync(empty).length, 0);
  assert.equal(output(await f.run(['file', 'download', 'original', '--out', out, '--json'])).error.code, 'output_exists');
  assert.deepEqual(readFileSync(out), bytes);
});

test('file length mismatch and access refusal never commit an incomplete local output', async t => {
  const f = fixture(t); let denied = false;
  const service = await mockServer(t, (hit, res) => {
    if (denied) { respond(res, { errorCode: 'file.service_forbidden' }, 403); return; }
    if (!hit.url.endsWith('/content')) respond(res, { id: 'original', length: 10, contentType: 'text/plain' });
    else { res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Length': '5' }); res.end('short'); }
  });
  f.profile(service.url, 'tenant-one', 'service-token'); const out = join(f.directory, 'download.txt');
  assert.equal((await f.run(['file', 'download', 'original', '--out', out, '--json'])).code, 1); assert.equal(existsSync(out), false);
  assert.ok(!readdirSync(f.directory).some(name => name.endsWith('.part')));
  denied = true; const result = await f.run(['file', 'download', 'original', '--out', out, '--json']);
  assert.equal(output(result).error.code, 'permission_denied'); assert.equal(existsSync(out), false);
});

test('a lost upload receipt retains its uploader without sending another file', async t => {
  const f = fixture(t); let writes = 0;
  const service = await mockServer(t, (_hit, res) => { writes++; res.destroy(); });
  f.profile(service.url, 'tenant-one', 'service-token'); const input = join(f.directory, 'one.txt'); writeFileSync(input, 'one');
  const result = await f.run(['file', 'upload', input, '--uploader-id', 'original-uploader', '--json']);
  assert.equal(output(result).error.code, 'outcome_unknown'); assert.equal(output(result).error.details.uploaderId, 'original-uploader'); assert.equal(writes, 1);
});

test('delivery previews do not send, while an explicit lost test-send receipt is never replayed', async t => {
  const f = fixture(t); let sends = 0;
  const service = await mockServer(t, (hit, res) => {
    if (hit.url.endsWith('/preview')) { respond(res, { subject: 'preview', body: 'preview only' }); return; }
    assert.equal(hit.url, '/api/delivery/v1/email/templates/original/send-test'); sends++; res.destroy();
  });
  f.profile(service.url, 'tenant-one', 'own-token'); const file = join(f.directory, 'values.json'); writeFileSync(file, '{"data":{}}');
  assert.equal((await f.run(['email', 'template', 'preview', 'original', '--request-json', file, '--json'])).code, 0); assert.equal(sends, 0);
  const result = await f.run(['email', 'template', 'send-test', 'original', '--request-json', file, '--json']);
  assert.equal(output(result).error.code, 'outcome_unknown'); assert.equal(sends, 1); assert.equal(service.hits.length, 2);
});

test('personal mailbox receive and send passwords stay redacted even in an echoed failure', async t => {
  const f = fixture(t), service = await mockServer(t, (hit, res) => {
    assert.equal(hit.url, '/api/delivery/v1/email/me/accounts');
    respond(res, { errorCode: 'email_connection_failed', response: hit.json(), message: 'receive-canary send-canary' }, 502);
  });
  f.profile(service.url, 'tenant-one', 'own-token'); const file = join(f.directory, 'mail.json');
  writeFileSync(file, '{"receivePassword":"receive-canary","sendPassword":"send-canary"}');
  const result = await f.run(['mail', 'account', 'set', '--request-json', file, '--json']);
  assert.equal(output(result).error.code, 'outcome_unknown'); assert.ok(!result.stdout.includes('receive-canary')); assert.ok(!result.stdout.includes('send-canary'));
});
