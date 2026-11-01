import assert from 'node:assert/strict';
import test from 'node:test';
import { createImporter } from './app.mjs';
import { createRepository } from './repository.mjs';

test('ordinary import and replay', async () => {
  const scope = { tenantId: 't1', actorId: 'alice' };
  const repository = createRepository(); repository.grant(scope);
  const importer = createImporter(repository);
  const rows = [{ code: 'one', values: { name: 'part', amount: 2 } }];
  const token = importer.prepare(rows, scope);
  const receipt = await importer.commit(token, scope);
  assert.equal(receipt.created, 1);
  assert.deepEqual(await importer.commit(token, scope), receipt);
  assert.deepEqual(repository.read(scope), rows);
});
