import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CliError, isObject, jsonInput, nonempty, readJsonInput, segment } from './core.mjs';
import { definitionFileChanges, exportDefinition, readDefinitionFile } from './definition-file.mjs';
import { apiValue, request, responseError, writeOnce } from './http.mjs';
import { chatCommands } from './agent-chat.mjs';
import { applicationId, identifier, runtimeOrigin } from './agent-target.mjs';

export { identifier } from './agent-target.mjs';
export { writeOnce } from './http.mjs';

const definitions = '/v1/dsh/agent-definitions';
const platformAgents = '/api/xrain/v1/agents';
const definitionFields = ['name', 'enabled', 'instructions', 'provider', 'model', 'reasoningEffort', 'agentPreset',
  'workspaceId', 'nativeTools', 'suggestedQuestions', 'businessActions', 'uiPlugins', 'assistantTools'];
const inputFields = new Set([...definitionFields, 'workspaceChange']);

const runtimeConnections = new WeakMap();
function revision(args) {
  if (!args.has('expected-revision')) throw new CliError('--expected-revision is required. Read the definition first.', { code: 'invalid_arguments' });
  return args.integer('expected-revision');
}
async function objectInput(args, required = true) {
  const value = await jsonInput(args, 'values');
  if (value === undefined && !required) return {};
  if (!isObject(value)) throw new CliError('Supply a JSON object using --values-json, --values or --file.', { code: 'invalid_arguments' });
  return value;
}
function validateDefinitionInput(value) {
  const unknown = Object.keys(value).filter(key => !inputFields.has(key));
  if (unknown.length) throw new CliError(`Unexpected definition fields: ${unknown.join(', ')}.`, { code: 'invalid_arguments' });
  if (value.workspaceChange !== undefined && !isObject(value.workspaceChange))
    throw new CliError('workspaceChange must be an object.', { code: 'invalid_arguments' });
}
function workspaceChange(value) {
  const change = value.workspaceChange;
  if (!change) return;
  if (change.operation === 'bind') {
    if (value.workspaceId !== undefined && value.workspaceId !== change.workspaceId ||
        value.agentPreset !== undefined && value.agentPreset !== change.agentPreset)
      throw new CliError('workspaceChange conflicts with workspaceId or agentPreset.', { code: 'invalid_arguments' });
    value.workspaceId = change.workspaceId;
    value.agentPreset = change.agentPreset;
  } else if (change.operation === 'direct') {
    if (value.workspaceId != null || value.agentPreset !== undefined && value.agentPreset !== change.agentPreset)
      throw new CliError('A direct directory conflicts with workspaceId or agentPreset.', { code: 'invalid_arguments' });
    value.workspaceId = null;
    value.agentPreset = change.agentPreset;
  } else if (change.operation === 'clear') {
    if (value.workspaceId != null || value.agentPreset) throw new CliError('A cleared workspace cannot have a workspaceId or preset.', { code: 'invalid_arguments' });
    value.workspaceId = null;
    value.agentPreset = '';
  }
}

export function runtimeConnection(ctx) {
  const cached = runtimeConnections.get(ctx);
  if (cached) return cached;
  const { args, store } = ctx;
  const profile = store.resolve(args, true);
  const runtime = runtimeOrigin(profile);
  const { token, source } = store.credential(args, profile);
  if (!token) throw new CliError('A platform credential is required for the Runtime.', { code: 'authentication_required', hint: 'Check auth status for the selected platform profile.' });
  const connection = { runtime, profile, token, source };
  runtimeConnections.set(ctx, connection);
  return connection;
}
export async function runtimeValue(ctx, method, path, json, extraHeaders = {}, { signal, limit } = {}) {
  const { args } = ctx;
  const { runtime, profile, token, source } = runtimeConnection(ctx);
  const response = await request(new URL(path, runtime), { method, token, json, timeout: args.timeout(), signal, limit,
    headers: { 'X-XRain-Authorization': `Bearer ${token}`, ...extraHeaders } });
  if (!response.ok) throw responseError(response, '', { credentialSource: source, profile: profile.name });
  if (!response.bytes.length) return null;
  try { return response.json(); } catch { throw new CliError('Runtime returned invalid JSON.', { code: 'invalid_response' }); }
}
const missingCapability = error => error.httpStatus === 404 && error.serverCode !== 'AGENT_DEFINITION_NOT_FOUND';
const definitionRead = (ctx, path) => runtimeValue(ctx, 'GET', path, undefined, {}, { limit: Infinity });
async function definitionList(ctx) {
  try { return await runtimeValue(ctx, 'GET', definitions + '/summaries'); }
  catch (error) {
    if (!missingCapability(error)) throw error;
    ctx.reporter.progress('This Runtime uses the legacy full definition list.');
    return definitionRead(ctx, definitions);
  }
}
async function definition(ctx, id) {
  try {
    const item = await definitionRead(ctx, `${definitions}/items/${segment(id)}`);
    if (!isObject(item) || item.agentId !== id || !Number.isSafeInteger(item.revision) || item.revision < 1)
      throw new CliError('Runtime returned an invalid definition.', { code: 'invalid_response' });
    return item;
  } catch (error) { if (!missingCapability(error)) throw error; }
  ctx.reporter.progress('This Runtime lacks single-definition reads; using its legacy list.');
  const result = await definitionRead(ctx, definitions);
  if (!isObject(result) || !Array.isArray(result.items)) throw new CliError('Runtime returned an invalid definition list.', { code: 'invalid_response' });
  const matches = result.items.filter(item => isObject(item) && item.agentId === id);
  if (!matches.length) throw new CliError('Definition not found in this Runtime.', { code: 'not_found', details: { agentId: id } });
  if (matches.length !== 1 || !Number.isSafeInteger(matches[0].revision) || matches[0].revision < 1)
    throw new CliError('Runtime returned an ambiguous or invalid definition.', { code: 'invalid_response' });
  return matches[0];
}
async function definitionLimits(ctx) {
  let value, legacy = false;
  try { value = await runtimeValue(ctx, 'GET', definitions + '/limits'); }
  catch (error) {
    if (!missingCapability(error)) throw error;
    legacy = true;
    value = await runtimeValue(ctx, 'GET', definitions + '/options');
  }
  if (!isObject(value) || !(Number.isSafeInteger(value.maxDefinitionBytes) && value.maxDefinitionBytes > 0 || legacy && value.maxDefinitionBytes === undefined))
    throw new CliError('Runtime returned an invalid definition write limit.', { code: 'invalid_response' });
  return { maxDefinitionBytes: value.maxDefinitionBytes ?? 65536, supportsDefinitionStatusUpdate: value.supportsDefinitionStatusUpdate === true,
    ...(legacy ? { legacy: true } : {}) };
}
function checkDefinitionSize(body, limits) {
  const bytes = Buffer.byteLength(JSON.stringify(body), 'utf8');
  if (bytes > limits.maxDefinitionBytes) throw new CliError('The complete UTF-8 save request exceeds the current Runtime limit.', {
    code: 'definition_too_large', details: { requestBytes: bytes, maxDefinitionBytes: limits.maxDefinitionBytes },
  });
}
async function saveDefinition(ctx, id, body, limits, statusOnly = false) {
  if (!statusOnly) checkDefinitionSize(body, limits);
  return writeOnce(async () => {
    const result = await runtimeValue(ctx, 'POST', definitions + (statusOnly ? '/enabled' : ''), body, {}, { limit: Infinity });
    if (!isObject(result) || result.agentId !== id || result.revision !== (body.revision ?? 0) + 1 || result.enabled !== body.enabled)
      throw new CliError('Runtime returned an invalid save result.', { code: 'invalid_response' });
    return result;
  },
    'Save outcome is unknown. Read the same agent ID and revision before deciding whether to retry.', { agentId: id, expectedRevision: body.revision });
}

function selectDirectory(args, value) {
  if (!args.has('workspace-path')) return;
  if (['workspaceChange', 'workspaceId', 'agentPreset'].some(key => Object.hasOwn(value, key)))
    throw new CliError('Choose the directory once, using options or JSON.', { code: 'invalid_arguments' });
  value.workspaceChange = { operation: 'direct', path: args.value('workspace-path'), agentPreset: args.required('preset') };
}
async function definitionInput(ctx, limits, required = true) {
  const value = await jsonInput(ctx.args, 'values', true, { limit: limits.maxDefinitionBytes, stdin: ctx.stdin, utf8: true });
  if (value === undefined && !required) return {};
  if (!isObject(value)) throw new CliError('Supply a JSON object using --values-json, --values or --file.', { code: 'invalid_arguments' });
  validateDefinitionInput(value); return value;
}
function newDefinition(id, value) {
  return { aiUserId: '', agentId: id, revision: null, enabled: false, instructions: '', provider: '', model: '',
    agentPreset: '', workspaceId: null, nativeTools: [], allowedCallerUserIds: [], ...value };
}
function updatedDefinition(current, patch, expected) {
  if (current.revision !== expected) throw new CliError('Definition revision changed. Review the current definition before saving.', {
    code: 'conflict', details: { agentId: current.agentId, expectedRevision: expected, currentRevision: current.revision },
  });
  const base = Object.fromEntries(definitionFields.filter(key => Object.hasOwn(current, key)).map(key => [key, current[key]]));
  return { ...base, ...patch, aiUserId: '', agentId: current.agentId, revision: expected, allowedCallerUserIds: [],
    workspaceChange: patch.workspaceChange ?? { operation: 'keep' } };
}

async function importDefinition(ctx) {
  const { args, reporter } = ctx;
  const id = identifier(args.value('agent-id') ?? `agent-${randomBytes(16).toString('hex')}`, 'Agent ID');
  const expected = args.has('agent-id') ? revision(args) : null;
  const limits = await definitionLimits(ctx);
  const value = await readJsonInput(args.required('file'), 'Definition exchange file', { limit: limits.maxDefinitionBytes, stdin: ctx.stdin, utf8: true });
  let file;
  try { file = readDefinitionFile(value); }
  catch { throw new CliError('Expected a version 1 xrain-workforce-agent-definition exchange file.', { code: 'invalid_definition_file' }); }
  const current = expected === null ? newDefinition(id, {}) : await definition(ctx, id);
  // Check the explicit revision before resolving references or sending any mutation.
  if (expected !== null) updatedDefinition(current, {}, expected);
  const options = await runtimeValue(ctx, 'GET', definitions + '/options');
  if (!isObject(options) || !Array.isArray(options.workspaces)) throw new CliError('Runtime returned invalid definition options.', { code: 'invalid_response' });
  const { changes, warnings } = definitionFileChanges(file, current, options.workspaces, options.supportsNativeToolInheritanceReset === true);
  const patch = Object.fromEntries(Object.entries(changes).filter(([key]) => inputFields.has(key)));
  if (file.definition.nativeTools === null && options.supportsNativeToolInheritanceReset === true) patch.nativeTools = null;
  workspaceChange(patch);
  const body = expected === null ? newDefinition(id, patch) : updatedDefinition(current, patch, expected);
  for (const warning of warnings) reporter.progress(warning);
  reporter.progress(`Definition ID: ${id}`);
  reporter.print({ ...await saveDefinition(ctx, id, body, limits), ...(warnings.length ? { warnings } : {}) }); return 0;
}

async function definitionCommands(ctx) {
  const { args, reporter } = ctx;
  const action = args.command(2);
  if (action === 'list') { reporter.print(await definitionList(ctx)); return 0; }
  if (action === 'options') { reporter.print(await runtimeValue(ctx, 'GET', definitions + '/options')); return 0; }
  if (action === 'limits') { reporter.print({ ...await definitionLimits(ctx), runtime: runtimeConnection(ctx).runtime }); return 0; }
  if (action === 'import') return importDefinition(ctx);
  if (action === 'create') {
    const limits = await definitionLimits(ctx);
    const value = await definitionInput(ctx, limits, false);
    selectDirectory(args, value);
    if (value.enabled !== undefined && value.enabled !== false) throw new CliError('A new definition must be disabled.', { code: 'invalid_arguments' });
    if (args.has('name') && value.name !== undefined) throw new CliError('Provide the name once, using --name or JSON.', { code: 'invalid_arguments' });
    const name = args.value('name') ?? value.name;
    if (!nonempty(name)) throw new CliError('A definition name is required.', { code: 'invalid_arguments' });
    const id = identifier(args.value('agent-id') ?? `agent-${randomBytes(16).toString('hex')}`, 'Agent ID');
    workspaceChange(value);
    const body = newDefinition(id, { ...value, name });
    reporter.progress(`Definition ID: ${id}`);
    reporter.print(await saveDefinition(ctx, id, body, limits)); return 0;
  }
  const id = identifier(args.required('agent-id'), 'Agent ID');
  if (action === 'show') { reporter.print(await definition(ctx, id)); return 0; }
  if (action === 'export') {
    const current = await definition(ctx, id);
    // Direct and unset directories need no options/limit lookup, even after a limit decrease.
    const workspaces = current.workspaceId ? (await runtimeValue(ctx, 'GET', definitions + '/options')).workspaces : [];
    if (!Array.isArray(workspaces)) throw new CliError('Runtime returned invalid workspaces.', { code: 'invalid_response' });
    const file = exportDefinition(current, workspaces), output = resolve(args.required('out'));
    const bytes = Buffer.from(JSON.stringify(file, null, 2) + '\n');
    writeFileSync(output, bytes, { flag: 'wx', mode: 0o600 });
    reporter.print({ agentId: id, revision: current.revision, runtime: runtimeConnection(ctx).runtime, output, bytes: bytes.length, format: file.format, version: file.version }); return 0;
  }
  const expected = revision(args);
  const limits = await definitionLimits(ctx);
  if (action !== 'update' && limits.supportsDefinitionStatusUpdate) {
    reporter.print(await saveDefinition(ctx, id, { agentId: id, revision: expected, enabled: action === 'enable' }, limits, true)); return 0;
  }
  if (action !== 'update') reporter.progress('This Runtime does not support lightweight status updates; using its full-save contract.');
  const patch = action === 'update' ? await definitionInput(ctx, limits, !args.has('workspace-path')) : { enabled: action === 'enable' };
  selectDirectory(args, patch);
  if (!Object.keys(patch).length) throw new CliError('The update has no fields.', { code: 'invalid_arguments' });
  if ((Object.hasOwn(patch, 'workspaceId') || Object.hasOwn(patch, 'agentPreset')) && !patch.workspaceChange)
    throw new CliError('Changing workspace or preset requires an explicit workspaceChange.', { code: 'invalid_arguments' });
  workspaceChange(patch);
  const body = updatedDefinition(await definition(ctx, id), patch, expected);
  reporter.print(await saveDefinition(ctx, id, body, limits)); return 0;
}

export async function agentCommands(ctx) {
  const { args, store, reporter, spec } = ctx;
  const action = args.command(1), sub = args.command(2);
  if (action === 'chat') return chatCommands(ctx, { identifier, applicationId, runtimeConnection, runtimeValue, writeOnce });
  if (action === 'definition') return definitionCommands(ctx);
  if (action === 'directory') {
    if (args.has('mine') && args.has('application-id')) throw new CliError('--mine applies only to the personal directory.', { code: 'invalid_arguments' });
    const appId = applicationId(runtimeConnection(ctx).profile);
    const headers = appId ? { 'X-XRain-Application-Id': appId } : {};
    reporter.print(await runtimeValue(ctx, 'GET', `/v1/dsh/workbench-agents?mine=${args.has('mine')}`, undefined, headers)); return 0;
  }
  if (action === 'tool') {
    const body = sub === 'native' ? { ...(args.has('workspace-path') ? { workspacePath: args.value('workspace-path') } : { workspaceId: identifier(args.required('workspace-id'), 'Workspace ID') }), agentPreset: identifier(args.required('preset'), 'Preset') } : {};
    reporter.print(await runtimeValue(ctx, 'POST', `${definitions}/tools/${sub}`, body)); return 0;
  }
  if (action === 'workspace') {
    const body = await objectInput(args);
    const path = sub === 'register' ? '/workspaces/register' : `/directories/${sub === 'browse' ? 'list' : 'create'}`;
    const call = () => runtimeValue(ctx, 'POST', definitions + path, body);
    reporter.print(sub === 'browse' ? await call() : await writeOnce(call, 'Operation outcome is unknown. Inspect the original directory or workspace before retrying.', { operation: spec.path })); return 0;
  }
  const selectedProfile = (action === 'qualifications' || action === 'use') ? store.resolve(args, true) : undefined;
  const appId = selectedProfile ? applicationId(selectedProfile)
    : args.has('application-id') ? identifier(args.value('application-id'), 'Application ID') : undefined;
  let method = 'GET', path, body;
  if (action === 'qualifications') path = platformAgents + '/qualifications' + (appId ? '?' + new URLSearchParams({ applicationId: appId }) : '');
  else if (action === 'use') { method = 'POST'; path = `${platformAgents}/${segment(identifier(args.required('agent-id'), 'Agent ID'))}/use`; body = { applicationId: appId ?? null }; }
  else if (action === 'subscribe' || action === 'unsubscribe') { method = action === 'subscribe' ? 'POST' : 'DELETE'; path = `${platformAgents}/${segment(identifier(args.required('agent-id'), 'Agent ID'))}/subscription`; }
  else if (action === 'policy') {
    path = sub === 'list' ? `${platformAgents}/policies` : `${platformAgents}/${segment(identifier(args.required('agent-id'), 'Agent ID'))}/policy`;
    if (sub === 'set') { method = 'PUT'; const visibility = args.required('visibility'); if (!['public', 'private'].includes(visibility)) throw new CliError('--visibility must be public or private.', { code: 'invalid_arguments' }); body = { visibility }; }
  } else if (action === 'subscription') {
    path = `${platformAgents}/subscription-requests`;
    if (sub === 'decide') { method = 'POST'; path += `/${segment(identifier(args.required('id'), 'Request ID'))}/decision`; const decision = args.required('decision'); if (!['approved', 'rejected', 'revoked'].includes(decision)) throw new CliError('--decision must be approved, rejected or revoked.', { code: 'invalid_arguments' }); body = { decision }; }
  } else if (action === 'application') {
    path = '/api/xrain/v1/applications' + (sub === 'list' ? '' : `/${segment(appId)}/agents`);
    if (sub === 'set') { method = 'PUT'; body = await objectInput(args); }
  }
  const readOnly = method === 'GET' || action === 'use';
  const call = async () => {
    const result = await apiValue(ctx, method, path, body, { resolvedProfile: selectedProfile });
    if (!readOnly) {
      const id = args.value('agent-id');
      const valid = action === 'subscribe' ? isObject(result) && nonempty(result.id) && result.agentId === id && result.selected === true && ['pending', 'approved'].includes(result.approvalStatus)
        : action === 'unsubscribe' ? isObject(result) && result.cancelled === true
          : action === 'policy' ? isObject(result) && result.agentId === id && result.visibility === body.visibility
            : action === 'subscription' ? isObject(result) && result.id === args.value('id') && result.approvalStatus === body.decision
              : isObject(result) && Array.isArray(result.bindings) && Array.isArray(body.bindings) &&
                result.bindings.length === body.bindings.length && result.bindings.every((row, index) => isObject(row) && row.agentId === body.bindings[index]?.agentId) &&
                (result.defaultAgentId ?? null) === (body.defaultAgentId ?? null);
      if (!valid) throw new CliError('XRain returned an invalid operation result.', { code: 'invalid_response' });
    }
    return result;
  };
  reporter.print(readOnly ? await call() : await writeOnce(call, 'Operation outcome is unknown. Read the original policy, subscription or application selection before retrying.', {
    operation: spec.path, ...(args.has('agent-id') ? { agentId: args.value('agent-id') } : {}),
    ...(args.has('id') ? { requestId: args.value('id') } : {}), ...(appId ? { applicationId: appId } : {}),
  }));
  return 0;
}
