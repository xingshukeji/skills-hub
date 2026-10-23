import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash, randomInt } from 'node:crypto';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const json = path => readFile(path, 'utf8').then(JSON.parse);
const clone = value => structuredClone(value);
const hash = value => createHash('sha256').update(value).digest('hex');
function assert(value, message = 'Invalid lab input.') { if (!value) throw new Error(message); }
const ok = data => ({ status: 200, data: clone(data) });
const error = (status, errorCode) => ({ status, data: { errorCode } });

// Restricted state simulator, not a substitute for the product implementation.
export function request(state, method, path, body = {}) {
  if (state.kind === 'application') {
    const installed = state.installation, op = state.operation;
    state.operations ??= { [op.id]: clone(op) };
    const installPath = '/api/application/v1/installations/' + installed.id;
    if (method === 'GET' && path === installPath) return ok(installed);
    if (method === 'GET' && path === installPath + '/components') return ok({ installationId: installed.id, tenantId: installed.tenantId, versionId: installed.installedVersionId, revision: installed.revision, items: state.components });
    const match = /^\/api\/application\/v1\/operations\/([^/]+)(?:\/(resolve|retry|continue|cancel))?$/.exec(path);
    if (match) {
      const current = state.operations[match[1]];
      if (!current) return error(404, 'application_not_found');
      if (method === 'GET' && !match[2]) return ok(current);
      if (method !== 'POST' || !match[2]) return error(405, 'method_not_allowed');
      const finish = operation => {
        operation.status = 'Succeeded'; operation.errorCode = null;
        operation.details = { ...operation.details, requiredBindings: [], requiredConfirmations: [], conflicts: [] };
        installed.installedVersionId = operation.targetVersionId; installed.revision++;
        installed.activeOperationId = null; installed.latestOperationId = operation.id;
        state.operation = clone(operation); return ok(operation);
      };
      if (match[2] === 'resolve') {
        if (current.status !== 'WaitingForResolution') return error(409, 'resolve_requires_waiting');
        if (body.expectedRevision !== installed.revision) return error(409, 'application_revision_conflict');
        if (Object.keys(body.resolutions ?? {}).some(key => !key.endsWith('/$delete'))) return error(409, 'managed_property_read_only');
        for (const binding of current.details.requiredBindings) if (!body.tenantBindings?.[binding.recordId + '/' + binding.binding]) return error(422, 'application_binding_required');
        for (const [key, envelope] of Object.entries(body.configurationChanges ?? {})) {
          const conflict = current.details.conflicts.find(row => row.unit === '$configuration' && row.editableProperties?.some(name => key === row.recordId + '/' + name));
          if (!conflict) return error(409, 'managed_property_read_only');
          if (envelope === null || typeof envelope !== 'object' || Array.isArray(envelope) || typeof envelope.present !== 'boolean' ||
            Object.keys(envelope).some(name => !['present', 'value'].includes(name)) || envelope.present !== Object.hasOwn(envelope, 'value')) return error(400, 'application_package_invalid');
        }
        for (const conflict of current.details.conflicts) {
          if (conflict.unit !== '$configuration') return error(422, 'unsupported_by_lab');
          const fields = body.configurationChanges?.[conflict.recordId + '/fieldNames'];
          if (!fields?.present || JSON.stringify(fields.value) !== JSON.stringify(['name', 'amount'])) return error(422, 'managed_contract_incompatible');
        }
        for (const item of current.details.requiredConfirmations) if (!body.confirmations?.some(row => row.recordId === item.recordId && row.unit === item.unit && row.token === item.token)) return error(422, 'application_confirmation_required');
        if (current.details.conflicts.length) state.fieldNames = clone(body.configurationChanges['apr-view/fieldNames'].value);
        state.bindings = { ...state.bindings, ...body.tenantBindings };
        return finish(current);
      }
      if (match[2] === 'retry') {
        if (current.status !== 'Failed') return error(409, 'retry_requires_failed');
        if (!body.requestId || body.requestId === current.id) return error(409, 'retry_requires_new_request_identity');
        if (installed.revision !== current.sourceRevision || body.expectedRevision !== installed.revision) return error(409, 'application_revision_conflict');
        if (current.details.result?.requiresResubmission) return error(409, 'application_operation_resubmission_required');
        if (state.operations[body.requestId]) return ok(state.operations[body.requestId]);
        const next = { ...clone(current), id: body.requestId, status: 'Pending', errorCode: null };
        state.operations[next.id] = next; state.retryOf = current.id;
        return finish(next);
      }
      if (match[2] === 'continue') {
        if (current.status === 'Succeeded') return ok(current);
        if (!['Running', 'Finalizing'].includes(current.status)) return error(409, 'continue_requires_interrupted_execution');
        if (!state.toolContext.executionInterrupted) return error(409, 'application_in_use');
        return finish(current);
      }
      if (!['Pending', 'WaitingForResolution'].includes(current.status)) return error(409, 'operation_cannot_cancel');
      current.status = 'Cancelled'; installed.activeOperationId = null; state.operation = clone(current); return ok(current);
    }
    const restore = new RegExp('^' + installPath + '/components/([^/]+):restore$').exec(path);
    if (restore && method === 'POST') {
      const component = state.components.find(item => item.recordId === restore[1]);
      if (body.expectedRevision !== installed.revision || installed.activeOperationId) return error(409, 'application_revision_conflict');
      if (!component || component.kind !== 'BizListView' || component.state !== 'Hidden') return error(409, 'only_hidden_view_can_restore');
      component.state = 'Active'; component.effective = true; installed.revision++; return ok(installed);
    }
    if (method === 'DELETE' && path === installPath) {
      if (body.expectedRevision !== installed.revision || installed.activeOperationId || !body.requestId) return error(409, 'application_revision_conflict');
      const result = { ...clone(op), id: body.requestId, targetVersionId: null, sourceVersionId: installed.installedVersionId, sourceRevision: installed.revision, status: 'Succeeded' };
      installed.installedVersionId = null; installed.revision++; installed.latestOperationId = result.id;
      state.operations[result.id] = result; state.operation = clone(result);
      state.components.forEach(item => { item.state = 'Retained'; item.effective = false; });
      return ok(result);
    }
  }
  if (state.kind === 'access') {
    const base = '/api/xrain/v1/applications/' + state.applicationId + '/execution-authorization';
    if (method === 'GET' && path === base) return ok(state);
    if (method === 'PUT' && path === base + '/grants') {
      if (!Array.isArray(body.permissionIds) || !body.permissionIds.length || body.permissionIds.some(id => !state.capabilityChecks.some(row => row.permissionId === id && row.canGrantInApplication))) return error(400, 'permission_not_in_grant_directory');
      body.permissionIds.forEach(id => { state.capabilityChecks.find(row => row.permissionId === id).status = 'allowed'; if (!state.granted.includes(id)) state.granted.push(id); });
      return ok({ roleId: 'role-fixed', permissionSetId: 'set-fixed', grantedPermissionIds: body.permissionIds, roleCreated: false, permissionSetCreated: false });
    }
  }
  if (state.kind === 'publication') {
    const base = '/api/xrain/v1/applications/' + state.applicationId + '/publication-scope';
    if (method === 'GET' && path === base) return ok(state.publication);
    if (method === 'PUT' && path === base) {
      if (body.expectedRevision !== state.publication.revision) return error(409, 'application_management_conflict');
      if (!['all', 'selected'].includes(body.mode) || !Array.isArray(body.userIds) || !Array.isArray(body.departments)) return error(400, 'invalid_request');
      state.publication = { mode: body.mode, userIds: clone(body.userIds), departments: clone(body.departments), revision: state.publication.revision + 1 };
      return ok(state.publication);
    }
  }
  return error(404, 'not_supported_by_lab');
}

async function fingerprint(directory) {
  const entries = [];
  async function walk(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      assert(!entry.isSymbolicLink(), 'Symlinks are not allowed in lab inputs.');
      const file = join(path, entry.name);
      if (entry.isDirectory()) await walk(file);
      else entries.push([relative(directory, file).replaceAll('\\', '/'), hash(await readFile(file))]);
    }
  }
  await walk(directory); return hash(JSON.stringify(entries.sort((a, b) => a[0].localeCompare(b[0]))));
}
export async function prepareLab(output, repeats = 1) {
  assert(Number.isInteger(repeats) && repeats >= 1 && repeats <= 3);
  const { cases, apiContract } = await import('../evals/workforce/capability-lab-cases.mjs');
  await mkdir(dirname(output), { recursive: true }); await mkdir(output);
  const manifest = { format: 'capability-lab-1', createdAt: new Date().toISOString(), repeats, ids: cases.map(row => row.id), groups: [] };
  const rubric = await readFile(join(root, 'evals/workforce/capability-lab-rubric.json'));
  await writeFile(join(output, 'rubric.private.json'), rubric);
  manifest.rubricHash = hash(rubric);
  const writeJson = async (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n');
  for (let repeat = 1; repeat <= repeats; repeat++) {
    const variants = randomInt(2) ? ['without-skills', 'with-skills'] : ['with-skills', 'without-skills'];
    for (const [i, variant] of variants.entries()) {
      const id = `group-${repeat}-${i + 1}`, group = join(output, id), input = join(group, 'input');
      await mkdir(join(group, 'output'), { recursive: true }); await mkdir(join(input, 'artifacts'), { recursive: true });
      await cp(fileURLToPath(import.meta.url), join(input, 'lab.mjs'));
      await writeJson(join(input, 'service-state.json'), Object.fromEntries(cases.filter(row => row.seed).map(row => [row.id, row.seed])));
      await writeJson(join(input, 'api.json'), apiContract);
      const catalog = [];
      if (variant === 'with-skills') {
        await cp(join(root, 'skills'), join(input, 'skills'), { recursive: true });
        for (const name of await readdir(join(input, 'skills'))) {
          const content = await readFile(join(input, 'skills', name, 'SKILL.md'), 'utf8');
          catalog.push({ name, description: /^description: (.+)$/m.exec(content)[1], resourceBase: { kind: 'directory', path: join(input, 'skills', name) } });
        }
      }
      await writeJson(join(input, 'catalog.json'), catalog);
      for (const row of cases) {
        const destination = join(input, 'artifacts', row.id); await mkdir(destination);
        if (row.seed) await writeJson(join(destination, 'observed.json'), row.seed.kind === 'publication' ? { applicationId: row.seed.applicationId, oldScreenshot: row.seed.oldScreenshot } : row.seed);
        for (const [name, value] of Object.entries(row.artifacts ?? {})) await writeJson(join(destination, name), value);
        if (row.projectFixture) {
          const project = join(destination, 'demo project'); await mkdir(join(project, '.workforce'), { recursive: true });
          await mkdir(join(project, 'scripts')); await mkdir(join(project, 'tenant app/scripts'), { recursive: true });
          const command = 'node scripts/start-development.mjs';
          await writeJson(join(project, 'package.json'), { scripts: { start: command, dev: command, preview: command, debug: command } });
          await writeJson(join(project, '.workforce/development-launch.json'), { applicationDirectory: 'tenant app', applicationConfiguration: 'application.json', connectionScript: 'connect.py', proxyScript: 'proxy.mjs', proxyTlsConfiguration: 'tls.json', applicationUrl: 'http://localhost:4870', browserUrl: 'https://localhost:9443' });
          for (const file of ['scripts/start-development.mjs', 'connect.py', 'tenant app/application.json', 'tenant app/scripts/start-development.mjs', 'tls.json']) await writeFile(join(project, file), '{}\n');
        }
      }
      await writeJson(join(input, 'cases.json'), cases.map(({ id, request }) => ({ id, request, artifacts: 'artifacts/' + id })));
      await writeFile(join(input, 'instructions.md'), [
        '# 独立运行任务', '',
        '处理 cases.json 的 12 个独立请求。全部是合成离线环境，禁止联网、真实浏览器、账号或部署操作；不能创建子代理。',
        '只读取本组 input/instructions.md、cases.json、catalog.json、api.json、artifacts/ 与 catalog 中实际提供的 skills/。可在本组 output/ 写文件。禁止读取父目录、其他组、旧对话、评审标准、lab.mjs 源码、service-state.json 及 output/state-*.json。',
        'catalog 中资源可按需读取/执行；为空时用通用能力和相同 API/原始材料完成，不寻找其他 skill。不要猜分组，也不要自行打分。',
        'l01–l07 必须实际通过下列本地模拟接口完成授权操作，保存每次响应并回读结果。其他项实际解析文件与计算后报告，不只列计划。',
        '命令：node input/lab.mjs request <案例ID> <GET|POST|PUT|DELETE> <相对API路径> [本组output下的body.json]。运行目录为本组。返回 status/data；4xx 是操作未成功，可按响应修正。不要启动其他服务。',
        '每个案例有独立状态，模拟器只覆盖 api.json 的子集；未提供的真实业务验证如实列为缺口。HTTP 200 或本地操作成功不能被写成真实生产已完成。',
        '产出 output/answers.json：{"answers":[{"id":"l01","skill":"catalog中的名称或null","conclusion":"当前结果","actions":["实际操作"],"evidence":["输出文件或观测"],"unresolved":["尚未验证项"]}]}。每项都要回答，保存可重查的脚本/响应证据。', ''
      ].join('\n'));
      manifest.groups.push({ id, repeat, variant, inputHash: await fingerprint(input) });
    }
  }
  await writeJson(join(output, 'manifest.json'), manifest);
  return { output, groups: manifest.groups.map(row => row.id), cases: cases.length };
}
async function labRequest(args) {
  const [caseId, method, path, bodyFile] = args;
  assert(/^l\d{2}$/.test(caseId) && ['GET', 'POST', 'PUT', 'DELETE'].includes(method) && path?.startsWith('/api/'));
  const input = dirname(fileURLToPath(import.meta.url)), group = resolve(input, '..');
  const file = join(group, 'output', 'state-' + caseId + '.json');
  let state;
  try { state = await json(file); } catch (error) { if (error.code !== 'ENOENT') throw error; state = clone((await json(join(input, 'service-state.json')))[caseId]); }
  assert(state, 'No simulated API state for this case.');
  let body = {};
  if (bodyFile) {
    const full = resolve(bodyFile), rel = relative(join(group, 'output'), full);
    assert(rel && !rel.startsWith('..') && !rel.includes(':')); body = await json(full);
  }
  const response = request(state, method, path, body);
  state.trace ??= []; state.trace.push({ method, path, body, status: response.status });
  await writeFile(file, JSON.stringify(state, null, 2) + '\n');
  console.log(JSON.stringify(response, null, 2));
}
export async function verifyLab(output) {
  const manifest = await json(join(output, 'manifest.json')); assert(manifest.format === 'capability-lab-1');
  assert(hash(await readFile(join(output, 'rubric.private.json'))) === manifest.rubricHash, 'Lab rubric changed.');
  const results = [];
  for (const group of manifest.groups) {
    const directory = join(output, group.id);
    assert(await fingerprint(join(directory, 'input')) === group.inputHash, 'Lab input changed.');
    const raw = await readFile(join(directory, 'output/answers.json'), 'utf8'), response = JSON.parse(raw);
    assert(Array.isArray(response.answers) && response.answers.length === manifest.ids.length && new Set(response.answers.map(row => row.id)).size === manifest.ids.length, 'Missing or duplicate answers.');
    const catalog = await json(join(directory, 'input/catalog.json'));
    for (const answer of response.answers) {
      assert(manifest.ids.includes(answer.id)); assert(answer.skill === null || catalog.some(row => row.name === answer.skill));
      assert(typeof answer.conclusion === 'string' && answer.conclusion.trim());
      for (const field of ['actions', 'evidence', 'unresolved']) assert(Array.isArray(answer[field]) && answer[field].every(value => typeof value === 'string'));
    }
    const states = {};
    const frozenAdapter = await import(pathToFileURL(join(directory, 'input/lab.mjs')).href);
    for (let n = 1; n <= 7; n++) {
      const id = 'l0' + n; let state;
      try { state = await json(join(directory, 'output/state-' + id + '.json')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      const original = (await json(join(directory, 'input/service-state.json')))[id];
      const replay = clone(original);
      for (const item of state?.trace ?? []) {
        const replayed = frozenAdapter.request(replay, item.method, item.path, item.body);
        assert(replayed.status === item.status, 'Invalid lab trace.');
      }
      const { trace, ...actualState } = state ?? {};
      assert(!state || JSON.stringify(replay) === JSON.stringify(actualState), 'State does not match replayed requests.');
      const finished = Boolean(state) && [
        () => state.operation.status === 'Succeeded' && state.installation.installedVersionId === 'apv-2' && state.label === original.label &&
          (original.fieldNames ? state.bindings?.['apr-connector/baseAddress'] === 'https://orders.example.invalid' && JSON.stringify(state.fieldNames) === JSON.stringify(['name', 'amount']) : state.bindings?.['apr-http/baseAddress'] === 'https://orders.example.invalid'),
        () => state.operation.status === 'Succeeded' && state.operation.id !== original.operation.id && state.retryOf === original.operation.id && state.operations[original.operation.id].status === 'Failed',
        () => state.operation.status === 'Succeeded' && state.operation.id === original.operation.id,
        () => state.components[0].state === 'Active' && state.components[0].effective && state.installation.installedVersionId === original.installation.installedVersionId && state.businessRows === original.businessRows,
        () => state.installation.installedVersionId === null && state.operation.status === 'Succeeded' && state.businessRows === original.businessRows,
        () => JSON.stringify(state.granted) === JSON.stringify(['perm-orders-read']) && state.messageRobot.status === 'not_established' && state.capabilityChecks[2].status === 'unverified',
        () => state.publication.mode === 'selected' && JSON.stringify([...state.publication.userIds].sort()) === JSON.stringify(['user-colleague', 'user-li', 'user-zhang']) && JSON.stringify(state.publication.departments) === JSON.stringify(original.publication.departments)
      ][n - 1]();
      states[id] = { finished, requests: trace?.length ?? 0, rejectedMutations: (trace ?? []).filter(row => row.method !== 'GET' && row.status >= 400).length };
    }
    results.push({ ...group, responseHash: hash(raw), states, semanticReview: 'required-for-all-answers' });
  }
  return { scope: 'synthetic-state-execution', groups: results, semanticReview: 'required', realBusinessVerified: false };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [mode, ...args] = process.argv.slice(2);
    if (mode === 'request') await labRequest(args);
    else if (mode === 'prepare') console.log(JSON.stringify(await prepareLab(resolve(args[0]), args[1] === undefined ? 1 : Number(args[1])), null, 2));
    else if (mode === 'verify') console.log(JSON.stringify(await verifyLab(resolve(args[0])), null, 2));
    else throw new Error('Usage: capability-lab.mjs prepare DIRECTORY [REPEATS] | verify DIRECTORY');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
