import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';
import { fingerprint } from './evaluate-skills.mjs';

const hash = text => createHash('sha256').update(text).digest('hex');
const json = path => readFile(path, 'utf8').then(JSON.parse);
const assert = (value, message) => { if (!value) throw new Error(message); };
export const POLICY = {
  protocol: 'catalog-then-mounted-entry-intent-4',
  maxRounds: 6, maxOutputTokens: 900, temperature: 0, thinking: 'disabled',
  minimumTotalTokenReduction: 0.10, criticalErrorsAllowed: 0,
  quality: 'candidate must have no new failing case and at least baseline total correct',
  scope: 'intent and next-step judgment only; no business execution; no engineering delegation',
};
const INSTRUCTION = [
  '你是技能使用的意图判别模型。对当前自然请求及已知事实，选择一个主技能并判断下一步。',
  '只评估意图，不执行真实业务、CLI、登录、写入或工程任务，不创建其他智能体。',
  '目录中的系统归属优先于通用词语；只有目标确实不明且现有上下文不能确定时才澄清。',
  '先用已确认前文确定业务系统及可用条件，再匹配用户请求；不能忽略前文，把 XRain 的联系人或邮箱改成飞书。前文说没有工具时按事实处理，技能说明不会授予工具。',
  '若同时有多个系统且未指定目标，主技能和 cli_applicable 均为 null，intent 为 clarify，不先任选一个系统。',
  '结构化字段必须与 next_step 一致。若判断刚才选的技能不适用，应从目录重选并更新 primary_skill；不能在文字里说改用另一个技能而保留原字段。前文已明确系统时，不重复询问是否改查该系统。',
  '先按目录判断意图。选中主技能后，评估器会提供它的入口正文供你校核；普通小改或不需技能时主技能可为 null。',
  'intent 定义：read=查已有业务资源；write=修改已有业务资源；develop=修改源码或实现新能力；recover=接续已提交动作的失败/未知结果；diagnose=定位故障或403；clarify=系统等关键目标不明；explain=只解释或比较方案。',
  'readiness 描述案例内目标动作的状态：目标动作整体被明确403拒绝用 denied；回执已明确一部分成功、另一部分失败或未执行用 partial_failure；原提交结果缺少有效回执才用 result_unknown；缺工具用 missing_tool；系统等关键上下文缺失用 missing_context；只讨论不实施用 not_requested；其余已具备前提用 ready。不要用“本评估不执行”把所有案例标为 not_requested。',
  'cli_applicable 只指 XRain CLI：飞书业务为 false，目标系统未定为 null；XRain/Workforce 已有资源操作即使由访问权限等领域技能组织也可为 true；纯方案和页面源码修改为 false。',
  'proposed_action 中 readback_original 指先查原提交/原资源结果；read_current 指普通资源查询；inspect_access 指定位原拒绝层并保留拒绝；缺工具只 report_limit，不自动扩权。',
  '最后只输出 JSON：{"primary_skill":目录名称或null,"intent":"read|write|develop|recover|diagnose|clarify|explain|other",',
  '"cli_applicable":true或false或null,"needs_clarification":true或false,',
  '"readiness":"ready|missing_context|missing_tool|denied|partial_failure|result_unknown|not_requested",',
  '"proposed_action":"read_current|write_requested|readback_original|inspect_access|clarify|report_limit|edit_source|compare|explain",',
  '"next_step":"一句具体判断，不能把计划说成已执行"}。cli_applicable 指 XRain CLI 是否适用于当前意图。',
].join('\n');

export function usageTotals(usage) {
  assert(usage && ['input_tokens', 'output_tokens'].every(k => Number.isSafeInteger(usage[k]) && usage[k] >= 0), 'Missing actual model usage');
  const cached = usage.cache_read_input_tokens ?? 0, created = usage.cache_creation_input_tokens ?? 0;
  assert([cached, created].every(v => Number.isSafeInteger(v) && v >= 0), 'Invalid cache usage');
  return { input: usage.input_tokens + cached + created, uncached: usage.input_tokens, cached, created,
    output: usage.output_tokens, total: usage.input_tokens + cached + created + usage.output_tokens };
}

export function judgeIntent(expected, answer) {
  const fields = ['primary_skill', 'intent', 'cli_applicable', 'needs_clarification', 'readiness', 'proposed_action'];
  return Object.fromEntries(fields.map(field => [field, Array.isArray(expected[field])
    ? expected[field].includes(answer?.[field]) : expected[field] === answer?.[field]]));
}

export async function readResource(root, knownNames, input) {
  assert(input && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.skill) && knownNames.has(input.skill), 'Unknown skill resource');
  const path = input.path ?? 'SKILL.md';
  assert(typeof path === 'string' && !isAbsolute(path) && path.endsWith('.md'), 'Only relative Markdown resources are available');
  const skillRoot = resolve(root, input.skill), target = resolve(skillRoot, path), rel = relative(skillRoot, target);
  assert(rel !== '..' && !rel.startsWith('../') && !rel.startsWith('..\\') && !isAbsolute(rel), 'Resource escapes frozen skill');
  return readFile(target, 'utf8');
}

export async function classifyIntent({ item, catalog, resource, complete, maxRounds = POLICY.maxRounds }) {
  const messages = [{ role: 'user', content: '已确认前文：\n' + item.context + '\n\n用户本轮要求：\n' + item.request }];
  const system = INSTRUCTION + '\n技能目录：\n' + JSON.stringify(catalog);
  const calls = [], reads = [], loaded = new Set(); let routing;
  for (let round = 0; round < maxRounds; round++) {
    const payload = { system, messages, max_tokens: POLICY.maxOutputTokens,
      temperature: POLICY.temperature, thinking: { type: POLICY.thinking }, stream: false };
    const response = await complete(payload);
    const usage = usageTotals(response.usage);
    assert(Array.isArray(response.content), 'Malformed model response');
    calls.push({ requestHash: hash(JSON.stringify(payload)), response, usage });
    assert(!response.content.some(block => block.type === 'tool_use'), 'No tools are enabled in intent-only inference');
    assert(response.stop_reason === 'end_turn', 'Model output incomplete');
    const text = response.content.filter(block => block.type === 'text').map(block => block.text).join('\n').trim();
    let answer;
    try { answer = JSON.parse(text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); }
    catch { return { calls, reads, failure: 'invalid_json' }; }
    if (typeof answer?.next_step !== 'string' || !answer.next_step.trim()) return { calls, reads, answer, failure: 'missing_next_step' };
    routing ??= answer;
    if (answer.primary_skill !== null && !catalog.some(v => v.name === answer.primary_skill)) return { calls, reads, routing, answer, failure: 'unknown_skill' };
    if (answer.primary_skill !== null && !loaded.has(answer.primary_skill)) {
      const input = { skill: answer.primary_skill, path: 'SKILL.md' }; let content;
      try { content = await resource(input); }
      catch { return { calls, reads, routing, answer, failure: 'missing_frozen_entry' }; }
      reads.push({ ...input, contentHash: hash(content) }); loaded.add(answer.primary_skill);
      messages.push({ role: 'assistant', content: response.content }, { role: 'user', content: '以下是你刚选中技能的冻结入口正文。依据它校核当前意图，仍只输出相同格式 JSON；不执行任何业务。\n\n' + content });
      continue;
    }
    return { calls, reads, routing, answer };
  }
  return { calls, reads, failure: 'round_budget_exhausted' };
}

async function catalogOf(root) {
  const result = [];
  for (const name of (await readdir(root)).sort()) {
    const text = await readFile(join(root, name, 'SKILL.md'), 'utf8');
    const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
    const meta = parse(match[1]);
    result.push({ name: meta.name, description: meta.description });
  }
  return result;
}

export async function prepareIntents({ output, baseline, candidate, cases, rubric, repeats = 2 }) {
  const items = await json(cases), expected = await json(rubric);
  assert(Number.isSafeInteger(repeats) && repeats > 0 && repeats <= 5, 'Invalid repeat count');
  assert(items.length && items.every(v => /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(v.id)) && new Set(items.map(v => v.id)).size === items.length, 'Invalid or duplicate intent case ID');
  assert(items.every(v => !Object.hasOwn(v, 'expected') && ['development', 'holdout'].includes(v.split) && expected[v.id]), 'Cases and private rubric disagree');
  assert(Object.keys(expected).length === items.length, 'Extra rubric cases');
  assert(items.every(v => ['primary_skill', 'intent', 'cli_applicable', 'needs_clarification', 'readiness', 'proposed_action', 'critical'].every(k => Object.hasOwn(expected[v.id], k))), 'Incomplete intent rubric');
  await mkdir(dirname(output), { recursive: true }); await mkdir(output);
  await cp(baseline, join(output, 'a', 'skills'), { recursive: true });
  await cp(candidate, join(output, 'b', 'skills'), { recursive: true });
  const schedule = [];
  for (const item of items) for (let repeat = 0; repeat < repeats; repeat++) {
    // Counterbalance first-position/cache effects; arms receive identical requests.
    const order = (schedule.length / 2) % 2 ? ['b', 'a'] : ['a', 'b'];
    for (const arm of order) schedule.push({ id: item.id, split: item.split, repeat, arm });
  }
  await writeFile(join(output, 'cases.json'), JSON.stringify(items, null, 2));
  await writeFile(join(output, 'rubric.private.json'), JSON.stringify(expected, null, 2));
  const manifest = { format: 'intent-comparison-1', policy: POLICY, instructionHash: hash(INSTRUCTION), repeats, schedule,
    casesHash: hash(JSON.stringify(items)), rubricHash: hash(JSON.stringify(expected)),
    snapshots: { a: await fingerprint(join(output, 'a', 'skills')), b: await fingerprint(join(output, 'b', 'skills')) } };
  await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return { cases: items.length, repeats, decisions: schedule.length, output };
}

export function summarizeIntents(records, rubric, schedule) {
  assert(Array.isArray(schedule) && schedule.length, 'A complete planned schedule is required');
  const key = row => `${row.split}/${row.id}/${row.repeat}/${row.arm}`;
  assert(new Set(schedule.map(key)).size === schedule.length, 'Duplicate planned comparison slot');
  assert(new Set(records.map(key)).size === records.length, 'Duplicate comparison result');
  const result = {};
  for (const split of ['development', 'holdout']) {
    result[split] = {};
    for (const arm of ['a', 'b']) {
      const rows = records.filter(r => r.split === split && r.arm === arm), counters = { decisions: rows.length, correct: 0, routingCorrect: 0, criticalErrors: 0, criticalRoutingErrors: 0,
        input: 0, uncached: 0, cached: 0, created: 0, output: 0, total: 0, calls: 0 };
      for (const row of rows) {
        const expected = rubric[row.id]; const judgments = judgeIntent(expected, row.answer);
        const passed = !row.failure && Object.values(judgments).every(Boolean);
        counters.correct += Number(passed);
        counters.criticalErrors += Number(expected.critical && !passed);
        const route = judgeIntent(expected, row.routing ?? row.answer);
        const routePassed = ['primary_skill', 'intent', 'cli_applicable', 'needs_clarification'].every(k => route[k]);
        counters.routingCorrect += Number(routePassed); counters.criticalRoutingErrors += Number(expected.critical && !routePassed);
        for (const call of row.calls) { counters.calls++; for (const k of ['input', 'uncached', 'cached', 'created', 'output', 'total']) counters[k] += call.usage[k]; }
      }
      result[split][arm] = counters;
    }
    const a = result[split].a, b = result[split].b;
    const newFailures = records.filter(r => r.split === split && r.arm === 'b').filter(brow => {
      const arow = records.find(r => r.id === brow.id && r.repeat === brow.repeat && r.arm === 'a');
      return arow && !arow.failure && Object.values(judgeIntent(rubric[arow.id], arow.answer)).every(Boolean) &&
        (brow.failure || !Object.values(judgeIntent(rubric[brow.id], brow.answer)).every(Boolean));
    }).map(r => ({ id: r.id, repeat: r.repeat }));
    const reduction = a.total ? 1 - b.total / a.total : null;
    const planned = schedule.filter(r => r.split === split).map(key), actual = records.filter(r => r.split === split);
    const complete = planned.length > 0 && planned.length === actual.length && actual.every(r => planned.includes(key(r)) && r.calls.length > 0) && a.decisions === b.decisions;
    result[split].gate = { complete, newFailures, totalTokenReduction: reduction,
      passed: complete && b.correct >= a.correct && b.routingCorrect >= a.routingCorrect && b.criticalErrors === 0 && b.criticalRoutingErrors === 0 && !newFailures.length && reduction >= POLICY.minimumTotalTokenReduction };
  }
  return result;
}

export async function runIntents({ output, split, complete, model }) {
  assert(['development', 'holdout'].includes(split), 'Select development or holdout');
  const manifest = await json(join(output, 'manifest.json')), items = await json(join(output, 'cases.json')), rubric = await json(join(output, 'rubric.private.json'));
  assert(hash(JSON.stringify(manifest.policy)) === hash(JSON.stringify(POLICY)) && manifest.instructionHash === hash(INSTRUCTION), 'Evaluation protocol drift');
  assert(hash(JSON.stringify(items)) === manifest.casesHash && hash(JSON.stringify(rubric)) === manifest.rubricHash, 'Evaluation input drift');
  for (const arm of ['a', 'b']) assert(await fingerprint(join(output, arm, 'skills')) === manifest.snapshots[arm], 'Frozen skill drift');
  const runRoot = join(output, split); await mkdir(runRoot);
  const records = [], catalogs = { a: await catalogOf(join(output, 'a', 'skills')), b: await catalogOf(join(output, 'b', 'skills')) };
  for (const slot of manifest.schedule.filter(v => v.split === split)) {
    const item = items.find(v => v.id === slot.id), root = join(output, slot.arm, 'skills'), names = new Set(catalogs[slot.arm].map(v => v.name));
    const start = Date.now();
    const record = { ...slot, model, ...await classifyIntent({ item, catalog: catalogs[slot.arm],
      resource: input => readResource(root, names, input), complete }), elapsedMs: Date.now() - start };
    records.push(record);
    await writeFile(join(runRoot, `${slot.id}-${slot.repeat}-${slot.arm}.json`), JSON.stringify(record, null, 2));
    const correct = !record.failure && Object.values(judgeIntent(rubric[item.id], record.answer)).every(Boolean);
    console.log(JSON.stringify({ split, id: slot.id, repeat: slot.repeat, arm: slot.arm, correct,
      tokens: record.calls.reduce((n, c) => n + c.usage.total, 0), reads: record.reads.length }));
  }
  for (const arm of ['a', 'b']) assert(await fingerprint(join(output, arm, 'skills')) === manifest.snapshots[arm], 'Skills changed during evaluation');
  const summary = summarizeIntents(records, rubric, manifest.schedule);
  await writeFile(join(runRoot, 'summary.json'), JSON.stringify({ model, policy: manifest.policy, snapshots: manifest.snapshots, summary }, null, 2));
  return summary[split];
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [command, output, ...args] = process.argv.slice(2);
  try {
    if (command === 'prepare') console.log(JSON.stringify(await prepareIntents({ output: resolve(output), baseline: resolve(args[0]), candidate: resolve(args[1]), cases: resolve(args[2]), rubric: resolve(args[3]), repeats: Number(args[4] ?? 2) })));
    else if (command === 'run') {
      const key = process.env.SKILLS_EVAL_API_KEY, model = process.env.SKILLS_EVAL_MODEL;
      assert(key && model, 'Set SKILLS_EVAL_API_KEY and SKILLS_EVAL_MODEL in the process environment');
      const endpoint = process.env.SKILLS_EVAL_MODEL_URL ?? 'https://api.deepseek.com/anthropic/v1/messages';
      console.log(JSON.stringify(await runIntents({ output: resolve(output), split: args[0], model,
        complete: async payload => {
          const response = await fetch(endpoint, { method: 'POST', redirect: 'error', headers: {
            'content-type': 'application/json', 'anthropic-version': '2023-06-01', 'x-api-key': key,
          }, body: JSON.stringify({ model, ...payload }), signal: AbortSignal.timeout(90000) });
          assert(response.ok, 'Intent model transport failed: HTTP ' + response.status);
          const result = await response.json(); assert(result.model === model, 'Model changed during paired evaluation'); return result;
        } })));
    } else throw new Error('Use prepare OUTPUT BASELINE_SKILLS CANDIDATE_SKILLS CASES RUBRIC [REPEATS] or run OUTPUT development|holdout');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
