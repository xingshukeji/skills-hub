import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cpSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixture, mockServer, PACKAGE_ID, respond, VERSION_ID } from './helpers.mjs';

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
  const accountPassword = 'installed-test-account-password';
  const account = await execute(script, ['security', 'user', 'create', '--user', 'zhangsan', '--values-json', '-', '--json'], f.directory, f.env,
    JSON.stringify({ name: '张三', password: accountPassword }));
  assert.equal(account.code, 0, account.stdout);
  assert.equal(server.hits.at(-1).url, '/api/service/authen/v1/security/users');
  assert.equal(server.hits.at(-1).json().password, accountPassword);
  assert.equal(JSON.parse(account.stdout).data.received.name, '张三');
  assert.ok(!account.stdout.includes(accountPassword)); assert.ok(!account.stderr.includes(accountPassword));
  const reused = await execute(script, ['security', 'user', 'ensure', 'zhangsan', '--json'], f.directory, f.env);
  assert.equal(reused.code, 0, reused.stdout); assert.equal(JSON.parse(reused.stdout).data.created, false);
  assert.equal(server.hits.at(-1).method, 'GET');
  assert.equal(server.hits.at(-1).url, '/api/service/authen/v1/security/users/zhangsan');
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

test('standalone application commands import, preview, install and resolve with JSON stdin and reusable impact tokens', async t => {
  const f = fixture(t);
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const installed = join(f.directory, 'application management skill');
  cpSync(join(root, 'skills/xrain-cli'), installed, { recursive: true });
  const script = join(installed, 'scripts/xrain-cli.mjs');
  const installationId = 'api0123456789abcdefg';
  const confirmation = { recordId: 'apr0123456789abcdefg', unit: '$security', token: 'synthetic-installed-impact-token' };
  let operation;
  const server = await mockServer(t, (hit, res) => {
    assert.equal(hit.headers.authorization, 'Bearer synthetic-installed-app-session');
    if (hit.url.endsWith(':import')) return respond(res, { packageId: PACKAGE_ID, versionId: VERSION_ID, alreadyExisted: false });
    if (hit.url.endsWith('/preview')) {
      assert.deepEqual(hit.json(), { versionId: VERSION_ID, expectedRevision: 0 });
      return respond(res, { targetVersionId: VERSION_ID, ready: false, revision: 0, requiredConfirmations: [confirmation] });
    }
    if (hit.url.endsWith('/install')) {
      operation = { id: hit.json().requestId, installationId, targetVersionId: VERSION_ID, sourceVersionId: null, sourceRevision: 0,
        status: 'WaitingForResolution', details: { requiredConfirmations: [confirmation], requiredBindings: [], conflicts: [] } };
      return respond(res, operation);
    }
    if (hit.url.endsWith('/resolve')) {
      assert.equal(hit.url, `/api/application/v1/operations/${operation.id}/resolve`);
      assert.deepEqual(hit.json(), { expectedRevision: 0, confirmations: [confirmation] });
      operation = { ...operation, status: 'Succeeded', details: { requiredConfirmations: [] } };
      return respond(res, operation);
    }
    if (hit.url.includes('/installations/')) return respond(res, { id: installationId, packageId: PACKAGE_ID,
      installedVersionId: VERSION_ID, revision: 1, activeOperationId: null, latestOperationId: operation.id });
    return respond(res, {}, 404);
  });
  f.profile(server.url);
  f.store.saveSession('Demo', server.url, 'tenant-demo', 'synthetic-installed-app-session', Date.now() + 300000);
  const run = (args, input) => execute(script, [...args, '--json'], f.directory, f.env, input);
  const help = await run(['app', 'install', '--help']);
  assert.equal(help.code, 0); assert.match(JSON.parse(help.stdout).data, /--wait/);
  const imported = await run(['app', 'import', PACKAGE_ID, '--version-id', VERSION_ID]);
  assert.equal(imported.code, 0, imported.stdout);
  const preview = await run(['app', 'preview', PACKAGE_ID, '--request-json', '-'], JSON.stringify({ versionId: VERSION_ID, expectedRevision: 0 }));
  assert.equal(preview.code, 0, preview.stdout);
  assert.equal(JSON.parse(preview.stdout).data.requiredConfirmations[0].token, confirmation.token);
  const submitted = await run(['app', 'install', PACKAGE_ID, '--version-id', VERSION_ID, '--wait']);
  assert.equal(submitted.code, 1);
  const waiting = JSON.parse(submitted.stdout).error.details.operation;
  const resolved = await run(['app', 'operation', 'resolve', waiting.id, '--request-json', '-', '--wait'],
    JSON.stringify({ expectedRevision: waiting.sourceRevision, confirmations: waiting.details.requiredConfirmations }));
  assert.equal(resolved.code, 0, resolved.stdout); assert.equal(JSON.parse(resolved.stdout).data.status, 'Succeeded');
  const installedResult = await run(['app', 'installation', 'show', installationId]);
  assert.equal(installedResult.code, 0, installedResult.stdout); assert.equal(JSON.parse(installedResult.stdout).data.installedVersionId, VERSION_ID);
  assert.equal(server.hits.filter(hit => hit.url.endsWith('/install')).length, 1);
  assert.equal(existsSync(join(installed, 'node_modules')), false);
});
