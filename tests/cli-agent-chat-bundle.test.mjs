import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { fixture, mockServer, respond } from './helpers.mjs';

function invoke(script, argv, f, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...argv], { cwd: f.directory, env, windowsHide: true });
    let stdout = '', stderr = '';
    child.stdout.on('data', value => { stdout += value; }); child.stderr.on('data', value => { stderr += value; });
    child.on('error', reject); child.on('close', code => resolve({ code, stdout, stderr }));
  });
}

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
  const call = await invoke(script, ['agent', 'chat', 'start', 'agent-one', '--message', 'hello', '--runtime', service.url, '--wait-timeout', '3', '--json'], f, env);
  assert.equal(call.code, 0, call.stdout); assert.equal(JSON.parse(call.stdout).data.answer, 'bundle reply');
  assert.equal(JSON.parse(call.stdout).data.sessionId, 'session-bundle'); assert.equal(submissions, 1);
  assert.ok(!(call.stdout + call.stderr).includes('synthetic-bundle-token'));
});

for (const earlyTerminal of [false, true]) test(`a copied CLI ${earlyTerminal ? 'uses a correlated terminal event before a delayed receipt' : 'bounds an unconfirmed POST and reads the same request without replay'}`, async t => {
  const f = fixture(t); let stream, records = [], inputs = 0;
  const timers = new Set(); t.after(() => { for (const timer of timers) clearTimeout(timer); });
  const service = await mockServer(t, (hit, res) => {
    if (hit.method === 'GET' && hit.url.endsWith('/stream')) {
      stream = res; res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: {"type":"pending-actions","items":[]}\n\n');
      res.write(`data: ${JSON.stringify({ type: 'snapshot', records, hasMore: false })}\n\n`); return;
    }
    if (hit.method === 'POST' && hit.url.endsWith('/inputs')) {
      inputs++; const body = hit.json();
      records = [
        { event: { type: 'turn/start', data: { turn: 1 } } },
        { event: { type: 'user/message', data: { source: { kind: 'user', rpcId: body.requestId }, content: body.content } } },
        { event: { type: 'assistant/message', data: { turn: 1, message: { content: [{ type: 'text', text: 'persisted bundle reply' }] } } } },
        { event: { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } } },
      ];
      if (earlyTerminal) for (const record of records) stream.write(`data: ${JSON.stringify({ type: 'event', event: record.event })}\n\n`);
      timers.add(setTimeout(() => { if (!res.destroyed) respond(res, { accepted: true }, 202); }, 3000)); return;
    }
    respond(res, {}, 404);
  });
  const skill = join(f.directory, 'isolated-skill'); cpSync('skills/shzw-xrain-cli', skill, { recursive: true });
  const script = join(skill, 'scripts/xrain-cli.mjs');
  const env = { ...f.env, XRAIN_SERVER: service.url, XRAIN_TENANT: 'tenant-demo', XRAIN_TOKEN: 'synthetic-bundle-token' };
  const common = ['--runtime', service.url, '--wait-timeout', '1', '--timeout', '5', '--json'];
  const start = performance.now();
  const result = await invoke(script, ['agent', 'chat', 'send', 'bundle-session', '--request-id', 'original-bundle-request', '--message', 'hello', ...common], f, env);
  assert.ok(performance.now() - start < 2300, result.stdout);
  assert.equal(result.code, earlyTerminal ? 0 : 1, result.stdout);
  const payload = JSON.parse(result.stdout);
  if (earlyTerminal) assert.equal(payload.data.answer, 'persisted bundle reply');
  else {
    assert.equal(payload.error.code, 'outcome_unknown');
    assert.equal(payload.error.details.sessionId, 'bundle-session');
    assert.equal(payload.error.details.requestId, 'original-bundle-request');
    assert.doesNotMatch(payload.error.hint, /not submitted/);
    const recovered = await invoke(script, ['agent', 'chat', 'wait', 'bundle-session', '--request-id', 'original-bundle-request', ...common], f, env);
    assert.equal(recovered.code, 0, recovered.stdout);
    assert.equal(JSON.parse(recovered.stdout).data.answer, 'persisted bundle reply');
  }
  assert.equal(inputs, 1); assert.ok(service.hits.every(hit => !hit.url.includes('/cancel')));
});

test('a copied standalone CLI recovers a long completed turn from older history pages', async t => {
  const f = fixture(t);
  const event = (type, seq, data) => ({ event: { type, seq, data } });
  const records = [event('turn/start', 0, { turn: 1 }), event('user/message', 1,
    { source: { kind: 'user', rpcId: 'long-bundle-request' }, content: [{ type: 'text', text: 'long task' }] })];
  for (let i = 0; i < 110; i++) records.push(event('tool/call', 2 + i * 2, { turn: 1, callId: `call-${i}`, name: 'read' }),
    event('tool/result', 3 + i * 2, { turn: 1, message: { role: 'tool', toolCallId: `call-${i}` } }));
  records.push(event('assistant/message', 222, { turn: 1, message: { content: [{ type: 'text', text: 'recovered bundle answer' }] } }),
    event('turn/end', 223, { turn: 1, reason: { kind: 'completed' } }));
  const service = await mockServer(t, (hit, res) => {
    assert.equal(hit.headers['x-xrain-application-id'], 'app-bundle');
    const url = new URL(hit.url, 'http://local');
    if (url.pathname.endsWith('/stream')) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ type: 'snapshot', cursor: 223, records: records.slice(-100), hasMore: true })}\n\n`); return;
    }
    if (url.pathname.endsWith('/history')) {
      assert.equal(url.searchParams.get('throughSeq'), '223');
      const eligible = records.filter(row => row.event.seq < Number(url.searchParams.get('beforeSeq')));
      return respond(res, { records: eligible.slice(-100), hasMore: eligible.length > 100 });
    }
    respond(res, {}, 404);
  });
  const skill = join(f.directory, 'isolated-skill'); cpSync('skills/shzw-xrain-cli', skill, { recursive: true });
  const env = { ...f.env, XRAIN_SERVER: service.url, XRAIN_TENANT: 'tenant-demo', XRAIN_TOKEN: 'synthetic-bundle-token' };
  const call = await invoke(join(skill, 'scripts/xrain-cli.mjs'), ['agent', 'chat', 'wait', 'long-bundle-session',
    '--request-id', 'long-bundle-request', '--runtime', service.url, '--application-id', 'app-bundle', '--wait-timeout', '3', '--json'], f, env);
  assert.equal(call.code, 0, call.stdout);
  assert.equal(JSON.parse(call.stdout).data.answer, 'recovered bundle answer');
  assert.equal(JSON.parse(call.stdout).data.toolCalls.length, 110);
  assert.equal(service.hits.filter(hit => hit.url.includes('/history?')).length, 2);
  assert.ok(service.hits.every(hit => hit.method === 'GET'));
});
