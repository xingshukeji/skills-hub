import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fixture, mockServer, respond } from './helpers.mjs';

const result = value => JSON.parse(value.stdout);
function client(t, bundled) {
  const f = fixture(t);
  if (!bundled) return f;
  const directory = join(f.directory, 'complete-skill');
  cpSync('skills/shzw-xrain-cli', directory, { recursive: true });
  return { ...f, run(argv) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [join(directory, 'scripts/xrain-cli.mjs'), ...argv], { cwd: f.directory, env: f.env, windowsHide: true });
      let stdout = '', stderr = '';
      child.stdout.on('data', value => { stdout += value; }); child.stderr.on('data', value => { stderr += value; });
      child.on('error', reject); child.on('close', code => resolve({ code, stdout, stderr }));
    });
  } };
}
async function mailbox(t, f) {
  const state = { drafts: 0, reads: 0, status: 409, body: { errorCode: 'email_draft_outcome_unknown' } };
  const reference = { accountId: 'original', mailbox: 'human@example.test', folder: 'Drafts', uidValidity: 7, uid: 11 };
  const server = await mockServer(t, (hit, res) => {
    assert.equal(hit.headers.authorization, 'Bearer synthetic-mail-session');
    if (hit.url.endsWith('/account/context')) return respond(res, { tenantId: 'TEN', userId: 'human' });
    const app = hit.url.startsWith('/api/cli/');
    if (app) {
      assert.equal(hit.headers['x-xrain-application-id'], 'APP');
      assert.equal(hit.headers['x-xrain-expected-user-id'], 'human');
      assert.equal(hit.headers['x-xrain-expected-tenant-id'], 'TEN');
    }
    if (hit.url.endsWith('/drafts')) {
      state.drafts++; state.saved = hit.json();
      return respond(res, state.status === 409 && app && state.body.errorCode ? { error: { code: state.body.errorCode } } : state.body, state.status);
    }
    state.reads++;
    if (hit.url.endsWith('/folders')) return respond(res, { items: [{ name: 'Drafts', label: '草稿', role: 'Drafts' }] });
    if (hit.url.endsWith('/messages/search')) {
      assert.deepEqual(hit.json(), { folder: 'Drafts', text: 'Synthetic draft' });
      return respond(res, { items: [{ reference, subject: state.saved.subject, from: [], to: [], date: null, size: null }], nextCursor: null });
    }
    assert.ok(hit.url.endsWith('/messages/read'));
    assert.deepEqual(hit.json(), { reference });
    return respond(res, { message: { reference, subject: state.saved.subject }, textBody: state.saved.textBody, bodyTruncated: false });
  });
  f.store.save({ activeProfile: 'Demo', profiles: { Demo: { server: server.url, tenant: 'TEN', applicationId: 'APP' } } });
  f.store.saveSession('Demo', server.url, 'TEN', 'synthetic-mail-session', Date.now() + 300000);
  const file = join(f.directory, 'draft.json');
  writeFileSync(file, JSON.stringify({ to: ['recipient@example.test'], subject: 'Synthetic draft', textBody: 'Synthetic text' }));
  const commands = [ ['mail', 'draft', 'original'], ['mail', 'app', 'draft', 'original', '--app-url', server.url] ];
  return { server, state, reference, file, commands };
}

for (const bundled of [false, true]) {
  const label = bundled ? 'copied Skill' : 'source CLI';
  test(`${label}: both mailbox draft paths preserve explicit unknown outcomes and native refusals`, async t => {
    const f = client(t, bundled), m = await mailbox(t, f);
    for (const [status, code, expected] of [[409, 'email_draft_outcome_unknown', 'outcome_unknown'],
      [409, 'email_account_changed', 'conflict'], [403, 'email_identity_required', 'permission_denied']]) {
      m.state.status = status; m.state.body = { errorCode: code };
      for (const command of m.commands) {
        const call = await f.run([...command, '--auth', 'session', '--request-json', m.file, '--json']);
        assert.equal(call.code, 1);
        assert.equal(result(call).error.code, expected, call.stdout);
        assert.equal(result(call).error.httpStatus, status);
        assert.equal(result(call).error.serverCode, code);
        if (expected === 'outcome_unknown') {
          assert.match(result(call).error.hint, /same (?:target|customer)/);
          assert.match(result(call).error.hint, /not (?:replay|automatically)/i);
          assert.equal(result(call).error.details.target.id, 'original');
        }
        assert.ok(!(call.stdout + call.stderr).includes('synthetic-mail-session'));
      }
    }
    assert.equal(m.state.drafts, 6);
  });

  test(`${label}: only a saved draft receipt for the original account succeeds, with optional native reference`, async t => {
    const f = client(t, bundled), m = await mailbox(t, f); m.state.status = 200;
    for (const receipt of [{ status: 'Saved', internetMessageId: '<original@example.test>', reference: null },
      { status: 'Saved', internetMessageId: '<original@example.test>', reference: m.reference },
      { status: 'Unknown', internetMessageId: '<original@example.test>' },
      { status: 'Saved', internetMessageId: '' },
      { status: 'Saved', internetMessageId: '<original@example.test>', reference: { ...m.reference, accountId: 'neighbor' } }]) {
      m.state.body = receipt;
      const valid = receipt.status === 'Saved' && receipt.internetMessageId && (!receipt.reference || receipt.reference.accountId === 'original');
      for (const command of m.commands) {
        const call = await f.run([...command, '--auth', 'session', '--request-json', m.file, '--json']);
        assert.equal(call.code, valid ? 0 : 1, call.stdout);
        if (valid) assert.deepEqual(result(call).data, receipt);
        else {
          assert.equal(result(call).error.code, 'outcome_unknown');
          assert.deepEqual(result(call).error.details.result, receipt);
        }
      }
    }
    assert.equal(m.state.drafts, 10);
  });

  test(`${label}: an uncertain draft stops batch and is found through the original mailbox without another save`, async t => {
    const f = client(t, bundled), m = await mailbox(t, f);
    for (const [index, command] of m.commands.entries()) {
      const prefix = index ? ['mail', 'app'] : ['mail'];
      const target = index ? ['--app-url', m.server.url] : [];
      const plan = join(f.directory, 'plan.json');
      writeFileSync(plan, JSON.stringify([[...command, '--request-json', m.file], [...prefix, 'folders', 'original', ...target]]));
      const before = m.state.reads;
      const batch = await f.run(['batch', plan, '--json']);
      assert.equal(batch.code, 1, batch.stdout);
      assert.equal(result(batch).error.details.results[0].error.code, 'outcome_unknown');
      assert.equal(m.state.drafts, index + 1); assert.equal(m.state.reads, before);
      const folders = await f.run([...prefix, 'folders', 'original', ...target, '--json']);
      assert.equal(folders.code, 0, folders.stdout);
      const query = join(f.directory, 'search.json'); writeFileSync(query, JSON.stringify({ folder: 'Drafts', text: 'Synthetic draft' }));
      const found = await f.run([...prefix, 'search', 'original', ...target, '--request-json', query, '--json']);
      assert.equal(found.code, 0, found.stdout); assert.deepEqual(result(found).data.items[0].reference, m.reference);
      const read = join(f.directory, 'read.json'); writeFileSync(read, JSON.stringify({ reference: result(found).data.items[0].reference }));
      const reopened = await f.run([...prefix, 'read', 'original', ...target, '--request-json', read, '--json']);
      assert.equal(reopened.code, 0, reopened.stdout); assert.equal(result(reopened).data.textBody, 'Synthetic text');
      assert.equal(m.state.drafts, index + 1);
    }
  });
}
