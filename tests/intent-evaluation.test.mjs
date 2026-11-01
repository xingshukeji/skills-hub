import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifyIntent, judgeIntent, prepareIntents, readResource, summarizeIntents, usageTotals } from '../tools/intent-evaluation.mjs';

const expected = { primary_skill: 'shzw-xrain-cli', intent: 'read', cli_applicable: true, needs_clarification: false,
  readiness: 'ready', proposed_action: 'read_current', critical: true };
const answer = { ...expected, next_step: '读取原身份下的任务。' };
const usage = { input_tokens: 100, cache_read_input_tokens: 200, cache_creation_input_tokens: 10, output_tokens: 20 };

test('intent token accounting includes cached input exactly once and refuses absent usage', () => {
  assert.deepEqual(usageTotals(usage), { input: 310, uncached: 100, cached: 200, created: 10, output: 20, total: 330 });
  assert.throws(() => usageTotals({ output_tokens: 1 }));
  assert.throws(() => usageTotals({ input_tokens: 1, output_tokens: 1, cache_read_input_tokens: -1 }));
});

test('intent resource reads cannot leave the frozen Markdown directory or run scripts', async t => {
  const root = await mkdtemp(join(tmpdir(), 'intent resources ')); t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'shzw-xrain-cli')); await writeFile(join(root, 'shzw-xrain-cli', 'SKILL.md'), 'Actual frozen entry');
  const names = new Set(['shzw-xrain-cli']);
  assert.equal(await readResource(root, names, { skill: 'shzw-xrain-cli' }), 'Actual frozen entry');
  for (const input of [{ skill: 'other' }, { skill: 'shzw-xrain-cli', path: '../private.md' },
    { skill: 'shzw-xrain-cli', path: '..\\private.md' }, { skill: 'shzw-xrain-cli', path: 'scripts/run.mjs' }])
    await assert.rejects(readResource(root, names, input));
  await assert.rejects(readResource(root, new Set(['../private']), { skill: '../private' }));
});

test('comparison preparation rejects path-like case IDs and missing rubric fields before reserving output', async t => {
  const root = await mkdtemp(join(tmpdir(), 'intent inputs ')); t.after(() => rm(root, { recursive: true, force: true }));
  const cases = join(root, 'cases.json'), rubric = join(root, 'rubric.json');
  await writeFile(cases, JSON.stringify([{ id: '../escape', split: 'development', request: 'query', context: '' }]));
  await writeFile(rubric, JSON.stringify({ '../escape': expected }));
  const options = { output: join(root, 'output'), baseline: root, candidate: root, cases, rubric };
  await assert.rejects(prepareIntents(options), /case ID/);
  await writeFile(cases, JSON.stringify([{ id: 'safe', split: 'development', request: 'query', context: '' }]));
  await writeFile(rubric, JSON.stringify({ safe: { primary_skill: null } }));
  await assert.rejects(prepareIntents(options), /Incomplete intent rubric/);
});

test('paired intent inference sees only the natural request and frozen resources, never the rubric', async () => {
  let count = 0;
  const result = await classifyIntent({ item: { request: '查我的任务', context: '系统已经确定', expected: 'hidden grader' },
    catalog: [{ name: 'shzw-xrain-cli', description: 'Workforce 任务查询' }], resource: async () => 'Only the frozen skill text',
    complete: async payload => {
      assert(!JSON.stringify(payload).includes('hidden grader'));
      assert.equal(payload.tools, undefined);
      count++;
      return { usage, stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(answer) }] };
    } });
  assert.equal(result.failure, undefined); assert.equal(result.reads.length, 1); assert.equal(result.calls.length, 2);
  assert(Object.values(judgeIntent(expected, result.answer)).every(Boolean));
});

test('a truncated answer, unknown skill choice and a business tool cannot pass intention checks', async () => {
  const base = { item: { request: 'query', context: '' }, catalog: [{ name: 'shzw-xrain-cli', description: 'test' }], resource: async () => 'text' };
  const plain = await classifyIntent({ ...base, complete: async () => ({ usage, stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ ...answer, primary_skill: 'unknown' }) }] }) });
  assert.equal(plain.failure, 'unknown_skill');
  await assert.rejects(classifyIntent({ ...base, complete: async () => ({ usage, stop_reason: 'max_tokens', content: [{ type: 'text', text: '{}' }] }) }));
  await assert.rejects(classifyIntent({ ...base, complete: async () => ({ usage, stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'x', name: 'execute_cli', input: {} }] }) }));
});

test('a cheaper candidate fails its gate if quality regresses, a critical case fails or paired results are missing', () => {
  const schedule = ['a', 'b'].flatMap(arm => ['one', 'two'].map(id => ({ arm, id, split: 'holdout', repeat: 0 })));
  const rubric = { one: expected, two: expected };
  const records = schedule.map(row => ({ ...row, answer, calls: [{ usage: { ...usageTotals(usage), total: row.arm === 'a' ? 330 : 200 } }] }));
  assert.equal(summarizeIntents(records, rubric, schedule).holdout.gate.passed, true);
  assert.equal(summarizeIntents(records.slice(0, 2), rubric, schedule).holdout.gate.passed, false);
  const bad = records.map(row => row.arm === 'b' && row.id === 'one' ? { ...row, answer: { ...answer, proposed_action: 'write_requested' } } : row);
  const summary = summarizeIntents(bad, rubric, schedule).holdout;
  assert.equal(summary.gate.passed, false); assert.equal(summary.b.criticalErrors, 1); assert.equal(summary.gate.newFailures.length, 1);
  assert.throws(() => summarizeIntents([...records, records[0]], rubric, schedule));
});
