import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fixture, mockServer, respond } from './helpers.mjs';

const output = value => JSON.parse(value.stdout);
const item = (index, success = true) => ({ index, success, recordId: 'record-' + index, errors: success ? [] : [{ code: 'record.conflict', message: 'Conflict' }] });

test('collection writes cannot report success or continue a batch when the original receipt is incomplete or uncommitted', async t => {
  const f = fixture(t); let receipt, writes = 0, later = 0;
  const service = await mockServer(t, (hit, res) => {
    if (hit.url.endsWith('/deactivate')) { later++; return respond(res, {}); }
    writes++; respond(res, receipt);
  });
  f.profile(service.url, 'TEN', 'member-token');
  const file = join(f.directory, 'records.json'), plan = join(f.directory, 'batch.json');
  writeFileSync(file, JSON.stringify({ allOrNone: false, records: [{ values: { name: 'first' } }, { values: { name: 'second' } }] }));
  writeFileSync(plan, JSON.stringify([['data', 'batch-create', 'customer', '--request-json', file], ['security', 'role', 'deactivate', 'later']]));
  const receipts = [null, {}, { allOrNone: false, commitState: 'committed', results: [] },
    { allOrNone: false, commitState: 'committed', results: [item(0), item(0)] },
    { allOrNone: false, commitState: 'committed', results: [item(0), { ...item(1), success: 'true' }] },
    { allOrNone: false, commitState: 'pending', results: [item(0), item(1)] }];
  for (receipt of receipts) {
    const result = await f.run(['batch', plan, '--json']);
    assert.equal(result.code, 1, result.stdout);
    const error = output(result).error.details.results[0].error;
    assert.equal(error.code, 'outcome_unknown', result.stdout);
    assert.deepEqual(error.details.result, receipt);
    assert.equal(error.details.recordCount, 2);
    assert.deepEqual(error.details.readback, ['data', 'query', 'customer']);
  }
  assert.equal(writes, receipts.length, 'each write is sent once'); assert.equal(later, 0);
});

test('native atomic arrays, no-content deletion and committed per-item results retain their distinct outcomes', async t => {
  const f = fixture(t); let receipt;
  const service = await mockServer(t, (_hit, res) => receipt === undefined ? (res.writeHead(204), res.end()) : respond(res, receipt));
  f.profile(service.url, 'TEN', 'member-token');
  const file = join(f.directory, 'records.json');
  const run = async (action, body, result) => {
    receipt = result; writeFileSync(file, JSON.stringify(body));
    return f.run(['data', action, 'customer', '--request-json', file, '--json']);
  };
  const records = [{ recordId: 'record-0', values: { name: 'saved' } }];
  assert.equal((await run('batch-create', { records: [{ values: { name: 'saved' } }] }, records)).code, 0);
  assert.equal((await run('batch-update', { records }, records)).code, 0);
  assert.equal((await run('batch-delete', { recordIds: ['record-0'] }, undefined)).code, 0);
  const good = { allOrNone: false, commitState: 'committed', results: [item(0)] };
  assert.equal((await run('batch-delete', { recordIds: ['record-0'], allOrNone: false }, good)).code, 0);
  const failure = { ...good, results: [item(0, false)] };
  const failed = await run('batch-update', { records, allOrNone: false }, failure);
  assert.equal(output(failed).error.code, 'collection_failed'); assert.deepEqual(output(failed).error.details.result, failure);
  const mismatched = await run('batch-update', { records, allOrNone: false }, { ...good, results: [{ ...item(0), recordId: 'another-record' }] });
  assert.equal(output(mismatched).error.code, 'outcome_unknown');
});

test('a complete copied Skill preserves the original collection receipt and stops before the next write in a new CLI process', async t => {
  const f = fixture(t), directory = join(f.directory, 'complete skill');
  cpSync(new URL('../skills/shzw-xrain-cli/', import.meta.url), directory, { recursive: true });
  let writes = 0;
  const receipt = { allOrNone: false, commitState: 'pending', results: [item(0)] };
  const service = await mockServer(t, (_hit, res) => { writes++; respond(res, receipt); });
  f.profile(service.url, 'TEN', 'member-token');
  const file = join(f.directory, 'records.json'), plan = join(f.directory, 'batch.json');
  writeFileSync(file, JSON.stringify({ allOrNone: false, records: [{ values: { name: 'once' } }] }));
  const command = ['data', 'batch-create', 'customer', '--request-json', file];
  writeFileSync(plan, JSON.stringify([command, command]));
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(directory, 'scripts/xrain-cli.mjs'), 'batch', plan, '--json'], { cwd: directory, env: f.env, windowsHide: true });
    let stdout = '', stderr = '';
    child.stdout.on('data', bytes => { stdout += bytes; }); child.stderr.on('data', bytes => { stderr += bytes; });
    child.once('error', reject); child.once('close', code => resolve({ code, stdout, stderr }));
  });
  assert.equal(result.code, 1, result.stdout + result.stderr);
  const error = output(result).error.details.results[0].error;
  assert.equal(error.code, 'outcome_unknown'); assert.deepEqual(error.details.result, receipt);
  assert.equal(error.details.tenant, 'TEN'); assert.equal(error.details.server, service.url);
  assert.equal(writes, 1);
});
