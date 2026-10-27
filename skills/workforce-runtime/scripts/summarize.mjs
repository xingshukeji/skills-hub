import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { existsSync, realpathSync } from 'node:fs';

function assert(condition) { if (!condition) throw new Error('Invalid performance samples; see references/measurement.md.'); }
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const fields = new Set(['scenario', 'phase', 'visibility', 'outcome', 'ms', 'budgetMs']);
const outcomes = ['success', 'error', 'timeout', 'cancelled'];

export function summarize(input) {
  assert(object(input) && Object.keys(input).length === 1 && Array.isArray(input.samples));
  assert(input.samples.length > 0 && input.samples.length <= 100000);
  const groups = new Map();
  for (const row of input.samples) {
    assert(object(row) && Object.keys(row).every(key => fields.has(key)));
    assert(typeof row.scenario === 'string' && row.scenario.trim().length > 0 && row.scenario.length <= 80 && !/[\r\n]|https?:\/\//i.test(row.scenario));
    assert(['cold', 'warm'].includes(row.phase) && ['foreground', 'background'].includes(row.visibility));
    assert(outcomes.includes(row.outcome) && Number.isFinite(row.ms) && row.ms >= 0);
    assert(row.budgetMs === undefined || (Number.isFinite(row.budgetMs) && row.budgetMs > 0));
    const key = JSON.stringify([row.scenario, row.phase, row.visibility]);
    if (!groups.has(key)) groups.set(key, { scenario: row.scenario, phase: row.phase, visibility: row.visibility, budgetMs: row.budgetMs ?? null, samples: [] });
    const group = groups.get(key);
    assert(group.budgetMs === (row.budgetMs ?? null));
    group.samples.push(row);
  }
  return [...groups.values()].map(({ samples, ...group }) => {
    const successful = samples.filter(row => row.outcome === 'success').map(row => row.ms).sort((a, b) => a - b);
    const percentile = p => successful.length ? successful[Math.ceil(successful.length * p) - 1] : null;
    const counts = Object.fromEntries(outcomes.map(outcome => [outcome, samples.filter(row => row.outcome === outcome).length]));
    const overBudget = group.budgetMs === null ? null : samples.filter(row => row.ms > group.budgetMs).length;
    const failures = samples.length - successful.length;
    const verdict = group.budgetMs === null ? 'not-assessed' : failures || overBudget ? 'fail' : successful.length < 20 ? 'insufficient' : 'pass';
    return { ...group, total: samples.length, counts, maxAttemptMs: samples.reduce((max, row) => Math.max(max, row.ms), 0),
      successfulP50Ms: percentile(.5), successfulP95Ms: successful.length >= 20 ? percentile(.95) : null,
      overBudget, verdict };
  });
}

if (process.argv[1] && existsSync(process.argv[1]) && import.meta.url === pathToFileURL(realpathSync(resolve(process.argv[1]))).href) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: node summarize.mjs samples.json');
    const rows = summarize(JSON.parse(await readFile(process.argv[2], 'utf8')));
    console.log(JSON.stringify({ groups: rows }, null, 2));
    if (rows.some(row => row.verdict === 'fail')) process.exitCode = 1;
  } catch {
    console.error('Cannot summarize samples. Check the input schema in references/measurement.md.');
    process.exitCode = 2;
  }
}
