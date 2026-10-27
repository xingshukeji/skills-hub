import test from 'node:test';
import assert from 'node:assert/strict';
import { ContactsPage } from './contacts-page.mjs';
import { createApi } from './api.mjs';
test('opens the existing customer', async () => {
  const page = new ContactsPage(createApi()); await page.open('customer-a');
  assert.equal(page.record.name, '示例客户'); assert.equal(page.dirty, false);
});
