import { execFileSync } from 'node:child_process';
import { createHash, randomInt } from 'node:crypto';
import { cp, mkdir, open, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from 'yaml';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const names = ['shzw-delivery', 'shzw-xrain-access', 'shzw-xrain-cli'];
// Keep historical responses intact; normalize task identity only when grading.
const sourceNames = {
  'shzw-delivery': ['shzw-cicd', 'cicd'],
  'shzw-xrain-access': ['shzw-xrain-auth', 'xrain-auth'],
  'shzw-xrain-cli': ['xrain-cli']
};
const aliases = Object.fromEntries(Object.entries(sourceNames).flatMap(([name, prior]) => prior.map(alias => [alias, name])));
const canonicalName = name => aliases[name] ?? name;
const hash = value => createHash('sha256').update(value).digest('hex');
const json = path => readFile(path, 'utf8').then(JSON.parse);
function assert(condition, message) { if (!condition) throw new Error(message); }

async function copyGitBlob(commit, path, destination) {
  const output = await open(destination, 'wx');
  try {
    execFileSync('git', ['show', commit + ':' + path], {
      cwd: root, windowsHide: true, stdio: ['ignore', output.fd, 'pipe']
    });
  } finally {
    await output.close();
  }
}

async function files(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    assert(!entry.isSymbolicLink(), 'Evaluation snapshots must not contain symlinks.');
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await files(path));
    else result.push(path);
  }
  return result.sort();
}

async function fingerprint(directory) {
  const entries = [];
  for (const path of await files(directory)) entries.push([relative(directory, path).replaceAll('\\', '/'), hash(await readFile(path))]);
  return hash(JSON.stringify(entries));
}

async function sizes(directory) {
  const output = {};
  for (const name of names) {
    const entry = await readFile(join(directory, name, 'SKILL.md'), 'utf8');
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(entry);
    const metadata = parse(frontmatter[1]);
    let markdownChars = 0;
    for (const path of await files(join(directory, name))) if (path.endsWith('.md')) markdownChars += [...await readFile(path, 'utf8')].length;
    output[name] = { descriptionChars: [...metadata.description].length, entryChars: [...entry].length, markdownChars };
  }
  return output;
}

export function grade(cases, response) {
  assert(Array.isArray(cases) && cases.length > 0 && new Set(cases.map(item => item.id)).size === cases.length, 'Invalid or duplicate evaluation case.');
  assert(response && Array.isArray(response.answers), 'Response must contain an answers array.');
  assert(response.answers.length === cases.length, 'Missing or extra answers.');
  const answers = new Map();
  for (const answer of response.answers) {
    assert(answer && typeof answer.id === 'string' && !answers.has(answer.id), 'Invalid or duplicate case ID.');
    assert(answer.skill === null || names.includes(canonicalName(answer.skill)), 'Invalid selected skill.');
    assert(Number.isInteger(answer.choice) && answer.choice >= 0 && answer.choice < 4, 'choice must be an integer from 0 to 3.');
    assert(typeof answer.reason === 'string' && answer.reason.trim(), 'Every answer needs a short reason.');
    answers.set(answer.id, answer);
  }
  return cases.map(item => {
    const answer = answers.get(item.id);
    assert(answer, 'Missing answer for ' + item.id);
    const routing = canonicalName(answer.skill) === canonicalName(item.expected.skill);
    const decision = answer.choice === item.expected.choice;
    return { id: item.id, routing, decision, passed: routing && decision, actual: answer, expected: item.expected };
  });
}

export async function prepare({ output, baselineRef = 'HEAD', repeats = 2 }) {
  assert(Number.isInteger(repeats) && repeats >= 1 && repeats <= 5, 'repeats must be 1–5.');
  const baselineCommit = execFileSync('git', ['rev-parse', '--verify', baselineRef + '^{commit}'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
  const cases = await json(join(root, 'evals/workforce/cases.json'));
  const ids = new Set();
  for (const item of cases) {
    assert(!ids.has(item.id) && item.options.length === 4 && Number.isInteger(item.expected.choice) && item.expected.choice >= 0 && item.expected.choice < 4, 'Invalid evaluation case.');
    assert(item.expected.skill === null || names.includes(canonicalName(item.expected.skill)), 'Invalid expected skill.');
    ids.add(item.id);
  }
  // Reserve a new run. Never overwrite prior snapshots or responses.
  await mkdir(dirname(output), { recursive: true });
  await mkdir(output);
  const baseline = join(output, 'sources/baseline');
  const candidate = join(output, 'sources/candidate');
  const baselineSourceNames = {};
  for (const name of names) {
    let sourceName = name;
    let paths = [];
    for (const source of [name, ...sourceNames[name]]) {
      const found = execFileSync('git', ['ls-tree', '-r', '--name-only', baselineCommit, '--', 'skills/' + source], { cwd: root, encoding: 'utf8', windowsHide: true }).trim().split('\n').filter(Boolean);
      if (found.includes('skills/' + source + '/SKILL.md')) { sourceName = source; paths = found; break; }
    }
    assert(paths.length, 'Baseline skill is missing: ' + name);
    baselineSourceNames[name] = sourceName;
    for (const path of paths) {
      const destination = join(baseline, name, path.slice(('skills/' + sourceName + '/').length));
      await mkdir(dirname(destination), { recursive: true });
      await copyGitBlob(baselineCommit, path, destination);
    }
    await cp(join(root, 'skills', name), join(candidate, name), { recursive: true });
  }
  // Shuffle options once so both arms get exactly the same task inputs.
  const shuffled = cases.map(item => {
    const order = [0, 1, 2, 3];
    for (let i = 3; i > 0; i--) { const j = randomInt(i + 1); [order[i], order[j]] = [order[j], order[i]]; }
    return { ...item, options: order.map(index => item.options[index]), expected: { ...item.expected, choice: order.indexOf(item.expected.choice) } };
  });
  const privateText = JSON.stringify(shuffled, null, 2) + '\n';
  await writeFile(join(output, 'cases.private.json'), privateText);
  const inputs = JSON.stringify(shuffled.map(({ expected, ...item }) => item), null, 2) + '\n';
  const manifest = {
    format: 1, createdAt: new Date().toISOString(), baselineCommit, baselineSourceNames, repeats, casesHash: hash(privateText),
    snapshots: {
      baseline: { hash: await fingerprint(baseline), sizes: await sizes(baseline) },
      candidate: { hash: await fingerprint(candidate), sizes: await sizes(candidate) }
    }, groups: []
  };
  for (let repeat = 1; repeat <= repeats; repeat++) {
    const order = randomInt(2) ? ['baseline', 'candidate'] : ['candidate', 'baseline'];
    for (const [index, variant] of order.entries()) {
      const id = 'group-' + repeat + '-' + (index + 1);
      const directory = join(output, id);
      await cp(join(output, 'sources', variant), join(directory, 'skills'), { recursive: true });
      await writeFile(join(directory, 'cases.json'), inputs);
      const catalog = [];
      for (const name of names) {
        const entry = await readFile(join(directory, 'skills', name, 'SKILL.md'), 'utf8');
        const meta = parse(/^---\r?\n([\s\S]*?)\r?\n---/.exec(entry)[1]);
        catalog.push({ name, description: meta.description, resourceBase: { kind: 'directory', path: join(directory, 'skills', name) } });
      }
      await writeFile(join(directory, 'catalog.json'), JSON.stringify(catalog, null, 2) + '\n');
      const instruction = [
        '# 固定观察下的下一步决策',
        '',
        '你在 Workforce 场景中处理 cases.json 中的独立用户任务。每一项给出本轮已观察到的事实和四个可能的下一步。',
        '先用 catalog.json 选择适用 skill，按任务需要读取本目录 skills 下的 SKILL.md 和参考文件。无关任务选 null。',
        '只能读取本组目录，不读取父目录、其他组、仓库或旧对话。不要猜测哪版较新，不自行创建子代理。',
        '这是离线决策回放：不执行场景中的命令，不访问真实服务，不操作账号、浏览器或部署。已有事实视为本轮可信观测。',
        '从给出的选项选择最合适的下一步，choice 是从 0 开始的索引。每项给出一句理由。各案例相互独立。',
        '只写本组 answers.json，格式：{"answers":[{"id":"c01","skill":"shzw-cicd","choice":0,"reason":"简短理由"}]}。',
        'skill 只能是目录中的 skill 名或 null。必须覆盖所有案例。结束时告知文件位置，不自行打分。',
        ''
      ].join('\n');
      await writeFile(join(directory, 'instructions.md'), instruction);
      manifest.groups.push({ id, repeat, variant, inputHash: hash(inputs), instructionHash: hash(instruction), catalogHash: hash(JSON.stringify(catalog, null, 2) + '\n') });
    }
  }
  await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return { output, baselineCommit, cases: cases.length, groups: manifest.groups.map(({ id }) => id) };
}

export async function score(output) {
  const manifest = await json(join(output, 'manifest.json'));
  assert(manifest.format === 1 && manifest.groups.length === manifest.repeats * 2, 'Invalid manifest.');
  const privateText = await readFile(join(output, 'cases.private.json'), 'utf8');
  assert(hash(privateText) === manifest.casesHash, 'Evaluation cases changed after preparation.');
  const cases = JSON.parse(privateText);
  const groups = [];
  for (const group of manifest.groups) {
    const directory = join(output, group.id);
    assert(['baseline', 'candidate'].includes(group.variant), 'Invalid variant.');
    assert(await fingerprint(join(directory, 'skills')) === manifest.snapshots[group.variant].hash, 'Skill snapshot changed: ' + group.id);
    for (const [filename, expected] of [['cases.json', group.inputHash], ['instructions.md', group.instructionHash], ['catalog.json', group.catalogHash]]) {
      assert(hash(await readFile(join(directory, filename))) === expected, 'Evaluation input changed: ' + group.id);
    }
    const responseText = await readFile(join(directory, 'answers.json'), 'utf8');
    const results = grade(cases, JSON.parse(responseText));
    groups.push({ ...group, responseHash: hash(responseText), total: results.length, passed: results.filter(row => row.passed).length,
      routingPassed: results.filter(row => row.routing).length, decisionPassed: results.filter(row => row.decision).length, results });
  }
  const totals = {};
  for (const variant of ['baseline', 'candidate']) {
    const rows = groups.filter(group => group.variant === variant);
    assert(rows.length === manifest.repeats && new Set(rows.map(row => row.repeat)).size === manifest.repeats, 'Unbalanced experiment.');
    totals[variant] = Object.fromEntries(['total', 'passed', 'routingPassed', 'decisionPassed'].map(key => [key, rows.reduce((sum, row) => sum + row[key], 0)]));
  }
  const result = { format: 1, baselineCommit: manifest.baselineCommit, createdAt: manifest.createdAt, scoredAt: new Date().toISOString(),
    casesHash: manifest.casesHash, snapshots: manifest.snapshots, totals, groups };
  await writeFile(join(output, 'results.json'), JSON.stringify(result, null, 2) + '\n');
  return result;
}

export async function prepareForward({ output, repeats = 2 }) {
  assert(Number.isInteger(repeats) && repeats >= 1 && repeats <= 5, 'repeats must be 1–5.');
  const skillNames = (await readdir(join(root, 'skills'), { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  const cases = await json(join(root, 'evals/workforce/forward-cases.json'));
  const { cases: operationCases } = await import('../evals/workforce/capability-lab-cases.mjs');
  const operationCase = operationCases.find(row => row.id === 'l01');
  const sample = (ms, extra = {}) => ({ scenario: '页面操作', phase: 'warm', visibility: 'foreground', outcome: 'success', ms, budgetMs: 2000, ...extra });
  await mkdir(dirname(output), { recursive: true });
  await mkdir(output);
  const manifest = { format: 'forward-1', createdAt: new Date().toISOString(), ids: cases.map(item => item.id), skillNames, groups: [] };
  await cp(join(root, 'evals/workforce/forward-rubric.json'), join(output, 'rubric.private.json'));
  manifest.rubricHash = hash(await readFile(join(output, 'rubric.private.json')));
  for (let i = 1; i <= repeats; i++) {
    const directory = join(output, 'group-' + i), input = join(directory, 'input');
    await mkdir(join(input, 'artifacts'), { recursive: true });
    await cp(join(root, 'skills'), join(input, 'skills'), { recursive: true });
    const catalog = [];
    for (const name of skillNames) {
      const entry = await readFile(join(input, 'skills', name, 'SKILL.md'), 'utf8');
      catalog.push({ name, description: parse(/^---\r?\n([\s\S]*?)\r?\n---/.exec(entry)[1]).description, resourceBase: { kind: 'directory', path: join(input, 'skills', name) } });
    }
    await writeFile(join(input, 'catalog.json'), JSON.stringify(catalog, null, 2) + '\n');
    await writeFile(join(input, 'cases.json'), JSON.stringify(cases, null, 2) + '\n');
    await writeFile(join(input, 'artifacts/performance.json'), JSON.stringify({ samples: [...Array.from({ length: 19 }, (_, i) => sample(700 + i * 20)), sample(10000, { outcome: 'timeout' })] }, null, 2) + '\n');
    await writeFile(join(input, 'artifacts/mixed-performance.json'), JSON.stringify({ samples: [
      ...Array.from({ length: 20 }, () => sample(600)), sample(3000, { phase: 'cold' }),
      ...Array.from({ length: 20 }, () => sample(3000, { visibility: 'background' })), sample(4500, { phase: 'cold', visibility: 'background' })
    ] }, null, 2) + '\n');
    await writeFile(join(input, 'artifacts/resolution.json'), JSON.stringify({ target: operationCase.seed.target,
      installation: operationCase.seed.installation, operation: operationCase.seed.operation }, null, 2) + '\n');
    await writeFile(join(input, 'artifacts/binding-directory.json'), JSON.stringify(operationCase.artifacts['binding-directory.json'], null, 2) + '\n');
    await writeFile(join(input, 'instructions.md'), [
      '# 独立运行场景回放', '',
      '读取 catalog.json，为 cases.json 每个独立请求选一个最直接处理当前问题的 skill；不适用选 null。按需读取本组 input/skills 中资源。',
      '仅本组目录可读写；禁止读取父目录、其他组、仓库原文件或旧对话；不创建子代理。input 只读，回答写本组 answers.json，所需脚本产物也保存在本组 input 之外。',
      '这是离线任务，不访问网络、不操作真实服务、账号、浏览器或部署。给出的 observed 是本轮可信观测，其余未验证。',
      '有本地 artifacts 的任务可运行本组随 skill 提供的脚本，用实际输出作证；其他场景给出可执行下一步及完成判据，不声称已在真实服务执行。',
      'answers.json 格式为 {"answers":[{"id":"f01","skill":"skill 名或 null","nextSteps":["具体下一步"],"evidence":["实际观测或脚本结果"],"completion":"完成依据或未完成项"}]}。',
      '必须覆盖所有案例。用自然语言回答，不猜预期答案，不自行评分。不要复述未执行操作为已完成。', ''
    ].join('\n'));
    manifest.groups.push({ id: 'group-' + i, inputHash: await fingerprint(input) });
  }
  await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return { output, cases: cases.length, groups: manifest.groups.map(group => group.id) };
}

export async function verifyForward(output) {
  const manifest = await json(join(output, 'manifest.json'));
  assert(manifest.format === 'forward-1', 'Invalid forward manifest.');
  assert(hash(await readFile(join(output, 'rubric.private.json'))) === manifest.rubricHash, 'Forward rubric changed.');
  const result = [];
  for (const group of manifest.groups) {
    const directory = join(output, group.id);
    assert(await fingerprint(join(directory, 'input')) === group.inputHash, 'Forward inputs changed: ' + group.id);
    const response = await readFile(join(directory, 'answers.json'), 'utf8');
    const { answers } = JSON.parse(response);
    assert(Array.isArray(answers) && answers.length === manifest.ids.length, 'Missing or extra forward answers.');
    assert(new Set(answers.map(answer => answer.id)).size === manifest.ids.length, 'Duplicate forward answer.');
    for (const answer of answers) {
      assert(manifest.ids.includes(answer.id), 'Unexpected forward case.');
      assert(answer.skill === null || manifest.skillNames.includes(answer.skill), 'Unknown forward skill.');
      for (const field of ['nextSteps', 'evidence']) assert(Array.isArray(answer[field]) && answer[field].length && answer[field].every(value => typeof value === 'string' && value.trim()), 'Invalid forward evidence or steps.');
      assert(typeof answer.completion === 'string' && answer.completion.trim(), 'Missing completion criteria.');
    }
    result.push({ id: group.id, inputHash: group.inputHash, responseHash: hash(response), answers: answers.length });
  }
  // Semantic review is deliberately not replaced by keyword matching.
  return { inputIntegrity: true, structuralCompleteness: true, semanticReview: 'required', groups: result };
}

// Natural task inputs are deliberately separate from coaching and the rubric.
// This prepares a reproducible review; it does not infer semantic success from words.
export async function prepareTaskReplay({ output, baselineRef = 'HEAD', repeats = 1 }) {
  assert(Number.isInteger(repeats) && repeats >= 1 && repeats <= 3, 'repeats must be 1–3.');
  const cases = await json(join(root, 'evals/task-scenarios/cases.json'));
  const rubric = await readFile(join(root, 'evals/task-scenarios/rubric.json'), 'utf8');
  const ids = cases.map(item => item.id);
  assert(new Set(ids).size === cases.length && cases.length > 0, 'Duplicate or missing task case.');
  const allowedFields = new Set(['id', 'request', 'project', 'context', 'explicitSkill']);
  for (const item of cases) {
    assert(Object.keys(item).every(key => allowedFields.has(key)), 'Expected answers or coaching must not enter task inputs.');
    for (const field of ['id', 'request', 'project', 'context']) assert(typeof item[field] === 'string' && item[field].trim(), 'Invalid raw task input.');
  }
  const expectedIds = JSON.parse(rubric).cases.map(item => item.id);
  assert(expectedIds.length === ids.length && ids.every(id => expectedIds.includes(id)), 'Task rubric does not match inputs.');
  const baselineCommit = execFileSync('git', ['rev-parse', '--verify', baselineRef + '^{commit}'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
  await mkdir(dirname(output), { recursive: true });
  await mkdir(output); // Never overwrite a previous run or its responses.
  await writeFile(join(output, 'rubric.private.json'), rubric);
  const sourceRoot = join(output, 'sources');
  const baseline = join(sourceRoot, 'baseline'), candidate = join(sourceRoot, 'candidate');
  const tracked = execFileSync('git', ['ls-tree', '-r', '--name-only', baselineCommit, '--', 'skills', 'support'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim().split('\n').filter(Boolean);
  assert(tracked.some(path => path.endsWith('/SKILL.md')), 'Baseline has no task skills.');
  for (const path of tracked) {
    const destination = join(baseline, path);
    await mkdir(dirname(destination), { recursive: true });
    await copyGitBlob(baselineCommit, path, destination);
  }
  const filter = path => !['node_modules', 'bin', 'obj', '__pycache__'].includes(path.replaceAll('\\', '/').split('/').at(-1));
  await cp(join(root, 'skills'), join(candidate, 'skills'), { recursive: true, filter });
  await cp(join(root, 'support'), join(candidate, 'support'), { recursive: true, filter });
  const inputText = JSON.stringify(cases, null, 2) + '\n';
  const manifest = { format: 'task-replay-1', createdAt: new Date().toISOString(), baselineCommit, ids,
    casesHash: hash(inputText), rubricHash: hash(rubric), sourceHashes: { baseline: await fingerprint(baseline), candidate: await fingerprint(candidate) }, groups: [] };
  for (let repeat = 1; repeat <= repeats; repeat++) {
    const variants = randomInt(2) ? ['baseline', 'candidate'] : ['candidate', 'baseline'];
    for (const [index, variant] of variants.entries()) {
      const id = 'task-' + repeat + '-' + (index + 1), input = join(output, id, 'input');
      await cp(join(sourceRoot, variant), input, { recursive: true });
      const catalog = [];
      for (const name of (await readdir(join(input, 'skills'))).sort()) {
        const directory = join(input, 'skills', name);
        const content = await readFile(join(directory, 'SKILL.md'), 'utf8');
        const meta = parse(/^---\r?\n([\s\S]*?)\r?\n---/.exec(content)[1]);
        let implicit = true;
        try { implicit = parse(await readFile(join(directory, 'agents/openai.yaml'), 'utf8')).policy?.allow_implicit_invocation ?? true; }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        catalog.push({ name: meta.name, description: meta.description, allowImplicitInvocation: implicit, resourceBase: { kind: 'directory', path: directory } });
      }
      await writeFile(join(input, 'catalog.json'), JSON.stringify(catalog, null, 2) + '\n');
      await writeFile(join(input, 'cases.json'), inputText);
      await writeFile(join(input, 'instructions.md'), [
        '# 原始任务选择与首次执行检查', '',
        '按 cases.json 的自然请求和必要前文，选择 catalog.json 中一个主任务；普通小改或不需技能时可选 null。显式调用政策按 catalog 和 explicitSkill 判断。',
        '只读本组 input 中的材料；只在本组 input 之外写回答。不要读父目录的评分资料、其他组、旧对话或当前仓库。不要新建子代理。',
        '这是离线选择与执行决定核验，不连接真实平台、不改产品、不操作账号、不触发流水线或部署，不执行 Git 写入。按需读取技能和具体知识；所需项目事实未提供时明确缺口。',
        '给出当前范围下的具体下一步、首次应覆盖的入口和失败分支、实际已有证据及未完成的验证。不得把下一步写成已经完成。',
        '不要从技能名、数量或文体猜哪版较新。不要自行评分。',
        '回答写 ../answers.json，格式为 {"provenance":"author-check 或 independent-model","answers":[{"id":"t01","skill":"名称或 null","nextSteps":["具体动作"],"evidence":["实际观察，未执行须说明"],"completion":"覆盖及缺口"}]}。覆盖全部案例。', ''
      ].join('\n'));
      manifest.groups.push({ id, repeat, variant, inputHash: await fingerprint(input), skillNames: catalog.map(item => item.name) });
    }
  }
  await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return { output, baselineCommit, cases: ids.length, groups: manifest.groups.map(group => group.id) };
}

export async function verifyTaskReplay(output) {
  const manifest = await json(join(output, 'manifest.json'));
  assert(manifest.format === 'task-replay-1', 'Invalid task replay manifest.');
  assert(hash(await readFile(join(output, 'rubric.private.json'))) === manifest.rubricHash, 'Task rubric changed.');
  const groups = [];
  for (const group of manifest.groups) {
    const directory = join(output, group.id), input = join(directory, 'input');
    assert(await fingerprint(input) === group.inputHash, 'Task inputs changed: ' + group.id);
    assert(hash(await readFile(join(input, 'cases.json'))) === manifest.casesHash, 'Paired task inputs changed.');
    const response = await readFile(join(directory, 'answers.json'), 'utf8');
    const { provenance, answers } = JSON.parse(response);
    assert(['author-check', 'independent-model', 'protocol-fixture'].includes(provenance), 'Task response must declare its provenance.');
    assert(Array.isArray(answers) && answers.length === manifest.ids.length, 'Missing or extra task answers.');
    assert(new Set(answers.map(item => item.id)).size === manifest.ids.length, 'Duplicate task answer.');
    for (const answer of answers) {
      assert(manifest.ids.includes(answer.id), 'Unknown task case.');
      assert(answer.skill === null || group.skillNames.includes(answer.skill), 'Unknown task skill.');
      for (const field of ['nextSteps', 'evidence']) assert(Array.isArray(answer[field]) && answer[field].length && answer[field].every(value => typeof value === 'string' && value.trim()), 'Missing task evidence or next steps.');
      assert(typeof answer.completion === 'string' && answer.completion.trim(), 'Missing task completion boundary.');
    }
    groups.push({ id: group.id, variant: group.variant, declaredProvenance: provenance, responseHash: hash(response), answers: answers.length });
  }
  return { inputIntegrity: true, structuralCompleteness: true, semanticReview: 'required', independence: 'not-established-by-this-verifier', groups };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [command, ...args] = process.argv.slice(2);
    const options = {};
    for (let i = 0; i < args.length; i += 2) {
      assert(['--output', '--baseline', '--repeats'].includes(args[i]) && args[i + 1] && !options[args[i]], 'Invalid evaluation argument.');
      options[args[i]] = args[i + 1];
    }
    assert(['prepare', 'score', 'prepare-forward', 'verify-forward', 'prepare-tasks', 'verify-tasks'].includes(command), 'Usage: node tools/evaluate-skills.mjs prepare|score|prepare-forward|verify-forward|prepare-tasks|verify-tasks --output DIRECTORY [--baseline REF] [--repeats 2]');
    assert(options['--output'], '--output is required.');
    const output = resolve(options['--output']);
    if (command === 'prepare-tasks') console.log(JSON.stringify(await prepareTaskReplay({ output, baselineRef: options['--baseline'], repeats: options['--repeats'] === undefined ? 1 : Number(options['--repeats']) }), null, 2));
    else if (command === 'verify-tasks') console.log(JSON.stringify(await verifyTaskReplay(output), null, 2));
    else if (command === 'prepare-forward') console.log(JSON.stringify(await prepareForward({ output, repeats: options['--repeats'] === undefined ? 2 : Number(options['--repeats']) }), null, 2));
    else if (command === 'verify-forward') console.log(JSON.stringify(await verifyForward(output), null, 2));
    else if (command === 'prepare') console.log(JSON.stringify(await prepare({ output, baselineRef: options['--baseline'], repeats: options['--repeats'] === undefined ? 2 : Number(options['--repeats']) }), null, 2));
    else {
      const result = await score(output);
      console.log(JSON.stringify({ output, totals: result.totals, groups: result.groups.map(({ id, variant, total, passed }) => ({ id, variant, total, passed })) }, null, 2));
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
