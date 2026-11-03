import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {test} from 'node:test';
import {fixture, mockServer, respond} from './helpers.mjs';

// Select the envelope for this CLI version; quota and content expectations do not depend on it.
const protocol = (await readFile(new URL('../src/xrain-cli/data-import.mjs', import.meta.url), 'utf8'))
  .match(/const protocol = '(xrain-import-jobs-v[12])';/)[1];
const entity = 'product__c', jobId = 'a'.repeat(32), requestId = 'b'.repeat(32);
const payload = Buffer.from('完整_x0041_🙂 original file\n'.repeat(4096));
const digest = value => createHash('sha256').update(value).digest('hex');
const execute = promisify(execFile);
const summary = {sourceRows: 1, outputRows: 1, created: 1, updated: 0, deleted: 0, unchanged: 0,
  notFoundSkipped: 0, transformSkipped: 0, clearedFields: 0, sourceErrors: 0, outputErrors: 0};
const accepted = {jobId, requestId, entityCode: entity, protocol, commitMode: 'chunked', status: 'checking', phase: 'checking',
  version: 1, planRevision: 0, viewVersion: null,
  progress: {sourceRows: 0, checkedSourceRows: 0, outputRows: 0, committedOutputRows: 0, remainingOutputRows: 0},
  summary, summaryKind: 'planned', detailsStatus: 'complete', canConfirm: false, canContinue: false, canRecheck: false,
  pauseRequested: false, cancelRequested: false, sourceComplete: false, canDownloadRemaining: false,
  createdAt: '2026-11-04T00:00:00Z', updatedAt: '2026-11-04T00:00:00Z'};

for (const entry of ['source', 'bundle']) {
  for (const fileLimit of [0, 1]) {
    test(`${entry} job input honors ${fileLimit === 0 ? 'removed zero' : 'positive legacy'} byte admission`, async t => {
      const f = fixture(t);
      let uploads = 0;
      const service = await mockServer(t, async (hit, res) => {
        if (hit.url.endsWith('/capabilities')) return respond(res, {entityCode: entity, orchestrations: [],
          jobs: {protocol, supported: true, commitModes: ['chunked'], limits: {maximumFileBytes: fileLimit}}});
        assert.equal(hit.method, 'POST');
        assert.equal(hit.url, `/api/data/v1/entities/${entity}/imports/jobs`);
        assert.equal(hit.headers['x-xrain-import-application'], 'app-demo');
        const form = await new Response(hit.body, {headers: {'content-type': hit.headers['content-type']}}).formData();
        assert.equal(form.get('coordination'), protocol);
        assert.equal(form.get('commitMode'), 'chunked');
        assert.equal(form.get('requestId'), requestId);
        const file = form.get('file');
        assert.equal(file.size, payload.length);
        assert.equal(digest(Buffer.from(await file.arrayBuffer())), digest(payload));
        uploads++;
        respond(res, protocol.endsWith('v2') ? {disclosure: 'complete', job: accepted} : accepted, 202);
      });
      f.profile(service.url);
      const file = join(f.directory, 'source.xlsx'); await writeFile(file, payload);
      const args = ['data', 'import', 'check', '--entity', entity, '--application', 'app-demo', '--file', file, '--request-id', requestId, '--json'];
      let result;
      if (entry === 'source') result = await f.run(args);
      else {
        const bundle = fileURLToPath(new URL('../skills/shzw-xrain-cli/scripts/xrain-cli.mjs', import.meta.url));
        try { result = {code: 0, ...await execute(process.execPath, [bundle, ...args], {env: f.env})}; }
        catch (error) { result = {code: error.code, stdout: error.stdout, stderr: error.stderr}; }
      }
      if (fileLimit === 0) {
        assert.equal(result.code, 0, result.stdout); assert.equal(uploads, 1);
        assert.equal(JSON.parse(result.stdout).data.jobId, jobId);
      } else { assert.notEqual(result.code, 0); assert.equal(uploads, 0); }
      assert.equal(digest(await readFile(file)), digest(payload));
    });
  }
}
