import test from 'node:test';
import assert from 'node:assert/strict';
import { Remote } from './remote.mjs';
import { Submission } from './app.mjs';
test('a synchronous completion is displayed as the original result', async () => {
  const remote = new Remote({ immediate: true });
  const page = new Submission(remote);
  assert.equal((await page.start('request-1', { name: 'sample' })).status, 'completed');
  assert.equal((await page.cancel()).status, 'completed');
  assert.equal(remote.installed.length, 1);
});
test('the server can withdraw a request before it is registered', async () => {
  const remote = new Remote();
  assert.equal((await remote.withdraw('request-2')).status, 'withdrawn');
  assert.equal((await remote.submit('request-2', { name: 'sample' })).status, 'withdrawn');
  remote.deliver();
  assert.equal(remote.installed.length, 0);
});
