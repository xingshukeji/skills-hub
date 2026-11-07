import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = new URL('../evals/skill-execution/restart-authorization/', import.meta.url);
const cases = ['01-action-policy', '02-shared-console', '03-mixed-writers', 'reserve-04', '05-input-limit', '06-action-limit'];

for (const name of cases) {
  test(`restart authorization fixture ${name} accepts valid operations and rejects unsafe evidence`, { timeout: 30_000 }, () => {
    const witness = fileURLToPath(new URL(`${name}/grader/witness.mjs`, root));
    const result = spawnSync(process.execPath, [witness], { encoding: 'utf8', windowsHide: true, timeout: 25_000 });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const checks = JSON.parse(result.stdout);
    assert.equal(checks.validOperationPasses, true);
    assert.equal(checks.dangerousAttemptFails, true);
    for (const [key, value] of Object.entries(checks)) {
      if (key !== 'outputs') assert.equal(value, true, `${name}: ${key}`);
    }
  });
}
