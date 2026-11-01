import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';
import { createImporter } from './app.mjs';
import { createRepository } from './repository.mjs';

const scope = { tenantId: 't1', actorId: 'alice' };
const repository = createRepository(); repository.grant(scope);
const importer = createImporter(repository);
const rows = Array.from({ length: 4000 }, (_, index) => ({ code: String(index), values: { name: `零件😀-${index}`, amount: index } }));
const started = performance.now();
const token = importer.prepare(rows, scope);
assert.equal(repository.read(scope).length, 0);
const receipt = await importer.commit(token, scope);
assert.equal(receipt.created, rows.length);
assert.deepEqual(repository.read(scope), rows);
console.log(JSON.stringify({ rows: rows.length, milliseconds: performance.now() - started, note: 'Isolated functional workload; not production capacity evidence.' }));
