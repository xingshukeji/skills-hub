import test from 'node:test';
import assert from 'node:assert/strict';
import { CustomerEditor, RecordBrowser } from './app.mjs';
test('normal save', async () => {
  const page = new CustomerEditor({ save: async value => value });
  page.open({ id: 'customer-a', phone: '100' }); page.editPhone('200'); await page.save();
  assert.equal(page.current.phone, '200'); assert.equal(page.dirty, false);
});
test('directory recovers only proxy identity', async () => {
  const proxy = { token: 'expired', async renew() { this.token = 'valid'; } };
  const main = { token: 'main' };
  const api = { directory: async token => { if (token !== 'valid') throw { status: 401 }; return ['customers']; } };
  const browser = new RecordBrowser(api, proxy, main);
  assert.deepEqual(await browser.directory(), ['customers']); assert.equal(main.token, 'main');
});
