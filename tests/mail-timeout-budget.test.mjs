import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, mockServer, respond } from './helpers.mjs';
import { request, writeOnce } from '../src/xrain-cli/http.mjs';
import { CliError } from '../src/xrain-cli/core.mjs';
import { personalMailDraftDefiniteCodes } from '../src/xrain-cli/delivery-operations.mjs';

function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

for (const kind of ['native', 'application', 'assistance', 'check']) {
  for (const explicit of [false, true]) {
    test(`${kind} mail ${explicit ? 'honors the user deadline' : 'waits for the native owner instead of a generic deadline'}`, async t => {
      const f = fixture(t), ready = deferred(), release = deferred(), deadlines = [];
      let calls = 0;
      t.mock.method(AbortSignal, 'timeout', () => {
        const controller = new AbortController(); deadlines.push(controller); return controller.signal;
      });
      const server = await mockServer(t, async (hit, response) => {
        assert.equal(hit.headers.authorization, 'Bearer synthetic-mail-session');
        if (hit.url.endsWith('/account/context')) return respond(response, { tenantId: 'TEN', userId: 'human' });
        calls++; ready.resolve(); await release.promise;
        respond(response, kind === 'check' ? { receive: { status: 'Succeeded' }, send: { status: 'Succeeded' } }
          : kind === 'assistance' ? { answer: 'Runtime completed the original request' }
          : { status: 'Saved', internetMessageId: '<native-result@synthetic.invalid>' });
      });
      f.store.save({ activeProfile: 'Demo', profiles: { Demo: { server: server.url, tenant: 'TEN', applicationId: 'APP' } } });
      f.store.saveSession('Demo', server.url, 'TEN', 'synthetic-mail-session', Date.now() + 300000);
      const file = join(f.directory, 'input.json');
      writeFileSync(file, JSON.stringify(kind === 'assistance' ? { agentId: 'ai-one', reference: {
        accountId: 'original', mailbox: 'human@synthetic.invalid', folder: 'INBOX', uidValidity: 7, uid: 11 }, action: 'summary' }
        : { to: ['recipient@synthetic.invalid'], subject: 'Synthetic draft', textBody: 'Synthetic body' }));
      const command = kind === 'check' ? ['mail', 'account', 'check', 'original'] : kind === 'native' ? ['mail', 'draft', 'original']
        : kind === 'application' ? ['mail', 'app', 'draft', 'original', '--app-url', server.url]
          : ['mail', 'assist', 'original', '--app-url', server.url];
      const pending = f.run([...command, '--auth', 'session', ...(kind === 'check' ? [] : ['--request-json', file]), '--json', ...(explicit ? ['--timeout', '1'] : [])]);
      await ready.promise;
      for (const controller of deadlines) controller.abort(new DOMException('Synthetic deadline', 'TimeoutError'));
      release.resolve();
      const result = await pending, value = JSON.parse(result.stdout);
      assert.equal(result.code, explicit ? 1 : 0, result.stdout);
      if (explicit) assert.equal(value.error.code, ['assistance', 'check'].includes(kind) ? 'timeout' : 'outcome_unknown');
      else if (kind === 'check') assert.equal(value.data.receive.status, 'Succeeded');
      else assert.equal(value.data.status ?? value.data.answer, kind === 'assistance' ? 'Runtime completed the original request' : 'Saved');
      assert.equal(calls, 1, 'a deadline does not replay a native operation');
    });
  }
}

test('explicit HTTP deadlines remain enforced and an unconfirmed failure code cannot prove an unsaved draft', async t => {
  const deadlines = [], ready = deferred(), release = deferred();
  t.mock.method(AbortSignal, 'timeout', () => { const controller = new AbortController(); deadlines.push(controller); return controller.signal; });
  const server = await mockServer(t, async (_hit, response) => { ready.resolve(); await release.promise; respond(response, {}); });
  const pending = request(server.url, { timeout: 1000 });
  await ready.promise;
  for (const controller of deadlines) controller.abort(new DOMException('Synthetic deadline', 'TimeoutError'));
  release.resolve();
  await assert.rejects(pending, { code: 'timeout' });
  const unconfirmed = new CliError('Synthetic network failure', { code: 'network_error', serverCode: 'email_connection_timeout' });
  await assert.rejects(writeOnce(() => { throw unconfirmed; }, 'Inspect the original draft', {}, [], personalMailDraftDefiniteCodes), { code: 'outcome_unknown' });
});
