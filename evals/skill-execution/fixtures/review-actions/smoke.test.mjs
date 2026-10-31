import test from 'node:test';
import assert from 'node:assert/strict';
import { Gateway, operations, item } from './app.mjs';
test('available collaboration operations send', async () => {
  for (const key of ['reply', 'contact', 'supplement', 'escalate']) {
    const gateway = new Gateway();
    await operations[key](gateway, item, async () => 'text');
    assert.equal(gateway.messages.length, 1);
  }
});
test('ordinary reply rejects a source withdrawn while composing', async () => {
  const gateway = new Gateway();
  await assert.rejects(operations.reply(gateway, item, async () => { gateway.sources.clear(); return 'text'; }), /source unavailable/);
  assert.equal(gateway.messages.length, 0);
});
test('a direct message uses its own destination permission', () => {
  const gateway = new Gateway();
  gateway.sources.clear();
  assert.equal(operations.direct(gateway, 'starter', 'hello').body, 'hello');
});
