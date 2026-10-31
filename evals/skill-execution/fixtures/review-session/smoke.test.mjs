import test from 'node:test';
import assert from 'node:assert/strict';
import { createEventSource, openSession } from './app.mjs';
test('an open session receives a message and retains it when closed', () => {
  const source = createEventSource();
  const session = openSession(source);
  source.emit('message', 'first');
  session.close();
  assert.deepEqual(session.messages, ['first']);
});
