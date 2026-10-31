import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fixture, mockServer, respond } from './helpers.mjs';

test('the copied standalone skill runs agent commands without the authoring source or dependencies', async t => {
  const f = fixture(t), service = await mockServer(t, (hit, res) => {
    assert.equal(hit.headers.authorization, 'Bearer synthetic-bundle-token');
    if (hit.url === '/v1/dsh/agent-definitions/limits') return respond(res, { maxDefinitionBytes: 16777216, supportsDefinitionStatusUpdate: true });
    if (hit.url === '/v1/dsh/agent-definitions' && hit.method === 'POST') return respond(res, { ...hit.json(), revision: 1 }, 201);
    if (hit.url === '/api/xrain/v1/agents/a/subscription') return respond(res, { id: 'request-a', agentId: 'a', selected: true, approvalStatus: 'pending' });
    respond(res, { error: 'NOT_FOUND' }, 404);
  });
  const skill = join(f.directory, 'isolated-skill');
  cpSync('skills/shzw-xrain-cli', skill, { recursive: true });
  const script = join(skill, 'scripts', 'xrain-cli.mjs');
  const env = { ...f.env, XRAIN_SERVER: service.url, XRAIN_TENANT: 'tenant-demo', XRAIN_TOKEN: 'synthetic-bundle-token' };
  const run = argv => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...argv, '--json'], { env, cwd: f.directory, windowsHide: true });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
  const created = await run(['agent', 'definition', 'create', '--name', 'Example', '--agent-id', 'fixed-id', '--runtime', service.url]);
  assert.equal(created.code, 0, created.stdout); assert.equal(JSON.parse(created.stdout).data.enabled, false);
  assert.equal(JSON.parse(created.stdout).data.agentId, 'fixed-id');
  const subscribed = await run(['agent', 'subscribe', 'a']);
  assert.equal(subscribed.code, 0, subscribed.stdout); assert.equal(JSON.parse(subscribed.stdout).data.approvalStatus, 'pending');
  assert.ok(!(created.stdout + created.stderr + subscribed.stdout + subscribed.stderr).includes('synthetic-bundle-token'));
});
