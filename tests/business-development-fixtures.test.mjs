import test from 'node:test';
import assert from 'node:assert/strict';
import { createFilePlatform, createQueryPlatform, makeRows } from '../evals/skill-execution/fixtures/business-boundaries/platform.mjs';

// Evaluator-side checks of the synthetic contract. They do not score a model or a skill.
function batchesFor(rows, limits) {
  const batches = [];
  let current = [], bytes = 2;
  for (const row of rows) {
    const rowBytes = Buffer.byteLength(JSON.stringify(row));
    if (rowBytes + 2 > limits.maximumParsedBytes) throw new Error('individual row does not fit');
    if (current.length && (current.length === limits.maximumSourceRows || bytes + 1 + rowBytes > limits.maximumParsedBytes)) {
      batches.push(current); current = []; bytes = 2;
    }
    bytes += (current.length ? 1 : 0) + rowBytes;
    current.push(row);
  }
  if (current.length) batches.push(current);
  return batches;
}

test('whole-file fixture exposes both limits and the actual repeated user operations', () => {
  const platform = createFilePlatform(), rows = makeRows();
  const limits = platform.capabilities();
  assert.equal(rows.length, 40000);
  assert.throws(() => platform.preview(rows), { code: 'source_row_limit' });
  assert.throws(() => platform.preview(rows.slice(0, limits.maximumSourceRows)), { code: 'parsed_payload_limit' });
  const batches = batchesFor(rows, limits);
  assert.ok(batches.length > Math.ceil(rows.length / limits.maximumSourceRows));
  assert.equal(batches.flat().length, rows.length);
  assert.equal(new Set(batches.flat().map(row => row.id)).size, rows.length);
  for (const batch of batches) assert.equal(platform.preview(batch).state, 'ready');
  assert.equal(batches.length * limits.userSteps.length, batches.length * 2);
  assert.equal(platform.calls.filter(call => call.operation === 'execute').length, 0);
});

test('explicit departmental files remain a valid delivery under the same platform limits', () => {
  const platform = createFilePlatform(), rows = makeRows(400, 4);
  const groups = Map.groupBy(rows, row => row.department);
  assert.equal(groups.size, 4);
  for (const group of groups.values()) {
    assert.equal(group.length, 100);
    assert.equal(platform.preview(group).state, 'ready');
  }
  assert.deepEqual([...groups.values()].flat().map(row => row.id).sort(), rows.map(row => row.id).sort());
  assert.equal(platform.calls.filter(call => call.operation === 'execute').length, 0);
});

test('an unknown former submission is resolved by reading its original batch', () => {
  const platform = createFilePlatform();
  assert.deepEqual(platform.getBatch('accepted-original'), { batchId: 'accepted-original', state: 'Succeeded', completedRows: 100 });
  assert.deepEqual(platform.calls, [{ operation: 'getBatch', batchId: 'accepted-original' }]);
  assert.throws(() => platform.execute('accepted-original'), { code: 'import_not_authorized' });
});

test('a completed empty work-order query does not imply that parts were queried', async () => {
  const platform = createQueryPlatform();
  assert.deepEqual(await platform.workOrders('open'), { records: [], totalCount: 0, hasMore: false, actor: 'fixture-member', scope: 'own' });
  assert.deepEqual(platform.calls.map(call => call.operation), ['workOrders']);
  const missingInput = createQueryPlatform();
  await assert.rejects(missingInput.parts(), { code: 'equipment_required' });
});

test('supplying the required input allows two complete and legitimately empty queries', async () => {
  const platform = createQueryPlatform();
  const results = await Promise.all([platform.workOrders('open'), platform.parts('equipment-a')]);
  assert.ok(results.every(result => result.totalCount === 0 && result.hasMore === false && result.records.length === 0));
  assert.deepEqual(platform.calls.map(call => [call.operation, call.arguments]), [
    ['workOrders', { status: 'open' }], ['parts', { equipmentId: 'equipment-a' }],
  ]);
  assert.ok(platform.calls.every(call => call.actor === 'fixture-member' && call.scope === 'own'));
});
