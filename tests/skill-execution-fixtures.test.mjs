import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Gateway, operations, item } from '../evals/skill-execution/fixtures/review-actions/app.mjs';
import { build } from '../evals/skill-execution/fixtures/review-package/app.mjs';
import { list, detail, member, records, saveView } from '../evals/skill-execution/fixtures/review-views/app.mjs';
import { Remote } from '../evals/skill-execution/fixtures/review-submission/remote.mjs';
import { Submission } from '../evals/skill-execution/fixtures/review-submission/app.mjs';
import { createEventSource, openSession } from '../evals/skill-execution/fixtures/review-session/app.mjs';
import { CustomerEditor, RecordBrowser } from '../evals/skill-execution/fixtures/review-consumers/app.mjs';
import { BindingIndex, mergeHistory, SubscriptionHub, createSessionView, PermissionStore } from '../evals/skill-execution/fixtures/review-runtime/app.mjs';

// These are evaluator-side witnesses of intentionally defective fixtures.
// Passing these tests validates the cases, never the skill or a model response.
test('runtime fixture reproduces large arguments in save, history and event consumption', () => {
  const rows = Array.from({ length: 250_000 }, (_, index) => ({ id: `binding-${index}`, seq: index + 1 }));
  let persisted = JSON.stringify(rows);
  const bindings = new BindingIndex({ read: () => persisted, write: next => { persisted = next; } });
  assert.throws(() => bindings.save({ id: 'new-binding' }), RangeError);
  assert.equal(bindings.list().length, rows.length);
  assert.equal(JSON.parse(persisted).length, rows.length + 1);
  assert.throws(() => mergeHistory(rows, [{ seq: 0 }]), RangeError);
  const view = createSessionView([], {});
  assert.throws(() => view.receive({ type: 'events', items: rows }), RangeError);
  assert.deepEqual(mergeHistory([], [{ seq: 0 }]), [{ seq: 0 }]);
});

test('runtime fixture separates full-directory rejection from the cumulative admission race', async () => {
  const hub = new SubscriptionHub(), cold = hub.connect('person');
  const view = createSessionView(['a', 'b', 'c'], { subscribe: channels => hub.subscribe(cold, channels) });
  await view.open();
  assert.equal(view.connected, true);
  assert.equal(cold.subscriptions.size, 0);
  assert.deepEqual(view.messages, []);
  let release, entered = 0, bothEntered;
  const gate = new Promise(resolve => { release = resolve; });
  const both = new Promise(resolve => { bothEntered = resolve; });
  const racing = new SubscriptionHub(async () => { if (++entered === 2) bothEntered(); await gate; return true; });
  const client = racing.connect('person');
  const first = racing.subscribe(client, ['a', 'b']), second = racing.subscribe(client, ['c']);
  await both; release(); await Promise.all([first, second]);
  assert.equal(client.subscriptions.size, 3);
  const normal = hub.connect('person');
  await hub.subscribe(normal, ['a', 'b']);
  await assert.rejects(hub.subscribe(normal, ['c']), /subscription_limit/);
  const denied = new SubscriptionHub(async () => false), refused = denied.connect('other');
  await assert.rejects(denied.subscribe(refused, ['a']), /access_denied/);
  assert.equal(refused.subscriptions.size, 0);
});

test('runtime permission registry legitimately survives value TTL and retires on session exit', () => {
  let now = 0;
  const permissions = new PermissionStore(() => now);
  permissions.enter('tenant-session', 'tenant'); permissions.enter('host-session', 'host');
  now = 11;
  assert.throws(() => permissions.read('tenant-session'), /permission_cache_not_ready/);
  assert.equal(permissions.activeScopes.size, 2);
  permissions.refresh();
  assert.equal(permissions.read('tenant-session'), 'tenant');
  assert.equal(permissions.read('host-session'), 'host');
  permissions.leave('tenant-session'); permissions.refresh();
  assert.throws(() => permissions.read('tenant-session'), /permission_cache_not_ready/);
  assert.equal(permissions.activeScopes.size, 1);
});
test('raw execution inputs remain separate from grading and resolve every fixture', async () => {
  const root = new URL('../evals/skill-execution/', import.meta.url);
  const cases = JSON.parse(await readFile(new URL('cases.json', root), 'utf8'));
  const rubric = JSON.parse(await readFile(new URL('rubric.json', root), 'utf8'));
  assert.equal(new Set(cases.map(row => row.id)).size, cases.length);
  assert.deepEqual(cases.map(row => row.id).sort(), rubric.cases.map(row => row.id).sort());
  for (const row of cases) {
    assert.deepEqual(Object.keys(row).sort(), ['context', 'id', 'request', 'workspace']);
    assert.match(row.workspace, /^fixtures\/[a-z-]+$/);
    assert.ok((await readFile(new URL(`${row.workspace}/AGENTS.md`, root), 'utf8')).length);
  }
});

test('the existing editor case reproduces a late save replacing the newly opened draft', async () => {
  let complete;
  const page = new CustomerEditor({ save: value => new Promise(resolve => { complete = () => resolve(value); }) });
  page.open({ id: 'customer-a', phone: '100' });
  page.editPhone('101');
  const pending = page.save();
  page.confirmLeaveAndOpen({ id: 'customer-b', phone: '200' });
  page.editPhone('201');
  complete();
  await pending;
  assert.equal(page.current.id, 'customer-a');
  assert.equal(page.current.phone, '101');
  assert.equal(page.dirty, false);
  assert.equal(page.route, 'detail');
});
test('the existing browser case leaves both list and detail without proxy renewal', async () => {
  for (const method of ['list', 'detail']) {
    const proxy = { token: 'expired', async renew() { this.token = 'valid'; } };
    const main = { token: 'main' };
    const read = async token => { if (token !== 'valid') throw { status: 401 }; return ['ok']; };
    const browser = new RecordBrowser({ directory: read, list: read, detail: read }, proxy, main);
    await assert.rejects(browser[method]('sample'), error => error.status === 401);
    assert.deepEqual(await browser.directory(), ['ok']);
    assert.deepEqual(await browser[method]('sample'), ['ok']);
    assert.equal(main.token, 'main');
  }
});

for (const key of ['contact', 'supplement', 'escalate']) {
  test(`source withdrawal during composition reaches the ${key} consumer`, async () => {
    const gateway = new Gateway();
    await operations[key](gateway, item, async () => { gateway.sources.clear(); return 'source-based text'; });
    assert.equal(gateway.messages.length, 1);
    assert.equal(gateway.messages[0].body, 'source-based text');
  });
}
test('normal collaboration, ordinary reply protection and direct messaging are legitimate controls', async () => {
  for (const key of ['reply', 'contact', 'supplement', 'escalate']) {
    const gateway = new Gateway();
    await operations[key](gateway, item, async () => 'allowed');
    assert.equal(gateway.messages.length, 1);
    const revoked = new Gateway();
    revoked.sources.clear();
    await assert.rejects(operations[key](revoked, item, async () => 'denied'), /source unavailable/);
    const targetRevoked = new Gateway();
    await assert.rejects(operations[key](targetRevoked, item, async () => { targetRevoked.destinations.clear(); return 'denied'; }), /cannot post/);
    assert.equal(targetRevoked.messages.length, 0);
  }
  const reply = new Gateway();
  await assert.rejects(operations.reply(reply, item, async () => { reply.sources.clear(); return 'denied'; }), /source unavailable/);
  assert.equal(reply.messages.length, 0);
  assert.equal(operations.direct(reply, 'starter', 'independent text').body, 'independent text');
});
test('a configuration edit during compilation changes only the outer name, not the frozen contents', async () => {
  const configuration = { name: 'catalog', version: '1.2.0', files: { 'a.txt': 'original' }, dependencies: ['base@1'] };
  const result = await build(configuration, async files => {
    configuration.name = 'changed'; configuration.version = '1.3.0';
    configuration.files['a.txt'] = 'changed'; configuration.dependencies.push('new@2');
    return files;
  });
  const content = JSON.parse(result.content);
  assert.equal(result.filename, 'changed-1.3.0.appkg');
  assert.deepEqual(content.manifest, { name: 'catalog', version: '1.2.0', dependencies: ['base@1'] });
  assert.equal(content.files['a.txt'], 'original');
  assert.equal(result.digest, createHash('sha256').update(result.content).digest('hex'));
});
test('view fixtures separately reproduce authorized relation omission and detail field disclosure', () => {
  const view = { title: 'shared', columns: ['title', 'contact', 'confidential'] };
  const actor = member();
  assert.deepEqual(list(actor, view, records)[0].values, { title: 'sample' });
  assert.equal(detail(actor, 'row-1', records).values.confidential, 'restricted sample');
  assert.deepEqual(saveView(view, 'renamed').columns, view.columns);
  assert.deepEqual(list(member(['title', 'contact'], []), view, records)[0].values, { title: 'sample' });
  assert.throws(() => list(actor, { ...view, condition: { field: 'confidential', value: 'x' } }, records), /condition denied/);
  assert.throws(() => detail({ ...actor, id: 'member-b' }, 'row-1', records), /record denied/);
  assert.equal(detail(member(['title', 'confidential']), 'row-1', records).values.confidential, 'restricted sample');
});
test('a missing lookup followed by local cancellation still allows late submission', async () => {
  const remote = new Remote();
  const page = new Submission(remote);
  assert.equal((await page.start('request-1', { name: 'sample' })).status, 'unknown');
  assert.equal((await remote.lookup('request-1')).status, 'not-found');
  assert.equal(remote.installed.length, 0);
  assert.equal((await page.cancel()).status, 'cancelled');
  assert.equal(page.requestId, null);
  remote.deliver();
  assert.equal(remote.installed.length, 1);
});
test('server withdrawal prevents a late request and preserves an already completed result', async () => {
  const remote = new Remote();
  await assert.rejects(remote.submit('request-1', { name: 'sample' }), /timeout/);
  assert.equal((await remote.withdraw('request-1')).status, 'withdrawn');
  remote.deliver();
  assert.equal(remote.installed.length, 0);
  assert.equal((await remote.submit('request-1', { name: 'sample' })).status, 'withdrawn');
  const completed = new Remote({ immediate: true });
  const page = new Submission(completed);
  await page.start('request-2', { name: 'done' });
  assert.equal((await page.cancel()).status, 'completed');
  assert.equal((await completed.withdraw('request-2')).status, 'completed');
  assert.equal(completed.installed.length, 1);
});
test('starting again before a terminal result loses the client reference to the first pending request', async () => {
  const remote = new Remote();
  const page = new Submission(remote);
  assert.equal((await page.start('request-1', { name: 'first' })).status, 'unknown');
  assert.equal((await page.start('request-2', { name: 'second' })).status, 'unknown');
  assert.equal(page.requestId, 'request-2');
  assert.deepEqual([...remote.pending.keys()], ['request-1', 'request-2']);
  assert.equal(remote.results.has('request-1'), false);
  assert.equal(remote.withdrawn.has('request-1'), false);
});
test('closing and reopening a session leaves an old live subscription without needing load assumptions', () => {
  const source = createEventSource();
  const first = openSession(source);
  source.emit('message', 'first');
  first.close();
  assert.deepEqual(first.messages, ['first']);
  const second = openSession(source);
  source.emit('message', 'second');
  assert.deepEqual(first.messages, ['first', 'second']);
  assert.deepEqual(second.messages, ['second']);
  assert.equal(source.listenerCount('message'), 2);
});
