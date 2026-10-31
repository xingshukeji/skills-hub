import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// These witnesses validate synthetic task inputs, not model decisions or skill effectiveness.
const root = fileURLToPath(new URL('../evals/skill-execution/fixtures/diagnose-contrasts/', import.meta.url));
const text = path => readFile(path, 'utf8');
const project = id => join(root, id);
const traces = async id => (await text(join(project(id), 'traces.jsonl'))).trim().split('\n').map(JSON.parse);
const skill = (id, kind, name = 'edit-label') => text(join(project(id), kind, name, 'SKILL.md'));
const reads = rows => rows.filter(row => row.type === 'tool' && row.name === 'read_file');
const users = rows => rows.filter(row => row.type === 'user').map(row => row.text);
async function fileMap(directory) {
  const result = {};
  async function walk(current) {
    for (const item of await readdir(current, { withFileTypes: true })) {
      const path = join(current, item.name);
      if (item.isDirectory()) await walk(path);
      else result[relative(directory, path).replaceAll('\\', '/')] = createHash('sha256').update(await readFile(path)).digest('hex');
    }
  }
  await walk(directory);
  return result;
}
function query(directory, kind = 'installed-skills') {
  const run = spawnSync(process.execPath, [join(directory, kind, 'query-state/scripts/query.mjs'), join(directory, 'service.json')],
    { cwd: directory, windowsHide: true, encoding: 'utf8' });
  assert.equal(run.error, undefined);
  assert.equal(run.stderr, '');
  return { exitCode: run.status, result: JSON.parse(run.stdout) };
}

test('diagnosis replay has raw messages and local contracts while grading remains outside the workspace', async () => {
  const catalog = JSON.parse(await text(new URL('../evals/skill-execution/cases.json', import.meta.url)));
  const entry = catalog.find(row => row.id === 'diagnose-contrasts');
  assert.deepEqual(Object.keys(entry).sort(), ['context', 'id', 'request', 'workspace']);
  assert.equal(entry.workspace, 'fixtures/diagnose-contrasts');
  const files = Object.keys(await fileMap(root));
  assert.ok(!files.some(path => /rubric|expected|grading|assessment/.test(path)));
  for (const id of ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8']) {
    assert.ok((await text(join(project(id), 'AGENTS.md'))).length);
    for (const row of await traces(id)) {
      assert.ok(['user', 'assistant', 'tool'].includes(row.type));
      assert.ok(!Object.hasOwn(row, 'cause') && !Object.hasOwn(row, 'expected'));
    }
  }
});

test('the same approved task and repeated question are separable by loaded rule and source-copy differences', async () => {
  const rows = await Promise.all(['q1', 'q2', 'q3', 'q8'].map(traces));
  for (const row of rows.slice(1)) assert.deepEqual(users(row), users(rows[0]));
  for (const row of rows.slice(1)) assert.equal(row.at(-2).text, rows[0].at(-2).text);
  assert.equal(await skill('q1', 'source-skills'), await skill('q1', 'installed-skills'));
  assert.equal(await skill('q2', 'source-skills'), await skill('q2', 'installed-skills'));
  assert.notEqual(await skill('q1', 'source-skills'), await skill('q2', 'source-skills'));
  assert.equal(await skill('q3', 'source-skills'), await skill('q2', 'source-skills'));
  assert.equal(await skill('q3', 'installed-skills'), await skill('q1', 'installed-skills'));
  assert.equal(reads(rows[3]).length, 0);
  assert.equal(reads(rows[0]).length, 1);
});

test('recorded reads return the actual installed content and the wrong route reaches a different valid method', async () => {
  for (const id of ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7']) {
    for (const row of reads(await traces(id))) {
      const path = resolve(project(id), row.arguments.path);
      const inside = relative(project(id), path);
      assert.ok(inside && !inside.startsWith('..') && !isAbsolute(inside));
      assert.equal(row.result.ok, true);
      assert.equal(row.result.content, await text(path));
    }
  }
  const rows = await traces('q4');
  assert.equal(reads(rows)[0].arguments.path, 'installed-skills/query-state/SKILL.md');
  assert.ok((await text(join(project('q4'), 'AGENTS.md'))).includes('installed-skills/query-state/SKILL.md'));
  assert.equal(query(project('q4')).result.status, 200);
  assert.equal(await skill('q4', 'source-skills'), await skill('q2', 'source-skills'));
});

test('approved business work is still incomplete in the stopped cases but was completed before the new request', async () => {
  for (const id of ['q1', 'q2', 'q3', 'q4', 'q8']) {
    const page = await import(pathToFileURL(join(project(id), 'app.mjs')).href);
    assert.deepEqual(page.saveLabel(' Alpha '), { id: 'item-a', label: ' Alpha ', category: 'sample' });
    assert.equal(page.readItem().label, ' Alpha ');
  }
  const page = await import(pathToFileURL(join(project('q7'), 'app.mjs')).href);
  assert.deepEqual(page.saveLabel(' Alpha '), { id: 'item-a', label: 'Alpha', category: 'sample' });
  assert.equal(page.readItem().label, 'Alpha');
  const rows = await traces('q7');
  assert.equal(rows.at(-1).type, 'user');
  assert.ok(rows.at(-1).text.includes('小写'));
  assert.equal(rows.find(row => row.name === 'command').result.exitCode, 0);
  assert.equal(await skill('q7', 'source-skills'), await skill('q2', 'source-skills'));
});

test('the actual query helper distinguishes the retired request from maintenance on the current endpoint', async () => {
  assert.equal(await skill('q5', 'source-skills', 'query-state'), await skill('q6', 'source-skills', 'query-state'));
  for (const id of ['q5', 'q6']) {
    assert.deepEqual(await fileMap(join(project(id), 'source-skills')), await fileMap(join(project(id), 'installed-skills')));
    const run = query(project(id));
    const recorded = (await traces(id)).find(row => row.name === 'command');
    assert.deepEqual(run.result, JSON.parse(recorded.result.stdout));
    assert.equal(run.exitCode, recorded.result.exitCode);
  }
  assert.deepEqual(query(project('q5')).result, { method: 'GET', path: '/v1/status', status: 404, body: { code: 'route_not_found' } });
  assert.deepEqual(query(project('q6')).result, { method: 'GET', path: '/health', status: 503, body: { state: 'maintenance' } });
});

test('updating only the obsolete request configuration restores the existing helper without changing the method', async t => {
  const temporary = await mkdtemp(join(tmpdir(), 'skill diagnosis witness '));
  t.after(async () => {
    const inside = relative(resolve(tmpdir()), resolve(temporary));
    assert.ok(inside && !inside.startsWith('..') && !isAbsolute(inside));
    await rm(temporary, { recursive: true, force: true });
  });
  const copy = join(temporary, 'project');
  await cp(project('q5'), copy, { recursive: true });
  const before = await fileMap(copy);
  for (const kind of ['source-skills', 'installed-skills']) {
    await writeFile(join(copy, kind, 'query-state/references/endpoint.json'), JSON.stringify({ path: '/health' }, null, 2) + '\n');
    assert.deepEqual(query(copy, kind), { exitCode: 0, result: { method: 'GET', path: '/health', status: 200, body: { state: 'ready' } } });
  }
  const after = await fileMap(copy);
  assert.deepEqual(Object.keys(after), Object.keys(before));
  assert.deepEqual(Object.keys(after).filter(path => after[path] !== before[path]).sort(),
    ['installed-skills/query-state/references/endpoint.json', 'source-skills/query-state/references/endpoint.json']);
  assert.deepEqual(await fileMap(join(copy, 'source-skills')), await fileMap(join(copy, 'installed-skills')));
});
