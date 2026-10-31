import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sha256 } from '../src/xrain-cli/core.mjs';
import { fixture, mockServer, respond, appArchive, PACKAGE_ID, VERSION_ID } from './helpers.mjs';
const output = value => JSON.parse(value.stdout);

test('Host builds, checks and inspects exact version components without acquiring a tenant', async t => {
  const f = fixture(t), archive = appArchive(); let denied = false;
  const service = await mockServer(t, (hit, res) => {
    assert.equal(hit.headers.authorization, 'Bearer host-session'); assert.equal(hit.headers['x-tenant-id'], undefined);
    if (denied) return respond(res, { errorCode: 'application_package.forbidden' }, 403);
    if (hit.method === 'GET') { assert.equal(hit.url, `/api/application/v1/packages/${PACKAGE_ID}/versions/${VERSION_ID}/components`); return respond(res, [{ recordId: 'original' }]); }
    assert.equal(hit.url, '/api/application/v1/packages:build');
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'x-appkg-source-sha256': sha256(hit.body),
      'x-appkg-file-sha256': sha256(archive), 'x-appkg-package-id': PACKAGE_ID, 'x-appkg-version': '1.0.0' }); res.end(archive);
  });
  f.store.save({ activeProfile: 'Host', profiles: { Host: { server: service.url, tenant: null, scope: 'host' } } });
  f.store.saveSession('Host', service.url, null, 'host-session', Date.now() + 300000, 'host');
  const source = join(f.directory, 'source.json'), out = join(f.directory, 'output.appkg');
  writeFileSync(source, JSON.stringify({ packageId: PACKAGE_ID, versionId: VERSION_ID, records: [] }));
  for (const argv of [['app', 'check', '--source', source], ['app', 'build', '--source', source, '--output', out], ['app', 'components', PACKAGE_ID, '--version-id', VERSION_ID]]) {
    const result = await f.run([...argv, '--json']); assert.equal(result.code, 0, result.stdout);
  }
  assert.deepEqual(readFileSync(out), archive); assert.equal(service.hits.length, 3);
  denied = true;
  assert.equal(output(await f.run(['app', 'components', PACKAGE_ID, '--version-id', VERSION_ID, '--json'])).error.code, 'permission_denied');
  assert.equal(output(await f.run(['app', 'list', '--json'])).error.code, 'tenant_required'); assert.equal(service.hits.length, 4);
});

test('security API debug consumes the native proxied response using the shared raw response path', async t => {
  const f = fixture(t), service = await mockServer(t, (hit, res) => {
    assert.equal(hit.url, '/api/service/authen/v1/security/api-debug');
    assert.deepEqual(hit.json(), { catalogKey: 'original', tokenId: 'original-token-id', input: {} });
    res.writeHead(200, { 'content-type': 'text/plain', 'x-original': 'yes' }); res.end('raw API result');
  });
  f.profile(service.url, 'tenant', 'caller');
  const result = await f.run(['security', 'api-debug', '--request-json', '-', '--json'], { stdin: '{"catalogKey":"original","tokenId":"original-token-id","input":{}}' });
  assert.equal(result.code, 0, result.stdout); assert.equal(output(result).data.body, 'raw API result'); assert.equal(output(result).data.headers['x-original'], 'yes');
});

test('explicit connection and delivery checks fail on native negative results and stop later batch writes', async t => {
  const f = fixture(t); let receipt, later = 0;
  const service = await mockServer(t, (hit, res) => { if (hit.url.endsWith('/deactivate')) { later++; return respond(res, {}); } respond(res, receipt); });
  const plan = join(f.directory, 'batch.json');
  for (const [argv, failed, passed, host] of [
    [['email', 'account', 'check', 'original'], { status: 'Failed', errorCode: 'smtp.rejected' }, { status: 'Succeeded' }],
    [['feishu', 'account', 'check'], { succeeded: false, errorCode: 'bot.rejected' }, { succeeded: true }],
    [['mail', 'account', 'check', 'original'], { receive: { status: 'Succeeded' }, send: { status: 'Failed' } }, { receive: { status: 'Succeeded' }, send: { status: 'Succeeded' } }],
    [['host', 'tenant', 'connection', 'check', 'original', 'business'], { ready: false, status: 'unavailable' }, { ready: true, status: 'ready' }, true],
  ]) {
    if (host) f.store.save({ activeProfile: 'Host', profiles: { Host: { server: service.url, scope: 'host', tenant: null, bearerToken: 'caller' } } });
    else f.profile(service.url, 'tenant', 'caller');
    receipt = failed; writeFileSync(plan, JSON.stringify([argv, ['security', 'role', 'deactivate', 'later']]));
    const result = await f.run(['batch', plan, '--json']);
    assert.equal(result.code, 1, result.stdout); assert.equal(output(result).error.details.results[0].error.code, 'execution_failed'); assert.equal(later, 0);
    receipt = passed; const valid = await f.run([...argv, '--json']); assert.equal(valid.code, 0, valid.stdout);
  }
});

test('send-test preserves Accepted, queued and ignored results and distinguishes failure from unknown delivery', async t => {
  const f = fixture(t); let receipt;
  const service = await mockServer(t, (_hit, res) => respond(res, receipt)); f.profile(service.url, 'tenant', 'caller');
  for (const [argv, rows] of [
    [['email', 'template', 'send-test', 'original'], [['Queued', 0], ['Sending', 0], ['Accepted', 0], ['Failed', 'execution_failed'], ['Unknown', 'outcome_unknown']]],
    [['feishu', 'template', 'send-test', 'original'], [['Accepted', 0], ['Rejected', 'execution_failed'], ['Unknown', 'outcome_unknown'], ['Ignored', 0]]],
    [['sms', 'send-test'], [['Accepted', 0], ['Rejected', 'execution_failed'], ['Unknown', 'outcome_unknown'], ['Ignored', 0]]],
  ]) for (const [status, expected] of rows) {
    receipt = { messageId: 'original', recordId: 'original', [argv[0] === 'sms' ? 'submitStatus' : 'status']: status, ignored: status === 'Ignored' };
    const result = await f.run([...argv, '--request-json', '-', '--json'], { stdin: argv[0] === 'sms' ? '{"accountId":"original","localTemplateKey":"original","recipient":"synthetic-recipient"}' : '{"data":{}}' });
    if (expected === 0) assert.equal(result.code, 0, result.stdout);
    else { assert.equal(result.code, 1, result.stdout); assert.equal(output(result).error.code, expected); assert.equal(output(result).error.details.result.messageId, 'original'); }
  }
  receipt = { status: 'Failed' };
  assert.equal((await f.run(['email', 'message', 'show', 'original', '--json'])).code, 0);
  assert.equal(service.hits.length, 14);
});

test('Runtime commands and their Workforce proxy inspect the native execution result rather than only HTTP success', async t => {
  const f = fixture(t); let kind = 'error', malformed = false, commands = 0, later = 0;
  const service = await mockServer(t, (hit, res) => {
    if (hit.url.endsWith('/account/context')) return respond(res, { tenantId: 'TEN', userId: 'human' });
    if (hit.url.endsWith('/deactivate')) { later++; return respond(res, {}); }
    commands++; respond(res, malformed ? { execution: { status: 'completed' } } : { execution: { commandId: 'native-command', result: { kind, text: 'native result' } } });
  });
  f.store.save({ activeProfile: 'Demo', profiles: { Demo: { server: service.url, tenant: 'TEN', runtime: service.url, applicationId: 'APP', bearerToken: 'caller' } } });
  f.store.saveSession('Demo', service.url, 'TEN', 'session', Date.now() + 300000);
  const input = join(f.directory, 'input.json'), plan = join(f.directory, 'batch.json'); writeFileSync(input, '{"line":"/status"}');
  const entries = [ ['agent', 'chat', 'command', 'original', '--line', '/status'], ['workforce', 'session', 'command', 'original', '--workforce', service.url, '--request-json', input] ];
  for (const argv of entries) {
    writeFileSync(plan, JSON.stringify([argv, ['security', 'role', 'deactivate', 'later']]));
    const result = await f.run(['batch', plan, '--json']); assert.equal(result.code, 1, result.stdout);
    assert.equal(output(result).error.details.results[0].error.code, 'execution_failed'); assert.equal(later, 0);
  }
  kind = 'success'; for (const argv of entries) { const result = await f.run([...argv, '--json']); assert.equal(result.code, 0, result.stdout); }
  malformed = true; for (const argv of entries) assert.equal(output(await f.run([...argv, '--json'])).error.code, 'outcome_unknown');
  assert.equal(commands, 6);
});

test('raw gateway errors preserve unknown write semantics while definite denials remain definite', async t => {
  const f = fixture(t); let status = 502;
  const service = await mockServer(t, (_hit, res) => respond(res, { errorCode: 'upstream.failed' }, status)); f.profile(service.url, 'tenant', 'caller');
  const argv = ['http', 'interface', 'debug', 'original', '--request-json', '-', '--json'];
  const unknown = await f.run(argv, { stdin: '{}' });
  assert.equal(output(unknown).error.code, 'outcome_unknown'); assert.equal(output(unknown).error.details.response.statusCode, 502);
  status = 403; assert.equal(output(await f.run(argv, { stdin: '{}' })).error.code, 'permission_denied'); assert.equal(service.hits.length, 2);
});

test('lost delivery receipts retain the original body idempotency key and business target without sending again', async t => {
  const f = fixture(t), service = await mockServer(t, (hit, res) => {
    assert.equal(hit.json().idempotencyKey, 'original-delivery'); assert.equal(hit.json().whatId, 'original-record'); res.destroy();
  }); f.profile(service.url, 'tenant', 'caller');
  const result = await f.run(['email', 'template', 'send-test', 'original', '--request-json', '-', '--json'], {
    stdin: '{"data":{},"idempotencyKey":"original-delivery","whatId":"original-record"}',
  });
  const error = output(result).error; assert.equal(error.code, 'outcome_unknown');
  assert.equal(error.details.idempotencyKey, 'original-delivery'); assert.equal(error.details.whatId, 'original-record'); assert.equal(service.hits.length, 1);
});
