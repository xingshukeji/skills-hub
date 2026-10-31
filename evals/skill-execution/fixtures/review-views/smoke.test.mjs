import test from 'node:test';
import assert from 'node:assert/strict';
import { list, detail, saveView, records, member } from './app.mjs';
test('list omits an unauthorized text column and preserves the shared definition', () => {
  const view = { title: 'shared', columns: ['title', 'confidential'] };
  assert.deepEqual(list(member(), view, records)[0].values, { title: 'sample' });
  assert.deepEqual(saveView(view, 'renamed').columns, view.columns);
});
test('conditions and row access respect their own permissions', () => {
  assert.throws(() => list(member(), { columns: ['title'], condition: { field: 'confidential', value: 'x' } }, records), /condition denied/);
  assert.throws(() => detail({ ...member(), id: 'member-b' }, 'row-1', records), /record denied/);
});
