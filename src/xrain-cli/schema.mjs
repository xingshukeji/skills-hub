import { CliError } from './core.mjs';

const common = ['help', 'json'];
const target = ['server', 'tenant', 'profile', 'timeout'];
const credentials = ['bearer', 'token-name', 'auth'];
const api = [...target, ...credentials];
const app = [...target, 'auth'];
const slot = (name, aliases = []) => ({ name, aliases });
const specs = [];
function command(path, options = [], operands = [], description = '') {
  specs.push({ path, words: path.split(' '), options: [...common, ...options], operands, description });
}

command('login', [...target, 'bearer', 'token-name', 'check'], [], 'Save connection settings; use auth login for browser authentication.');
command('logout', ['profile'], [], 'Remove the selected profile and its platform browser session.');
command('profile show', api, [], 'Show the selected connection and credential source without secrets.');
command('profile list', [], [], 'List saved platform profiles.');
command('profile set', [...target, 'bearer', 'token-name', 'check'], [], 'Save connection settings.');
command('profile use', ['name', 'profile'], [slot('name', ['profile'])], 'Select a saved profile.');
command('profile remove', ['name', 'profile'], [{ ...slot('name', ['profile']), optional: true }], 'Remove a saved profile and session.');
command('profile path', [], [], 'Show the profile store path.');
command('auth login', [...target, 'exchange', 'no-browser'], [], 'Authenticate in the browser for platform or independent market commands.');
command('auth status', [...api, 'exchange'], [], 'Inspect local authentication state; this does not validate a token remotely.');
command('auth whoami', api, [], 'Read the server-verified XRain identity and tenant using the selected credential.');
command('auth logout', ['server', 'tenant', 'profile', 'exchange'], [], 'Delete the browser session, keeping the platform profile.');
command('doctor', [...api, 'exchange'], [], 'Check the selected connection and credential with a read-only probe.');
command('health', api, [], 'Probe readiness.');
for (const action of ['ready', 'live', 'healthz']) command('health ' + action, api, [], 'Read a health endpoint.');
command('metadata standards', api, [], 'Read entity design standards.');
command('metadata entities', api, [], 'List the target environment object registry.');
command('metadata describe', [...api, 'entity'], [slot('entity')], 'Read entity fields and constraints; metadata visibility does not imply runtime CRUD access.');
command('data query', [...api, 'entity', 'query', 'query-json', 'file', 'page', 'page-size', 'search', 'fields', 'filter', 'filter-json', 'sort', 'no-total'], [slot('entity')], 'Query runtime records using a complete JSON request or individual query options.');
command('data get', [...api, 'entity', 'id'], [slot('entity'), slot('id')], 'Read one runtime record.');
command('data delete', [...api, 'entity', 'id'], [slot('entity'), slot('id')], 'Delete exactly one runtime record. Filters are not accepted.');
command('data create', [...api, 'entity', 'values', 'values-json', 'file'], [slot('entity')], 'Create one record; JSON file options accept - for stdin.');
command('data update', [...api, 'entity', 'id', 'values', 'values-json', 'file'], [slot('entity'), slot('id')], 'Update one record; a full values envelope can include expectedValues.');
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
const host = ['server', 'profile', 'timeout', ...credentials];
command('host tenant member list', [...host, 'tenant-id', 'page', 'page-size', 'search'], [slot('tenant-id')], 'List one named tenant membership directory using an authorized Host login.');
command('host tenant member ensure', [...host, 'tenant-id', 'user-id'], [slot('tenant-id'), slot('user-id')], 'Reuse the same tenant member unchanged, or add an existing global user as an ordinary member. Does not create a global identity.');
command('app login', [...target, 'exchange', 'no-browser'], [], 'Compatibility alias for auth login.');
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
  if (spec.path === 'data query') {
    exclusive(['query', 'query-json', 'file']); exclusive(['filter', 'filter-json']);
    if (['query', 'query-json', 'file'].some(name => args.has(name)) && ['page', 'page-size', 'search', 'fields', 'filter', 'filter-json', 'sort', 'no-total'].some(name => args.has(name)))
      throw new CliError('A complete query JSON request cannot be combined with individual query options.', { code: 'invalid_arguments' });
  }
  if (['data create', 'data update', 'security user create', 'security user ensure', 'security permission-set create', 'security permission-set ensure'].includes(spec.path)) exclusive(['values', 'values-json', 'file']);
  if (spec.options.includes('request-json')) exclusive(['request-json', 'file']);
  if (spec.options.includes('wait-timeout')) {
    if (spec.path !== 'app operation wait' && !args.has('wait') && (args.has('wait-timeout') || args.has('poll-interval')))
      throw new CliError('--wait-timeout and --poll-interval require --wait.', { code: 'invalid_arguments' });
    for (const name of ['wait-timeout', 'poll-interval']) if (args.integer(name, 1) > 86400)
      throw new CliError(`--${name} cannot exceed 86400 seconds.`, { code: 'invalid_arguments' });
  }
  if (spec.path.startsWith('security ') && / (?:grant|revoke)-/.test(spec.path)) exclusive(['names', 'roles', 'permission-sets', 'permissions']);
  if (args.has('exchange')) {
    exclusive(['server', 'exchange']);
    if (args.has('tenant') || args.has('bearer') || args.has('token-name')) throw new CliError('Independent market commands use their own browser session, without platform tenant or API token options.', { code: 'invalid_arguments' });
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
  const lines = [title, 'Usage: node <skill>/scripts/xrain-cli.mjs <command> [options]', ''];
  for (const spec of selected) {
    lines.push(spec.path + spec.operands.map(operand => ` ${operand.optional ? '[' : '<'}${operand.name}${operand.optional ? ']' : '>'}`).join(''));
    lines.push('  ' + spec.description);
    if (exact) lines.push('  Options: ' + spec.options.map(name => '--' + name).join(', '));
  }
  if (!exact) lines.push('', 'Common where supported: --profile NAME --server URL --tenant ID --timeout SECONDS --json');
  if (!exact || exact.options.includes('bearer')) lines.push('Credentials: XRAIN_TOKEN (preferred over --bearer to avoid shell history); --auth session selects the browser session explicitly.');
  if (!exact || exact.options.includes('values-json') || exact.options.includes('query-json') || exact.path === 'batch') lines.push('JSON input: --values/--query/--filter JSON or @FILE; --values-json/--query-json/--filter-json FILE, or - for stdin. Batch input uses --file FILE|- .');
  if (!exact || exact.options.includes('request-json')) lines.push('Application requests: --request-json FILE|- (alias --file) accepts the API request object. Do not repeat fields in JSON and command options.');
  if (!exact || exact.options.includes('wait-timeout')) lines.push('Waiting: --wait-timeout SECONDS (default 300) bounds submission and polling; --poll-interval SECONDS (default 2). --timeout remains the per-request limit.');
  lines.push('auth login authenticates; login/profile set only save settings. Applications require browser authentication.',
    'Runtime: Node.js >=22.12.0. No npm install or .NET SDK needed.');
  return lines.join('\n') + '\n';
}
