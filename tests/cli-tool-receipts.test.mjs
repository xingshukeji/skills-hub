import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fixture, mockServer, respond } from './helpers.mjs';

const event = (type, seq, data) => ({ event: { type, seq, data } });
const frame = value => `data: ${JSON.stringify(value)}\n\n`;
const payload = call => JSON.parse(call.stdout);

async function conversation(t, f, { failedTurn = false } = {}) {
  let stream, records = [], sends = 0, denied = false;
  const receipts = [
    { turn: 1, message: { role: 'tool', source: { kind: 'tool', callId: 'create:original/1' },
      content: [{ type: 'text', text: JSON.stringify({ recordId: 'original-record', password: 'synthetic-tool-secret' }) }] },
      meta: { businessRecordMutation: { recordId: 'original-record', action: 'create' } } },
    { turn: 1, message: { content: [{ type: 'tool-result', toolCallId: 'read:original/2', isError: true,
      content: [{ type: 'text', text: '原记录已保存；关联资料读取失败' }] }] },
      meta: { retryable: false, apiToken: 'synthetic-meta-secret' } },
  ];
  const service = await mockServer(t, (hit, response) => {
    if (denied) return respond(response, { error: 'SESSION_ACCESS_DENIED' }, 403);
    if (hit.url.endsWith('/stream')) {
      stream = response; response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write(frame({ type: 'snapshot', cursor: 8, records, hasMore: false })); return;
    }
    if (hit.url.endsWith('/inputs')) {
      sends++;
      const body = hit.json();
      records = [
        event('turn/start', 0, { turn: 1 }),
        event('user/message', 1, { source: { kind: 'user', rpcId: body.requestId }, content: body.content }),
        event('tool/call', 2, { turn: 1, callId: 'create:original/1', name: 'create_business_record' }),
        event('tool/result', 3, receipts[0]),
        event('tool/call', 4, { turn: 1, callId: 'read:original/2', name: 'get_business_record' }),
        event('tool/result', 5, receipts[1]),
        event('assistant/message', 6, { turn: 1, content: [{ type: 'reasoning', text: 'internal-reasoning' }] }),
        event('user/message', 7, { source: { kind: 'runtime-context' }, content: [{ type: 'text', text: 'internal-setup' }] }),
        event('turn/end', 8, { turn: 1, reason: { kind: failedTurn ? 'failed' : 'completed' } }),
      ];
      respond(response, { accepted: true }, 202);
      for (const record of records) stream.write(frame({ type: 'event', ...record })); return;
    }
    if (hit.url.endsWith('/history')) return respond(response, { type: 'snapshot', cursor: 8, records, hasMore: false });
    respond(response, {}, 404);
  });
  f.profile(service.url, 'tenant-demo', 'synthetic-login-token');
  return { service, receipts, sends: () => sends, deny() { denied = true; } };
}

function verifyReceipts(call, tools) {
  assert.equal(tools.length, 2);
  assert.equal(tools[0].callId, 'create:original/1');
  assert.equal(tools[0].status, 'succeeded');
  assert.deepEqual(JSON.parse(tools[0].result.message.content[0].text), { recordId: 'original-record', password: '[REDACTED]' });
  assert.deepEqual(tools[0].result.meta.businessRecordMutation, { recordId: 'original-record', action: 'create' });
  assert.equal(tools[1].callId, 'read:original/2');
  assert.equal(tools[1].status, 'failed');
  assert.equal(tools[1].result.message.content[0].content[0].text, '原记录已保存；关联资料读取失败');
  assert.equal(tools[1].result.meta.retryable, false);
  assert.equal(tools[1].result.meta.apiToken, '[REDACTED]');
  assert.doesNotMatch(call.stdout + call.stderr, /synthetic-(?:login-token|tool-secret|meta-secret)|internal-(?:reasoning|setup)/);
}

test('tool-only completion retains native receipts for wait and history without another input', async t => {
  const f = fixture(t), c = await conversation(t, f);
  const common = ['--runtime', c.service.url, '--json'];
  const sent = await f.run(['agent', 'chat', 'send', 'original-session', '--message', '登记后读取关联资料', '--request-id', 'task:original/input', ...common]);
  assert.equal(sent.code, 0, sent.stdout);
  assert.equal(payload(sent).data.answer, '');
  verifyReceipts(sent, payload(sent).data.toolCalls);
  const waited = await f.run(['agent', 'chat', 'wait', 'original-session', '--request-id', 'task:original/input', ...common]);
  assert.equal(waited.code, 0, waited.stdout);
  verifyReceipts(waited, payload(waited).data.toolCalls);
  const history = await f.run(['agent', 'chat', 'history', 'original-session', ...common]);
  assert.equal(history.code, 0, history.stdout);
  verifyReceipts(history, payload(history).data.items.filter(item => item.type === 'tool/result'));
  assert.equal(c.sends(), 1);
  c.deny();
  const refused = await f.run(['agent', 'chat', 'history', 'original-session', ...common]);
  assert.equal(refused.code, 1);
  assert.equal(payload(refused).error.code, 'permission_denied');
  assert.ok(!refused.stdout.includes('original-record'));
  assert.equal(c.sends(), 1);
});

test('a failed native turn retains its original tool receipts in the failure result', async t => {
  const f = fixture(t), c = await conversation(t, f, { failedTurn: true });
  const sent = await f.run(['agent', 'chat', 'send', 'original-session', '--message', '查询', '--request-id', 'failed-original', '--runtime', c.service.url, '--json']);
  assert.equal(sent.code, 1);
  assert.equal(payload(sent).error.code, 'turn_failed');
  verifyReceipts(sent, payload(sent).error.details.toolCalls);
  assert.equal(c.sends(), 1);
});

function invoke(script, argv, f) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...argv], { cwd: f.directory, env: f.env, windowsHide: true });
    let stdout = '', stderr = '';
    child.stdout.on('data', value => { stdout += value; }); child.stderr.on('data', value => { stderr += value; });
    child.on('error', reject); child.on('close', code => resolve({ code, stdout, stderr }));
  });
}

test('the complete copied Skill retains the same receipts after a new process reopens history', async t => {
  const f = fixture(t), c = await conversation(t, f), skill = join(f.directory, 'complete-skill');
  cpSync('skills/shzw-xrain-cli', skill, { recursive: true });
  const script = join(skill, 'scripts/xrain-cli.mjs'), common = ['--runtime', c.service.url, '--json'];
  const sent = await invoke(script, ['agent', 'chat', 'send', 'original-session', '--message', '登记', '--request-id', 'copied-original', ...common], f);
  assert.equal(sent.code, 0, sent.stdout);
  verifyReceipts(sent, payload(sent).data.toolCalls);
  const history = await invoke(script, ['agent', 'chat', 'history', 'original-session', ...common], f);
  assert.equal(history.code, 0, history.stdout);
  verifyReceipts(history, payload(history).data.items.filter(item => item.type === 'tool/result'));
  assert.equal(c.sends(), 1);
});
