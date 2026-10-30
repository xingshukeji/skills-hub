import assert from 'node:assert/strict';
import { createReadStream } from 'node:fs';
import { readFile, readdir, stat, truncate, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { fixture, mockServer, respond } from './helpers.mjs';

const entity = 'product__c';
const root = `/api/data/v1/entities/${entity}/imports`;
const jobId = 'a'.repeat(32), requestId = 'b'.repeat(32);
const mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const options = { uniqueField: 'product_code__c', filePurpose: 'sourceImport', blankPolicy: 'preserve',
  importBinding: { importSourceKey: 'product:source', orchestrationId: 'rule-1' } };
const capabilities = { entityCode: entity, orchestrations: [{ id: 'rule-1', versionId: 'v2', import: {
  version: 2, prepareRecord: true, validate: true, phaseScopes: { prepareRecord: 'independentRows', validate: 'independentRows' } } }],
  jobs: { protocol: 'xrain-import-jobs-v1', supported: true, commitModes: ['chunked'], limits: { maximumFileBytes: 268435456 } } };
function job(status, overrides = {}) {
  return { jobId, requestId, entityCode: entity, protocol: 'xrain-import-jobs-v1', commitMode: 'chunked',
    status, phase: status, version: 3, planRevision: 2, viewVersion: 'view-1',
    progress: { sourceRows: 3, checkedSourceRows: 3, outputRows: 3, committedOutputRows: 0, remainingOutputRows: 3 },
    summary: { sourceRows: 3, outputRows: 3, created: 3, updated: 0, deleted: 0, unchanged: 0,
      notFoundSkipped: 0, transformSkipped: 0, clearedFields: 0, sourceErrors: 0, outputErrors: 0 }, summaryKind: 'planned', detailsStatus: 'complete',
    canConfirm: status === 'ready', canContinue: status === 'paused', canRecheck: status === 'paused',
    pauseRequested: false, cancelRequested: false, sourceComplete: true, canDownloadRemaining: false,
    createdAt: '2026-10-30T00:00:00Z', updatedAt: '2026-10-30T00:00:00Z', ...overrides };
}
const output = result => JSON.parse(result.stdout);
const baseArgs = ['--entity', entity, '--application', 'app-demo', '--json'];

test('template, whole-file check and reviewed revision use the documented paths without implicit confirmation', async t => {
  const f = fixture(t), calls = [];
  const service = await mockServer(t, (hit, res) => {
    calls.push(hit);
    if (hit.url === `${root}/capabilities`) return respond(res, capabilities);
    if (hit.url === `${root}/template`) { res.writeHead(200, { 'Content-Type': mime }); return res.end('signed-template'); }
    if (hit.url === `${root}/jobs` && hit.method === 'POST') return respond(res, job('ready'), 202);
    if (hit.url === `${root}/jobs/${jobId}/confirm`) return respond(res, job('completed', {
      summaryKind: 'processed', progress: { ...job('ready').progress, committedOutputRows: 3, remainingOutputRows: 0 } }), 202);
    return respond(res, { errorCode: 'unexpected' }, 404);
  });
  f.profile(service.url, 'tenant-demo', 'synthetic-token');
  const optionsFile = join(f.directory, 'options.json'), template = join(f.directory, 'template.xlsx'), input = join(f.directory, 'input.xlsx');
  await writeFile(optionsFile, JSON.stringify(options)); await writeFile(input, 'whole workbook');
  const gotTemplate = await f.run(['data', 'import', 'template', ...baseArgs, '--options-json', optionsFile, '--out', template]);
  assert.equal(gotTemplate.code, 0, gotTemplate.stdout); assert.equal(await readFile(template, 'utf8'), 'signed-template');
  assert.deepEqual(calls.find(hit => hit.url === `${root}/template`).json(), options);
  const checked = await f.run(['data', 'import', 'check', ...baseArgs, '--options-json', optionsFile, '--file', input, '--request-id', requestId, '--wait']);
  assert.equal(checked.code, 0, checked.stdout); assert.match(checked.stderr, new RegExp(requestId));
  assert.equal(output(checked).data.jobId, jobId); assert.match(output(checked).data.message, /待确认/);
  const upload = calls.find(hit => hit.url === `${root}/jobs` && hit.method === 'POST');
  assert.match(upload.headers['content-type'], /^multipart\/form-data; boundary=/);
  for (const fragment of ['whole workbook', 'name="options"', 'product_code__c', 'name="requestId"', requestId,
    'name="coordination"', 'xrain-import-jobs-v1', 'name="commitMode"', 'chunked']) assert.ok(upload.body.includes(fragment), fragment);
  assert.equal(calls.filter(hit => hit.url.endsWith('/confirm')).length, 0);
  const confirmed = await f.run(['data', 'import', 'confirm', ...baseArgs, '--job', jobId, '--plan-revision', '2', '--wait']);
  assert.equal(confirmed.code, 0, confirmed.stdout); assert.match(output(confirmed).data.message, /导入完成/);
  assert.deepEqual(calls.find(hit => hit.url.endsWith('/confirm')).json(), { planRevision: 2, commitMode: 'chunked' });
  assert.ok(calls.every(hit => hit.headers.authorization === 'Bearer synthetic-token' && hit.headers['x-xrain-import-application'] === 'app-demo'));
});

test('lost upload response retains the original request ID and lists only the requested job', async t => {
  const f = fixture(t);
  const service = await mockServer(t, (hit, res) => {
    if (hit.url === `${root}/capabilities`) return respond(res, capabilities);
    if (hit.method === 'POST') return res.destroy();
    if (hit.url.startsWith(`${root}/jobs?`)) return respond(res, { items: [job('checking')], nextCursor: null });
    return respond(res, {}, 404);
  });
  f.profile(service.url); const input = join(f.directory, 'input.xlsx'); await writeFile(input, 'synthetic workbook');
  const lost = await f.run(['data', 'import', 'check', ...baseArgs, '--file', input, '--request-id', requestId]);
  assert.equal(lost.code, 1); assert.equal(output(lost).error.requestId, requestId);
  assert.match(output(lost).error.hint, /data import list/); assert.match(lost.stderr, new RegExp(requestId));
  const found = await f.run(['data', 'import', 'list', ...baseArgs, '--request-id', requestId]);
  assert.equal(found.code, 0, found.stdout); assert.equal(output(found).data.items[0].jobId, jobId);
  assert.equal(service.hits.filter(hit => hit.method === 'POST').length, 1);
  assert.equal(new URL(service.hits.at(-1).url, service.url).searchParams.get('requestId'), requestId);
});

test('a lost confirmation response retains the job and retry uses the same revision without prechecking canConfirm', async t => {
  const f = fixture(t); let attempts = 0;
  const service = await mockServer(t, (hit, res) => {
    if (hit.url.endsWith('/confirm')) {
      assert.deepEqual(hit.json(), { planRevision: 2, commitMode: 'chunked' });
      if (++attempts === 1) return res.destroy();
      return respond(res, job('completed', { canConfirm: false, summaryKind: 'processed' }));
    }
    return respond(res, {}, 404);
  });
  f.profile(service.url);
  const args = ['data', 'import', 'confirm', ...baseArgs, '--job', jobId, '--plan-revision', '2'];
  const lost = await f.run(args);
  assert.equal(lost.code, 1); assert.equal(output(lost).error.details.jobId, jobId); assert.match(output(lost).error.hint, /data import show/);
  const repeated = await f.run(args);
  assert.equal(repeated.code, 0, repeated.stdout); assert.equal(output(repeated).data.status, 'completed');
  assert.equal(attempts, 2); assert.ok(service.hits.every(hit => hit.method === 'POST'));
});

test('wait, pause, recheck and cancel report actual states and preserve committed progress', async t => {
  const f = fixture(t); let state = job('checking');
  const service = await mockServer(t, (hit, res) => {
    if (hit.method === 'GET') return respond(res, state);
    if (hit.url.endsWith('/pause')) { state = job('paused', { progress: { ...job('ready').progress, committedOutputRows: 1, remainingOutputRows: 2 } }); return respond(res, state, 202); }
    if (hit.url.endsWith('/resume')) {
      assert.deepEqual(hit.json(), { planRevision: 2, action: 'recheck' });
      state = job('ready', { planRevision: 3, progress: { ...job('ready').progress, committedOutputRows: 1, remainingOutputRows: 2 } });
      return respond(res, state, 202);
    }
    if (hit.url.endsWith('/cancel')) { state = job('canceled'); return respond(res, state, 202); }
    return respond(res, {}, 404);
  });
  f.profile(service.url);
  const timeout = await f.run(['data', 'import', 'wait', ...baseArgs, '--job', jobId, '--wait-timeout', '1', '--poll-interval', '1']);
  assert.equal(timeout.code, 1); assert.equal(output(timeout).error.code, 'import_wait_timeout');
  assert.equal(output(timeout).error.details.jobId, jobId); assert.equal(service.hits.filter(hit => hit.method === 'POST').length, 0);
  const paused = await f.run(['data', 'import', 'pause', ...baseArgs, '--job', jobId, '--wait']);
  assert.equal(paused.code, 0); assert.equal(output(paused).data.status, 'paused');
  const checked = await f.run(['data', 'import', 'resume', ...baseArgs, '--job', jobId, '--plan-revision', '2', '--action', 'recheck', '--wait']);
  assert.equal(checked.code, 0, checked.stdout); assert.equal(output(checked).data.planRevision, 3);
  assert.match(output(checked).data.message, /已提交 1 条，剩余资料预检通过/);
  const observed = await f.run(['data', 'import', 'wait', ...baseArgs, '--job', jobId]);
  assert.equal(observed.code, 0); assert.equal(output(observed).data.status, 'ready');
  assert.equal(service.hits.filter(hit => hit.url.endsWith('/confirm')).length, 0);
  const canceled = await f.run(['data', 'import', 'cancel', ...baseArgs, '--job', jobId, '--wait']);
  assert.equal(canceled.code, 0); assert.match(output(canceled).data.message, /已结束/);
});

test('pagination carries the frozen view and does not aggregate or substitute mismatched results', async t => {
  const f = fixture(t);
  const service = await mockServer(t, (hit, res) => {
    if (hit.url === `${root}/jobs/${jobId}`) return respond(res, job('ready'));
    if (hit.url.includes('/rows?')) return respond(res, { viewVersion: 'view-1', planRevision: 2, items: [{ sourceRow: 8 }], nextCursor: 'next', totalCount: 3, detailsStatus: 'complete' });
    if (hit.url.includes('/issues?')) return respond(res, { viewVersion: 'other', planRevision: 2, items: [], totalCount: 0, detailsStatus: 'complete' });
    return respond(res, {}, 404);
  });
  f.profile(service.url);
  const rows = await f.run(['data', 'import', 'rows', ...baseArgs, '--job', jobId, '--source-row', '8', '--page-size', '1']);
  assert.equal(rows.code, 0, rows.stdout); assert.equal(output(rows).data.nextCursor, 'next');
  const query = new URL(service.hits.at(-1).url, service.url).searchParams;
  assert.equal(query.get('viewVersion'), 'view-1'); assert.equal(query.get('sourceRow'), '8'); assert.equal(query.get('pageSize'), '1');
  const issues = await f.run(['data', 'import', 'issues', ...baseArgs, '--job', jobId, '--view-version', 'view-1']);
  assert.equal(issues.code, 1); assert.equal(output(issues).error.code, 'invalid_response');
});

test('large downloads stream past the JSON limit and interrupted downloads never replace an existing file', async t => {
  const f = fixture(t); let broken = false;
  const bytes = 33 * 1024 * 1024 + 7, chunk = Buffer.alloc(65536, 65);
  const service = await mockServer(t, async (hit, res) => {
    if (hit.url === `${root}/capabilities`) return respond(res, capabilities);
    if (hit.url.includes('/file?')) {
      if (broken) {
        res.writeHead(200, { 'Content-Type': mime, 'Content-Length': 100 }); res.write('incomplete');
        await new Promise(resolve => setTimeout(resolve, 50)); return res.destroy();
      }
      res.writeHead(200, { 'Content-Type': mime, 'Content-Length': bytes });
      for (let remaining = bytes; remaining > 0; remaining -= chunk.length) {
        if (!res.write(chunk.subarray(0, Math.min(chunk.length, remaining)))) await once(res, 'drain');
      }
      return res.end();
    }
    return respond(res, {}, 404);
  });
  f.profile(service.url); const destination = join(f.directory, 'large.xlsx');
  const downloaded = await f.run(['data', 'import', 'download', ...baseArgs, '--job', jobId, '--purpose', 'remaining', '--out', destination]);
  assert.equal(downloaded.code, 0, downloaded.stdout); assert.equal((await stat(destination)).size, bytes);
  const hash = createHash('sha256'); for await (const piece of createReadStream(destination)) hash.update(piece);
  const expected = createHash('sha256'); for (let left = bytes; left > 0; left -= chunk.length) expected.update(chunk.subarray(0, Math.min(chunk.length, left)));
  assert.equal(hash.digest('hex'), expected.digest('hex'));
  const overwrite = await f.run(['data', 'import', 'download', ...baseArgs, '--job', jobId, '--purpose', 'result', '--out', destination]);
  assert.equal(overwrite.code, 1); assert.equal(output(overwrite).error.code, 'output_exists'); assert.equal((await stat(destination)).size, bytes);
  broken = true; const incomplete = join(f.directory, 'incomplete.xlsx');
  const failed = await f.run(['data', 'import', 'download', ...baseArgs, '--job', jobId, '--purpose', 'result', '--out', incomplete]);
  assert.equal(failed.code, 1); assert.ok(!(await readdir(f.directory)).some(name => name.includes('incomplete.xlsx')));
  broken = false;
  const retried = await f.run(['data', 'import', 'download', ...baseArgs, '--job', jobId, '--purpose', 'result', '--out', incomplete]);
  assert.equal(retried.code, 0, retried.stdout); assert.equal((await stat(incomplete)).size, bytes);
});

test('upload uses the job file budget beyond 32 MiB, and unsuitable bindings are rejected before upload', async t => {
  const f = fixture(t); let cap = capabilities;
  const service = await mockServer(t, (hit, res) => {
    if (hit.url === `${root}/capabilities`) return respond(res, cap);
    if (hit.method === 'POST' && hit.url === `${root}/jobs`) return respond(res, job('ready'), 202);
    return respond(res, {}, 404);
  });
  f.profile(service.url); const input = join(f.directory, 'large.xlsx'), optionsFile = join(f.directory, 'options.json');
  await writeFile(input, 'x'); await truncate(input, 33 * 1024 * 1024); await writeFile(optionsFile, JSON.stringify(options));
  cap = { ...capabilities, orchestrations: [{ ...capabilities.orchestrations[0], import: { version: 1, prepareRecord: true } }] };
  const rejected = await f.run(['data', 'import', 'check', ...baseArgs, '--file', input, '--options-json', optionsFile, '--request-id', requestId]);
  assert.equal(rejected.code, 1); assert.equal(output(rejected).error.code, 'import_binding_unavailable');
  assert.equal(service.hits.filter(hit => hit.method === 'POST').length, 0);
  cap = capabilities;
  const accepted = await f.run(['data', 'import', 'check', ...baseArgs, '--file', input, '--options-json', optionsFile, '--request-id', requestId]);
  assert.equal(accepted.code, 0, accepted.stdout); assert.ok(service.hits.at(-1).body.length > 32 * 1024 * 1024);
});

test('local interruption stops waiting, preserves job identity, and sends no pause or cancel', async t => {
  const f = fixture(t);
  const service = await mockServer(t, (_hit, res) => respond(res, job('running')));
  f.profile(service.url);
  const timer = setTimeout(() => process.emit('SIGINT'), 100);
  try {
    const result = await f.run(['data', 'import', 'wait', ...baseArgs, '--job', jobId, '--poll-interval', '2']);
    assert.equal(result.code, 130); assert.equal(output(result).error.code, 'interrupted');
    assert.equal(output(result).error.details.jobId, jobId); assert.ok(service.hits.every(hit => hit.method === 'GET'));
  } finally { clearTimeout(timer); }
});

test('a paused initial check resumes with revision zero and invalid batch shapes cause no earlier writes', async t => {
  const f = fixture(t);
  const service = await mockServer(t, (hit, res) => {
    if (hit.url.endsWith('/resume')) {
      assert.deepEqual(hit.json(), { planRevision: 0, action: 'continue' });
      return respond(res, job('checking', { planRevision: 0 }), 202);
    }
    return respond(res, { recordId: 'created' });
  });
  f.profile(service.url);
  const resumed = await f.run(['data', 'import', 'resume', ...baseArgs, '--job', jobId, '--plan-revision', '0', '--action', 'continue']);
  assert.equal(resumed.code, 0, resumed.stdout);
  const before = service.hits.length, plan = join(f.directory, 'batch.json');
  await writeFile(plan, JSON.stringify([
    ['data', 'create', entity, '--values', '{}'],
    ['data', 'import', 'confirm', '--entity', entity, '--job', jobId]
  ]));
  const invalid = await f.run(['batch', '--file', plan, '--json']);
  assert.equal(invalid.code, 1); assert.equal(output(invalid).error.code, 'invalid_arguments');
  assert.equal(service.hits.length, before);
});
