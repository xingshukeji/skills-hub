import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { CliError, isObject, jsonInput, nonempty, readJsonInput, segment } from './core.mjs';
import { definitionFileChanges, exportDefinition, readDefinitionFile } from './definition-file.mjs';
import { apiValue, request, responseError, writeOnce } from './http.mjs';
import { chatCommands } from './agent-chat.mjs';
import { runtimeRuns } from './runtime-runs.mjs';
import { applicationId, identifier, runtimeOrigin } from './agent-target.mjs';
import { memberTarget, memberValue } from './member-target.mjs';
import { publishAgent, publicationStatus, showAgentTools, setAgentTools } from './agent-publication.mjs';

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
export async function runtimeValue(ctx, method, path, json, extraHeaders = {}, { signal, limit, timeout } = {}) {
  const { args } = ctx;
  const { runtime, profile, token, source } = runtimeConnection(ctx);
  const response = await request(new URL(path, runtime), { method, token, json, timeout: timeout === undefined ? args.timeout() : timeout, signal, limit,
    headers: { 'X-XRain-Authorization': `Bearer ${token}`, ...extraHeaders } });
  if (!response.ok) throw responseError(response, '', { credentialSource: source, profile: profile.name });
  if (!response.bytes.length) return null;
  try { return response.json(); } catch { throw new CliError('Runtime returned invalid JSON.', { code: 'invalid_response' }); }
}
const definitionRead = (ctx, path) => runtimeValue(ctx, 'GET', path, undefined, {}, { limit: Infinity });
export async function definition(ctx, id) {
  const item = await definitionRead(ctx, `${definitions}/items/${segment(id)}`);
  if (!isObject(item) || item.agentId !== id || !Number.isSafeInteger(item.revision) || item.revision < 1)
    throw new CliError('Runtime returned an invalid definition.', { code: 'invalid_response' });
  return item;
}
async function definitionLimits(ctx) {
  const value = await runtimeValue(ctx, 'GET', definitions + '/limits');
  if (!isObject(value) || !(value.maxDefinitionBytes === null || Number.isSafeInteger(value.maxDefinitionBytes) && value.maxDefinitionBytes > 0))
    throw new CliError('Runtime returned an invalid definition write limit.', { code: 'invalid_response' });
  return value;
}
export async function saveDefinition(ctx, id, body, statusOnly = false) {
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
async function definitionInput(ctx, required = true) {
  const value = await jsonInput(ctx.args, 'values', true, { limit: Infinity, stdin: ctx.stdin, utf8: true });
  if (value === undefined && !required) return {};
  if (!isObject(value)) throw new CliError('Supply a JSON object using --values-json, --values or --file.', { code: 'invalid_arguments' });
  validateDefinitionInput(value); return value;
}
export function newDefinition(id, value) {
  return { aiUserId: '', agentId: id, revision: null, enabled: false, instructions: '', provider: '', model: '',
    agentPreset: '', workspaceId: null, nativeTools: [], allowedCallerUserIds: [], ...value };
}
export function updatedDefinition(current, patch, expected) {
  if (current.revision !== expected) throw new CliError('Definition revision changed. Review the current definition before saving.', {
    code: 'conflict', details: { agentId: current.agentId, expectedRevision: expected, currentRevision: current.revision },
  });
  const base = Object.fromEntries(definitionFields.filter(key => Object.hasOwn(current, key)).map(key => [key, current[key]]));
  return { ...base, ...patch, aiUserId: '', agentId: current.agentId, revision: expected, allowedCallerUserIds: [],
    workspaceChange: patch.workspaceChange ?? { operation: 'keep' } };
}

export async function exchangeFile(ctx) {
  const value = await readJsonInput(ctx.args.required('file'), 'Definition exchange file', { limit: Infinity, stdin: ctx.stdin, utf8: true });
  try { return readDefinitionFile(value); }
  catch { throw new CliError('Expected a version 1 xrain-workforce-agent-definition exchange file.', { code: 'invalid_definition_file' }); }
}
function requireValidation(options) {
  if (options.supportsDefinitionValidation !== true)
    throw new CliError('This Runtime does not support complete definition validation.', { code: 'unsupported_runtime',
      hint: 'Prepare the Runtime from the matching project source or artifact, then check again. No definition was saved.' });
}
export async function validateCandidate(ctx, id, expected, body) {
  const result = await runtimeValue(ctx, 'POST', definitions + '/validate', body, {}, { limit: Infinity });
  if (!isObject(result) || result.valid !== true || result.agentId !== id || result.revision !== expected)
    throw new CliError('Runtime returned an invalid validation result.', { code: 'invalid_response' });
  return result;
}

async function prepareDefinition(ctx) {
  const { args, reporter } = ctx, file = await exchangeFile(ctx);
  const connection = runtimeConnection(ctx), options = await runtimeValue(ctx, 'GET', definitions + '/options');
  if (!isObject(options) || !Array.isArray(options.workspaces)) throw new CliError('Runtime returned invalid definition options.', { code: 'invalid_response' });
  requireValidation(options);
  const app = applicationId(connection.profile) ?? options.applicationId;
  if (!nonempty(app)) throw new CliError('The target application is not configured.', { code: 'invalid_application_configuration', hint: 'Use the project’s application connection or --application-id.' });
  identifier(app, 'Application ID');
  const selectedIdentity = async () => {
    const selection = await apiValue(ctx, 'GET', platformAgents + '/qualifications?' + new URLSearchParams({ applicationId: app }), undefined, { resolvedProfile: connection.profile });
    if (!isObject(selection) || selection.applicationId !== app || !Array.isArray(selection.items))
      throw new CliError('XRain returned an invalid application agent selection.', { code: 'invalid_response' });
    const selected = selection.items.filter(item => isObject(item) && item.selected === true);
    const selectedId = selection.defaultAgentId ?? (selected.length === 1 ? selected[0].agentId : undefined);
    if (!nonempty(selectedId) || !selection.items.some(item => isObject(item) && item.agentId === selectedId))
      throw new CliError('The application has no unambiguous selected agent.', { code: 'agent_selection_required', hint: 'Have the application owner set its existing selection; preparation does not change platform bindings.' });
    return identifier(selectedId, 'Agent ID');
  };
  const id = await selectedIdentity();
  let current;
  try { current = await definition(ctx, id); }
  catch (error) { if (!(error instanceof CliError && error.httpStatus === 404 && error.serverCode === 'AGENT_DEFINITION_NOT_FOUND')) throw error; }
  const expected = current?.revision ?? null, draft = current ?? newDefinition(id, {});
  const reference = file.definition.workspace;
  const workspace = reference.kind === 'registered' ? options.workspaces.find(item => item.id === reference.id) : undefined;
  if (!workspace || !nonempty(workspace.cwd) || !Array.isArray(workspace.agentPresets) || !workspace.agentPresets.includes(file.definition.agentPreset))
    throw new CliError('The project workspace reference cannot be resolved on this Runtime.', { code: 'workspace_unavailable',
      details: { workspaceId: reference.id, agentPreset: file.definition.agentPreset }, hint: 'Prepare the project’s configured Runtime and workspace. No definition was saved.' });
  if (file.definition.nativeTools === null && options.supportsNativeToolInheritanceReset !== true)
    throw new CliError('This Runtime cannot restore the project’s native tool inheritance.', { code: 'unsupported_runtime' });
  // The source supplies a logical reference; the running host supplies its local directory.
  const mapped = { ...file, definition: { ...file.definition, workspace: { kind: 'registered', id: workspace.id, path: workspace.cwd } } };
  const { changes, warnings } = definitionFileChanges(mapped, draft, options.workspaces);
  const patch = Object.fromEntries(Object.entries(changes).filter(([key]) => inputFields.has(key)));
  if (file.definition.nativeTools === null) patch.nativeTools = null;
  workspaceChange(patch);
  const body = current ? updatedDefinition(current, patch, expected) : newDefinition(id, patch);
  const validation = await validateCandidate(ctx, id, expected, body);
  const changedFields = current ? definitionFields.filter(key => !isDeepStrictEqual(current[key], key === 'nativeTools' && body[key] === null ? undefined : body[key])) : [];
  if (current?.workspaceUnavailable && !changedFields.includes('workspaceId')) changedFields.push('workspaceId');
  const context = { applicationId: app, runtime: connection.runtime, workspace: { id: workspace.id, path: workspace.cwd, agentPreset: file.definition.agentPreset }, changedFields,
    ...(warnings.length ? { warnings } : {}) };
  if (args.has('check')) { reporter.print({ ...validation, ...context }); return 0; }
  if (current && changedFields.length && !args.has('update'))
    throw new CliError('The existing definition differs from the project source.', { code: 'definition_update_required',
      hint: 'Use --check to inspect the changes, or --update to apply this project definition at the observed revision.', details: { agentId: id, revision: expected, ...context } });
  if ((!current || changedFields.length || args.has('enable') && !current.enabled) && await selectedIdentity() !== id)
    throw new CliError('The application agent selection changed during preparation.', { code: 'agent_selection_changed', details: { agentId: id, ...context } });
  let saved = !current || changedFields.length ? await saveDefinition(ctx, id, body) : current;
  if (args.has('enable') && !saved.enabled) {
    try { saved = await saveDefinition(ctx, id, { agentId: id, revision: saved.revision, enabled: true }, true); }
    catch (error) {
      if (error instanceof CliError) error.details = { ...error.details, preparedRevision: saved.revision, agentId: id };
      throw error;
    }
  }
  reporter.print({ agentId: id, revision: saved.revision, enabled: saved.enabled,
    operation: !current ? 'created' : changedFields.length ? 'updated' : 'unchanged', ...context }); return 0;
}

async function importDefinition(ctx) {
  const { args, reporter } = ctx;
  const id = identifier(args.value('agent-id') ?? `agent-${randomBytes(16).toString('hex')}`, 'Agent ID');
  const expected = args.has('agent-id') && !args.has('create') ? revision(args) : null;
  let file = await exchangeFile(ctx);
  const current = expected === null ? newDefinition(id, {}) : await definition(ctx, id);
  // Check the explicit revision before resolving references or sending any mutation.
  if (expected !== null) updatedDefinition(current, {}, expected);
  const options = await runtimeValue(ctx, 'GET', definitions + '/options');
  if (!isObject(options) || !Array.isArray(options.workspaces)) throw new CliError('Runtime returned invalid definition options.', { code: 'invalid_response' });
  if (args.has('check')) requireValidation(options);
  // Environment paths are selected explicitly; a portable reference must never
  // silently adopt another computer’s directory or replace an existing binding.
  if (args.has('workspace-path')) file = { ...file, definition: { ...file.definition,
    workspace: { kind: 'direct', path: args.required('workspace-path') }, agentPreset: args.required('preset') } };
  const canRestoreInheritance = options.supportsNativeToolInheritanceReset === true;
  const { changes, warnings } = definitionFileChanges(file, current, options.workspaces, canRestoreInheritance);
  const patch = Object.fromEntries(Object.entries(changes).filter(([key]) => inputFields.has(key)));
  if (file.definition.nativeTools === null && canRestoreInheritance) patch.nativeTools = null;
  workspaceChange(patch);
  const body = expected === null ? newDefinition(id, patch) : updatedDefinition(current, patch, expected);
  for (const warning of warnings) reporter.progress(warning);
  reporter.progress(`Definition ID: ${id}`);
  if (args.has('check')) {
    const result = await validateCandidate(ctx, id, expected, body);
    reporter.print({ ...result, runtime: runtimeConnection(ctx).runtime, ...(warnings.length ? { warnings } : {}) }); return 0;
  }
  reporter.print({ ...await saveDefinition(ctx, id, body), ...(warnings.length ? { warnings } : {}) }); return 0;
}

async function definitionCommands(ctx) {
  const { args, reporter } = ctx;
  const action = args.command(2);
  if (action === 'list') { reporter.print(await runtimeValue(ctx, 'GET', definitions + '/summaries')); return 0; }
  if (action === 'options') { reporter.print(await runtimeValue(ctx, 'GET', definitions + '/options')); return 0; }
  if (action === 'employee-options') { reporter.print(await runtimeValue(ctx, 'GET', definitions + '/employee-options')); return 0; }
  if (action === 'member') { reporter.print(await runtimeValue(ctx, 'GET', `${definitions}/members/${segment(args.required('user-id'))}`)); return 0; }
  if (action === 'limits') { reporter.print({ ...await definitionLimits(ctx), runtime: runtimeConnection(ctx).runtime }); return 0; }
  if (action === 'import') return importDefinition(ctx);
  if (action === 'prepare') return prepareDefinition(ctx);
  if (action === 'create') {
    const value = await definitionInput(ctx, false);
    selectDirectory(args, value);
    if (value.enabled !== undefined && value.enabled !== false) throw new CliError('A new definition must be disabled.', { code: 'invalid_arguments' });
    if (args.has('name') && value.name !== undefined) throw new CliError('Provide the name once, using --name or JSON.', { code: 'invalid_arguments' });
    const name = args.value('name') ?? value.name;
    if (!nonempty(name)) throw new CliError('A definition name is required.', { code: 'invalid_arguments' });
    const id = identifier(args.value('agent-id') ?? `agent-${randomBytes(16).toString('hex')}`, 'Agent ID');
    workspaceChange(value);
    const body = newDefinition(id, { ...value, name });
    reporter.progress(`Definition ID: ${id}`);
    reporter.print(await saveDefinition(ctx, id, body)); return 0;
  }
  const id = identifier(args.required('agent-id'), 'Agent ID');
  if (action === 'show') { reporter.print(await definition(ctx, id)); return 0; }
  if (action === 'export') {
    const current = await definition(ctx, id);
    // Direct and unset directories need no options lookup.
    const workspaces = current.workspaceId ? (await runtimeValue(ctx, 'GET', definitions + '/options')).workspaces : [];
    if (!Array.isArray(workspaces)) throw new CliError('Runtime returned invalid workspaces.', { code: 'invalid_response' });
    const file = exportDefinition(current, workspaces), output = resolve(args.required('out'));
    const bytes = Buffer.from(JSON.stringify(file, null, 2) + '\n');
    writeFileSync(output, bytes, { flag: 'wx', mode: 0o600 });
    reporter.print({ agentId: id, revision: current.revision, runtime: runtimeConnection(ctx).runtime, output, bytes: bytes.length, format: file.format, version: file.version }); return 0;
  }
  const expected = revision(args);
  if (action !== 'update') {
    reporter.print(await saveDefinition(ctx, id, { agentId: id, revision: expected, enabled: action === 'enable' }, true)); return 0;
  }
  const patch = await definitionInput(ctx, !args.has('workspace-path'));
  selectDirectory(args, patch);
  if (!Object.keys(patch).length) throw new CliError('The update has no fields.', { code: 'invalid_arguments' });
  if ((Object.hasOwn(patch, 'workspaceId') || Object.hasOwn(patch, 'agentPreset')) && !patch.workspaceChange)
    throw new CliError('Changing workspace or preset requires an explicit workspaceChange.', { code: 'invalid_arguments' });
  workspaceChange(patch);
  const body = updatedDefinition(await definition(ctx, id), patch, expected);
  reporter.print(await saveDefinition(ctx, id, body)); return 0;
}

async function sidebarCommands(ctx) {
  const { args, reporter } = ctx, action = args.command(2);
  if (action === 'catalog') {
    const { send } = await memberTarget(ctx, 'workforce', { applicationRequired: false });
    const result = memberValue(await send('GET', '/api/workbench/sidebar-plugins'));
    if (!isObject(result) || !Array.isArray(result.items)) throw new CliError('Workforce returned an invalid sidebar catalog.', { code: 'invalid_response' });
    reporter.print(result); return 0;
  }
  const id = identifier(args.required('agent-id'), 'Agent ID');
  const current = await definition(ctx, id);
  if (action === 'show') { reporter.print({ agentId: id, revision: current.revision, uiPlugins: current.uiPlugins ?? null }); return 0; }
  const expected = revision(args);
  // Validate the caller's observed revision before computing a partial update.
  updatedDefinition(current, {}, expected);
  const value = action === 'remove' ? undefined : await jsonInput(args, 'values', true, { limit: Infinity, stdin: ctx.stdin, utf8: true });
  let uiPlugins;
  if (action === 'set') {
    if (value !== null && !Array.isArray(value)) throw new CliError('Supply an array of sidebar entries or null to inherit.', { code: 'invalid_arguments' });
    uiPlugins = value === null ? undefined : value;
  } else {
    if (!Array.isArray(current.uiPlugins)) throw new CliError('The sidebar inherits defaults. Set an explicit configuration before changing one entry.', { code: 'invalid_arguments' });
    uiPlugins = structuredClone(current.uiPlugins);
    if (action === 'add') {
      if (!isObject(value) || !nonempty(value.pluginId)) throw new CliError('Supply one sidebar entry with pluginId.', { code: 'invalid_arguments' });
      const entry = { ...value, entryId: value.entryId ?? `entry-${randomBytes(16).toString('hex')}` };
      if (!nonempty(entry.entryId) || uiPlugins.some(row => (row.entryId ?? row.pluginId) === entry.entryId))
        throw new CliError('Sidebar entry ID must be unique.', { code: 'invalid_arguments' });
      uiPlugins.push(entry);
    } else {
      const entryId = args.required('entry-id');
      const matches = uiPlugins.map((row, index) => (row.entryId ?? row.pluginId) === entryId ? index : -1).filter(index => index >= 0);
      if (matches.length !== 1) throw new CliError('Sidebar entry was not found or is ambiguous.', { code: 'invalid_arguments' });
      if (action === 'remove') uiPlugins.splice(matches[0], 1);
      else {
        if (!isObject(value) || Object.hasOwn(value, 'entryId') || Object.hasOwn(value, 'pluginId'))
          throw new CliError('Supply changed sidebar fields without changing its identity.', { code: 'invalid_arguments' });
        uiPlugins[matches[0]] = { ...uiPlugins[matches[0]], ...value };
      }
    }
  }
  const saved = await saveDefinition(ctx, id, updatedDefinition(current, { uiPlugins }, expected));
  reporter.print({ agentId: id, revision: saved.revision, uiPlugins: saved.uiPlugins ?? null }); return 0;
}

export async function agentCommands(ctx) {
  if (['run', 'ephemeral'].includes(ctx.args.command(1))) return runtimeRuns(ctx, { runtimeConnection, runtimeValue, identifier, applicationId, writeOnce });
  const { args, store, reporter, spec } = ctx;
  const action = args.command(1), sub = args.command(2);
  if (action === 'publish') return publishAgent(ctx);
  if (action === 'config') return definitionCommands(ctx);
  if (action === 'chat') return chatCommands(ctx, { identifier, applicationId, runtimeConnection, runtimeValue, writeOnce });
  if (action === 'definition') return definitionCommands(ctx);
  if (action === 'sidebar') return sidebarCommands(ctx);
  if (action === 'directory') {
    if (args.has('mine') && args.has('application-id')) throw new CliError('--mine applies only to the personal directory.', { code: 'invalid_arguments' });
    const appId = applicationId(runtimeConnection(ctx).profile);
    const headers = appId ? { 'X-XRain-Application-Id': appId } : {};
    reporter.print(await runtimeValue(ctx, 'GET', `/v1/dsh/workbench-agents?mine=${args.has('mine')}`, undefined, headers)); return 0;
  }
  if (action === 'tool') {
    if (sub === 'show') return showAgentTools(ctx);
    if (sub === 'set') return setAgentTools(ctx);
    const body = sub === 'native' ? { ...(args.has('workspace-path') ? { workspacePath: args.value('workspace-path') } : { workspaceId: identifier(args.required('workspace-id'), 'Workspace ID') }), agentPreset: identifier(args.required('preset'), 'Preset') } : {};
    reporter.print(await runtimeValue(ctx, 'POST', `${definitions}/tools/${sub}`, body)); return 0;
  }
  if (action === 'workspace') {
    if (sub === 'status') return publicationStatus(ctx);
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
