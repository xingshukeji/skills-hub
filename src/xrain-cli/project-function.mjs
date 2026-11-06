import { isDeepStrictEqual } from 'node:util';
import { resolve } from 'node:path';
import { CliError, isObject, nonempty, readJsonInput, registerSecrets, segment, sha256 } from './core.mjs';
import { apiValue } from './http.mjs';
import { assembleProject } from './project-source.mjs';
import { saveAssembly } from './project.mjs';

const sources = '/api/orchestration/v1/functions';
const versions = id => `/api/xrain/v1/functions/${segment(id)}/versions`;
const canonical = value => JSON.stringify(sort(value));
function sort(value) {
  if (Array.isArray(value)) return value.map(sort);
  return isObject(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])])) : value;
}
const sameContent = (a, b) => a.source === b.source && canonical(a.contractJson) === canonical(b.contractJson);
const definition = value => ({ key: value.key, label: value.label, helpText: value.helpText ?? null,
  signature: value.signature ?? null, isActive: value.isActive ?? true, source: value.source, contractJson: value.contractJson });
const definitionLabels = { label: '函数名称', helpText: '说明', signature: '调用签名', isActive: '启用状态', source: '源码', contractJson: '输入输出合同' };
const textSummary = text => ({ sha256: sha256(text), bytes: Buffer.byteLength(text), lines: text.split('\n').length });
function contractDifferences(current, project, path = 'contractJson') {
  if (isDeepStrictEqual(current, project)) return [];
  if (isObject(current) && isObject(project)) return [...new Set([...Object.keys(current), ...Object.keys(project)])].sort()
    .flatMap(key => contractDifferences(current[key], project[key], `${path}[${JSON.stringify(key)}]`));
  if (Array.isArray(current) && Array.isArray(project)) return Array.from({ length: Math.max(current.length, project.length) }, (_, index) =>
    contractDifferences(current[index], project[index], `${path}[${index}]`)).flat();
  return [{ path, ...(current === undefined ? { currentMissing: true } : { current }),
    ...(project === undefined ? { projectMissing: true } : { project }) }];
}
function definitionDifferences(current, project) {
  return Object.entries(definitionLabels).filter(([field]) => !isDeepStrictEqual(current[field], project[field])).map(([field, label]) => {
    if (field === 'source') {
      const before = current.source.split('\n'), after = project.source.split('\n');
      const index = Array.from({ length: Math.max(before.length, after.length) }, (_, i) => i).find(i => before[i] !== after[i]);
      return { field, label, current: textSummary(current.source), project: textSummary(project.source), firstDifferingLine: index + 1 };
    }
    if (field === 'contractJson') return { field, label, changes: contractDifferences(current[field], project[field]) };
    return { field, label, current: current[field], project: project[field] };
  });
}
function array(value) {
  if (!Array.isArray(value)) throw new CliError('The server returned an invalid function catalog.', { code: 'invalid_response' });
  return value;
}
async function findSource(call, key, tenantId) {
  const matches = array(await call('GET', sources)).filter(item => item.key === key);
  if (matches.length > 1) throw new CliError('The function key is ambiguous.', { code: 'function_ambiguous' });
  const value = matches[0];
  if (value && (!nonempty(value.id) || value.isSystem !== false || value.tenantId !== tenantId))
    throw new CliError('The function is not a source owned by the current tenant.', { code: 'function_source_unavailable' });
  return value;
}

// Expected objects are subsets; arrays and scalar values are exact. This keeps
// cases focused on business results without copying every diagnostic field.
export function expectedDifferences(actual, expected, path = '$') {
  if (isObject(expected)) {
    if (!isObject(actual)) return [{ path, expected, actual: actual ?? null }];
    return Object.entries(expected).flatMap(([key, value]) => Object.hasOwn(actual, key)
      ? expectedDifferences(actual[key], value, `${path}.${key}`) : [{ path: `${path}.${key}`, expected: value, missing: true }]);
  }
  if (Array.isArray(expected) && Array.isArray(actual) && expected.length === actual.length)
    return expected.flatMap((value, index) => expectedDifferences(actual[index], value, `${path}[${index}]`));
  return isDeepStrictEqual(actual, expected) ? [] : [{ path, expected, actual: actual ?? null }];
}
function validateCases(suite) {
  if (!isObject(suite) || suite.schemaVersion !== 1 || Object.keys(suite).some(k => !['schemaVersion', 'cases'].includes(k)) ||
      !Array.isArray(suite.cases) || !suite.cases.length) throw new CliError('Cases require schemaVersion: 1 and a nonempty cases array.', { code: 'invalid_cases' });
  const names = new Set();
  for (const item of suite.cases) {
    if (!isObject(item) || Object.keys(item).some(k => !['name', 'input', 'expected'].includes(k)) || !nonempty(item.name) || names.has(item.name) ||
        !Object.hasOwn(item, 'input') || !Object.hasOwn(item, 'expected') || isObject(item.expected) && !Object.keys(item.expected).length)
      throw new CliError('Every case needs a unique name, input and nonempty expected result.', { code: 'invalid_cases' });
    names.add(item.name);
  }
  return suite.cases;
}

export async function projectFunctionCommands(ctx) {
  const { args, reporter } = ctx;
  const key = args.required('key'), action = args.command(2);
  const versionId = action === 'test' ? args.required('version-id') : undefined;
  const project = resolve(args.value('project') ?? '.');
  const cases = action === 'test' ? validateCases(await readJsonInput(resolve(project, args.required('cases')), 'Function cases')) : undefined;
  if (cases) registerSecrets(reporter, cases);
  const assembly = await assembleProject(project, { release: args.has('release') });
  const declared = assembly.tenantFunctions.filter(item => item.key === key);
  if (declared.length !== 1 || !isObject(declared[0].contractJson))
    throw new CliError('Select one declared tenantFunctions entry with a structured contract using --key.', { code: 'project_function_missing' });
  const wanted = definition(declared[0]);
  const profile = ctx.store.resolve(args, true);
  const call = (method, route, body, mutation, validate) => apiValue(ctx, method, route, body,
    { resolvedProfile: profile, sessionOnly: true, mutation, validate });
  const identity = await call('GET', '/api/service/authen/v1/account/context');
  if (!nonempty(identity?.tenantId) || !nonempty(identity?.userId) || identity.scope !== 'tenant' || profile.scope === 'host')
    throw new CliError('A tenant user session is required.', { code: 'invalid_identity' });
  const target = { server: profile.server, tenantId: identity.tenantId, userId: identity.userId, key };
  let source = await findSource(call, key, identity.tenantId);
  if (action === 'test') {
    if (!source) throw new CliError('The declared function has not been published to this tenant.', { code: 'function_source_unavailable' });
    const version = array(await call('GET', versions(source.id))).find(item => item.id === versionId);
    if (!version || version.functionId !== source.id || !nonempty(version.source) || !isObject(version.contractJson))
      throw new CliError('The version does not belong to the selected project function.', { code: 'function_version_unavailable' });
    const results = [];
    for (const item of cases) {
      let actual;
      try { actual = await call('POST', `/api/xrain/v1/function-versions/${segment(versionId)}:test`, { input: item.input },
        { ...target, functionId: source.id, versionId, case: item.name,
          hint: 'The test outcome is unknown. Ordinary functions may have SDK effects; inspect the original effects before running this case again.' }); }
      catch (error) { error.details = { ...error.details, ...target, versionId, case: item.name, completedCases: results }; throw error; }
      const differences = expectedDifferences(actual, item.expected);
      results.push({ name: item.name, passed: !differences.length, ...(differences.length ? { differences } : {}) });
    }
    const failed = results.filter(item => !item.passed).length;
    reporter.print({ ...target, functionId: source.id, versionId, matchesProject: sameContent(version, wanted),
      sourceSha256: sha256(version.source), contractSha256: sha256(canonical(version.contractJson)),
      total: results.length, passed: results.length - failed, failed, cases: results });
    return failed ? 1 : 0;
  }

  const saved = await saveAssembly(assembly);
  const output = saved.metadata.functions.find(item => item.key === key);
  const progress = { ...target, assembly: saved.assemblyPath, functionInput: output.output,
    sourceSha256: sha256(wanted.source), contractSha256: sha256(canonical(wanted.contractJson)) };
  const mutate = async (method, route, body, stage, validate) => {
    reporter.progress(`Publishing ${key}: ${stage}${source ? ` (${source.id})` : ''}.`);
    return call(method, route, body, { ...progress, stage, ...(source ? { functionId: source.id } : {}),
      readback: ['function', 'list'], hint: 'Inspect the original function key and its versions on this target before another publish; do not blindly repeat an unknown write.' }, validate);
  };
  const validSource = value => nonempty(value?.id) && value.key === key && value.tenantId === identity.tenantId && value.isSystem === false;
  try {
    if (!source) source = await mutate('POST', sources, wanted, 'create-source', validSource);
    else if (!isDeepStrictEqual(definition(source), wanted)) {
      if (!args.has('update')) {
        const differences = definitionDifferences(definition(source), wanted);
        throw new CliError(`目标租户 ${JSON.stringify(identity.tenantId)}（${profile.server}）中的函数 ${JSON.stringify(source.label)}（${key}）与本地项目定义不同。差异：${differences.map(item => item.label).join('、')}。本次未向平台写入；函数来源、版本和应用选版均未修改。`, {
          code: 'function_update_required',
          hint: '请先核对 differences 中的 current（目标租户现值）和 project（本地项目值），将需要保留的租户修改合入项目。添加 --update 后，本地项目定义将更新目标租户中的同一函数来源（名称、说明、签名、启用状态、源码及输入输出合同），随后创建或复用匹配的不可变版本。启用状态也按项目值更新，停用会使已关联应用的当前调用不可用；旧不可变版本内容不变。不会自动切换应用选版、修改宿主配置或写入业务记录。',
          details: { ...progress, functionId: source.id, functionName: source.label, currentSourceSha256: sha256(source.source),
            writePerformed: false, differences, updateDirection: 'project_to_tenant',
            updateImpact: { functionSource: 'replace_definition', version: 'create_or_reuse', activeStateAppliedFromProject: true, applicationSelectionChanged: false,
              hostConfigurationChanged: false, businessRecordsChanged: false } } });
      }
      const { key: _key, ...body } = wanted;
      source = await mutate('PUT', `${sources}/${segment(source.id)}`, body, 'update-source', validSource);
    }
    // Re-read, then verify the immutable version returned by the actual creation.
    // The service has no source CAS: a concurrent editor must never be reported
    // as the version built from this project's input.
    progress.functionId = source.id;
    source = await findSource(call, key, identity.tenantId);
    if (!source || !isDeepStrictEqual(definition(source), wanted))
      throw new CliError('The current source changed during publication.', { code: 'function_source_changed', details: progress });
    const previous = array(await call('GET', versions(source.id)));
    let version = previous.find(item => item.functionId === source.id && nonempty(item.id) && sameContent(item, wanted));
    const reused = !!version;
    if (!version) version = await mutate('POST', versions(source.id), undefined, 'create-version',
      value => nonempty(value?.id) && value.functionId === source.id && nonempty(value.source) && isObject(value.contractJson));
    if (!sameContent(version, wanted)) throw new CliError('The created version contains a concurrent source change; it was not selected.',
      { code: 'function_source_changed', details: { ...progress, functionId: source.id, versionId: version.id } });
    reporter.print({ ...progress, functionId: source.id, versionId: version.id, reused, selectionChanged: false });
  } catch (error) {
    error.details = { ...progress, ...error.details };
    throw error;
  }
  return 0;
}
