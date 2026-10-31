import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, mockServer, respond } from './helpers.mjs';
const output = value => JSON.parse(value.stdout);
const runId = '55555555-1111-2222-3333-444444444444';

test('managed runs submit once and query the original owner-bound result without creating a workbench conversation', async t => {
  const f = fixture(t); let failed = false;
  const service = await mockServer(t, (hit, res) => {
    assert.equal(hit.headers['x-xrain-authorization'], 'Bearer caller');
    if (hit.method === 'POST') {
      assert.equal(hit.url, '/xrain/runs'); assert.deepEqual(hit.json(), { input: { agentId: 'review', prompt: 'Summarize', applicationId: null } });
      return respond(res, { runId, status: 'accepted' }, 202);
    }
    assert.equal(hit.url, '/xrain/runs/' + runId);
    respond(res, failed ? { status: 'failed', error: 'AGENT_RUN_FAILED' } : { status: 'succeeded', result: { answer: 'Done' } });
  });
  f.profile(service.url, 'tenant', 'caller'); const target = ['--runtime', service.url, '--json'];
  const submitted = await f.run(['agent', 'run', 'start', 'review', '--message', 'Summarize', ...target]);
  assert.equal(submitted.code, 0, submitted.stdout); assert.equal(output(submitted).data.runId, runId);
  assert.equal((await f.run(['agent', 'run', 'show', runId, ...target])).code, 0);
  failed = true; assert.equal(output(await f.run(['agent', 'run', 'show', runId, ...target])).error.code, 'run_failed');
  assert.equal(service.hits.filter(hit => hit.method === 'POST').length, 1);
});

test('lost managed receipts are unknown and are not resubmitted; invalid inputs and forbidden results preserve native errors', async t => {
  const f = fixture(t); let status = 0;
  const service = await mockServer(t, (_hit, res) => { if (!status) res.destroy(); else respond(res, { error: 'FORBIDDEN' }, status); });
  f.profile(service.url, 'tenant', 'caller'); const argv = ['agent', 'run', 'start', 'review', '--message', 'do once', '--runtime', service.url, '--json'];
  assert.equal(output(await f.run(argv)).error.code, 'outcome_unknown'); assert.equal(service.hits.length, 1);
  status = 403; assert.equal(output(await f.run(argv)).error.code, 'permission_denied'); assert.equal(service.hits.length, 2);
});

test('ephemeral calls use their own text protocol and return no session or tools', async t => {
  const f = fixture(t), service = await mockServer(t, (hit, res) => {
    if (hit.method === 'GET') { assert.equal(hit.url, '/v1/dsh/ephemeral-agents'); return respond(res, { agents: [{ id: 'writer' }], defaultAgentId: 'writer' }); }
    assert.equal(hit.url, '/v1/dsh/ephemeral-runs'); assert.deepEqual(hit.json(), { agentId: 'writer', prompt: 'Rewrite' }); respond(res, { answer: 'Rewritten' });
  });
  f.profile(service.url, 'tenant', 'caller'); const target = ['--runtime', service.url, '--json'];
  assert.equal((await f.run(['agent', 'ephemeral', 'directory', ...target])).code, 0);
  const result = await f.run(['agent', 'ephemeral', 'generate', 'writer', '--message', 'Rewrite', ...target]);
  assert.equal(result.code, 0, result.stdout); assert.equal(output(result).data.answer, 'Rewritten'); assert.equal(output(result).data.sessionId, undefined);
});

test('primary objects use the exact native reference and do not accept Task grants through that field', async t => {
  const f = fixture(t), object = { businessSourceId: 'business', objectType: 'case', objectId: 'case-one' };
  const file = join(f.directory, 'context.json'); writeFileSync(file, JSON.stringify(object));
  const service = await mockServer(t, (hit, res) => {
    assert.equal(hit.url, '/v1/dsh/sessions'); assert.deepEqual(hit.json(), { agentId: 'review', source: 'xrain-cli', primaryObjectRef: object });
    respond(res, { error: 'WORKBENCH_AGENT_FORBIDDEN' }, 403);
  });
  f.profile(service.url, 'tenant', 'caller');
  const argv = ['agent', 'chat', 'start', 'review', '--message', 'Review', '--context-json', file, '--runtime', service.url, '--json'];
  assert.equal(output(await f.run(argv)).error.code, 'permission_denied');
  writeFileSync(file, JSON.stringify({ taskId: 'task', grantId: 'fake' }));
  assert.equal(output(await f.run(argv)).error.code, 'invalid_arguments'); assert.equal(service.hits.length, 1);
});
