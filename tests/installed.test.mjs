import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cpSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixture, mockServer, respond } from './helpers.mjs';

function execute(script, args, cwd, env, input = '') {
  return new Promise((resolveResult, reject) => {
    const process = spawn(globalThis.process.execPath, [script, ...args], { cwd, env: { ...env, NODE_PATH: '', NODE_OPTIONS: '' }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    process.stdout.on('data', chunk => { stdout += chunk; }); process.stderr.on('data', chunk => { stderr += chunk; });
    process.stdin.on('error', () => {});
    if (typeof input === 'function') input(process.stdin); else process.stdin.end(input);
    process.on('error', reject); process.on('close', code => resolveResult({ code, stdout, stderr }));
  });
}

test('installed skill alone runs help, profile, token, HTTP and app-init commands without node_modules or repository source', async t => {
  const f = fixture(t);
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const installed = join(f.directory, 'installed skill with spaces');
  cpSync(join(root, 'skills/xrain-cli'), installed, { recursive: true });
  assert.equal(existsSync(join(f.directory, 'node_modules')), false);
  assert.equal(existsSync(join(installed, 'src')), false);
  const script = join(installed, 'scripts/xrain-cli.mjs');
  assert.equal((await execute(script, ['--help'], f.directory, f.env)).code, 0);
  const server = await mockServer(t, (hit, res) => respond(res, { tenant: 'tenant-demo', received: hit.body.length ? hit.json() : null, authorization: hit.headers.authorization }));
  const login = await execute(script, ['login', '--server', server.url, '--tenant', 'tenant-demo', '--token-name', 'admin'], f.directory, f.env);
  assert.equal(login.code, 0, login.stderr);
  assert.equal((await execute(script, ['security', 'tokens', 'ensure'], f.directory, f.env)).code, 0);
  const shown = await execute(script, ['profile', 'show'], f.directory, f.env);
  assert.equal(JSON.parse(shown.stdout).tokenSource, 'local-secret-store:admin');
  const query = await execute(script, ['data', 'query', 'customer', '--page-size', '5'], f.directory, f.env);
  assert.equal(query.code, 0, query.stderr); assert.equal(JSON.parse(query.stdout).received.pageSize, 5);
  assert.equal(JSON.parse(query.stdout).authorization, '[REDACTED]');
  const created = await execute(script, ['data', 'create', 'customer', '--values', '{"name":"Installed"}'], f.directory, f.env);
  assert.equal(created.code, 0, created.stderr); assert.deepEqual(server.hits.at(-1).json(), { values: { name: 'Installed' } });
  const stdin = await execute(script, ['data', 'create', 'customer', '--values-json', '-', '--json'], f.directory, f.env, '{"name":"输入中文"}');
  assert.equal(stdin.code, 0, stdin.stdout); assert.equal(JSON.parse(stdin.stdout).data.received.values.name, '输入中文');
  const streamed = await execute(script, ['data', 'create', 'customer', '--values-json', '-', '--json'], f.directory, f.env, stream => {
    const bytes = Buffer.from('{"name":"分段中文"}');
    stream.write(bytes.subarray(0, 11));
    setTimeout(() => stream.end(bytes.subarray(11)), 200);
  });
  assert.equal(streamed.code, 0, streamed.stdout); assert.equal(JSON.parse(streamed.stdout).data.received.values.name, '分段中文');
  const stdinFilter = await execute(script, ['data', 'query', 'customer', '--filter-json', '-', '--json'], f.directory, f.env, '{"name":"输入中文"}');
  assert.equal(stdinFilter.code, 0, stdinFilter.stdout); assert.equal(server.hits.at(-1).json().filter.name, '输入中文');
  const badStdinCalls = server.hits.length;
  const badStdin = await execute(script, ['data', 'create', 'customer', '--values-json', '-', '--json'], f.directory, f.env, 'invalid JSON');
  assert.equal(badStdin.code, 1); assert.equal(JSON.parse(badStdin.stdout).ok, false); assert.equal(server.hits.length, badStdinCalls);
  const discovery = await execute(script, ['metadata', 'describe', 'customer', '--json'], f.directory, f.env);
  assert.equal(discovery.code, 0, discovery.stdout); assert.equal(server.hits.at(-1).url, '/api/metadata/v1/entities/customer/describe');
  const diagnosed = await execute(script, ['doctor', '--json'], f.directory, f.env);
  assert.equal(diagnosed.code, 0, diagnosed.stdout); assert.equal(JSON.parse(diagnosed.stdout).data.remoteValidation, 'accepted_by_probe');
  const invalidCalls = server.hits.length;
  const invalidDelete = await execute(script, ['data', 'delete', 'customer', 'r1', '--filter', '{}', '--json'], f.directory, f.env);
  assert.equal(invalidDelete.code, 1); assert.equal(JSON.parse(invalidDelete.stdout).error.code, 'invalid_arguments'); assert.equal(server.hits.length, invalidCalls);
  const batch = await execute(script, ['batch', '--file', '-', '--json'], f.directory, f.env, JSON.stringify([['profile', 'show'], ['metadata', 'entities']]));
  assert.equal(batch.code, 0, batch.stdout); assert.equal(JSON.parse(batch.stdout).data.length, 2);
  const appDir = join(f.directory, 'application');
  const app = await execute(script, ['app', 'init', '--namespace', 'myapp', '--label', 'Installed app', '--dir', appDir], f.directory, f.env);
  assert.equal(app.code, 0, app.stderr); assert.equal(JSON.parse(readFileSync(join(appDir, 'source.json'))).namespace, 'myapp');
});
