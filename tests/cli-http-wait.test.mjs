import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { request } from '../src/xrain-cli/http.mjs';
import { appClient } from '../src/xrain-cli/app.mjs';
import { fixture, mockServer, respond } from './helpers.mjs';

test('ordinary HTTP requests wait for complete responses without an implicit deadline', async t => {
  const timer = t.mock.method(AbortSignal, 'timeout');
  const service = await mockServer(t, async (_hit, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.write('{"value":'); await delay(60); response.end('"complete"}');
  });
  for (const options of [undefined, { timeout: undefined }, { timeout: null }]) {
    assert.deepEqual((await request(service.url, options)).json(), { value: 'complete' });
  }
  assert.equal(timer.mock.callCount(), 0);
  assert.equal(service.hits.length, 3);
});

for (const phase of ['headers', 'body']) {
  test(`explicit HTTP timeout still ends a delayed ${phase} response`, async t => {
    const service = await mockServer(t, async (_hit, response) => {
      if (phase === 'body') { response.writeHead(200); response.write('{'); }
      await delay(100); response.end('{}');
    });
    await assert.rejects(request(service.url, { timeout: 25 }), error => error.code === 'timeout');
    assert.equal(service.hits.length, 1);
  });

  test(`caller cancellation still closes a delayed ${phase} request without replay`, async t => {
    const controller = new AbortController(); let closed;
    const disconnected = new Promise(resolve => { closed = resolve; });
    const service = await mockServer(t, (_hit, response) => {
      response.once('close', closed);
      if (phase === 'body') { response.writeHead(200); response.write('{'); }
      controller.abort();
    });
    await assert.rejects(request(service.url, { signal: controller.signal }), error => error.code === 'timeout');
    await disconnected;
    assert.equal(service.hits.length, 1);
  });
}

test('application requests preserve optional timeouts and take the earlier explicit operation budget', async t => {
  const f = fixture(t), timer = t.mock.method(AbortSignal, 'timeout');
  const service = await mockServer(t, async (_hit, response) => { await delay(70); respond(response, { original: true }); });
  f.profile(service.url);
  f.store.saveSession('Demo', service.url, 'tenant-demo', 'isolated-session', Date.now() + 300000);
  assert.deepEqual((await appClient(f.context([])).send('GET', '/read')).json(), { original: true });
  assert.equal(timer.mock.callCount(), 0);
  await assert.rejects(appClient(f.context([])).send('GET', '/read', { timeout: 25 }), error => error.code === 'timeout');
  assert.deepEqual((await appClient(f.context(['--timeout', '1'])).send('GET', '/read', { timeout: 2000 })).json(), { original: true });
  assert.deepEqual(timer.mock.calls.map(call => call.arguments[0]), [25, 1000]);
});

test('import reads accept the absent deadline without coercing it into a one millisecond timeout', async t => {
  const f = fixture(t), timer = t.mock.method(AbortSignal, 'timeout'), jobId = 'a'.repeat(32);
  const receipt = { disclosure: 'restricted', jobId, requestId: 'b'.repeat(32), entityCode: 'customer', reason: 'details_unavailable' };
  const service = await mockServer(t, async (_hit, response) => { await delay(70); respond(response, receipt); });
  f.profile(service.url);
  const args = ['data', 'import', 'show', '--entity', 'customer', '--job', jobId, '--json'];
  const result = await f.run(args);
  assert.equal(result.code, 0, result.stdout); assert.deepEqual(JSON.parse(result.stdout).data, { ...receipt, message: '任务详情暂不可用，任务可能仍在处理；可按原任务编号查询、暂停或结束。' });
  assert.equal(timer.mock.callCount(), 0);
  assert.equal((await f.run([...args, '--timeout', '2'])).code, 0);
  assert.deepEqual(timer.mock.calls.map(call => call.arguments[0]), [2000]);
  assert.equal(service.hits.length, 2);
});

test('an explicit write timeout retains the unknown outcome and original request key without retry', async t => {
  const f = fixture(t), key = 'original-request';
  const service = await mockServer(t, async (_hit, response) => { await delay(1300); respond(response, {}); });
  f.profile(service.url, 'tenant-demo', 'isolated-bearer');
  const result = await f.run(['data', 'create', 'customer', '--values', '{"name":"original"}', '--request-key', key, '--timeout', '1', '--json']);
  assert.equal(result.code, 1);
  const error = JSON.parse(result.stdout).error;
  assert.equal(error.code, 'outcome_unknown'); assert.equal(error.details.requestKey, key);
  assert.equal(service.hits.length, 1);
  assert.deepEqual(service.hits[0].json(), { values: { name: 'original' }, requestKey: key });
});
