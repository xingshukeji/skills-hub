import assert from 'node:assert/strict';
import { saveLabel, readItem } from './app.mjs';
const expected = { id: 'item-a', label: 'Alpha', category: 'sample' };
assert.deepEqual(saveLabel(' Alpha '), expected);
assert.deepEqual(readItem(), expected);
console.log('save and readback passed');
