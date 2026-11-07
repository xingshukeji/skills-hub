import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mockServer, respond } from './helpers.mjs';

test('contract mocks survive synchronous credential work between reused-socket requests', async t => {
  const service = await mockServer(t, (_hit, res) => respond(res, { ready: true }));
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  t.after(() => agent.destroy());
  let connections = 0;
  service.server.on('connection', () => connections++);
  const read = () => new Promise((resolve, reject) => {
    const request = http.get(service.url, { agent }, response => {
      let body = '';
      response.setEncoding('utf8'); response.on('data', chunk => body += chunk);
      response.on('end', () => resolve({ status: response.statusCode, body }));
      response.on('error', reject);
    });
    request.on('error', reject);
  });
  assert.deepEqual(await read(), { status: 200, body: '{"ready":true}' });
  // Exceed Node's former 5s idle deadline plus its 1s server buffer while the
  // client and mock cannot process their queued socket timers.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 6200);
  assert.deepEqual(await read(), { status: 200, body: '{"ready":true}' });
  assert.equal(connections, 1);
  assert.equal(service.hits.length, 2);
});
