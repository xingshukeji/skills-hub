import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { summarize } from '../skills/shzw-workforce-runtime/scripts/summarize.mjs';

const sample = (ms, extra = {}) => ({ scenario: '打开页面', phase: 'warm', visibility: 'foreground', outcome: 'success', ms, budgetMs: 2000, ...extra });
test('performance samples preserve failures and do not report a small-sample p95 or false pass', () => {
  const [small] = summarize({ samples: [sample(800)] });
  assert.equal(small.successfulP95Ms, null);
  assert.equal(small.verdict, 'insufficient');
  const [mixed] = summarize({ samples: [...Array.from({ length: 20 }, (_, i) => sample(i * 10)), sample(10000, { outcome: 'timeout' }), sample(500, { outcome: 'cancelled' })] });
  assert.equal(mixed.total, 22);
  assert.deepEqual(mixed.counts, { success: 20, error: 0, timeout: 1, cancelled: 1 });
  assert.equal(mixed.successfulP95Ms, 180);
  assert.equal(mixed.maxAttemptMs, 10000);
  assert.equal(mixed.overBudget, 1);
  assert.equal(mixed.verdict, 'fail');
});
test('performance groups separate cold, warm, foreground and background; no budget means no assessment', () => {
  const rows = summarize({ samples: [sample(100), sample(4000, { phase: 'cold' }), sample(5000, { visibility: 'background' }), sample(3000, { scenario: '无预算', budgetMs: undefined })] });
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map(row => row.verdict), ['insufficient', 'fail', 'fail', 'not-assessed']);
  assert.equal(rows[3].overBudget, null);
  assert.equal(summarize({ samples: Array.from({ length: 20 }, () => sample(2000)) })[0].verdict, 'pass');
});
test('performance rejects malformed, contradictory and secret-bearing extra fields without echoing them', () => {
  for (const input of [{ samples: [] }, { samples: [sample(-1)] }, { samples: [sample(NaN)] }, { samples: [sample(1, { token: 'synthetic-secret' })] },
    { samples: [sample(1), sample(1, { budgetMs: 2500 })] }, { samples: [sample(1, { outcome: 'ok' })] }, { samples: [sample(1, { scenario: 'https://example.invalid' })] }]) {
    assert.throws(() => summarize(input), error => !error.message.includes('synthetic-secret'));
  }
});
test('performance helper runs from a copied skill with spaces, without dependencies, and returns meaningful exit codes', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'skills performance '));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const installed = join(directory, 'installed skill');
  await cp(new URL('../skills/shzw-workforce-runtime/', import.meta.url), installed, { recursive: true });
  const input = join(directory, 'samples.json');
  await writeFile(input, JSON.stringify({ samples: [sample(5000, { outcome: 'error' })] }));
  const run = () => spawnSync(process.execPath, [join(installed, 'scripts/summarize.mjs'), input], { cwd: directory, encoding: 'utf8', windowsHide: true, env: { ...process.env, NODE_PATH: '', NODE_OPTIONS: '' } });
  const failure = run();
  assert.equal(failure.status, 1);
  assert.equal(JSON.parse(failure.stdout).groups[0].verdict, 'fail');
  await writeFile(input, JSON.stringify({ samples: [sample(1, { token: 'synthetic-secret' })] }));
  const invalid = run();
  assert.equal(invalid.status, 2);
  assert.equal(invalid.stdout, '');
  assert.ok(!invalid.stderr.includes('synthetic-secret'));
});
