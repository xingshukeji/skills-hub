import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, readFileSync } from 'node:fs';
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
    if (hit.url === '/api/cli/v1/context') {
      assert.equal(hit.headers.authorization, 'Bearer original-session'); assert.equal(hit.headers['x-xrain-application-id'], 'APP');
      return respond(res, { tenantId: 'TEN', userId: 'human', applicationId: 'APP' });
    }
    if (hit.url === '/api/service/files/v1/files/file-one') return respond(res, { id: 'file-one', length: bytes.length, contentType: 'text/plain' });
    assert.equal(hit.url, '/api/service/files/v1/files/file-one/content');
    res.writeHead(200, { 'content-type': 'text/plain', 'content-length': bytes.length }); res.end(bytes);
  });
  f.store.save({ activeProfile: 'Demo', profiles: { Demo: { server: service.url, tenant: 'TEN', applicationId: 'APP', bearerToken: 'service-file-token' } } });
  f.store.saveSession('Demo', service.url, 'TEN', 'original-session', Date.now() + 300000);
  const run = args => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(directory, 'scripts/xrain-cli.mjs'), ...args, '--json'], { cwd: directory, env: f.env, windowsHide: true });
    let stdout = '', stderr = ''; child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject); child.on('close', code => resolve({ code, stdout, stderr, result: JSON.parse(stdout) }));
  });
  const metadata = await run(['metadata', 'entity', 'show', 'customer']); assert.equal(metadata.code, 0, metadata.stdout); assert.equal(metadata.result.data.headers.etag, '"real-8"');
  const context = await run(['workforce', 'context', '--workforce', service.url]); assert.equal(context.code, 0, context.stdout); assert.equal(context.result.data.applicationId, 'APP');
  const downloaded = await run(['file', 'download', 'file-one', '--out', file]); assert.equal(downloaded.code, 0, downloaded.stdout); assert.deepEqual(readFileSync(file), bytes);
});
