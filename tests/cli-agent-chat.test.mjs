import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fixture, mockServer, respond } from './helpers.mjs';

const result = value => JSON.parse(value.stdout);
const frame = value => `data: ${JSON.stringify(value)}\n\n`;
const event = (type, seq, data) => ({ event: { type, seq, data } });
const user = (seq, requestId, text) => event('user/message', seq, { source: { kind: 'user', rpcId: requestId }, content: [{ type: 'text', text }] });
const assistant = (seq, turn, text) => event('assistant/message', seq, { turn, message: { content: [{ type: 'text', text }] } });
const start = (seq, turn) => event('turn/start', seq, { turn });
const end = (seq, turn, kind = 'completed') => event('turn/end', seq, { turn, reason: { kind } });

async function delayedConversation(t, { inputDelay = 0, creationDelay = 0, earlyTerminal = false, dropStream = false } = {}) {
  let stream, records = [], creates = 0, sends = 0;
  const timers = new Set();
  const later = (action, ms) => { const timer = setTimeout(() => { timers.delete(timer); action(); }, ms); timers.add(timer); };
  t.after(() => { for (const timer of timers) clearTimeout(timer); });
  const service = await mockServer(t, (hit, res) => {
    if (hit.method === 'POST' && hit.url === '/v1/dsh/sessions') {
      creates++; later(() => { if (!res.destroyed) respond(res, { sessionId: 'delayed-session' }, 201); }, creationDelay); return;
    }
    if (hit.url === '/v1/dsh/sessions/delayed-session/stream') {
      stream = res; res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(frame({ type: 'snapshot', records, hasMore: false })); return;
    }
    if (hit.url === '/v1/dsh/sessions/delayed-session/inputs') {
      sends++;
      const input = hit.json();
      records = [start(1, 1), user(2, input.requestId, input.content[0].text), assistant(3, 1, 'stored reply'), end(4, 1)];
      const publish = () => { if (!stream.destroyed) for (const record of records) stream.write(frame({ type: 'event', ...record })); };
      if (earlyTerminal) publish();
      if (dropStream) stream.end();
      later(() => {
        if (!res.destroyed) respond(res, { accepted: true }, 202);
        if (!earlyTerminal && !dropStream) publish();
      }, inputDelay);
      return;
    }
    respond(res, {}, 404);
  });
  return { ...service, state: () => ({ creates, sends }) };
}

test('the deadline bounds a delayed POST and the original request can be read without another input', async t => {
  const f = fixture(t), service = await delayedConversation(t, { inputDelay: 2300 });
  f.profile(service.url, 'tenant-demo', 'synthetic-token');
  const target = ['--runtime', service.url, '--request-id', 'original-request', '--wait-timeout', '1', '--timeout', '5', '--json'];
  const began = performance.now();
  const sent = await f.run(['agent', 'chat', 'send', 'delayed-session', '--message', 'test', ...target]);
  assert.ok(performance.now() - began < 1800, sent.stdout);
  assert.equal(result(sent).error.code, 'outcome_unknown');
  assert.equal(result(sent).error.details.sessionId, 'delayed-session');
  assert.equal(result(sent).error.details.requestId, 'original-request');
  assert.ok(!sent.stdout.includes('not submitted'));
  const read = await f.run(['agent', 'chat', 'wait', 'delayed-session', ...target]);
  assert.equal(read.code, 0, read.stdout); assert.equal(result(read).data.answer, 'stored reply');
  assert.deepEqual(service.state(), { creates: 0, sends: 1 });
  assert.ok(service.hits.every(hit => !hit.url.endsWith('/cancel')));
});

test('the same deadline includes session creation and is not restarted before input submission', async t => {
  const f = fixture(t), service = await delayedConversation(t, { creationDelay: 600, inputDelay: 700 });
  f.profile(service.url, 'tenant-demo', 'synthetic-token');
  const sent = await f.run(['agent', 'chat', 'start', 'agent-one', '--message', 'test', '--runtime', service.url,
    '--request-id', 'creation-budget', '--wait-timeout', '1', '--timeout', '5', '--json']);
  assert.equal(result(sent).error.code, 'outcome_unknown');
  assert.equal(result(sent).error.details.sessionId, 'delayed-session');
  assert.equal(result(sent).error.details.requestId, 'creation-budget');
  assert.deepEqual(service.state(), { creates: 1, sends: 1 });
});

test('a correlated terminal event completes before its delayed HTTP receipt', async t => {
  const f = fixture(t), service = await delayedConversation(t, { inputDelay: 2300, earlyTerminal: true });
  f.profile(service.url, 'tenant-demo', 'synthetic-token');
  const sent = await f.run(['agent', 'chat', 'send', 'delayed-session', '--message', 'test', '--runtime', service.url,
    '--request-id', 'early-terminal', '--wait-timeout', '1', '--timeout', '5', '--json']);
  assert.equal(sent.code, 0, sent.stdout); assert.equal(result(sent).data.status, 'completed');
  assert.equal(result(sent).data.requestId, 'early-terminal'); assert.equal(result(sent).data.answer, 'stored reply');
  assert.equal(service.state().sends, 1);
});

test('stream loss during an unconfirmed POST retains the original input for readback', async t => {
  const f = fixture(t), service = await delayedConversation(t, { inputDelay: 2300, dropStream: true });
  f.profile(service.url, 'tenant-demo', 'synthetic-token');
  const target = ['--runtime', service.url, '--request-id', 'lost-stream', '--wait-timeout', '1', '--json'];
  const sent = await f.run(['agent', 'chat', 'send', 'delayed-session', '--message', 'test', ...target]);
  assert.equal(result(sent).error.code, 'outcome_unknown');
  const read = await f.run(['agent', 'chat', 'wait', 'delayed-session', ...target]);
  assert.equal(read.code, 0, read.stdout); assert.equal(result(read).data.answer, 'stored reply');
  assert.equal(service.state().sends, 1);
});

function setup(t, { pending = false, initialPending = false, interrupted = false, neverFinish = false, denied = false, reason = 'completed' } = {}) {
  let stream, requestId, savedText = '', answered = false, creates = 0, sends = 0;
  const prior = [start(1, 1), user(2, 'old-request', 'old'), assistant(3, 1, 'old answer'), end(4, 1)];
  const histories = () => answered ? [...prior, start(5, 2), user(6, requestId, savedText), assistant(7, 2, 'new answer'), end(8, 2)] : prior;
  const servicePromise = mockServer(t, (hit, res) => {
    assert.equal(hit.headers.authorization, 'Bearer synthetic-token');
    const url = new URL(hit.url, 'http://local');
    if (hit.method === 'GET' && url.pathname === '/v1/dsh/sessions') return respond(res, { items: [{ sessionId: 'session-1', source: 'xrain-cli', agentId: 'agent-one', applicationId: 'app-1' }] });
    if (hit.method === 'POST' && url.pathname === '/v1/dsh/sessions') {
      creates++; assert.equal(hit.headers['x-xrain-application-id'], 'app-1');
      assert.deepEqual(hit.json(), { agentId: 'agent-one', source: 'xrain-cli' });
      return respond(res, { sessionId: 'session-1' }, 201);
    }
    if (hit.method === 'GET' && url.pathname === '/v1/dsh/sessions/session-1/history')
      return respond(res, { type: 'snapshot', hasMore: false, records: [...histories(), event('user/message', 9, { source: { kind: 'runtime-context' }, content: [{ type: 'text', text: 'internal' }] })] });
    if (hit.method === 'GET' && url.pathname === '/v1/dsh/pending-actions') return respond(res, { items: pending && !answered ? [{ actionRef: 'action-1', sessionId: 'session-1', kind: 'approval', toolName: 'read' }] : [] });
    if (hit.method === 'POST' && url.pathname === '/v1/dsh/pending-actions/action-1/responses') {
      assert.equal(hit.headers['x-xrain-application-id'], 'app-1'); assert.equal(hit.json().outcome, 'allowed-once'); assert.ok(hit.json().responseId);
      answered = true; return respond(res, { accepted: true }, 202);
    }
    if (hit.method === 'GET' && url.pathname === '/v1/dsh/sessions/session-1/stream') {
      assert.equal(hit.headers['x-xrain-application-id'], 'app-1');
      if (denied) return respond(res, { error: 'SESSION_NOT_FOUND' }, 404);
      stream = res; res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(frame({ type: 'pending-actions', items: initialPending ? [{ actionRef: 'old-action', sessionId: 'session-1', kind: 'approval' }] : [] }));
      const snapshot = frame({ type: 'snapshot', records: histories(), hasMore: false });
      res.write(snapshot.slice(0, 11)); res.write(snapshot.slice(11));
      return;
    }
    if (hit.method === 'POST' && url.pathname === '/v1/dsh/sessions/session-1/inputs') {
      sends++; assert.equal(hit.headers['x-xrain-application-id'], 'app-1');
      const input = hit.json(); requestId = input.requestId; savedText = input.content[0].text;
      if (interrupted) return res.destroy();
      respond(res, { accepted: true }, 202);
      if (neverFinish) return;
      for (const record of [start(5, 2), user(6, requestId, savedText)]) stream.write(frame({ type: 'event', ...record }));
      if (pending) stream.write(frame({ type: 'pending-actions', items: [{ actionRef: 'action-1', sessionId: 'session-1', kind: 'approval', toolName: 'read' }] }));
      else for (const record of [event('tool/call', 7, { turn: 2, callId: 'tool-1', name: 'read' }), event('tool/result', 8, { turn: 2, message: { role: 'tool', toolCallId: 'tool-1', isError: false } }), assistant(9, 2, 'new answer'), end(10, 2, reason)]) stream.write(frame({ type: 'event', ...record }));
      return;
    }
    respond(res, { error: 'NOT_FOUND' }, 404);
  });
  return { servicePromise, state: () => ({ requestId, creates, sends }) };
}

test('chat starts and continues the selected agent only after observing its own completed turn', async t => {
  const f = fixture(t), mock = setup(t), service = await mock.servicePromise;
  f.profile(service.url, 'tenant-demo', 'synthetic-token');
  const options = ['--runtime', service.url, '--application-id', 'app-1', '--wait-timeout', '3', '--json'];
  const started = await f.run(['agent', 'chat', 'start', 'agent-one', '--message', 'first message', ...options]);
  assert.equal(started.code, 0, started.stdout); const first = result(started).data;
  assert.equal(first.sessionId, 'session-1'); assert.equal(first.status, 'completed'); assert.equal(first.answer, 'new answer');
  assert.deepEqual(first.toolCalls, [{ name: 'read', status: 'succeeded' }]); assert.equal(first.requestId, mock.state().requestId);
  assert.match(started.stderr, /Session ID: session-1/); assert.match(started.stderr, /Request ID:/);
  const continued = await f.run(['agent', 'chat', 'send', 'session-1', '--message', 'second message', ...options]);
  assert.equal(continued.code, 0, continued.stdout); assert.equal(result(continued).data.answer, 'new answer');
  assert.deepEqual({ creates: mock.state().creates, sends: mock.state().sends }, { creates: 1, sends: 2 });
  const list = await f.run(['agent', 'chat', 'list', '--runtime', service.url, '--json']);
  assert.equal(result(list).data.items[0].sessionId, 'session-1');
  assert.equal(service.hits.find(hit => hit.method === 'GET' && hit.url.startsWith('/v1/dsh/sessions?')).url, '/v1/dsh/sessions?source=xrain-cli');
  const history = await f.run(['agent', 'chat', 'history', 'session-1', '--runtime', service.url, '--json']);
  assert.equal(result(history).data.items.some(item => item.text === 'old answer'), true);
  assert.ok(!history.stdout.includes('internal')); assert.ok(!started.stdout.includes('synthetic-token'));
});

test('chat reuses the saved Runtime and application while returning the original conversation context', async t => {
  const f = fixture(t), mock = setup(t), service = await mock.servicePromise;
  f.profile(service.url, 'tenant-demo', 'synthetic-token');
  const configured = await f.run(['profile', 'set', '--runtime', service.url, '--application-id', 'app-1', '--json']);
  assert.equal(configured.code, 0, configured.stdout);
  const started = await f.run(['agent', 'chat', 'start', 'agent-one', '--message', 'saved target', '--wait-timeout', '3', '--json']);
  assert.equal(started.code, 0, started.stdout);
  assert.equal(result(started).data.runtime, service.url); assert.equal(result(started).data.applicationId, 'app-1');
  const continued = await f.run(['agent', 'chat', 'send', result(started).data.sessionId, '--message', 'continue', '--wait-timeout', '3', '--json']);
  assert.equal(continued.code, 0, continued.stdout);
  assert.equal(result(continued).data.sessionId, 'session-1'); assert.equal(result(continued).data.runtime, service.url);
  assert.equal(result(continued).data.applicationId, 'app-1'); assert.deepEqual({ creates: mock.state().creates, sends: mock.state().sends }, { creates: 1, sends: 2 });
});

test('pending actions require an explicit response and can be followed to completion without resending', async t => {
  const f = fixture(t), mock = setup(t, { pending: true }), service = await mock.servicePromise;
  f.profile(service.url, 'tenant-demo', 'synthetic-token');
  const options = ['--runtime', service.url, '--application-id', 'app-1', '--wait-timeout', '3', '--json'];
  const waiting = await f.run(['agent', 'chat', 'start', 'agent-one', '--message', 'test', ...options]);
  assert.equal(waiting.code, 1); assert.equal(result(waiting).error.code, 'action_required');
  const details = result(waiting).error.details;
  assert.equal(details.submitted, true); assert.equal(details.pendingActions[0].actionRef, 'action-1');
  const actions = await f.run(['agent', 'chat', 'pending', '--session-id', 'session-1', '--runtime', service.url, '--json']);
  assert.equal(result(actions).data.items.length, 1);
  const answered = await f.run(['agent', 'chat', 'respond', 'action-1', '--values', '{"outcome":"allowed-once"}', '--runtime', service.url, '--application-id', 'app-1', '--json']);
  assert.equal(result(answered).data.accepted, true);
  const completed = await f.run(['agent', 'chat', 'wait', 'session-1', '--request-id', details.requestId, ...options]);
  assert.equal(completed.code, 0, completed.stdout); assert.equal(result(completed).data.answer, 'new answer');
  assert.equal(mock.state().sends, 1);
});

test('old history cannot satisfy a new request, and a lost input response is never replayed', async t => {
  for (const mode of ['timeout', 'lost']) {
    const f = fixture(t), mock = setup(t, mode === 'timeout' ? { neverFinish: true } : { interrupted: true }), service = await mock.servicePromise;
    f.profile(service.url, 'tenant-demo', 'synthetic-token');
    const value = await f.run(['agent', 'chat', 'send', 'session-1', '--message', 'new input', '--runtime', service.url, '--application-id', 'app-1', '--wait-timeout', '1', '--json']);
    assert.equal(value.code, 1); assert.equal(result(value).error.code, mode === 'timeout' ? 'turn_timeout' : 'outcome_unknown');
    assert.equal(result(value).error.details.sessionId, 'session-1'); assert.ok(result(value).error.details.requestId);
    assert.equal(mock.state().sends, 1);
  }
});

test('rejected streams and invalid batch arguments do not send or create anything', async t => {
  const f = fixture(t), mock = setup(t, { denied: true }), service = await mock.servicePromise;
  f.profile(service.url, 'tenant-demo', 'synthetic-token');
  const denied = await f.run(['agent', 'chat', 'send', 'session-1', '--message', 'not sent', '--runtime', service.url, '--application-id', 'app-1', '--json']);
  assert.equal(result(denied).error.code, 'not_found'); assert.equal(mock.state().sends, 0);
  const file = join(f.directory, 'batch.json');
  writeFileSync(file, JSON.stringify([['agent', 'subscribe', 'a'], ['agent', 'chat', 'start', 'agent-one', '--runtime', service.url]]));
  const batch = await f.run(['batch', '--file', file, '--json']);
  assert.equal(batch.code, 1); assert.match(result(batch).error.message, /message/); assert.equal(mock.state().creates, 0);
  const badId = await f.run(['agent', 'chat', 'start', 'agent-one', '--message', 'input', '--request-id', 'bad/id', '--runtime', service.url, '--json']);
  assert.equal(result(badId).error.code, 'invalid_arguments'); assert.equal(mock.state().creates, 0);
});

test('failed turns are not successful and existing pending actions stop a new submission', async t => {
  const failed = fixture(t), failedMock = setup(t, { reason: 'failed' }), failedService = await failedMock.servicePromise;
  failed.profile(failedService.url, 'tenant-demo', 'synthetic-token');
  const turn = await failed.run(['agent', 'chat', 'send', 'session-1', '--message', 'input', '--runtime', failedService.url, '--application-id', 'app-1', '--json']);
  assert.equal(turn.code, 1); assert.equal(result(turn).error.code, 'turn_failed'); assert.equal(result(turn).error.details.reason, 'failed');
  const blocked = fixture(t), blockedMock = setup(t, { initialPending: true }), blockedService = await blockedMock.servicePromise;
  blocked.profile(blockedService.url, 'tenant-demo', 'synthetic-token');
  const pending = await blocked.run(['agent', 'chat', 'send', 'session-1', '--message', 'input', '--runtime', blockedService.url, '--application-id', 'app-1', '--json']);
  assert.equal(result(pending).error.code, 'action_required'); assert.equal(result(pending).error.details.submitted, false);
  assert.equal(blockedMock.state().sends, 0);
});
