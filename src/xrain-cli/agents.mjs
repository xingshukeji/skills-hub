import { randomBytes } from 'node:crypto';
import { CliError, isObject, jsonInput, nonempty, origin, segment } from './core.mjs';
import { apiValue, request, responseError } from './http.mjs';

const definitions = '/v1/dsh/agent-definitions';
const platformAgents = '/api/xrain/v1/agents';
const definitionFields = ['name', 'enabled', 'instructions', 'provider', 'model', 'reasoningEffort', 'agentPreset',
  'workspaceId', 'nativeTools', 'suggestedQuestions', 'businessActions', 'uiPlugins', 'assistantTools'];
const inputFields = new Set([...definitionFields, 'workspaceChange']);

function identifier(value, label) {
  if (!nonempty(value) || !/^[a-zA-Z0-9._-]{1,160}$/.test(value) || value === '.' || value === '..')
    throw new CliError(`${label} must be a valid exact identifier.`, { code: 'invalid_arguments' });
  return value;
}
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
  } else if (change.operation === 'clear') {
    if (value.workspaceId != null || value.agentPreset) throw new CliError('A cleared workspace cannot have a workspaceId or preset.', { code: 'invalid_arguments' });
    value.workspaceId = null;
    value.agentPreset = '';
  }
}

async function runtimeValue(ctx, method, path, json, extraHeaders = {}) {
  const { args, store } = ctx;
  const runtime = origin(args.required('runtime'));
  const profile = store.resolve(args, true);
  const { token, source } = store.credential(args, profile);
  if (!token) throw new CliError('A platform credential is required for the Runtime.', { code: 'authentication_required', hint: 'Check auth status for the selected platform profile.' });
  const response = await request(new URL(path, runtime), { method, token, json, timeout: args.timeout(),
    headers: { 'X-XRain-Authorization': `Bearer ${token}`, ...extraHeaders } });
  if (!response.ok) throw responseError(response, '', { credentialSource: source, profile: profile.name });
  if (!response.bytes.length) return null;
  try { return response.json(); } catch { throw new CliError('Runtime returned invalid JSON.', { code: 'invalid_response' }); }
}
async function writeOnce(action, hint, details) {
  try { return await action(); }
  catch (error) {
    if (error instanceof CliError && (['network_error', 'timeout', 'invalid_response'].includes(error.code) || error.httpStatus === 408 || error.httpStatus >= 500)) {
      error.code = 'outcome_unknown';
      error.hint = hint;
      error.details = { ...error.details, ...details };
    }
    throw error;
  }
}
async function definition(ctx, id) {
  const result = await runtimeValue(ctx, 'GET', definitions);
  if (!isObject(result) || !Array.isArray(result.items)) throw new CliError('Runtime returned an invalid definition list.', { code: 'invalid_response' });
  const matches = result.items.filter(item => isObject(item) && item.agentId === id);
  if (!matches.length) throw new CliError('Definition not found in this Runtime.', { code: 'not_found', details: { agentId: id } });
  if (matches.length !== 1 || !Number.isSafeInteger(matches[0].revision) || matches[0].revision < 1)
    throw new CliError('Runtime returned an ambiguous or invalid definition.', { code: 'invalid_response' });
  return matches[0];
}
async function saveDefinition(ctx, id, body) {
  return writeOnce(async () => {
    const result = await runtimeValue(ctx, 'POST', definitions, body);
    if (!isObject(result) || result.agentId !== id || result.revision !== (body.revision ?? 0) + 1 || result.enabled !== body.enabled)
      throw new CliError('Runtime returned an invalid save result.', { code: 'invalid_response' });
    return result;
  },
    'Save outcome is unknown. Read the same agent ID and revision before deciding whether to retry.', { agentId: id, expectedRevision: body.revision });
}

async function definitionCommands(ctx) {
  const { args, reporter } = ctx;
  const action = args.command(2);
  if (action === 'list' || action === 'options') {
    reporter.print(await runtimeValue(ctx, 'GET', definitions + (action === 'options' ? '/options' : ''))); return 0;
  }
  if (action === 'create') {
    const value = await objectInput(args, false);
    validateDefinitionInput(value);
    if (value.enabled !== undefined && value.enabled !== false) throw new CliError('A new definition must be disabled.', { code: 'invalid_arguments' });
    if (args.has('name') && value.name !== undefined) throw new CliError('Provide the name once, using --name or JSON.', { code: 'invalid_arguments' });
    const name = args.value('name') ?? value.name;
    if (!nonempty(name)) throw new CliError('A definition name is required.', { code: 'invalid_arguments' });
    const id = identifier(args.value('agent-id') ?? `agent-${randomBytes(16).toString('hex')}`, 'Agent ID');
    workspaceChange(value);
    const body = { aiUserId: '', agentId: id, revision: null, enabled: false, instructions: '', provider: '', model: '',
      agentPreset: '', workspaceId: null, nativeTools: [], allowedCallerUserIds: [], ...value, name };
    reporter.progress(`Definition ID: ${id}`);
    reporter.print(await saveDefinition(ctx, id, body)); return 0;
  }
  const id = identifier(args.required('agent-id'), 'Agent ID');
  if (action === 'show') { reporter.print(await definition(ctx, id)); return 0; }
  const expected = revision(args);
  const patch = action === 'update' ? await objectInput(args) : { enabled: action === 'enable' };
  validateDefinitionInput(patch);
  if (!Object.keys(patch).length) throw new CliError('The update has no fields.', { code: 'invalid_arguments' });
  if ((Object.hasOwn(patch, 'workspaceId') || Object.hasOwn(patch, 'agentPreset')) && !patch.workspaceChange)
    throw new CliError('Changing workspace or preset requires an explicit workspaceChange.', { code: 'invalid_arguments' });
  workspaceChange(patch);
  const current = await definition(ctx, id);
  if (current.revision !== expected) throw new CliError('Definition revision changed. Review the current definition before saving.', {
    code: 'conflict', details: { agentId: id, expectedRevision: expected, currentRevision: current.revision },
  });
  const base = Object.fromEntries(definitionFields.filter(key => Object.hasOwn(current, key)).map(key => [key, current[key]]));
  const body = { ...base, ...patch, aiUserId: '', agentId: id, revision: expected, allowedCallerUserIds: [] };
  if (!patch.workspaceChange) body.workspaceChange = { operation: 'keep' };
  reporter.print(await saveDefinition(ctx, id, body)); return 0;
}

export async function agentCommands(ctx) {
  const { args, reporter, spec } = ctx;
  const action = args.command(1), sub = args.command(2);
  if (action === 'definition') return definitionCommands(ctx);
  if (action === 'directory') {
    if (args.has('mine') && args.has('application-id')) throw new CliError('--mine applies only to the personal directory.', { code: 'invalid_arguments' });
    const headers = args.has('application-id') ? { 'X-XRain-Application-Id': identifier(args.value('application-id'), 'Application ID') } : {};
    reporter.print(await runtimeValue(ctx, 'GET', `/v1/dsh/workbench-agents?mine=${args.has('mine')}`, undefined, headers)); return 0;
  }
  if (action === 'tool') {
    const body = sub === 'native' ? { workspaceId: identifier(args.required('workspace-id'), 'Workspace ID'), agentPreset: identifier(args.required('preset'), 'Preset') } : {};
    reporter.print(await runtimeValue(ctx, 'POST', `${definitions}/tools/${sub}`, body)); return 0;
  }
  if (action === 'workspace') {
    const body = await objectInput(args);
    const path = sub === 'register' ? '/workspaces/register' : `/directories/${sub === 'browse' ? 'list' : 'create'}`;
    const call = () => runtimeValue(ctx, 'POST', definitions + path, body);
    reporter.print(sub === 'browse' ? await call() : await writeOnce(call, 'Operation outcome is unknown. Inspect the original directory or workspace before retrying.', { operation: spec.path })); return 0;
  }
  const appId = args.has('application-id') ? identifier(args.value('application-id'), 'Application ID') : undefined;
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
    const result = await apiValue(ctx, method, path, body);
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
