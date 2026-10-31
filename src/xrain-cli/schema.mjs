import { CliError, origin } from './core.mjs';
import { creationKey } from './record-creation.mjs';

const common = ['help', 'json'];
const target = ['server', 'tenant', 'scope', 'profile', 'timeout'];
const credentials = ['bearer', 'token-name', 'auth'];
const api = [...target, ...credentials];
const app = [...target, 'auth'];
const slot = (name, aliases = []) => ({ name, aliases });
const specs = [];
function command(path, options = [], operands = [], description = '') {
  specs.push({ path, words: path.split(' '), options: [...common, ...options], operands, description });
}

command('login', [...target, 'bearer', 'token-name', 'check', 'runtime', 'application-id', 'personal'], [], 'Save connection settings; use auth login for browser authentication.');
command('logout', ['profile'], [], 'Remove the selected profile and its platform session.');
command('profile show', api, [], 'Show the selected connection and credential source without secrets.');
command('profile list', [], [], 'List saved platform profiles.');
command('profile set', [...target, 'bearer', 'token-name', 'check', 'runtime', 'application-id', 'personal'], [], 'Save platform and optional agent connection settings.');
command('profile use', ['name', 'profile'], [slot('name', ['profile'])], 'Select a saved profile.');
command('profile remove', ['name', 'profile'], [{ ...slot('name', ['profile']), optional: true }], 'Remove a saved profile and session.');
command('profile path', [], [], 'Show the profile store path.');
command('auth login', [...target, 'exchange', 'device', 'no-browser', 'native', 'user', 'password-stdin'], [], 'Authenticate in the browser or with a native account. Explicit --scope host requires native login; password comes from stdin.');
command('auth status', [...api, 'exchange'], [], 'Inspect local authentication state; this does not validate a token remotely.');
command('auth whoami', [...api, 'agent', 'runtime', 'application-id', 'personal'], [], 'Read the verified XRain identity; --agent also checks the selected Runtime caller.');
command('auth logout', ['server', 'tenant', 'profile', 'exchange'], [], 'Delete the saved session, keeping the platform profile.');
command('doctor', [...api, 'exchange'], [], 'Check the selected connection and credential with a read-only probe.');
command('health', api, [], 'Probe readiness.');
for (const action of ['ready', 'live', 'healthz']) command('health ' + action, api, [], 'Read a health endpoint.');
command('metadata standards', api, [], 'Read entity design standards.');
command('metadata entities', api, [], 'List the target environment object registry.');
command('metadata describe', [...api, 'entity'], [slot('entity')], 'Read entity fields and constraints; metadata visibility does not imply runtime CRUD access.');
const runtime = [...api, 'runtime'];
command('agent directory', [...runtime, 'application-id', 'personal', 'mine'], [], 'Discover definitions and current use eligibility from the selected Runtime. --mine limits personal results to approved subscriptions.');
command('agent chat start', [...runtime, 'agent-id', 'application-id', 'personal', 'message', 'message-file', 'request-id', 'wait-timeout'], [slot('agent-id')], 'Create a conversation, submit one message and wait for its own completed turn.');
command('agent chat send', [...runtime, 'session-id', 'application-id', 'personal', 'message', 'message-file', 'request-id', 'wait-timeout'], [slot('session-id')], 'Send one message to an existing authorized conversation and wait for its own completed turn.');
command('agent chat wait', [...runtime, 'session-id', 'application-id', 'personal', 'request-id', 'wait-timeout'], [slot('session-id')], 'Read or follow one previously submitted request without sending it again.');
command('agent chat list', [...runtime, 'all'], [], 'List your CLI conversations; --all includes other sources owned by the same identity.');
command('agent chat history', [...runtime, 'session-id', 'through-seq', 'before-seq', 'page-size'], [slot('session-id')], 'Read visible history; page backwards at a fixed --through-seq using --before-seq.');
command('agent chat pending', [...runtime, 'session-id'], [], 'List your pending questions or approvals, optionally filtered by session.');
command('agent chat respond', [...runtime, 'action-ref', 'application-id', 'personal', 'request-id', 'values', 'values-json', 'file'], [slot('action-ref')], 'Submit an explicitly supplied answer or approval decision to one pending action.');
command('agent qualifications', [...api, 'application-id', 'personal'], [], 'Read XRain eligibility for this person or one application; this does not verify Runtime definitions.');
command('agent use', [...api, 'agent-id', 'application-id', 'personal'], [slot('agent-id')], 'Check XRain use eligibility; this does not run the agent or prove the Runtime definition is available.');
for (const action of ['subscribe', 'unsubscribe']) command(`agent ${action}`, [...api, 'agent-id'], [slot('agent-id')],
  action === 'subscribe' ? 'Request a personal subscription; private definitions can require approval.' : 'Cancel your personal subscription; history and application selection remain unchanged.');
command('agent policy list', api, [], 'List personal subscription policies.');
command('agent policy set', [...api, 'agent-id', 'visibility'], [slot('agent-id')], 'Set the personal subscription policy to public or private.');
command('agent subscription list', api, [], 'List pending and approved personal subscription requests when authorized.');
command('agent subscription decide', [...api, 'id', 'decision'], [slot('id')], 'Approve, reject or revoke one exact subscription request.');
command('agent application list', api, [], 'List accessible XRain applications.');
command('agent application show', [...api, 'application-id'], [slot('application-id')], 'Read one application’s agent selection and default.');
command('agent application set', [...api, 'application-id', 'values', 'values-json', 'file'], [slot('application-id')], 'Replace one application’s complete agent selection from JSON; preserve intended bindings and default.');
command('agent definition list', runtime, [], 'List definition summaries without full instructions; older Runtimes use their original list.');
command('agent definition show', [...runtime, 'agent-id'], [slot('agent-id')], 'Read one definition and its revision by exact agent ID.');
command('agent definition options', runtime, [], 'Read Runtime models, workspaces and presets available to this caller.');
command('agent definition limits', runtime, [], 'Read the current Runtime write limit and lightweight status capability.');
command('agent definition export', [...runtime, 'agent-id', 'out'], [slot('agent-id')], 'Export one saved definition as a version 1 exchange file; --out must name a new file.');
command('agent definition import', [...runtime, 'agent-id', 'expected-revision', 'file'], [], 'Import a version 1 exchange file. No ID creates a disabled definition; an existing ID requires --expected-revision and retains its enabled state.');
command('agent definition create', [...runtime, 'agent-id', 'name', 'values', 'values-json', 'file', 'workspace-path', 'preset'], [], 'Create a disabled definition. --workspace-path and --preset select an existing Runtime directory.');
command('agent definition update', [...runtime, 'agent-id', 'expected-revision', 'values', 'values-json', 'file', 'workspace-path', 'preset'], [slot('agent-id')], 'Apply a JSON patch or select an existing directory using an explicitly observed revision.');
for (const action of ['enable', 'disable']) command(`agent definition ${action}`, [...runtime, 'agent-id', 'expected-revision'], [slot('agent-id')], 'Change enabled state using an explicitly observed revision; preserve other settings.');
command('agent tool native', [...runtime, 'workspace-id', 'workspace-path', 'preset'], [], 'Read native tools for an existing directory or registered workspace and its preset.');
command('agent tool business', runtime, [], 'Read the business tools available in the current Runtime context.');
for (const action of ['browse', 'create', 'register']) command(`agent workspace ${action}`, [...runtime, 'values', 'values-json', 'file'], [],
  action === 'browse' ? 'Browse a Runtime-side directory from a JSON request.' : action === 'create' ? 'Create a directory on the Runtime host from a JSON request.' : 'Register an existing Runtime-side directory as a workspace from a JSON request.');
command('data query', [...api, 'entity', 'query', 'query-json', 'file', 'page', 'page-size', 'search', 'fields', 'filter', 'filter-json', 'sort', 'no-total'], [slot('entity')], 'Query runtime records using a complete JSON request or individual query options.');
command('data get', [...api, 'entity', 'id'], [slot('entity'), slot('id')], 'Read one runtime record.');
command('data delete', [...api, 'entity', 'id'], [slot('entity'), slot('id')], 'Delete exactly one runtime record. Filters are not accepted.');
command('data create', [...api, 'entity', 'request-key', 'values', 'values-json', 'file'], [slot('entity')], 'Create one record; optional requestKey enables recovery on a server that supports keyed creation. No automatic retry.');
command('data creation-result', [...api, 'entity', 'request-key'], [slot('entity')], 'Read the original creation by --request-key without creating or retrying a record. Inspect status: unknown or completed.');
command('data update', [...api, 'entity', 'id', 'values', 'values-json', 'file'], [slot('entity'), slot('id')], 'Update one record; a full values envelope can include expectedValues.');
const importTarget = [...api, 'entity', 'application'];
const importJob = [...importTarget, 'job'];
const importWait = ['wait', 'wait-timeout', 'poll-interval'];
command('data import template', [...importTarget, 'options-json', 'out'], [slot('entity')], 'Download a signed XLSX template for a supported import job.');
command('data import check', [...importTarget, 'options-json', 'file', 'request-id', ...importWait], [slot('entity')], 'Upload and check one complete XLSX without writing business records; preserve the request ID.');
command('data import list', [...importTarget, 'request-id', 'import-source-key', 'status', 'cursor', 'page-size'], [slot('entity')], 'List your jobs or find an interrupted upload by request ID.');
command('data import show', importJob, [slot('entity'), slot('job')], 'Read one job without starting or resuming it.');
command('data import wait', [...importJob, 'wait-timeout', 'poll-interval'], [slot('entity'), slot('job')], 'Wait for a job to need confirmation or finish; this does not confirm it.');
command('data import rows', [...importJob, 'view-version', 'cursor', 'page-size', 'action', 'source-row', 'match-value'], [slot('entity'), slot('job')], 'Read one authorized page of preview or result rows.');
command('data import issues', [...importJob, 'view-version', 'cursor', 'page-size', 'code', 'source-row'], [slot('entity'), slot('job')], 'Read one authorized page of issues.');
command('data import confirm', [...importJob, 'plan-revision', ...importWait], [slot('entity'), slot('job')], 'Confirm the reviewed revision for chunked execution. Earlier successful chunks remain if a later chunk fails.');
for (const action of ['pause', 'cancel']) command(`data import ${action}`, [...importJob, ...importWait], [slot('entity'), slot('job')],
  action === 'pause' ? 'Request a pause that can be continued.' : 'End this import while keeping already committed records.');
command('data import resume', [...importJob, 'plan-revision', 'action', ...importWait], [slot('entity'), slot('job')], 'Continue a paused job or recheck its uncommitted sources; recheck requires a new confirmation.');
command('data import download', [...importJob, 'purpose', 'out'], [slot('entity'), slot('job')], 'Download result, issues, maintenance or remaining XLSX without overwriting the destination.');
for (const action of ['ensure', 'show', 'path']) command('security tokens ' + action, [], [], 'Manage local test token aliases without printing token values.');
for (const action of ['create', 'ensure']) command(`security user ${action}`, [...api, 'user', 'name', 'values', 'values-json', 'file'], [slot('user', ['name'])],
  action === 'ensure' ? 'Reuse an existing platform user unchanged, or create a missing user from JSON. Does not create an OIDC identity.' : 'Create a platform user from JSON; use ensure to reuse fixed test accounts. Does not create an OIDC identity.');
command('security permissions catalog', api, [], 'Read the actual permission names before preparing a permission set.');
for (const action of ['create', 'ensure']) command(`security permission-set ${action}`, [...api, 'permission-set', 'name', 'values', 'values-json', 'file'], [slot('permission-set', ['name'])],
  action === 'ensure' ? 'Reuse an existing permission set unchanged, or create a missing set from JSON. Does not grant permissions.' : 'Create a permission set from JSON; permissions and user bindings are separate operations.');
for (const [kind, members] of [['user', ['role', 'permission-set']], ['role', ['permission-set']], ['permission-set', ['permission']]]) {
  command(`security ${kind} show`, [...api, kind, 'name'], [slot(kind, ['name'])], 'Read the selected security resource.');
  for (const member of members) for (const action of ['grant', 'revoke']) {
    const names = { role: 'roles', 'permission-set': 'permission-sets', permission: 'permissions' }[member];
    command(`security ${kind} ${action}-${member}`, [...api, kind, 'name', names, 'names'], [slot(kind, ['name'])], `Change ${member} relationships; the server enforces authorization.`);
  }
}
const host = ['server', 'scope', 'profile', 'timeout', ...credentials];
command('host settings get', [...host, 'setting'], [slot('setting')], 'Read agent-definition-limit from the Host settings API, showing bytes and MiB.');
command('host settings set', [...host, 'setting', 'mib', 'bytes', 'expected-bytes'], [slot('setting')], 'Set agent-definition-limit with --mib or --bytes and an observed old value; no automatic write retry.');
command('user settings get', [...api, 'setting'], [slot('setting')], 'Read your Workforce send-shortcut or unread-badge preference.');
command('user settings set', [...api, 'setting', 'value'], [slot('setting')], 'Set your Workforce send-shortcut (enter|ctrlEnter) or unread-badge (true|false).');
command('host tenant member list', [...host, 'tenant-id', 'page', 'page-size', 'search'], [slot('tenant-id')], 'List one named tenant membership directory using an authorized Host login.');
command('host tenant member ensure', [...host, 'tenant-id', 'user-id'], [slot('tenant-id'), slot('user-id')], 'Reuse the same tenant member unchanged, or add an existing global user as an ordinary member. Does not create a global identity.');
command('app login', [...target, 'exchange', 'device', 'no-browser'], [], 'Compatibility alias for auth login.');
command('app logout', ['server', 'tenant', 'profile', 'exchange'], [], 'Compatibility alias for auth logout.');
command('app init', ['namespace', 'label', 'dir'], [], 'Create source.json without overwriting a file.');
command('app check', [...app, 'source'], [], 'Build and validate remotely without saving; use build alone when an artifact is needed.');
command('app build', [...app, 'source', 'output'], [], 'Build remotely, validate the returned package, and save it exclusively.');
command('app publish', [...app, 'exchange', 'file'], [slot('file')], 'Publish an existing application package without automatic retries.');
command('app status', [...app, 'exchange', 'package'], [], 'Read published applications and version history. JSON mode always returns an array.');
command('app list', [...app, 'exchange'], [], 'List visible platform packages, or browse the independent market with --exchange.');
command('app versions', [...app, 'exchange', 'package'], [slot('package')], 'List versions of an exact package ID; availability for installation is decided by the platform.');
command('app import', [...app, 'package', 'version-id'], [slot('package')], 'Import an exact version from the platform-configured market; does not install or publish. --version-id is required.');
const installInput = ['package', 'version-id', 'expected-revision', 'maintain-installed-version', 'request-json', 'file'];
const wait = ['wait', 'wait-timeout', 'poll-interval'];
command('app preview', [...app, ...installInput], [slot('package')], 'Inspect installation or upgrade changes without applying them. Supply versionId via --version-id or --request-json.');
command('app install', [...app, ...installInput, 'request-id', ...wait], [slot('package')], 'Install or upgrade an exact version using server preflight. --wait tracks completion; request IDs allow recovery without resubmission.');
command('app installation show', [...app, 'installation'], [slot('installation')], 'Read the installed version, revision and active/latest operation IDs.');
command('app operation show', [...app, 'operation'], [slot('operation')], 'Read the original operation, including required inputs; successful inspection does not mean installation succeeded.');
command('app operation wait', [...app, 'operation', 'wait-timeout', 'poll-interval'], [slot('operation')], 'Poll the original operation until success, required input, failure, cancellation or timeout. Never writes.');
command('app operation resolve', [...app, 'operation', 'request-json', 'file', 'expected-revision', ...wait], [slot('operation')], 'Submit chosen bindings, configuration and impact confirmations to the original waiting operation. Current expectedRevision is required.');
command('app operation retry', [...app, 'operation', 'request-json', 'file', 'expected-revision', 'request-id', ...wait], [slot('operation')], 'Retry a failed operation with a new request ID; the platform checks its original revision.');
command('app operation continue', [...app, 'operation', ...wait], [slot('operation')], 'Explicitly resume an interrupted executing operation; --wait then tracks the same operation.');
command('app operation cancel', [...app, 'operation'], [slot('operation')], 'Cancel a pending or waiting operation when the platform permits it.');
command('batch', ['file'], [slot('file')], 'Run a JSON array of command argument arrays in this process; stop at the first failure.');

function words(args) {
  return args.commands.map((word, index) => {
    const lower = word.toLowerCase();
    return index === 1 && args.command(0) === 'security' ? ({ users: 'user', roles: 'role', 'permission-sets': 'permission-set' }[lower] ?? lower) : lower;
  });
}
export function findCommand(args) {
  const input = words(args);
  return specs.filter(spec => spec.words.every((word, i) => input[i] === word)).sort((a, b) => b.words.length - a.words.length)[0];
}
export function validateCommand(args) {
  const spec = findCommand(args);
  if (!spec) throw new CliError('Unknown or incomplete command. Run --help.', { code: 'invalid_command' });
  for (const name of args.options.keys()) if (!spec.options.includes(name))
    throw new CliError(`--${name} is not supported by '${spec.path}'.`, { code: 'invalid_arguments', hint: `Run ${spec.path} --help.` });
  const operands = args.commands.slice(spec.words.length);
  for (const operand of spec.operands) {
    const supplied = [operand.name, ...operand.aliases].filter(name => args.has(name));
    if (supplied.length > 1) throw new CliError(`Choose one option for ${operand.name}.`, { code: 'invalid_arguments' });
    const value = supplied.length ? args.value(supplied[0]) : operands.shift();
    if (value === undefined && !operand.optional) throw new CliError(`--${operand.name} is required.`, { code: 'invalid_arguments', hint: `Run ${spec.path} --help.` });
    if (value !== undefined) args.options.set(operand.name, value);
  }
  if (operands.length) throw new CliError(`Unexpected positional argument for '${spec.path}'.`, { code: 'invalid_arguments', hint: `Run ${spec.path} --help.` });
  const exclusive = names => {
    if (names.filter(name => args.has(name)).length > 1) throw new CliError(`Use only one of ${names.map(name => '--' + name).join(', ')}.`, { code: 'invalid_arguments' });
  };
  if (args.has('scope') && (!['host', 'tenant'].includes(args.value('scope')) || args.value('scope') === 'host' && args.has('tenant')))
    throw new CliError('--scope must be tenant or host; Host connections cannot select --tenant.', { code: 'invalid_arguments' });
  if (spec.path === 'auth login' && args.value('scope') === 'host' && !args.has('native'))
    throw new CliError('Host login requires --native.', { code: 'invalid_arguments' });
  if (spec.path.startsWith('host settings ')) {
    if (args.required('setting') !== 'agent-definition-limit') throw new CliError('Supported Host setting: agent-definition-limit.', { code: 'invalid_arguments' });
    if (spec.path.endsWith(' set')) {
      exclusive(['mib', 'bytes']);
      if (!args.has('mib') && !args.has('bytes')) throw new CliError('--mib or --bytes is required.', { code: 'invalid_arguments' });
    }
  }
  if (spec.path.startsWith('user settings ')) {
    const setting = args.required('setting');
    const choices = { 'send-shortcut': ['enter', 'ctrlEnter'], 'unread-badge': ['true', 'false'] };
    if (!Object.hasOwn(choices, setting)) throw new CliError('Supported personal settings: send-shortcut, unread-badge.', { code: 'invalid_arguments' });
    if (spec.path.endsWith(' set') && !choices[setting].includes(args.required('value')))
      throw new CliError(`--value must be ${choices[setting].join(' or ')}.`, { code: 'invalid_arguments' });
  }
  if (spec.path === 'auth login') {
    if (args.has('native')) {
      args.required('user');
      if (!args.has('password-stdin') || args.has('device') || args.has('no-browser') || args.has('exchange'))
        throw new CliError('Native login requires --user and --password-stdin and cannot be combined with browser, device or market login.', { code: 'invalid_arguments' });
    } else if (args.has('user') || args.has('password-stdin')) {
      throw new CliError('--user and --password-stdin require --native.', { code: 'invalid_arguments' });
    }
  }
  exclusive(['application-id', 'personal']);
  if (spec.path === 'data creation-result') args.required('request-key');
  if (args.has('request-key')) creationKey(args.value('request-key'));
  if (args.has('runtime')) origin(args.value('runtime'));
  if (spec.path === 'data query') {
    exclusive(['query', 'query-json', 'file']); exclusive(['filter', 'filter-json']);
    if (['query', 'query-json', 'file'].some(name => args.has(name)) && ['page', 'page-size', 'search', 'fields', 'filter', 'filter-json', 'sort', 'no-total'].some(name => args.has(name)))
      throw new CliError('A complete query JSON request cannot be combined with individual query options.', { code: 'invalid_arguments' });
  }
  if (['data create', 'data update', 'security user create', 'security user ensure', 'security permission-set create', 'security permission-set ensure'].includes(spec.path)) exclusive(['values', 'values-json', 'file']);
  if (spec.path.startsWith('data import ')) {
    const importAction = spec.words[2];
    const requireOption = name => {
      if (!args.has(name)) throw new CliError(`--${name} is required.`, { code: 'invalid_arguments' });
      return args.value(name);
    };
    if (['template', 'download'].includes(importAction)) requireOption('out');
    if (importAction === 'check') requireOption('file');
    for (const name of ['job', 'request-id']) if (args.has(name) && !/^[0-9a-f]{32}$/i.test(args.value(name)))
      throw new CliError(`--${name} must be 32 hexadecimal characters.`, { code: 'invalid_arguments' });
    if (args.has('page-size') && args.integer('page-size') > 200) throw new CliError('--page-size cannot exceed 200.', { code: 'invalid_arguments' });
    if (args.has('source-row')) args.integer('source-row');
    if (args.has('application') && (args.value('application').length > 100 || args.value('application') !== args.value('application').trim() || /[\x00-\x1f\x7f,]/.test(args.value('application'))))
      throw new CliError('--application is invalid.', { code: 'invalid_arguments' });
    if (importAction === 'confirm') { requireOption('plan-revision'); args.integer('plan-revision'); }
    if (importAction === 'resume') {
      const revision = requireOption('plan-revision');
      if (!/^\d+$/.test(revision) || !Number.isSafeInteger(Number(revision))) throw new CliError('--plan-revision must be a nonnegative integer.', { code: 'invalid_arguments' });
      if (!['continue', 'recheck'].includes(requireOption('action'))) throw new CliError('--action must be continue or recheck.', { code: 'invalid_arguments' });
    }
    if (importAction === 'download' && !['result', 'issues', 'maintenance', 'remaining'].includes(requireOption('purpose')))
      throw new CliError('--purpose must be result, issues, maintenance or remaining.', { code: 'invalid_arguments' });
  }
  if (spec.path.startsWith('agent ')) {
    if (spec.options.includes('expected-revision') && (spec.path !== 'agent definition import' || args.has('agent-id'))) { args.required('expected-revision'); args.integer('expected-revision'); }
    if (spec.options.includes('values-json')) exclusive(['values', 'values-json', 'file']);
    if (['agent definition update', 'agent application set', 'agent workspace browse', 'agent workspace create', 'agent workspace register'].includes(spec.path) &&
        !['values', 'values-json', 'file'].some(name => args.has(name)) && !(spec.path === 'agent definition update' && args.has('workspace-path'))) throw new CliError('A JSON input is required.', { code: 'invalid_arguments' });
    if (spec.path === 'agent definition export') args.required('out');
    if (spec.path === 'agent definition import') {
      args.required('file');
      if (args.has('expected-revision') && !args.has('agent-id')) throw new CliError('--expected-revision requires a target --agent-id.', { code: 'invalid_arguments' });
    }
    if (spec.path.startsWith('agent definition ') && (args.has('workspace-path') !== args.has('preset')))
      throw new CliError('Select a directory with both --workspace-path and --preset.', { code: 'invalid_arguments' });
    if (spec.path === 'agent definition create' && !['name', 'values', 'values-json', 'file'].some(name => args.has(name)))
      throw new CliError('A definition name is required.', { code: 'invalid_arguments' });
    if (spec.path === 'agent directory' && args.has('mine') && args.has('application-id'))
      throw new CliError('--mine applies only to the personal directory.', { code: 'invalid_arguments' });
    if (spec.path === 'agent tool native') { exclusive(['workspace-id', 'workspace-path']); if (!args.has('workspace-path')) args.required('workspace-id'); args.required('preset'); }
    if (spec.path === 'agent policy set' && !['public', 'private'].includes(args.required('visibility')))
      throw new CliError('--visibility must be public or private.', { code: 'invalid_arguments' });
    if (spec.path === 'agent subscription decide' && !['approved', 'rejected', 'revoked'].includes(args.required('decision')))
      throw new CliError('--decision must be approved, rejected or revoked.', { code: 'invalid_arguments' });
    if (['agent chat start', 'agent chat send'].includes(spec.path)) {
      exclusive(['message', 'message-file']);
      if (!args.has('message') && !args.has('message-file')) throw new CliError('--message or --message-file is required.', { code: 'invalid_arguments' });
    }
    if (spec.path === 'agent chat wait') args.required('request-id');
    if (spec.path === 'agent chat history' && ['through-seq', 'before-seq', 'page-size'].some(name => args.has(name))) {
      args.required('through-seq');
      for (const [name, minimum] of [['through-seq', -1], ['before-seq', 0]]) if (args.has(name)) {
        const value = args.value(name);
        if (!/^(?:0|[1-9][0-9]*|-1)$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < minimum)
          throw new CliError(`--${name} must be an integer of at least ${minimum}.`, { code: 'invalid_arguments' });
      }
      args.integer('page-size', 100);
    }
    if (spec.path === 'agent chat respond' && !['values', 'values-json', 'file'].some(name => args.has(name)))
      throw new CliError('A JSON response is required.', { code: 'invalid_arguments' });
  }
  if (spec.options.includes('request-json')) exclusive(['request-json', 'file']);
  if (spec.options.includes('wait-timeout')) {
    if (!['app operation wait', 'data import wait'].includes(spec.path) && !spec.path.startsWith('agent chat ') && !args.has('wait') && (args.has('wait-timeout') || args.has('poll-interval')))
      throw new CliError('--wait-timeout and --poll-interval require --wait.', { code: 'invalid_arguments' });
    for (const name of ['wait-timeout', 'poll-interval']) if (args.integer(name, 1) > 86400)
      throw new CliError(`--${name} cannot exceed 86400 seconds.`, { code: 'invalid_arguments' });
  }
  if (spec.path.startsWith('security ') && / (?:grant|revoke)-/.test(spec.path)) exclusive(['names', 'roles', 'permission-sets', 'permissions']);
  if (args.has('exchange')) {
    exclusive(['server', 'exchange']);
    if (args.has('tenant') || args.has('scope') || args.has('bearer') || args.has('token-name')) throw new CliError('Independent market commands use their own browser session, without platform scope, tenant or API token options.', { code: 'invalid_arguments' });
    if (args.has('device')) throw new CliError('Device login is available for the XRain platform, not the independent market.', { code: 'invalid_arguments' });
  }
  if (args.has('auth') && !['auto', 'session'].includes(args.value('auth')))
    throw new CliError('--auth must be auto or session.', { code: 'invalid_arguments' });
  if (args.value('auth') === 'session' && (args.has('bearer') || args.has('token-name')))
    throw new CliError('--auth session cannot be combined with --bearer or --token-name.', { code: 'invalid_arguments' });
  args.timeout();
  return spec;
}

export function commandHelp(args) {
  const prefix = words(args);
  const exact = specs.find(spec => spec.words.length === prefix.length && spec.words.every((word, i) => prefix[i] === word));
  const selected = exact ? [exact] : specs.filter(spec => prefix.every((word, i) => spec.words[i] === word));
  if (!selected.length) throw new CliError('Unknown command. Run --help.', { code: 'invalid_command' });
  const title = prefix.length ? `XRain CLI: ${prefix.join(' ')}` : 'XRain CLI — self-contained Node.js client';
  const lines = [title, 'Usage: xrain-cli <command> [options] (or node <skill>/scripts/xrain-cli.mjs <command> [options])', ''];
  for (const spec of selected) {
    lines.push(spec.path + spec.operands.map(operand => ` ${operand.optional ? '[' : '<'}${operand.name}${operand.optional ? ']' : '>'}`).join(''));
    lines.push('  ' + spec.description);
    if (exact) lines.push('  Options: ' + spec.options.map(name => '--' + name).join(', '));
  }
  if (!exact) lines.push('', 'Common where supported: --profile NAME --server URL --tenant ID --timeout SECONDS --json');
  if (!exact || exact.options.includes('bearer')) lines.push('Credentials: XRAIN_TOKEN (preferred over --bearer to avoid shell history); --auth session selects the saved session explicitly.');
  if (!exact || exact.options.includes('values-json') || exact.options.includes('query-json') || exact.path === 'batch') lines.push('JSON input: --values/--query/--filter JSON or @FILE; --values-json/--query-json/--filter-json FILE, or - for stdin. Batch input uses --file FILE|- .');
  if (!exact || exact.options.includes('request-json')) lines.push('Application requests: --request-json FILE|- (alias --file) accepts the API request object. Do not repeat fields in JSON and command options.');
  if (prefix[0] === 'agent' || !exact) lines.push('Agent Runtime commands use the profile Runtime or an explicit --runtime ORIGIN. Definitions and platform subscriptions are separate; inspect --help for each command.');
  if (prefix[0] === 'agent' && prefix[1] === 'chat') lines.push('Chat waits for the submitted turn; a 202 acceptance is not completion. --wait-timeout defaults to 120 seconds. Use --message-file - for stdin and retain session/request IDs for recovery.');
  if (prefix[0] !== 'agent' && (!exact || exact.options.includes('wait-timeout'))) lines.push('Waiting: --wait-timeout SECONDS (default 300) bounds submission and polling; --poll-interval SECONDS (default 2). --timeout remains the per-request limit.');
  lines.push('auth login authenticates; login/profile set only save settings. Market login uses browser authentication.',
    'Runtime: Node.js >=22.12.0. No npm install or .NET SDK needed.');
  return lines.join('\n') + '\n';
}
