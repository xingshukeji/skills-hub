import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fixture, mockServer, respond } from './helpers.mjs';

test('copied CLI uses the same caller and ordered results for old-platform batch fallback', async t => {
  const f = fixture(t), skill = join(f.directory, 'copied-skill');
  cpSync('skills/shzw-xrain-cli', skill, { recursive: true });
  let mode = 'missing';
  const server = await mockServer(t, (hit, res) => {
    assert.equal(hit.headers.authorization, 'Bearer synthetic-token');
    if (hit.url === '/api/data/v1/records:queryBatch') {
      if (mode === 'missing') return res.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return respond(res, { error: { code: 'runtime.entity_not_available' } }, 404);
    }
    const entity = decodeURIComponent(hit.url.split('/')[5]);
    respond(res, { records: [{ recordId: entity }], totalCount: 1 });
  });
  f.profile(server.url, 'tenant-one', 'synthetic-token');
  const input = join(f.directory, 'queries.json');
  writeFileSync(input, JSON.stringify({ queries: [
    { entityCode: 'first', query: { page: 1 } }, { entityCode: 'second', query: { page: 2 } },
  ] }));
  const run = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(skill, 'scripts/xrain-cli.mjs'), 'data', 'query-batch', '--request-json', input, '--json'],
      { cwd: f.directory, env: f.env, windowsHide: true });
    let stdout = '', stderr = '';
    child.stdout.on('data', value => { stdout += value; });
    child.stderr.on('data', value => { stderr += value; });
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));
  });

  const success = await run();
  assert.equal(success.code, 0, success.stdout);
  assert.deepEqual(JSON.parse(success.stdout).data.results.map(item => item.result.records[0].recordId), ['first', 'second']);
  assert.equal(server.hits.length, 3);
  mode = 'business-error';
  const denied = await run();
  assert.equal(denied.code, 1, denied.stdout);
  assert.equal(JSON.parse(denied.stdout).error.serverCode, 'runtime.entity_not_available');
  assert.equal(server.hits.length, 4);
});
