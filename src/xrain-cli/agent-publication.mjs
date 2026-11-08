import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { CliError, isObject, jsonInput, nonempty, sha256 } from './core.mjs';
import { applicationAgentIdentity, applicationId, identifier } from './agent-target.mjs';
import { apiValue, writeOnce } from './http.mjs';
import { definitionFileChanges } from './definition-file.mjs';
import { definition, exchangeFile, newDefinition, runtimeConnection, runtimeValue, saveDefinition, updatedDefinition, validateCandidate } from './agents.mjs';

const root = '/v1/dsh/agent-definitions';
const failure = (message, code = 'invalid_arguments', details) => { throw new CliError(message, { code, details }); };
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
// Explicit delivery directory, including hidden skills, binary files and empty folders.
// Symlinks and special files cannot smuggle content outside that directory.
export async function snapshotWorkspace(source) {
  const directory = await realpath(resolve(source)), files = [], directories = [], names = new Set();
  const visit = async (path, relative = '') => {
    const before = await lstat(path);
    if (before.isSymbolicLink()) failure(`Workspace contains a symbolic link: ${relative}`, 'invalid_workspace');
    if (before.isDirectory()) {
      if (relative) directories.push(relative);
      for (const name of (await readdir(path)).sort()) {
        if (/[\\:\x00-\x1f<>"|?*]/.test(name) || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) || name.toLowerCase().startsWith('.xrain-'))
          failure(`Workspace contains a reserved or nonportable name: ${name}`, 'invalid_workspace');
        const child = relative ? `${relative}/${name}` : name, key = child.toLowerCase();
        if (names.has(key)) failure(`Workspace contains conflicting paths: ${child}`, 'invalid_workspace');
        names.add(key); await visit(join(path, name), child);
      }
    } else if (before.isFile()) {
      const bytes = await readFile(path), after = await lstat(path);
      if (after.isSymbolicLink() || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.mode !== after.mode)
        failure(`Workspace changed while reading: ${relative}`, 'workspace_changed');
      files.push({ path: relative, sha256: sha256(bytes), executable: !!(before.mode & 0o111), content: bytes.toString('base64') });
    } else failure(`Workspace contains a special file: ${relative}`, 'invalid_workspace');
    const after = await lstat(path);
    if (before.ino !== after.ino || before.mtimeMs !== after.mtimeMs || before.mode !== after.mode) failure(`Workspace changed while reading: ${relative}`, 'workspace_changed');
  };
  if (!(await lstat(directory)).isDirectory()) failure('The workspace source must be a directory.', 'invalid_workspace');
  await visit(directory);
  directories.sort(); files.sort((a, b) => compare(a.path, b.path));
  const digest = sha256(JSON.stringify({ directories, files: files.map(({ path, sha256, executable }) => ({ path, sha256, executable })) }));
  return { directory, files, directories, digest };
}

async function selectedIdentity(ctx, options) {
  const { args } = ctx, connection = runtimeConnection(ctx);
  if (args.has('agent-id')) return { id: identifier(args.value('agent-id'), 'Agent ID') };
  const app = applicationId(connection.profile) ?? options.applicationId;
  if (!nonempty(app)) failure('Specify --agent-id or use an application connection with an existing agent selection.');
  const select = async () => {
    const selection = await apiValue(ctx, 'GET', '/api/xrain/v1/agents/qualifications?' + new URLSearchParams({ applicationId: app }), undefined, { resolvedProfile: connection.profile });
    return applicationAgentIdentity(selection, app);
  };
  return { id: await select(), select, applicationId: app };
}
function receipt(value, request, check) {
  if (!isObject(value) || value.agentId !== request.agentId || value.digest !== request.digest || !nonempty(value.path) || value.checked !== check ||
      typeof value.exists !== 'boolean' || !(value.previousDigest === null || typeof value.previousDigest === 'string' && /^[a-f0-9]{64}$/.test(value.previousDigest)) ||
      value.files !== request.files.length || !Array.isArray(value.written) || !Array.isArray(value.removed) || !Array.isArray(value.createdDirectories))
    failure('Runtime returned an invalid workspace publication receipt.', 'invalid_response');
  return value;
}

export async function publishAgent(ctx) {
  const { args, reporter } = ctx, file = await exchangeFile(ctx), snapshot = await snapshotWorkspace(args.required('source'));
  const options = await runtimeValue(ctx, 'GET', root + '/options');
  if (!isObject(options) || options.supportsWorkspacePublication !== true || options.supportsWorkspacePublicationPreconditions !== true || options.supportsDefinitionValidation !== true || !Array.isArray(options.workspaces))
    failure('This Runtime does not support complete agent publication.', 'unsupported_runtime');
  const identity = await selectedIdentity(ctx, options), id = identity.id;
  let current;
  try { current = await definition(ctx, id); }
  catch (error) { if (!(error instanceof CliError && error.httpStatus === 404 && error.serverCode === 'AGENT_DEFINITION_NOT_FOUND')) throw error; }
  const expected = current?.revision ?? null, reference = file.definition.workspace;
  const sourceSpace = reference.kind === 'registered' ? options.workspaces.find(item => item.id === reference.id) : undefined;
  const boundSpace = current && !current.workspaceUnavailable ? options.workspaces.find(item => item.id === current.workspaceId) : undefined;
  // The saved or configured target supplies machine-local paths; never use a
  // source-machine direct path from the exchange file as an implicit destination.
  const path = args.value('workspace-path') ?? (current?.workspaceDirect && !current.workspaceUnavailable ? current.workspacePath : undefined) ?? boundSpace?.cwd ?? sourceSpace?.cwd;
  if (!nonempty(path)) failure('Select the Runtime destination with --workspace-path, or use its configured workspace.', 'workspace_unavailable');
  const preset = args.value('preset') ?? file.definition.agentPreset;
  if (!nonempty(preset)) failure('A work mode is required in the definition or --preset.');
  if (file.definition.nativeTools === null && options.supportsNativeToolInheritanceReset !== true) failure('This Runtime cannot restore native tool inheritance.', 'unsupported_runtime');
  const space = [boundSpace, sourceSpace].find(item => item?.cwd === path && item.agentPresets?.includes(preset));
  const registered = !!space;
  const mapped = { ...file, definition: { ...file.definition, agentPreset: preset,
    workspace: registered ? { kind: 'registered', id: space.id, path } : { kind: 'direct', path } } };
  const { changes } = definitionFileChanges(mapped, current ?? newDefinition(id, {}), options.workspaces);
  const patch = Object.fromEntries(Object.entries(changes).filter(([key]) => !['workspaceDirect', 'workspaceUnavailable', 'workspacePath'].includes(key)));
  if (file.definition.nativeTools === null) patch.nativeTools = null;
  const body = current ? updatedDefinition(current, patch, expected) : newDefinition(id, patch);
  const changedFields = current ? Object.keys(patch).filter(key => !['workspaceChange', 'nativeTools'].includes(key) && !isDeepStrictEqual(body[key], current[key])) : [];
  if (current && !isDeepStrictEqual(current.nativeTools, body.nativeTools === null ? undefined : body.nativeTools)) changedFields.push('nativeTools');
  const currentPath = current?.workspacePath ?? options.workspaces.find(item => item.id === current?.workspaceId)?.cwd;
  if (current && (currentPath !== path || current.agentPreset !== preset || current.workspaceUnavailable)) changedFields.push('workspace');
  const request = { agentId: id, revision: expected, path, files: snapshot.files, directories: snapshot.directories, digest: snapshot.digest };
  const preview = receipt(await runtimeValue(ctx, 'POST', root + '/workspace-publication/check', request), request, true);
  let validation;
  if (preview.exists) validation = await validateCandidate(ctx, id, expected, body);
  if (args.has('check')) {
    reporter.print({ agentId: id, revision: expected, checked: true, definitionValidated: !!validation, changedFields, workspace: preview,
      ...(!validation ? { note: 'The target directory will be created by publication; definition readiness is checked after creation.' } : {}) }); return 0;
  }
  const workspaceChanged = preview.previousDigest !== snapshot.digest || preview.written.length || preview.removed.length || preview.createdDirectories?.length || !preview.exists;
  if (current && (changedFields.length || workspaceChanged) && !args.has('update')) failure('The target differs from the delivered source. Use --check to review or --update to publish the changes.', 'definition_update_required', { agentId: id, revision: expected, changedFields, workspace: preview });
  if (identity.select && await identity.select() !== id) failure('The application agent selection changed before publication.', 'agent_selection_changed');
  const details = { agentId: id, expectedRevision: expected, runtime: runtimeConnection(ctx).runtime, workspacePath: path, workspaceDigest: snapshot.digest };
  let workspace, saved = current, stage = 'workspace';
  try {
    workspace = await writeOnce(async () => receipt(await runtimeValue(ctx, 'POST', root + '/workspace-publication', { ...request, expectedDigest: preview.previousDigest }), request, false),
      'Workspace publication outcome is unknown. Inspect the original agent and workspace before retrying.', details);
    stage = 'definition-validation';
    // Check the actual destination after file delivery, before changing its definition.
    await validateCandidate(ctx, id, expected, body);
    stage = 'definition';
    if (!current || changedFields.length || workspaceChanged) saved = await saveDefinition(ctx, id, body);
    stage = 'enable';
    if (args.has('enable') && !saved.enabled) saved = await saveDefinition(ctx, id, { agentId: id, revision: saved.revision, enabled: true }, true);
    stage = 'verification';
    const actual = await definition(ctx, id), status = await runtimeValue(ctx, 'POST', root + '/workspace-publication/status', { agentId: id, path });
    const fields = ['name', 'instructions', 'provider', 'model', 'reasoningEffort', 'agentPreset', 'nativeTools', 'assistantTools', 'disabledAssistantTools', 'inheritDefaultAssistantTools', 'suggestedQuestions', 'businessActions', 'uiPlugins'];
    const definitionMatches = fields.every(key => isDeepStrictEqual(actual[key], key === 'nativeTools' && body[key] === null ? undefined : body[key]));
    const directoryMatches = registered ? actual.workspaceId === space.id : actual.workspaceDirect === true && actual.workspacePath === workspace.path;
    if (actual.revision !== saved.revision || actual.enabled !== saved.enabled || !definitionMatches || !directoryMatches || actual.workspaceUnavailable ||
        status.agentId !== id || status.path !== workspace.path || status.digest !== snapshot.digest || !Array.isArray(status.files) || status.files.length !== snapshot.files.length || status.files.some(item => item.status !== 'intact') ||
        !Array.isArray(status.directories) || status.directories.length !== snapshot.directories.length || status.directories.some(item => item.status !== 'intact'))
      failure('The published definition or workspace changed during verification.', 'publication_changed');
    reporter.print({ agentId: id, revision: actual.revision, enabled: actual.enabled, runtime: details.runtime,
      operation: !current ? 'created' : current.revision === actual.revision ? 'unchanged' : 'updated', workspace: status,
      ...(identity.applicationId ? { applicationId: identity.applicationId } : {}) }); return 0;
  } catch (error) {
    if (error instanceof CliError) error.details = { ...error.details, ...details, stage, workspacePublished: workspace ? true : error.code === 'outcome_unknown' ? 'unknown' : false, ...(saved ? { savedRevision: saved.revision } : {}) };
    throw error;
  }
}

export async function publicationStatus(ctx) {
  const id = identifier(ctx.args.required('agent-id'), 'Agent ID');
  ctx.reporter.print(await runtimeValue(ctx, 'POST', root + '/workspace-publication/status', { agentId: id, path: ctx.args.required('workspace-path') })); return 0;
}

export async function showAgentTools(ctx) {
  const id = identifier(ctx.args.required('agent-id'), 'Agent ID'), current = await definition(ctx, id);
  const catalog = async (kind, body) => {
    if (kind === 'native' && (!current.agentPreset || current.workspaceUnavailable || !(current.workspaceId || current.workspaceDirect && current.workspacePath)))
      failure('The definition has no available working directory and mode.', 'workspace_unavailable');
    const value = await runtimeValue(ctx, 'POST', root + '/tools/' + kind, body);
    if (!Array.isArray(value?.items)) failure('Runtime returned an invalid tool catalog.', 'invalid_response');
    return value.items;
  };
  const results = await Promise.allSettled([
    catalog('native', { ...(current.workspaceDirect ? { workspacePath: current.workspacePath } : { workspaceId: current.workspaceId }), agentPreset: current.agentPreset }),
    catalog('business', {}),
  ]);
  const available = {}, catalogErrors = {};
  for (const [index, kind] of ['native', 'business'].entries()) {
    const result = results[index];
    if (result.status === 'fulfilled') available[kind] = result.value;
    else {
      const error = result.reason;
      catalogErrors[kind] = { code: error.code ?? 'catalog_unavailable', message: error.message,
        ...(error.httpStatus ? { httpStatus: error.httpStatus } : {}), ...(error.serverCode ? { serverCode: error.serverCode } : {}) };
    }
  }
  ctx.reporter.print({ agentId: id, revision: current.revision, nativeTools: current.nativeTools ?? null, assistantTools: current.assistantTools ?? [], disabledAssistantTools: current.disabledAssistantTools ?? [], inheritDefaultAssistantTools: current.inheritDefaultAssistantTools !== false,
    nativeSelection: current.nativeTools === undefined ? 'inherited' : 'explicit', complete: !Object.keys(catalogErrors).length, available,
    ...(Object.keys(catalogErrors).length ? { catalogErrors } : {}) }); return 0;
}
export async function setAgentTools(ctx) {
  const { args, reporter } = ctx, id = identifier(args.required('agent-id'), 'Agent ID');
  const patch = await jsonInput(args, 'values', true, { limit: Infinity, stdin: ctx.stdin, utf8: true });
  if (!isObject(patch) || !Object.keys(patch).length || Object.keys(patch).some(key => !['nativeTools', 'assistantTools', 'disabledAssistantTools', 'inheritDefaultAssistantTools'].includes(key))) failure('Supply nativeTools, assistantTools, disabledAssistantTools and/or inheritDefaultAssistantTools only.');
  const current = await definition(ctx, id), body = updatedDefinition(current, patch, args.integer('expected-revision'));
  const saved = await saveDefinition(ctx, id, body);
  reporter.print({ agentId: id, revision: saved.revision, nativeTools: saved.nativeTools ?? null, assistantTools: saved.assistantTools ?? [], disabledAssistantTools: saved.disabledAssistantTools ?? [], inheritDefaultAssistantTools: saved.inheritDefaultAssistantTools !== false }); return 0;
}
