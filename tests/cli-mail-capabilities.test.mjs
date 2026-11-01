import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, mockServer, respond } from './helpers.mjs';

const limits = { maximumBodyBytes: 256 * 1024, maximumDraftSubjectLength: 998, maximumDraftRecipients: 50,
  maximumAddressLength: 320, maximumSearchTextLength: 256, maximumSearchPageSize: 50 };
const output = value => JSON.parse(value.stdout);

test('mailbox capabilities use the original platform and application identity and preserve current limits and denials', async t => {
  const f = fixture(t); let denied = false;
  const platform = await mockServer(t, (hit, res) => {
    assert.equal(hit.headers.authorization, 'Bearer member-session');
    if (hit.url.endsWith('/account/context')) return respond(res, { tenantId: 'TEN', userId: 'human' });
    assert.equal(hit.method, 'GET'); assert.equal(hit.url, '/api/delivery/v1/email/me/capabilities');
    respond(res, denied ? { errorCode: 'email.forbidden' } : limits, denied ? 403 : 200);
  });
  const app = await mockServer(t, (hit, res) => {
    assert.equal(hit.method, 'GET'); assert.equal(hit.url, '/api/cli/v1/mail/capabilities');
    assert.equal(hit.headers.authorization, 'Bearer member-session');
    assert.equal(hit.headers['x-xrain-application-id'], 'MAIL');
    assert.equal(hit.headers['x-xrain-expected-tenant-id'], 'TEN');
    assert.equal(hit.headers['x-xrain-expected-user-id'], 'human');
    assert.equal(hit.headers.cookie, undefined);
    respond(res, denied ? { error: { code: 'application.admission_denied' } } : limits, denied ? 403 : 200);
  });
  f.profile(platform.url, 'TEN');
  f.store.saveSession('Demo', platform.url, 'TEN', 'member-session', Date.now() + 300000);
  f.env.XRAIN_TOKEN = 'unrelated-token';
  const commands = [['mail', 'capabilities', '--auth', 'session'], ['mail', 'app', 'capabilities', '--app-url', app.url, '--application-id', 'MAIL']];
  for (const args of commands) {
    const result = await f.run([...args, '--json']);
    assert.equal(result.code, 0, result.stdout); assert.deepEqual(output(result).data, limits);
  }
  denied = true;
  for (const args of commands) {
    const result = await f.run([...args, '--json']);
    assert.equal(result.code, 1); assert.equal(output(result).error.code, 'permission_denied');
  }
  assert.equal(app.hits.length, 2);
  assert.equal(platform.hits.filter(hit => hit.url.endsWith('/capabilities')).length, 2);
});
