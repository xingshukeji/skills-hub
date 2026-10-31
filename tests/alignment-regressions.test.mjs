import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, mockServer, respond } from './helpers.mjs';

const output = value => JSON.parse(value.stdout);

test('required native paging works without flags and preserves explicit flags and query files', async t => {
  const f = fixture(t), service = await mockServer(t, (hit, res) => {
    const query = new URL(hit.url, 'http://fixture').searchParams;
    if (!query.has('page') || !query.has('pageSize')) return respond(res, {}, 400);
    respond(res, { page: Number(query.get('page')), pageSize: Number(query.get('pageSize')), items: [] });
  });
  f.profile(service.url, 'tenant', 'caller');
  const query = join(f.directory, 'query.json'); writeFileSync(query, '{"page":4,"pageSize":7,"search":"case"}');
  for (const argv of [['routine', 'list'], ['metadata', 'picklist', 'list'], ['metadata', 'picklist-item', 'list', 'original']]) {
    const first = await f.run([...argv, '--json']); assert.equal(first.code, 0, first.stdout);
    assert.deepEqual(output(first).data, { page: 1, pageSize: 20, items: [] });
    const flags = await f.run([...argv, '--page', '2', '--page-size', '5', '--json']);
    assert.deepEqual(output(flags).data, { page: 2, pageSize: 5, items: [] });
    const complete = await f.run([...argv, '--query-json', query, '--json']);
    assert.deepEqual(output(complete).data, { page: 4, pageSize: 7, items: [] });
  }
});

test('ephemeral directory and text use the saved application, explicit override and personal scope', async t => {
  const f = fixture(t); let expected = 'APP';
  const service = await mockServer(t, (hit, res) => {
    assert.equal(hit.headers['x-xrain-application-id'], expected);
    if (expected && hit.headers['x-xrain-application-id'] !== expected) return respond(res, { error: 'FORBIDDEN' }, 403);
    if (hit.method === 'GET') return respond(res, { agents: [{ id: 'writer' }], applicationId: expected ?? null });
    assert.deepEqual(hit.json(), { agentId: 'writer', prompt: 'Rewrite' }); respond(res, { answer: 'Rewritten' });
  });
  f.store.save({ activeProfile: 'Demo', profiles: { Demo: { server: service.url, tenant: 'tenant', runtime: service.url, applicationId: 'APP', bearerToken: 'caller' } } });
  for (const options of [[], ['--application-id', 'OTHER'], ['--personal']]) {
    expected = options.length === 0 ? 'APP' : options[0] === '--personal' ? undefined : 'OTHER';
    for (const argv of [['agent', 'ephemeral', 'directory'], ['agent', 'ephemeral', 'generate', 'writer', '--message', 'Rewrite']]) {
      const result = await f.run([...argv, ...options, '--json']); assert.equal(result.code, 0, result.stdout);
    }
  }
  assert.equal(service.hits.length, 6);
});

test('Host temporal reads use the native Host identity without supplying a tenant', async t => {
  const f = fixture(t), service = await mockServer(t, (hit, res) => {
    assert.equal(hit.headers.authorization, 'Bearer host-caller'); assert.equal(hit.headers['x-tenant-id'], undefined);
    assert.match(hit.url, /\/account\/temporal\/(resolve|day-range)$/); respond(res, { status: 'resolved' });
  });
  f.store.save({ activeProfile: 'Host', profiles: { Host: { server: service.url, scope: 'host', tenant: null, bearerToken: 'host-caller' } } });
  for (const [action, body] of [['resolve', { items: [] }], ['day-range', { date: '2026-10-31', timeZoneId: 'Asia/Shanghai' }]]) {
    const result = await f.run(['time', action, '--request-json', '-', '--json'], { stdin: JSON.stringify(body) });
    assert.equal(result.code, 0, result.stdout);
  }
});

test('raw HTTP debug retains text, JSON bytes, status and headers rather than parsing a write receipt', async t => {
  const f = fixture(t); let body = 'plain result\n', contentType = 'text/plain';
  const service = await mockServer(t, (_hit, res) => {
    res.writeHead(200, { 'content-type': contentType, 'x-debug': 'original', 'set-cookie': 'private-cookie' }); res.end(body);
  });
  f.profile(service.url, 'tenant', 'caller');
  for (const argv of [['http', 'request', 'debug', 'connector', 'name'], ['http', 'interface', 'debug', 'original']]) {
    const result = await f.run([...argv, '--request-json', '-', '--json'], { stdin: 'null' });
    assert.equal(result.code, 0, result.stdout); const data = output(result).data;
    assert.equal(data.statusCode, 200); assert.equal(data.body, body.replace('private-from-debug', '[REDACTED]')); assert.equal(data.encoding, 'utf8');
    assert.equal(data.headers['x-debug'], 'original'); assert.ok(!result.stdout.includes('private-cookie'));
    assert.ok(!result.stdout.includes('private-from-debug'));
    body = '{"answer":true,"api_token":"private-from-debug"}\n'; contentType = 'application/json';
  }
});

test('raw binary output is exact, exclusive and cleaned when the request has no receipt', async t => {
  const f = fixture(t), bytes = Buffer.from([0, 255, 128, 1]); let drop = false, interrupt = false;
  const service = await mockServer(t, (_hit, res) => {
    if (interrupt) { process.emit('SIGINT'); return; }
    if (drop) return res.destroy(); res.writeHead(200, { 'content-type': 'application/octet-stream' }); res.end(bytes);
  });
  f.profile(service.url, 'tenant', 'caller');
  const argv = ['http', 'interface', 'debug', 'original', '--request-json', '-', '--json'];
  const encoded = await f.run(argv, { stdin: '{}' });
  assert.equal(output(encoded).data.encoding, 'base64'); assert.equal(output(encoded).data.body, bytes.toString('base64'));
  const out = join(f.directory, 'response.bin');
  const saved = await f.run([...argv, '--out', out], { stdin: '{}' });
  assert.equal(saved.code, 0, saved.stdout); assert.deepEqual(readFileSync(out), bytes);
  assert.equal(output(saved).data.bytes, bytes.length); assert.equal(output(saved).data.body, undefined);
  const count = service.hits.length;
  assert.equal(output(await f.run([...argv, '--out', out], { stdin: '{}' })).error.code, 'output_exists');
  assert.equal(service.hits.length, count); assert.deepEqual(readFileSync(out), bytes);
  drop = true; const lost = join(f.directory, 'lost.bin');
  assert.equal(output(await f.run([...argv, '--out', lost], { stdin: '{}' })).error.code, 'outcome_unknown');
  assert.equal(service.hits.length, count + 1); assert.equal(existsSync(lost), false);
  interrupt = true;
  assert.equal(output(await f.run([...argv, '--out', lost], { stdin: '{}' })).error.code, 'outcome_unknown');
  assert.equal(service.hits.length, count + 2); assert.equal(existsSync(lost), false);
});

test('raw failed HTTP responses remain inspectable and never continue a batch', async t => {
  const f = fixture(t); let calls = 0;
  const service = await mockServer(t, (_hit, res) => { calls++; res.writeHead(503, { 'content-type': 'text/plain', 'x-debug': 'failed' }); res.end('upstream unavailable'); });
  f.profile(service.url, 'tenant', 'caller');
  const input = join(f.directory, 'input.json'), plan = join(f.directory, 'batch.json'); writeFileSync(input, '{}');
  writeFileSync(plan, JSON.stringify([['http', 'interface', 'debug', 'original', '--request-json', input], ['security', 'role', 'deactivate', 'later']]));
  const result = await f.run(['batch', plan, '--json']);
  const error = output(result).error.details.results[0].error;
  assert.equal(result.code, 1); assert.equal(error.httpStatus, 503); assert.equal(error.details.response.body, 'upstream unavailable');
  assert.equal(error.details.response.headers['x-debug'], 'failed'); assert.equal(calls, 1);
});

test('execution actions stop on native business failure while inspection of failed history succeeds', async t => {
  const f = fixture(t); let success = false, later = 0;
  const service = await mockServer(t, (hit, res) => {
    if (hit.url.endsWith('/deactivate')) { later++; return respond(res, {}); }
    if (hit.url.endsWith('/history')) return respond(res, [{ status: 'failed' }]);
    respond(res, { isSuccess: success, statusCode: success ? 200 : 500, body: { error: 'downstream' }, errorCode: success ? null : 'execution.failed' });
  });
  f.profile(service.url, 'tenant', 'caller');
  const input = join(f.directory, 'input.json'), plan = join(f.directory, 'batch.json'); writeFileSync(input, '{}');
  for (const argv of [['http', 'interface', 'invoke', 'original'], ['orchestration', 'debug']]) {
    writeFileSync(plan, JSON.stringify([[...argv, '--request-json', input], ['security', 'role', 'deactivate', 'later']]));
    const result = await f.run(['batch', plan, '--json']);
    assert.equal(result.code, 1); assert.equal(output(result).error.details.results[0].error.code, 'execution_failed'); assert.equal(later, 0);
  }
  success = true;
  assert.equal((await f.run(['batch', plan, '--json'])).code, 0); assert.equal(later, 1);
  assert.equal((await f.run(['routine', 'history', 'original', '--json'])).code, 0);
});

test('lost creates retain original request keys, ETags and object names without replay', async t => {
  const f = fixture(t), entityApiName = 'review__case__c', fieldApiName = 'amount';
  const service = await mockServer(t, (hit, res) => {
    assert.equal(hit.headers['idempotency-key'], 'original-key'); assert.equal(hit.headers['if-match'], '"observed"'); res.destroy();
  });
  f.profile(service.url, 'tenant', 'caller');
  for (const [argv, body, target] of [
    [['metadata', 'entity', 'create'], { entityApiName, label: 'Review' }, { entityApiName }],
    [['metadata', 'field', 'create', 'customer'], { fieldApiName, label: 'Amount', type: 'decimal' }, { entity: 'customer', fieldApiName }],
  ]) {
    const result = await f.run([...argv, '--request-key', 'original-key', '--if-match', '"observed"', '--request-json', '-', '--json'], { stdin: JSON.stringify(body) });
    const error = output(result).error; assert.equal(error.code, 'outcome_unknown');
    assert.equal(error.details.requestKey, 'original-key'); assert.equal(error.details.ifMatch, '"observed"'); assert.deepEqual(error.details.target, target);
  }
  assert.equal(service.hits.length, 2);
});

test('metadata mutation receipts require the native version and matching target; empty 204 remains valid', async t => {
  const f = fixture(t); let receipt = { unexpected: true };
  const service = await mockServer(t, (hit, res) => {
    if (hit.url.endsWith(':reconcilePermissions')) { res.writeHead(204); return res.end(); }
    respond(res, receipt);
  });
  f.profile(service.url, 'tenant', 'caller');
  const argv = ['metadata', 'entity', 'create', '--request-key', 'original', '--if-match', '"original"', '--request-json', '-', '--json'];
  const invoke = () => f.run(argv, { stdin: '{"entityApiName":"review__case__c","label":"Review"}' });
  assert.equal(output(await invoke()).error.code, 'outcome_unknown');
  receipt = { metadataRevision: 9, etag: '"r9"', object: { objectId: 'object-one', entityApiName: 'neighbor__case__c' } };
  assert.equal(output(await invoke()).error.code, 'outcome_unknown');
  receipt.object.entityApiName = 'review__case__c';
  assert.equal((await invoke()).code, 0);
  assert.equal((await f.run(['metadata', 'field', 'reconcile-permissions', 'customer', 'name', '--json'])).code, 0);
  assert.equal(service.hits.length, 4);
});
