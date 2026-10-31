import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fixture, mockServer, respond } from './helpers.mjs';

test('the complete copied CLI Skill performs metadata, Workforce and file operations with Node alone', async t => {
  const f = fixture(t), directory = join(f.directory, 'complete skill with spaces');
  cpSync(new URL('../skills/shzw-xrain-cli/', import.meta.url), directory, { recursive: true });
  const file = join(f.directory, 'download.txt'), bytes = Buffer.from('complete copied artifact');
  const service = await mockServer(t, (hit, res) => {
    if (hit.url === '/api/service/authen/v1/account/context') return respond(res, { tenantId: 'TEN', userId: 'human' });
    if (hit.url === '/api/metadata/v1/entities/customer/describe') return respond(res, { object: { entityApiName: 'customer' }, fields: [] }, 200, { ETag: '"real-8"' });
    if (hit.url.startsWith('/api/automation/routines?')) {
      const query = new URL(hit.url, service.url).searchParams;
      assert.equal(query.get('page'), '1'); assert.equal(query.get('pageSize'), '20'); return respond(res, { items: [] });
    }
    if (hit.url === '/v1/dsh/ephemeral-runs') {
      assert.equal(hit.headers['x-xrain-application-id'], 'APP'); return respond(res, { answer: 'application text' });
    }
    if (hit.url === '/api/integration/v1/http-interfaces/original/debug/raw') {
      res.writeHead(200, { 'content-type': 'text/plain', 'x-original': 'yes' }); return res.end('raw text');
    }
    if (hit.url === '/api/service/authen/v1/security/api-debug') {
      res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('security raw text');
    }
    if (hit.url === '/v1/dsh/sessions/original/commands') return respond(res, { execution: { commandId: 'native', result: { kind: 'error', text: 'rejected command' } } });
    if (hit.url === '/api/cli/v1/context') {
      assert.equal(hit.headers.authorization, 'Bearer original-session'); assert.equal(hit.headers['x-xrain-application-id'], 'APP');
      return respond(res, { tenantId: 'TEN', userId: 'human', applicationId: 'APP' });
    }
    if (hit.url === '/api/service/files/v1/files/file-one') return respond(res, { id: 'file-one', length: bytes.length, contentType: 'text/plain' });
    assert.equal(hit.url, '/api/service/files/v1/files/file-one/content');
    res.writeHead(200, { 'content-type': 'text/plain', 'content-length': bytes.length }); res.end(bytes);
  });
  f.store.save({ activeProfile: 'Demo', profiles: { Demo: { server: service.url, runtime: service.url, tenant: 'TEN', applicationId: 'APP', bearerToken: 'service-file-token' } } });
  f.store.saveSession('Demo', service.url, 'TEN', 'original-session', Date.now() + 300000);
  const run = args => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(directory, 'scripts/xrain-cli.mjs'), ...args, '--json'], { cwd: directory, env: f.env, windowsHide: true });
    let stdout = '', stderr = ''; child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject); child.on('close', code => resolve({ code, stdout, stderr, result: JSON.parse(stdout) }));
  });
  const metadata = await run(['metadata', 'entity', 'show', 'customer']); assert.equal(metadata.code, 0, metadata.stdout); assert.equal(metadata.result.data.headers.etag, '"real-8"');
  const context = await run(['workforce', 'context', '--workforce', service.url]); assert.equal(context.code, 0, context.stdout); assert.equal(context.result.data.applicationId, 'APP');
  const downloaded = await run(['file', 'download', 'file-one', '--out', file]); assert.equal(downloaded.code, 0, downloaded.stdout); assert.deepEqual(readFileSync(file), bytes);
  assert.equal((await run(['routine', 'list'])).code, 0);
  const text = await run(['agent', 'ephemeral', 'generate', 'writer', '--message', 'Rewrite']); assert.equal(text.code, 0, text.stdout);
  assert.equal(text.result.data.answer, 'application text');
  const input = join(f.directory, 'input.json'); writeFileSync(input, '{}');
  const raw = await run(['http', 'interface', 'debug', 'original', '--request-json', input]);
  assert.equal(raw.code, 0, raw.stdout); assert.equal(raw.result.data.body, 'raw text'); assert.equal(raw.result.data.headers['x-original'], 'yes');
  const security = await run(['security', 'api-debug', '--request-json', input]);
  assert.equal(security.code, 0, security.stdout); assert.equal(security.result.data.body, 'security raw text');
  const command = await run(['agent', 'chat', 'command', 'original', '--line', '/status']);
  assert.equal(command.code, 1, command.stdout); assert.equal(command.result.error.code, 'execution_failed');
});
