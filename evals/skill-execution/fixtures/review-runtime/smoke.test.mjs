import test from 'node:test';
import assert from 'node:assert/strict';
import { BindingIndex, mergeHistory, SubscriptionHub, createSessionView, PermissionStore } from './app.mjs';

test('small binding updates and history pages preserve their visible contents', () => {
  let data = '[]';
  const index = new BindingIndex({ read: () => data, write: next => { data = next; } });
  index.save({ id: 'first' }); index.save({ id: 'second' });
  assert.deepEqual(index.list(), JSON.parse(data));
  assert.deepEqual(mergeHistory([{ seq: 1 }], [{ seq: 0 }]), [{ seq: 0 }, { seq: 1 }]);
});

test('an admitted view receives messages and a current permission scope is available', async () => {
  const hub = new SubscriptionHub(), client = hub.connect('person');
  const view = createSessionView(['one', 'two'], { subscribe: channels => hub.subscribe(client, channels) });
  await view.open(); view.receive({ type: 'events', items: ['hello'] });
  assert.deepEqual(view.messages, ['hello']);
  assert.deepEqual([...client.subscriptions], ['one', 'two']);
  const permissions = new PermissionStore(() => 0); permissions.enter('session', 'tenant');
  assert.equal(permissions.read('session'), 'tenant');
});
