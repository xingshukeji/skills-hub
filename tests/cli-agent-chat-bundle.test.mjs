import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fixture, mockServer, respond } from './helpers.mjs';

test('a copied standalone CLI starts and completes an agent conversation', async t => {
  const f = fixture(t); let stream, submissions = 0;
  const service = await mockServer(t, (hit, res) => {
    assert.equal(hit.headers.authorization, 'Bearer synthetic-bundle-token');
    if (hit.method === 'POST' && hit.url === '/v1/dsh/sessions') return respond(res, { sessionId: 'session-bundle' }, 201);
    if (hit.method === 'GET' && hit.url.endsWith('/stream')) {
      stream = res; res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: {"type":"pending-actions","items":[]}\n\n');
      res.write('data: {"type":"snapshot","records":[],"hasMore":false}\n\n'); return;
    }
    if (hit.method === 'POST' && hit.url.endsWith('/inputs')) {
      submissions++; const body = hit.json(); respond(res, { accepted: true }, 202);
      const events = [
        { type: 'turn/start', data: { turn: 1 } },
        { type: 'user/message', data: { source: { kind: 'user', rpcId: body.requestId }, content: body.content } },
        { type: 'assistant/message', data: { turn: 1, message: { content: [{ type: 'text', text: 'bundle reply' }] } } },
        { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
      ];
      for (const event of events) stream.write(`data: ${JSON.stringify({ type: 'event', event })}\n\n`);
      return;
    }
    respond(res, { error: 'NOT_FOUND' }, 404);
  });
  const skill = join(f.directory, 'isolated-skill'); cpSync('skills/shzw-xrain-cli', skill, { recursive: true });
  const script = join(skill, 'scripts/xrain-cli.mjs');
  const env = { ...f.env, XRAIN_SERVER: service.url, XRAIN_TENANT: 'tenant-demo', XRAIN_TOKEN: 'synthetic-bundle-token' };
  const call = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, 'agent', 'chat', 'start', 'agent-one', '--message', 'hello', '--runtime', service.url, '--wait-timeout', '3', '--json'], { cwd: f.directory, env, windowsHide: true });
    let stdout = '', stderr = '';
    child.stdout.on('data', value => { stdout += value; }); child.stderr.on('data', value => { stderr += value; });
    child.on('error', reject); child.on('close', code => resolve({ code, stdout, stderr }));
  });
  assert.equal(call.code, 0, call.stdout); assert.equal(JSON.parse(call.stdout).data.answer, 'bundle reply');
  assert.equal(JSON.parse(call.stdout).data.sessionId, 'session-bundle'); assert.equal(submissions, 1);
  assert.ok(!(call.stdout + call.stderr).includes('synthetic-bundle-token'));
});
