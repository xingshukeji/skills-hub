import assert from 'node:assert/strict';
import { createRepository } from '../../evals/skill-execution/fixtures/optimize-import/repository.mjs';

const alice = { tenantId: 't1', actorId: 'alice' };
const otherTenant = { tenantId: 't2', actorId: 'alice' };
const bob = { tenantId: 't1', actorId: 'bob' };
const rows = () => [{ code: 'a', values: { name: '中文😀', amount: 1.25, nested: { label: 'keep' } } }, { code: 'b', values: { name: 'second', empty: null } }];
function setup(createImporter) {
  const repository = createRepository();
  for (const scope of [alice, otherTenant, bob]) repository.grant(scope);
  return { repository, importer: createImporter(repository) };
}
const code = expected => error => error.code === expected;

export const importFunctionalCases = [
  ['v1 digest keeps a frozen UTF-8 signature', async createImporter => {
    const { importer } = setup(createImporter);
    const input = [{ code: 'q', values: { text: '中文😀' + String.fromCharCode(10, 34) + '<&', zero: 0, amount: 1.25, items: [true, null, 'é'] } }];
    assert.equal(importer.prepare(input, alice).digest, '7a790d35563960f5cec1b53d28e4e4bce29b28fe3b86ec0bb0bee9e0a71d64d5');
  }],
  ['read permission is required before preparing a plan', async createImporter => {
    const { repository, importer } = setup(createImporter); repository.grant(alice, { read: false, write: true });
    assert.throws(() => importer.prepare(rows(), alice), code('forbidden'));
    repository.grant(alice); assert.deepEqual(repository.read(alice), []);
  }],
  ['all values, order and preparation side effects', async createImporter => {
    const { repository, importer } = setup(createImporter); const input = rows();
    const token = importer.prepare(input, alice);
    assert.deepEqual(repository.read(alice), []);
    assert.equal((await importer.commit(token, alice)).created, 2);
    assert.deepEqual(repository.read(alice), input);
  }],
  ['frozen input survives caller mutation', async createImporter => {
    const { repository, importer } = setup(createImporter); const input = rows(); const expected = structuredClone(input);
    const token = importer.prepare(input, alice);
    input[0].values.nested.label = 'changed'; input.push({ code: 'late', values: { name: 'late' } });
    await importer.commit(token, alice);
    assert.deepEqual(repository.read(alice), expected);
  }],
  ['decoded UTF-8 boundary accepts exact bytes', async createImporter => {
    const { repository, importer } = setup(createImporter);
    const input = [{ code: 'a', values: { name: '中文😀' } }];
    const token = importer.prepare(input, alice, { maxValueBytes: 10 });
    await importer.commit(token, alice); assert.deepEqual(repository.read(alice), input);
  }],
  ['decoded UTF-8 boundary rejects one byte over budget', async createImporter => {
    const { repository, importer } = setup(createImporter);
    assert.throws(() => importer.prepare([{ code: 'a', values: { name: '中文😀' } }], alice, { maxValueBytes: 9 }), code('too_large'));
    assert.deepEqual(repository.read(alice), []);
  }],
  ['invalid Unicode and non-object values are rejected', async createImporter => {
    const { repository, importer } = setup(createImporter);
    assert.throws(() => importer.prepare([{ code: 'a', values: { text: String.fromCharCode(0xD800) } }], alice), code('invalid'));
    assert.throws(() => importer.prepare([{ code: 'a', values: 'wrong' }], alice), code('invalid'));
    assert.deepEqual(repository.read(alice), []);
  }],
  ['empty and duplicate input are rejected without writes', async createImporter => {
    const { repository, importer } = setup(createImporter);
    assert.throws(() => importer.prepare([], alice), code('empty'));
    assert.throws(() => importer.prepare([rows()[0], rows()[0]], alice), code('duplicate'));
    assert.deepEqual(repository.read(alice), []);
  }],
  ['plan cannot cross an otherwise authorized tenant', async createImporter => {
    const { repository, importer } = setup(createImporter); const token = importer.prepare(rows(), alice);
    await assert.rejects(importer.commit(token, otherTenant), code('scope'));
    assert.deepEqual(repository.read(alice), []); assert.deepEqual(repository.read(otherTenant), []);
  }],
  ['plan cannot cross an otherwise authorized actor', async createImporter => {
    const { repository, importer } = setup(createImporter); const token = importer.prepare(rows(), alice);
    await assert.rejects(importer.commit(token, bob), code('scope'));
    assert.deepEqual(repository.read(bob), []);
  }],
  ['revocation after prepare is checked at commit', async createImporter => {
    const { repository, importer } = setup(createImporter); const token = importer.prepare(rows(), alice);
    repository.revoke(alice); await assert.rejects(importer.commit(token, alice), code('forbidden'));
    repository.grant(alice); assert.deepEqual(repository.read(alice), []);
  }],
  ['metadata change rejects an uncommitted plan', async createImporter => {
    const { repository, importer } = setup(createImporter); const token = importer.prepare(rows(), alice);
    repository.changeRevision(alice); await assert.rejects(importer.commit(token, alice), code('stale'));
    assert.deepEqual(repository.read(alice), []);
  }],
  ['failed save is atomic and the original plan remains recoverable', async createImporter => {
    const { repository, importer } = setup(createImporter); const input = rows(); const token = importer.prepare(input, alice);
    repository.failNextAt(1); await assert.rejects(importer.commit(token, alice), code('save_failed'));
    assert.deepEqual(repository.read(alice), []);
    assert.equal((await importer.commit(token, alice)).created, input.length); assert.deepEqual(repository.read(alice), input);
  }],
  ['acknowledgement loss replays the original receipt without duplicate rows', async createImporter => {
    const { repository, importer } = setup(createImporter); const token = importer.prepare(rows(), alice);
    repository.loseNextResponse(); await assert.rejects(importer.commit(token, alice), code('ack_lost'));
    const receipt = await importer.commit(token, alice);
    assert.equal(receipt.created, 2); assert.equal(repository.read(alice).length, 2);
    assert.deepEqual(await importer.commit(token, alice), receipt);
  }],
  ['concurrent confirmation has one durable result', async createImporter => {
    const { repository, importer } = setup(createImporter); const token = importer.prepare(rows(), alice);
    const receipts = await Promise.all([importer.commit(token, alice), importer.commit(token, alice)]);
    assert.deepEqual(receipts[0], receipts[1]); assert.equal(repository.read(alice).length, 2);
  }],
  ['independent plans cannot replay a different plans receipt', async createImporter => {
    const { repository, importer } = setup(createImporter); const input = rows();
    const first = importer.prepare(input, alice); const second = importer.prepare(input, alice);
    await importer.commit(first, alice); await assert.rejects(importer.commit(second, alice), code('conflict'));
    assert.deepEqual(repository.read(alice), input);
  }],
  ['a pre-cancelled call never starts the repository wait', async createImporter => {
    const { repository, importer } = setup(createImporter); const token = importer.prepare(rows(), alice);
    const controller = new AbortController(); controller.abort(); let waited = false;
    repository.waitBeforeCommit(() => { waited = true; });
    await assert.rejects(importer.commit(token, alice, { signal: controller.signal }), { name: 'AbortError' });
    assert.equal(waited, false); assert.deepEqual(repository.read(alice), []);
  }],
  ['cancellation while waiting leaves no writes and permits recovery', async createImporter => {
    const { repository, importer } = setup(createImporter); const token = importer.prepare(rows(), alice);
    const controller = new AbortController();
    repository.waitBeforeCommit(() => controller.abort());
    await assert.rejects(importer.commit(token, alice, { signal: controller.signal }), { name: 'AbortError' });
    assert.deepEqual(repository.read(alice), []);
    repository.waitBeforeCommit(undefined); assert.equal((await importer.commit(token, alice)).created, 2);
  }],
  ['receipts and records are isolated across tenants', async createImporter => {
    const { repository, importer } = setup(createImporter); const first = rows(); const second = rows(); second[0].values.name = 'other';
    const a = await importer.commit(importer.prepare(first, alice), alice);
    const b = await importer.commit(importer.prepare(second, otherTenant), otherTenant);
    assert.notEqual(a.id, b.id); assert.deepEqual(repository.read(alice), first); assert.deepEqual(repository.read(otherTenant), second);
  }],
  ['returned receipts cannot change the stored result', async createImporter => {
    const { importer } = setup(createImporter); const token = importer.prepare(rows(), alice);
    const receipt = await importer.commit(token, alice); const expected = structuredClone(receipt); receipt.created = 999;
    assert.deepEqual(await importer.commit(token, alice), expected);
  }],
  ['a committed receipt remains valid after metadata changes', async createImporter => {
    const { repository, importer } = setup(createImporter); const token = importer.prepare(rows(), alice);
    const receipt = await importer.commit(token, alice); repository.changeRevision(alice);
    assert.deepEqual(await importer.commit(token, alice), receipt); assert.equal(repository.read(alice).length, 2);
  }],
  ['replay after revocation is denied without losing the committed data', async createImporter => {
    const { repository, importer } = setup(createImporter); const input = rows(); const token = importer.prepare(input, alice);
    await importer.commit(token, alice); repository.revoke(alice);
    await assert.rejects(importer.commit(token, alice), code('forbidden'));
    repository.grant(alice); assert.deepEqual(repository.read(alice), input);
  }]
];
