import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { grade, prepare, score, prepareForward, verifyForward } from '../tools/evaluate-skills.mjs';

const cases = [{ id: 'a', expected: { skill: 'shzw-cicd', choice: 1 } }, { id: 'b', expected: { skill: null, choice: 0 } }];
const answer = (id, skill, choice) => ({ id, skill, choice, reason: 'Test fixture only.' });
test('evaluation counts routing and decision separately and rejects incomplete, duplicate or unknown answers', () => {
  const results = grade(cases, { answers: [answer('a', 'shzw-cicd', 0), answer('b', 'shzw-xrain-cli', 0)] });
  assert.deepEqual(results.map(row => [row.routing, row.decision, row.passed]), [[true, false, false], [false, true, false]]);
  for (const answers of [[], [answer('a', 'shzw-cicd', 1)], [answer('a', 'shzw-cicd', 1), answer('a', 'shzw-cicd', 1)],
    [answer('a', 'invented', 1), answer('b', null, 0)], [answer('a', 'shzw-cicd', 1), answer('unknown', null, 0)],
    [answer('a', 'shzw-cicd', 7), answer('b', null, 0)]]) assert.throws(() => grade(cases, { answers }));
  assert.throws(() => grade([cases[0], cases[0]], { answers: [] }));
});
test('renamed skills score consistently against historical cases without rewriting the supplied evidence', () => {
  const historical = [answer('a', 'cicd', 1), answer('b', null, 0)];
  const original = JSON.stringify(historical);
  assert(grade(cases, { answers: historical }).every(row => row.passed));
  assert.equal(JSON.stringify(historical), original);
  const oldCases = [{ id: 'a', expected: { skill: 'cicd', choice: 1 } }];
  const result = grade(oldCases, { answers: [answer('a', 'shzw-cicd', 1)] })[0];
  assert.equal(result.passed, true);
  assert.equal(result.actual.skill, 'shzw-cicd');
  assert.equal(result.expected.skill, 'cicd');
});
async function temporary(t) {
  const directory = await mkdtemp(join(tmpdir(), 'skill evaluation '));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
test('A/B scoring preserves paired cases, refuses overwrite and detects evidence drift', async t => {
  const directory = join(await temporary(t), 'run');
  await prepare({ output: directory, baselineRef: 'HEAD', repeats: 1 });
  await assert.rejects(prepare({ output: directory, repeats: 1 }));
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json')));
  const privateCases = JSON.parse(await readFile(join(directory, 'cases.private.json')));
  assert.equal(manifest.groups[0].inputHash, manifest.groups[1].inputHash);
  await assert.rejects(score(directory));
  // Synthetic responses validate only the scorer; never used as skill evaluation evidence.
  for (const group of manifest.groups) await writeFile(join(directory, group.id, 'answers.json'), JSON.stringify({ answers: privateCases.map(item => answer(item.id, item.expected.skill, item.expected.choice)) }));
  assert.equal((await score(directory)).totals.candidate.passed, privateCases.length);
  const skill = join(directory, manifest.groups[0].id, 'skills/shzw-cicd/SKILL.md');
  const original = await readFile(skill);
  await writeFile(skill, 'changed');
  await assert.rejects(score(directory), /snapshot changed/);
  await writeFile(skill, original);
  await writeFile(join(directory, manifest.groups[0].id, 'cases.json'), '[]');
  await assert.rejects(score(directory), /input changed/);
});
test('forward verification requires complete evidence and never claims a semantic pass', async t => {
  const directory = join(await temporary(t), 'forward');
  await prepareForward({ output: directory, repeats: 1 });
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json')));
  const file = join(directory, 'group-1/answers.json');
  const answers = manifest.ids.map(id => ({ id, skill: null, nextSteps: ['Fixture only'], evidence: ['Fixture only'], completion: 'Not run' }));
  await writeFile(file, JSON.stringify({ answers }));
  const result = await verifyForward(directory);
  assert.equal(result.semanticReview, 'required');
  assert.equal(result.structuralCompleteness, true);
  await writeFile(file, JSON.stringify({ answers: answers.slice(1) }));
  await assert.rejects(verifyForward(directory), /Missing/);
  await writeFile(file, JSON.stringify({ answers }));
  await writeFile(join(directory, 'group-1/input/artifacts/performance.json'), '{}');
  await assert.rejects(verifyForward(directory), /inputs changed/);
});
