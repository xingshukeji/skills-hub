import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { build } from './app.mjs';
test('package names and content match a normal build', async () => {
  const result = await build({ name: 'catalog', version: '1.2.0', files: { 'page.txt': 'hello' }, dependencies: [] });
  assert.equal(result.filename, 'catalog-1.2.0.appkg');
  assert.equal(JSON.parse(result.content).manifest.version, '1.2.0');
  assert.equal(result.digest, createHash('sha256').update(result.content).digest('hex'));
});
