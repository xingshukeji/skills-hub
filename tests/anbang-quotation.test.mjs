import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fixture, mockServer, respond } from './helpers.mjs';

test('quotation CLI uses the same application file/parser/run routes and retains row failures and report output', async t => {
  const f = fixture(t), platform = await mockServer(t, (_hit, res) => respond(res, { tenantId: 'TEN', userId: 'admin' }));
  f.store.save({ activeProfile: 'Demo', profiles: { Demo: { server: platform.url, tenant: 'TEN', applicationId: 'APP' } } });
  f.store.saveSession('Demo', platform.url, 'TEN', 'session', Date.now() + 300000);
  const bytes = Buffer.from('opaque-workbook'), digest = createHash('sha256').update(bytes).digest('hex');
  const rows = [{ id: 'one', enabled: '是' }, { id: 'two', enabled: '是' }, { id: 'disabled', enabled: '否' }];
  let status = 'different';
  const host = await mockServer(t, (hit, res) => {
    assert.equal(hit.headers['x-xrain-expected-user-id'], 'admin');
    assert.equal(hit.headers['x-xrain-application-id'], 'APP');
    const action = hit.url.split('/').at(-1), input = hit.json();
    if (action === 'context') return respond(res, {});
    if (['default', 'open'].includes(action)) { if (action === 'open') assert.equal(input.contentBase64, bytes.toString('base64')); return respond(res, { contentBase64: bytes.toString('base64'), digest, rows, errors: [] }); }
    if (action === 'run') return respond(res, { id: input.row.id, status: input.row.id === 'one' ? 'passed' : status, comparisons: [] });
    if (action === 'export') { assert.equal(input.results.length, 2); return respond(res, { contentBase64: bytes.toString('base64'), digest }); }
    throw Error('unexpected route');
  });
  const file = join(f.directory, 'cases.xlsx'); writeFileSync(file, bytes);
  const argv = ['anbang', 'quotation', 'verify', '--workforce', host.url, '--cases', file, '--json'];
  const failed = await f.run([...argv, '--out', join(f.directory, 'report.xlsx')]), result = JSON.parse(failed.stdout);
  assert.equal(failed.code, 1); assert.equal(result.data.completed, 2); assert.equal(result.data.summary.different, 1);
  assert.deepEqual(readFileSync(join(f.directory, 'report.xlsx')), bytes);
  status = 'passed'; const passed = await f.run(argv); assert.equal(passed.code, 0, passed.stdout);
  const selected = await f.run([...argv, '--case', 'one']); assert.equal(JSON.parse(selected.stdout).data.completed, 1);
  const defaults = await f.run(['anbang', 'quotation', 'defaults', '--workforce', host.url, '--out', join(f.directory, 'defaults.xlsx'), '--json']);
  assert.equal(defaults.code, 0, defaults.stdout);
  assert.equal((await f.run(['anbang', 'quotation', 'defaults', '--workforce', host.url, '--out', file, '--json'])).code, 1, 'existing file is not overwritten');
  assert.ok(host.hits.every(hit => hit.url.startsWith('/api/anbang-sales/admin/verification/')));
});

test('quotation CLI requires a verified tenant identity and does not borrow another user or token', async t => {
  const f = fixture(t), platform = await mockServer(t, (_hit, res) => respond(res, { tenantId: 'OTHER', userId: 'admin' }));
  f.store.save({ activeProfile: 'Demo', profiles: { Demo: { server: platform.url, tenant: 'TEN', applicationId: 'APP' } } });
  f.store.saveSession('Demo', platform.url, 'TEN', 'session', Date.now() + 300000);
  const host = await mockServer(t, () => { throw Error('host must not be called'); });
  const denied = await f.run(['anbang', 'quotation', 'verify', '--workforce', host.url, '--json']);
  assert.equal(JSON.parse(denied.stdout).error.code, 'identity_mismatch'); assert.equal(host.hits.length, 0);
});

test('quotation CLI preserves completed rows when authorization expires or report export fails', async t => {
  const f = fixture(t), platform = await mockServer(t, (_hit, res) => respond(res, { tenantId: 'TEN', userId: 'admin' }));
  f.store.save({ activeProfile: 'Demo', profiles: { Demo: { server: platform.url, tenant: 'TEN', applicationId: 'APP' } } });
  f.store.saveSession('Demo', platform.url, 'TEN', 'session', Date.now() + 300000);
  let deny = true;
  const host = await mockServer(t, (hit, res) => {
    const action = hit.url.split('/').at(-1), input = hit.json();
    if (action === 'context') return respond(res, {});
    if (action === 'default') return respond(res, { digest: 'default', rows: [{ id: 'one' }, { id: 'two' }, { id: 'three' }], errors: [] });
    if (action === 'run') return deny && input.row.id === 'two'
      ? respond(res, { code: 'sales.admin_denied', message: 'Permission revoked' }, 403)
      : respond(res, { id: input.row.id, status: 'passed' });
    if (action === 'export') return respond(res, { code: 'report.unavailable', message: 'Export unavailable' }, 503);
    throw Error('unexpected route');
  });
  const argv = ['anbang', 'quotation', 'verify', '--workforce', host.url, '--out', join(f.directory, 'report.xlsx'), '--json'];
  const denied = await f.run(argv), stopped = JSON.parse(denied.stdout).data;
  assert.equal(denied.code, 1); assert.equal(stopped.completed, 2); assert.equal(stopped.results[0].status, 'passed');
  assert.equal(stopped.results[1].status, 'failed'); assert.equal(stopped.passedAll, false);
  assert.equal(host.hits.filter(hit => hit.url.endsWith('/export')).length, 0, 'do not continue requests after authorization failure');
  deny = false;
  const failedExport = await f.run(argv), kept = JSON.parse(failedExport.stdout).data;
  assert.equal(failedExport.code, 1); assert.equal(kept.completed, 3); assert.equal(kept.summary.passed, 3);
  assert.equal(kept.reportError.code, 'http_error'); assert.equal(kept.reportError.serverCode, 'report.unavailable');
});
