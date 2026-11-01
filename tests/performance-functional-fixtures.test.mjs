import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createImporter } from '../evals/skill-execution/fixtures/optimize-import/app.mjs';
import { createImporter as reviewedImporter } from '../evals/skill-execution/fixtures/review-optimized-import/app.mjs';
import { importFunctionalCases } from './helpers/import-functional-contract.mjs';

const source = await readFile(new URL('../evals/skill-execution/fixtures/optimize-import/app.mjs', import.meta.url), 'utf8');
async function implementation(text) {
  return (await import('data:text/javascript;base64,' + Buffer.from(text).toString('base64'))).createImporter;
}

test('original functional import contract', async t => {
  for (const [name, verify] of importFunctionalCases) await t.test(name, () => verify(createImporter));
});

test('removing one redundant JSON round trip preserves all functional cases', async t => {
  const candidate = await implementation(source.replace('cloneJson(cloneJson(rows))', 'cloneJson(rows)'));
  for (const [name, verify] of importFunctionalCases) await t.test(name, () => verify(candidate));
});

test('functional cases reject plausible wrong optimizations', async t => {
  const examples = [
    ['borrowed mutable rows', source.replace('cloneJson(cloneJson(rows))', 'rows'), 'frozen input survives caller mutation'],
    ['UTF-16 count replaces UTF-8 bytes', source.replace("Buffer.byteLength(value, 'utf8')", 'value.length'), 'decoded UTF-8 boundary rejects one byte over budget'],
    ['scope check removed for the fast path', source.replace("if (scope.tenantId !== plan.scope.tenantId || scope.actorId !== plan.scope.actorId) fail('scope');", ''), 'plan cannot cross an otherwise authorized tenant'],
    ['digest protocol changed', source.replace("createHash('sha256')", "createHash('sha512')"), 'v1 digest keeps a frozen UTF-8 signature']
  ];
  for (const [name, code, target] of examples) await t.test(name, async () => {
    const candidate = await implementation(code);
    const verify = importFunctionalCases.find(([title]) => title === target)[1];
    await assert.rejects(() => verify(candidate), assert.AssertionError);
    await importFunctionalCases.find(([title]) => title === 'all values, order and preparation side effects')[1](candidate);
  });
});

test('review case keeps ordinary behavior and exposes its three regressions', async t => {
  const ordinary = importFunctionalCases.find(([title]) => title === 'all values, order and preparation side effects')[1];
  await t.test('ordinary business still succeeds', () => ordinary(reviewedImporter));
  for (const name of ['frozen input survives caller mutation', 'decoded UTF-8 boundary rejects one byte over budget', 'plan cannot cross an otherwise authorized tenant']) {
    await t.test(name, async () => {
      const verify = importFunctionalCases.find(([title]) => title === name)[1];
      await assert.rejects(() => verify(reviewedImporter), assert.AssertionError);
    });
  }
});
