// Explicit, opt-in verification against a local development service.
// Every capability under test is exercised through the delivered skill bundle.
// Direct API calls below only prepare dedicated test fixtures or inspect contracts.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, existsSync, readFileSync, writeFileSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { Args, Reporter, origin, parseJson, randomId, sha256 } from '../src/xrain-cli/core.mjs';
import { Store, writePrivate } from '../src/xrain-cli/store.mjs';
import { request } from '../src/xrain-cli/http.mjs';
import { LIVE_PHASES, VerificationState } from './xrain-verification-state.mjs';

function acquireLock(path, contents) {
  let descriptor;
  try { descriptor = openSync(path, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') throw new Error(`Verification is already locked at ${path}. Inspect the owning run before trying again.`); throw error; }
  try { writeFileSync(descriptor, contents); }
  catch (error) { closeSync(descriptor); unlinkSync(path); throw error; }
  let released = false;
  const release = () => { if (!released) { released = true; closeSync(descriptor); unlinkSync(path); } };
  process.once('exit', release);
  return release;
}

async function main() {
const reporter = new Reporter();
try {
const phase = ['--help', '-h'].includes(process.argv[2]) ? 'help' : process.argv[2] ?? 'help';
let planOnly = false, requestedDirectory;
for (let i = 3; i < process.argv.length; i++) {
  if (process.argv[i] === '--plan') planOnly = true;
  else if (process.argv[i] === '--dir' && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) requestedDirectory = process.argv[++i];
  else throw new Error('Use verify:live -- <phase|all|resume> [--dir PATH] [--plan].');
}
if (phase === 'help') {
  reporter.print('Opt-in XRain local development verification. Use all for a new run, resume for its pending phases, or an individual phase: ' + [...LIVE_PHASES, 'inspect'].join(', ') + '. --dir PATH selects an isolated run directory; all/resume --plan previews without running services. Browser login phases wait for the real callback. Each receipt binds the run, CLI artifact and targets. Failed or interrupted phases require inspection and an explicit phase run before resume; published writes are never automatically replayed. Fixtures and evidence are retained.');
  return 0;
}
if (![...LIVE_PHASES, 'inspect', 'all', 'resume'].includes(phase) || (planOnly && !['all', 'resume'].includes(phase))) throw new Error('Unknown phase or unsupported --plan. Run verify:live -- help.');

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = resolve(requestedDirectory ?? process.env.XRAIN_LIVE_DIRECTORY ?? join(repository, '.local-validation/current'));
const server = origin(process.env.XRAIN_LIVE_SERVER ?? 'http://127.0.0.1:5410');
const exchange = origin(process.env.XRAIN_LIVE_EXCHANGE ?? 'http://localhost:5380');
for (const target of [server, exchange]) assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(target).hostname), 'Live verifier only accepts local development targets.');
const reportPath = join(directory, 'report.json');
const artifactSha256 = sha256(readFileSync(join(repository, 'skills/xrain-cli/scripts/xrain-cli.mjs')));
const binding = { artifactSha256, targets: { server, exchange, tenant: 'tenant-xrain-demo' }, clean: value => reporter.clean(value) };
const coordinatorPath = join(directory, 'orchestration.lock');
if (['all', 'resume'].includes(phase)) {
  if (planOnly) {
    const state = new VerificationState(reportPath, binding);
    reporter.print({ directory, bundleSha256: artifactSha256, phases: state.remaining(phase), readOnly: true });
    return 0;
  }
  mkdirSync(directory, { recursive: true });
  const owner = randomBytes(24).toString('hex');
  const release = acquireLock(coordinatorPath, JSON.stringify({ owner, pid: process.pid }));
  try {
    if (existsSync(join(directory, 'verification.lock'))) throw new Error('A verification phase is already running. Wait for it to finish.');
    const state = new VerificationState(reportPath, binding);
    for (const next of state.remaining(phase)) {
      const code = await new Promise((resolveResult, reject) => {
        const child = spawn(process.execPath, [fileURLToPath(import.meta.url), next, '--dir', directory], {
          cwd: repository, env: { ...process.env, XRAIN_LIVE_COORDINATOR: owner }, windowsHide: true, stdio: 'inherit',
        });
        child.on('error', reject); child.on('close', resolveResult);
      });
      if (code !== 0) return 1;
    }
    return 0;
  } finally { release(); }
}
if (existsSync(coordinatorPath) && parseJson(readFileSync(coordinatorPath, 'utf8'), 'Coordinator lock').owner !== process.env.XRAIN_LIVE_COORDINATOR)
  throw new Error('This directory is owned by an active all/resume run. Wait for it to finish.');
mkdirSync(directory, { recursive: true });
const release = acquireLock(join(directory, 'verification.lock'), String(process.pid));
try {
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^xrain(?:_|__)/i.test(key)));
Object.assign(env, { XRAIN_HOME: join(directory, 'state'), XRAIN_CONFIG_PATH: join(directory, 'state/profiles.json'),
  XRAIN_SESSION_DIR: join(directory, 'state/sessions'), XRAIN_LOCAL_TEST_SECRETS_PATH: join(directory, 'state/local-test-secrets.json') });
const store = new Store(env, reporter);
const state = new VerificationState(reportPath, binding), report = state.report;
function save() { state.save(); }
function record(name, status, detail = {}) {
  state.record(name, status, detail);
  reporter.print({ name, status, ...detail });
}
async function cli(argv, extraEnv = {}, interactive = false, input = '') {
  const artifactPath = join(repository, 'skills/xrain-cli/scripts/xrain-cli.mjs');
  state.verifyArtifact(artifactPath);
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [artifactPath, ...argv], {
      cwd: directory, env: { ...env, ...extraEnv }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; if (interactive) process.stdout.write(chunk); });
    child.stderr.on('data', chunk => { stderr += chunk; if (interactive) process.stderr.write(chunk); });
    child.stdin.on('error', () => {}); child.stdin.end(input);
    child.on('error', reject);
    child.on('close', code => {
      try { state.verifyArtifact(artifactPath); } catch (error) { reject(error); return; }
      let value;
      try { value = JSON.parse(stdout); } catch {}
      resolveResult({ code, stdout, stderr, value });
    });
  });
}
async function check(name, argv, validate = () => {}, { expectedCode = 0, extraEnv = {}, interactive = false, input = '' } = {}) {
  const result = await cli(argv, extraEnv, interactive, input);
  try {
    assert.equal(result.code, expectedCode, result.stderr || result.stdout);
    await validate(result.value, result);
    record(name, 'passed');
  } catch (error) {
    record(name, 'failed', { message: reporter.clean(error.message).slice(0, 3000), stderr: reporter.clean(result.stderr).slice(0, 3000) });
    throw error;
  }
  return result;
}
function token() {
  const profile = store.resolve(new Args(['--profile', 'skill-live']), true);
  const value = store.loadSession(profile.name, profile.server, profile.tenant);
  assert.ok(value, 'Complete app login --profile skill-live first.');
  return reporter.secret(value);
}
async function setupApi(method, path, json, headers) {
  const response = await request(new URL(path, server), { method, token: token(), json, headers });
  let value;
  try { value = response.json(); } catch {}
  assert.ok(response.ok, `${method} ${path}: HTTP ${response.status}, ${JSON.stringify(reporter.clean(value))}`);
  return value;
}
const base = '/api/service/authen/v1/security';
const required = [
  'help', 'platform browser login', 'platform default browser login', 'profile path', 'profile show', 'profile set', 'profile use', 'profile remove', 'login and check', 'top-level logout',
  'health ready', 'health live', 'health healthz', 'metadata standards',
  'security tokens path', 'security tokens ensure', 'security tokens show', 'local admin API token query', 'local guest API token respects permissions',
  'security user show', 'security role show', 'security permission-set show',
  'user grant-role', 'user revoke-role', 'user grant-permission-set', 'user revoke-permission-set',
  'role grant-permission-set', 'role revoke-permission-set', 'permission-set grant-permission', 'permission-set revoke-permission',
  'data create from file', 'data get', 'data query fields/filter/sort/paging', 'data query search/no-total', 'data query file', 'data query at-file', 'data query inline', 'data query file alias',
  'data update inline', 'data update expectedValues/file', 'data delete', 'data get after delete',
  'explicit bearer', 'environment bearer', 'profile saved bearer', 'profile bearer request', 'profile bearer redaction', 'token alias clears saved bearer',
  'tenant flag cannot change bearer tenant', 'app session tenant binding', 'API token rejected for security management',
  'app init', 'app check', 'app build', 'app build refuses overwrite', 'platform app publish', 'platform app status', 'platform publish version update', 'platform status version history',
  'market browser login', 'market app publish', 'market app status', 'market publish version update', 'market status version history',
  'market app logout', 'market requires login after logout', 'platform app logout', 'platform requires login after logout',
  'auth status machine', 'doctor session', 'profile list machine', 'metadata entities machine', 'metadata describe machine',
  'unknown profile machine refusal', 'delete filter machine refusal', 'batch read-only machine', 'data query stdin machine', 'platform app status machine array',
];
let phaseCode = 0;
state.phase(phase, 'started');
try {
  if (phase === 'inspect') {
    await check('health ready', ['health', 'ready']);
    for (const argv of [['security', 'user', 'show', '--user', 'admin'], ['security', 'role', 'show', '--role', 'sysadmin'], ['metadata', 'standards']]) {
      const result = await cli(argv);
      reporter.print({ command: argv.join(' '), exitCode: result.code, stderr: result.stderr,
        output: result.value ? Object.fromEntries(Object.entries(result.value).map(([key, value]) => [key, Array.isArray(value) ? { length: value.length } : value && typeof value === 'object' ? { keys: Object.keys(value) } : ['email','avatar'].includes(key) ? '[OMITTED]' : value])) : result.stdout.slice(0, 1500) });
      if (argv[0] === 'metadata' && result.code === 0) writeFileSync(join(directory, 'standards.json'), JSON.stringify(result.value, null, 2));
    }
    const registry = await setupApi('GET', '/api/metadata/v1/objects');
    writeFileSync(join(directory, 'object-registry.json'), JSON.stringify(registry, null, 2));
    reporter.print({ objectRegistryKeys: Object.keys(registry), sample: (registry.objects ?? registry.items ?? []).slice(0, 12).map(item => ({ apiName: item.apiName, entityCode: item.entityCode, label: item.label })) });
    const picklist = await setupApi('GET', '/api/metadata/v1/entities/meta_biz_picklist/describe');
    writeFileSync(join(directory, 'picklist-metadata.json'), JSON.stringify(picklist, null, 2));
    reporter.print({ picklistKeys: Object.keys(picklist), fields: picklist.fields?.map(field => ({ apiName: field.apiName, fieldApiName: field.fieldApiName, required: field.isRequired, type: field.type })) });
  } else if (phase === 'login' || phase === 'login-auto' || phase === 'market-login') {
    const market = phase === 'market-login';
    const argv = market ? ['auth', 'login', '--exchange', exchange, '--profile', 'skill-market', '--no-browser'] : [phase === 'login-auto' ? 'app' : 'auth', 'login', '--server', server, '--tenant', 'tenant-xrain-demo', '--profile', 'skill-live', ...(phase === 'login-auto' ? [] : ['--no-browser'])];
    await check(market ? 'market browser login' : phase === 'login-auto' ? 'platform default browser login' : 'platform browser login', argv, () => {}, { interactive: true });
  } else if (phase === 'basic') {
    await check('help', ['--help'], (_, result) => assert.match(result.stdout, /Applications/));
    await check('profile path', ['profile', 'path'], (_, result) => assert.equal(result.stdout.trim(), store.configPath));
    await check('profile show', ['profile', 'show'], value => assert.equal(value.tokenSource, 'application-session'));
    await check('profile set', ['profile', 'set', '--profile', 'skill-settings', '--server', server, '--tenant', 'tenant-xrain-demo']);
    await check('profile use', ['profile', 'use', '--name', 'SKILL-SETTINGS']);
    await check('profile remove', ['profile', 'remove', '--name', 'skill-settings']);
    await check('profile restore', ['profile', 'use', 'skill-live']);
    await check('login and check', ['login', '--profile', 'skill-live', '--check']);
    for (const name of ['ready', 'live', 'healthz']) await check('health ' + name, ['health', name]);
    await check('metadata standards', ['metadata', 'standards'], value => assert.ok(value));
    await check('auth status machine', ['auth', 'status', '--auth', 'session', '--json'], value => assert.equal(value.data.session.status, 'valid'));
    await check('doctor session', ['doctor', '--auth', 'session', '--json'], value => assert.equal(value.data.remoteValidation, 'accepted_by_probe'));
    await check('profile list machine', ['profile', 'list', '--json'], value => assert.ok(value.data.some(profile => profile.name === 'skill-live')));
    await check('metadata entities machine', ['metadata', 'entities', '--auth', 'session', '--json'], value => assert.ok(value.data.objects.some(entity => entity.entityCode === report.fixtures.dataEntity)));
    await check('metadata describe machine', ['metadata', 'describe', report.fixtures.dataEntity, '--auth', 'session', '--json'], value => assert.ok(value.data.fields.length));
    await check('unknown profile machine refusal', ['profile', 'show', '--profile', 'skill-live-typo', '--json'], value => assert.equal(value.error.code, 'profile_not_found'), { expectedCode: 1 });
    await check('delete filter machine refusal', ['data', 'delete', report.fixtures.dataEntity, 'never-sent', '--filter', '{}', '--json'], value => assert.equal(value.error.code, 'invalid_arguments'), { expectedCode: 1 });
    const batchPath = join(directory, 'read-only-batch.json');
    writeFileSync(batchPath, JSON.stringify([['auth', 'status', '--auth', 'session'], ['health', '--auth', 'session'], ['metadata', 'entities', '--auth', 'session']]));
    await check('batch read-only machine', ['batch', '--file', batchPath, '--json'], value => assert.ok(value.data.length === 3 && value.data.every(result => result.ok)));
    await check('security tokens path', ['security', 'tokens', 'path'], (_, result) => assert.equal(result.stdout.trim(), store.secretPath));
    await check('security tokens ensure', ['security', 'tokens', 'ensure'], value => assert.deepEqual(value.configuredTokenNames.sort(), ['admin', 'guest']));
    await check('security tokens show', ['security', 'tokens', 'show'], value => assert.deepEqual(value.configuredTokenNames.sort(), ['admin', 'guest']));
    const actualTokenPath = resolve(process.env.USERPROFILE ?? process.env.HOME, '.xrain/local-test-secrets.json');
    await check('local admin API token query', ['data', 'query', report.fixtures.dataEntity, '--page-size', '1', '--fields', 'id', '--token-name', 'admin'], value => assert.ok(value), { extraEnv: { XRAIN_LOCAL_TEST_SECRETS_PATH: actualTokenPath } });
    await check('API token rejected for security management', ['security', 'user', 'show', '--user', 'admin', '--token-name', 'admin'], (_, result) => assert.match(result.stderr, /authentication_method_not_allowed/), { expectedCode: 1, extraEnv: { XRAIN_LOCAL_TEST_SECRETS_PATH: actualTokenPath } });
    await check('environment bearer', ['health', 'ready'], () => {}, { extraEnv: { XRAIN_TOKEN: token() } });
  } else if (phase === 'credentials') {
    report.checks = report.checks.filter(item => !item.name.includes('[REDACTED]'));
    const bearer = token();
    await check('explicit bearer', ['health', 'ready', '--bearer', bearer, '--timeout', '5']);
    await check('profile saved bearer', ['profile', 'set', '--profile', 'skill-bearer', '--server', server, '--tenant', 'tenant-xrain-demo', '--bearer', bearer]);
    await check('profile bearer request', ['health', 'ready', '--profile', 'skill-bearer']);
    await check('profile bearer redaction', ['profile', 'show', '--profile', 'skill-bearer'], (value, result) => {
      assert.equal(value.profile.hasBearerToken, true); assert.equal(value.tokenSource, 'profile:bearer'); assert.ok(!result.stdout.includes(bearer));
    });
    await check('token alias clears saved bearer', ['profile', 'set', '--profile', 'skill-bearer', '--token-name', 'guest']);
    await check('cleared profile bearer', ['profile', 'show', '--profile', 'skill-bearer'], value => assert.equal(value.profile.hasBearerToken, false));
    await check('credential test profile remove', ['profile', 'remove', '--name', 'skill-bearer']);
    await check('profile restore after credential tests', ['profile', 'use', 'skill-live']);
    await check('tenant flag cannot change bearer tenant', ['security', 'user', 'show', '--user', report.fixtures.userName, '--tenant', 'cli-unrelated-tenant'], value => assert.equal(value.userName, report.fixtures.userName), { extraEnv: { XRAIN_TOKEN: bearer } });
    await check('app session tenant binding', ['app', 'status', '--tenant', 'cli-unrelated-tenant'], (_, result) => assert.match(result.stderr, /App login is required/), { expectedCode: 1 });
    const actualTokenPath = resolve(process.env.USERPROFILE ?? process.env.HOME, '.xrain/local-test-secrets.json');
    await check('local guest API token respects permissions', ['data', 'query', report.fixtures.dataEntity, '--page-size', '1', '--fields', 'id', '--token-name', 'guest'], (_, result) => assert.match(result.stderr, /HTTP (403|404)/), { expectedCode: 1, extraEnv: { XRAIN_LOCAL_TEST_SECRETS_PATH: actualTokenPath } });
    await check('security users alias and --name', ['security', 'users', 'show', '--name', report.fixtures.userName], value => assert.equal(value.userName, report.fixtures.userName));
    await check('security roles alias and positional target', ['security', 'roles', 'show', report.fixtures.roleName], value => assert.equal(value.roleName, report.fixtures.roleName));
    await check('security permission-sets alias', ['security', 'permission-sets', 'show', '--name', report.fixtures.permissionSetName], value => assert.equal(value.permissionSetName, report.fixtures.permissionSetName));
  } else if (phase === 'prepare-data') {
    const entity = report.fixtures.dataEntity ?? 'cliVerify' + report.fixtures.suffix + '__c';
    report.fixtures.dataEntity = entity; save();
    if (!report.fixtures.dataEntityCreated) {
      const registry = await setupApi('GET', '/api/metadata/v1/objects');
      const existing = registry.objects.find(item => item.entityCode === entity);
      if (!existing) await setupApi('POST', '/api/metadata/v1/entities', { entityApiName: entity, label: 'CLI verification data', description: 'Synthetic data for the Node CLI acceptance checks.', searchFields: ['label__c', 'name__c'], visibility: 'private', share2AllRoles: false }, { 'If-Match': `"metadata-${registry.metadataRevision}"`, 'Idempotency-Key': 'cli-verification-' + report.fixtures.suffix });
      report.fixtures.dataEntityCreated = true; save();
    }
    for (const [field, type] of [['label__c', 'Text'], ['name__c', 'Text'], ['helpText__c', 'Text'], ['isActive__c', 'Boolean']]) {
      const describe = await setupApi('GET', `/api/metadata/v1/entities/${entity}/describe`);
      if (!describe.fields.some(item => item.fieldApiName === field)) await setupApi('POST', `/api/metadata/v1/entities/${entity}/fields`, { fieldApiName: field, label: field, type, required: false, nullable: true, searchable: type === 'Text', sortable: true, ...(type === 'Text' ? { length: 256 } : {}) }, { 'If-Match': `"metadata-${describe.metadataRevision}"`, 'Idempotency-Key': 'cli-verification-' + report.fixtures.suffix + '-' + field });
    }
    record('dedicated data fixture prepared', 'passed', { entity });
  } else if (phase === 'data') {
    const entity = report.fixtures.dataEntity;
    assert.ok(entity);
    const name = 'cli_verify_' + (report.fixtures.suffix ?? Date.now().toString(36));
    const label = 'CLI data verification ' + name;
    const valuesPath = join(directory, 'values.json');
    writeFileSync(valuesPath, JSON.stringify({ label__c: label, name__c: name, isActive__c: true, helpText__c: 'Synthetic local CLI verification data.' }));
    const created = await check('data create from file', ['data', 'create', entity, '--values-json', valuesPath], value => assert.ok(value.recordId));
    const id = created.value.recordId;
    report.fixtures.dataRecordId = id; report.fixtures.dataEntity = entity; save();
    await check('data get', ['data', 'get', entity, id], value => { assert.equal(value.recordId, id); assert.equal(value.values.label__c, label); });
    const filterPath = join(directory, 'filter.json');
    const filter = { field: 'name__c', op: 'eq', value: name };
    writeFileSync(filterPath, JSON.stringify(filter));
    await check('data query fields/filter/sort/paging', ['data', 'query', entity, '--fields', 'id,label__c,name__c', '--filter-json', filterPath, '--sort', 'label__c:asc', '--page', '1', '--page-size', '5'], value => assert.ok(value.records.some(record => record.recordId === id)));
    await check('data query search/no-total', ['data', 'query', entity, '--search', name, '--no-total', '--pageSize', '5'], value => assert.ok(value.records.some(record => record.recordId === id)));
    const queryPath = join(directory, 'query.json');
    writeFileSync(queryPath, JSON.stringify({ page: 1, pageSize: 5, includeTotalCount: true, fields: ['id', 'label__c', 'name__c'], filter }));
    for (const [suffix, args] of [['file', ['--query-json', queryPath]], ['at-file', ['--query', '@' + queryPath]], ['inline', ['--query', readFileSync(queryPath, 'utf8')]], ['file alias', ['--file', queryPath]]])
      await check('data query ' + suffix, ['data', 'query', entity, ...args], value => assert.equal(value.records[0].recordId, id));
    await check('data query stdin machine', ['data', 'query', entity, '--query-json', '-', '--json'], value => assert.equal(value.data.records[0].recordId, id), { input: readFileSync(queryPath, 'utf8') });
    const updated = label + ' updated';
    await check('data update inline', ['data', 'update', entity, id, '--values', JSON.stringify({ label__c: updated })], value => assert.equal(value.values.label__c, updated));
    const updatePath = join(directory, 'update.json');
    writeFileSync(updatePath, JSON.stringify({ values: { helpText__c: 'Updated with optimistic values.' }, expectedValues: { label__c: updated } }));
    await check('data update expectedValues/file', ['data', 'update', '--entity', entity, '--id', id, '--values', '@' + updatePath], value => assert.equal(value.values.helpText__c, 'Updated with optimistic values.'));
    await check('data delete', ['data', 'delete', '--entity', entity, '--id', id]);
    await check('data get after delete', ['data', 'get', entity, id], (_, result) => assert.match(result.stderr, /404|not_found|not found/i), { expectedCode: 1 });
  } else if (phase === 'security') {
    const suffix = report.fixtures.suffix ?? Date.now().toString(36);
    Object.assign(report.fixtures, { suffix, userName: 'cli-' + suffix, roleName: 'custom.cli.' + suffix, permissionSetName: 'custom.cli.' + suffix }); save();
    const { userName, roleName, permissionSetName } = report.fixtures;
    if (!report.fixtures.userCreated) {
      const password = randomBytes(32).toString('base64url'); reporter.secret(password);
      const created = await setupApi('POST', base + '/users', { userName, name: 'CLI verification ' + suffix, password });
      writePrivate(join(directory, 'test-account.json'), JSON.stringify({ userName, password }, null, 2));
      report.fixtures.userId = created.userId; report.fixtures.userCreated = true; save();
    }
    if (!report.fixtures.roleCreated) { await setupApi('POST', base + '/roles', { name: roleName, label: 'CLI verification role', helpText: 'Dedicated local CLI verification fixture.' }); report.fixtures.roleCreated = true; save(); }
    if (!report.fixtures.permissionSetCreated) { await setupApi('POST', base + '/permission-sets', { name: permissionSetName, label: 'CLI verification permission set', helpText: 'Dedicated local CLI verification fixture.' }); report.fixtures.permissionSetCreated = true; save(); }
    const permission = 'platform.entity.customer.read';
    await check('security user show', ['security', 'user', 'show', '--user', userName], value => assert.equal(value.userName, userName));
    await check('security role show', ['security', 'role', 'show', '--role', roleName], value => assert.equal(value.roleName, roleName));
    await check('security permission-set show', ['security', 'permission-set', 'show', '--permission-set', permissionSetName], value => assert.equal(value.permissionSetName, permissionSetName));
    await check('permission-set grant-permission', ['security', 'permission-set', 'grant-permission', '--permission-set', permissionSetName, '--permissions', permission], value => assert.ok(value.permissions.includes(permission)));
    await check('role grant-permission-set', ['security', 'role', 'grant-permission-set', '--role', roleName, '--permission-sets', permissionSetName], value => assert.ok(value.permissionSets.includes(permissionSetName)));
    await check('user grant-role', ['security', 'user', 'grant-role', '--user', userName, '--roles', roleName], value => assert.ok(value.roles.includes(roleName)));
    await check('user grant-permission-set', ['security', 'user', 'grant-permission-set', '--user', userName, '--permission-sets', permissionSetName], value => assert.ok(value.permissionSets.includes(permissionSetName)));
    await check('user revoke-role', ['security', 'user', 'revoke-role', '--user', userName, '--roles', roleName], value => assert.ok(!value.roles.includes(roleName)));
    await check('user revoke-permission-set', ['security', 'user', 'revoke-permission-set', '--user', userName, '--permission-sets', permissionSetName], value => assert.ok(!value.permissionSets.includes(permissionSetName)));
    await check('role revoke-permission-set', ['security', 'role', 'revoke-permission-set', '--role', roleName, '--permission-sets', permissionSetName], value => assert.ok(!value.permissionSets.includes(permissionSetName)));
    await check('permission-set revoke-permission', ['security', 'permission-set', 'revoke-permission', '--permission-set', permissionSetName, '--permissions', permission], value => assert.ok(!value.permissions.includes(permission)));
  } else if (phase === 'app') {
    const namespace = report.fixtures.namespace ?? 'cli' + Date.now().toString(36);
    report.fixtures.namespace = namespace;
    const appDir = join(directory, 'application'); mkdirSync(appDir, { recursive: true });
    report.fixtures.applicationDirectory = appDir; save();
    const source = join(appDir, 'source.json'), output = join(appDir, 'first.appkg');
    if (!existsSync(source)) await check('app init', ['app', 'init', '--namespace', namespace, '--label', 'Node CLI verification', '--dir', appDir]);
    const sourceData = JSON.parse(readFileSync(source));
    Object.assign(report.fixtures, { packageId: sourceData.packageId, versionId: sourceData.versionId }); save();
    await check('app check', ['app', 'check', '--source', source]);
    if (!existsSync(output)) await check('app build', ['app', 'build', '--source', source, '--output', output], value => assert.equal(value.packageSha256, sha256(readFileSync(output))));
    await check('app build refuses overwrite', ['app', 'build', '--source', source, '--output', output], (_, result) => assert.match(result.stderr, /already exists/), { expectedCode: 1 });
    await check('platform app publish', ['app', 'publish', '--file', output], value => assert.equal(value.versionId, sourceData.versionId));
    await check('platform app status', ['app', 'status', '--package', namespace], value => assert.ok(value.versions.some(v => v.id === sourceData.versionId)));
    await check('platform app status machine array', ['app', 'status', '--package', namespace, '--json'], value => assert.ok(value.data.length === 1 && value.data[0].versions.some(v => v.id === sourceData.versionId)));
    const nextSource = join(appDir, 'source-next.json'), nextOutput = join(appDir, 'next.appkg');
    if (!existsSync(nextSource)) writeFileSync(nextSource, JSON.stringify({ ...sourceData, versionId: randomId('apv'), version: '1.0.1' }, null, 2));
    const nextData = JSON.parse(readFileSync(nextSource));
    report.fixtures.nextVersionId = nextData.versionId; save();
    if (!existsSync(nextOutput)) await check('app build next version', ['app', 'build', '--source', nextSource, '--output', nextOutput]);
    await check('platform publish version update', ['app', 'publish', '--file', nextOutput], value => assert.equal(value.versionId, nextData.versionId));
    await check('platform status version history', ['app', 'status', '--package', namespace], value => assert.ok(value.versions.length >= 2));
  } else if (phase === 'market') {
    const { namespace, versionId, nextVersionId, applicationDirectory } = report.fixtures;
    assert.ok(namespace && versionId && nextVersionId);
    await check('market app publish', ['app', 'publish', '--file', join(applicationDirectory, 'first.appkg'), '--exchange', exchange, '--profile', 'skill-market'], value => assert.equal(value.versionId, versionId));
    await check('market app status', ['app', 'status', '--package', namespace, '--exchange', exchange, '--profile', 'skill-market'], value => assert.ok(value.versions.some(v => v.id === versionId)));
    await check('market publish version update', ['app', 'publish', '--file', join(applicationDirectory, 'next.appkg'), '--exchange', exchange, '--profile', 'skill-market'], value => assert.equal(value.versionId, nextVersionId));
    await check('market status version history', ['app', 'status', '--package', namespace, '--exchange', exchange, '--profile', 'skill-market'], value => assert.ok(value.versions.length >= 2));
  } else if (phase === 'end') {
    await check('market app logout', ['app', 'logout', '--exchange', exchange, '--profile', 'skill-market']);
    await check('market requires login after logout', ['app', 'status', '--exchange', exchange, '--profile', 'skill-market'], (_, result) => assert.match(result.stderr, /Market login is required/), { expectedCode: 1 });
    await check('platform app logout', ['app', 'logout', '--profile', 'skill-live']);
    await check('platform requires login after logout', ['app', 'status', '--profile', 'skill-live'], (_, result) => assert.match(result.stderr, /App login is required/), { expectedCode: 1 });
    await check('top-level logout', ['logout', '--profile', 'skill-live']);
    assert.ok(!store.load().profiles['skill-live']);
  } else if (phase === 'report') {
    const failed = report.checks.filter(item => item.status !== 'passed');
    const missing = required.filter(name => !report.checks.some(item => item.name === name && item.status === 'passed'));
    state.summarize(required);
    report.browserEvidence = 'default-browser-login.jpg';
    save();
    reporter.print({ ...report.summary, failures: failed, fixtures: report.fixtures, reportPath });
    phaseCode = failed.length || missing.length ? 1 : 0;
  } else throw new Error('Unknown live verification phase.');
} catch (error) { reporter.print(error.message, true); phaseCode = 1; }
finally { state.phase(phase, phaseCode === 0 ? 'passed' : 'failed'); }
return phaseCode;
} finally { release(); }
} catch (error) { reporter.print(error.message, true); return 1; }
}

process.exitCode = await main();
