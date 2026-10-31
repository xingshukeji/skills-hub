import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, cp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { inspectLaunch } from '../skills/shzw-runtime-operations/modes/workforce/scripts/inspect-launch.mjs';
import { inspectOperation } from '../skills/shzw-xrain-app-package/modes/operations/scripts/inspect-operation.mjs';
import { summarizeHistory } from '../skills/shzw-runtime-operations/modes/agents/scripts/summarize-history.mjs';

async function temporary(t) {
  const directory = await mkdtemp(join(tmpdir(), 'workforce operations '));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
const fixture = (status = 'WaitingForResolution') => ({
  target: { tenantId: 'tenant-demo', packageId: 'apg-demo', versionId: 'apv-new', operationId: 'apo-original' },
  installation: { id: 'api-demo', tenantId: 'tenant-demo', packageId: 'apg-demo', installedVersionId: 'apv-old', revision: 4, activeOperationId: 'apo-original' },
  operation: { id: 'apo-original', installationId: 'api-demo', targetVersionId: 'apv-new', sourceRevision: 4, status,
    details: { requiredBindings: [{ recordId: 'r1', binding: 'credential', value: 'SYNTHETIC_PRIVATE_BINDING' }], requiredConfirmations: [{ token: 'SYNTHETIC_CONFIRMATION' }], conflicts: [] } }
});
test('receipt differentiates resolve, continue, failed retry and explicit resubmission', () => {
  assert.equal(inspectOperation(fixture()).next, 'resolve-original-operation');
  for (const state of ['Running', 'Finalizing']) assert.equal(inspectOperation(fixture(state)).next, 'observe-or-continue-if-interrupted');
  assert.equal(inspectOperation(fixture('Failed')).next, 'retry-with-new-request-after-root-cause');
  const resubmit = fixture('Failed'); resubmit.operation.details.result = { requiresResubmission: true };
  assert.equal(inspectOperation(resubmit).next, 'restore-input-and-repreview-before-resubmission');
  const output = JSON.stringify(inspectOperation(fixture()));
  assert(!output.includes('SYNTHETIC_PRIVATE_BINDING') && !output.includes('SYNTHETIC_CONFIRMATION'));
});
test('receipt rejects cross-tenant, wrong operation, active competitor and changed revision evidence', () => {
  for (const [mutate, code] of [
    [x => { x.installation.tenantId = 'tenant-other'; }, 'tenant-mismatch'],
    [x => { x.operation.id = 'apo-other'; }, 'operation-mismatch'],
    [x => { x.installation.activeOperationId = 'apo-concurrent'; }, 'another-active-operation'],
    [x => { x.installation.revision = 5; }, 'source-revision-changed']
  ]) {
    const value = fixture(); mutate(value); const result = inspectOperation(value);
    assert(result.blockers.includes(code)); assert.equal(result.next, 'reconcile-evidence-before-mutation');
  }
  const missing = fixture(); delete missing.operation;
  assert(inspectOperation(missing).evidenceGaps.includes('original-operation-unavailable'));
  assert.throws(() => inspectOperation(fixture('WaitingForBindings')));
});
test('successful installation and Passed object do not conceal NotChecked or stale evidence', () => {
  const value = fixture('Succeeded');
  value.installation.installedVersionId = 'apv-new'; value.installation.revision = 5; value.installation.activeOperationId = null;
  value.check = { tenantId: 'tenant-demo', installationId: 'api-demo', versionId: 'apv-new', revision: 5, scope: 'CurrentActorObjectReadOnly',
    items: [{ status: 'Passed' }, { status: 'NotChecked' }] };
  const result = inspectOperation(value);
  assert.deepEqual(result.checkCounts, { passed: 1, failed: 0, notChecked: 1, unknown: 0 });
  assert.equal(result.businessVerified, false); assert(result.evidenceGaps.includes('runtime-check-incomplete'));
  assert.equal(result.installedVersionMatchesTarget, true);
  assert.equal(result.currentOperationCommitted, true);
  const otherTenant = structuredClone(value); otherTenant.installation.tenantId = 'tenant-other';
  const mismatched = inspectOperation(otherTenant);
  assert.equal(mismatched.installedVersionMatchesTarget, true);
  assert(mismatched.blockers.includes('tenant-mismatch'));
  assert.equal(mismatched.next, 'reconcile-evidence-before-mutation');
  assert.equal(mismatched.currentOperationCommitted, false);
  assert(!Object.hasOwn(mismatched, 'installationMatchesTarget'));
  value.check.revision = 4;
  assert(inspectOperation(value).blockers.includes('runtime-check-stale-or-mismatched'));
  value.installation.installedVersionId = 'apv-other';
  assert(inspectOperation(value).blockers.includes('successful-operation-not-current-installation'));
});
test('successful receipts distinguish an uncommitted revision, an unreleased pointer and missing evidence', () => {
  const succeeded = () => {
    const value = fixture('Succeeded');
    Object.assign(value.installation, { installedVersionId: 'apv-new', revision: 5, activeOperationId: null });
    return value;
  };
  for (const installedRevision of [3, 4]) {
    const value = succeeded(); value.installation.revision = installedRevision;
    const result = inspectOperation(value);
    assert(result.blockers.includes('successful-operation-revision-not-committed'));
    assert.equal(result.next, 'reconcile-evidence-before-mutation');
    assert.equal(result.operationStatus, 'Succeeded');
    assert.equal(result.currentOperationCommitted, false);
  }
  const active = succeeded(); active.installation.activeOperationId = active.operation.id;
  const unreleased = inspectOperation(active);
  assert(unreleased.blockers.includes('successful-operation-still-active'));
  assert.equal(unreleased.currentOperationCommitted, false);
  const incomplete = succeeded(); delete incomplete.installation.activeOperationId;
  const missing = inspectOperation(incomplete);
  assert.deepEqual(missing.blockers, []);
  assert(missing.evidenceGaps.includes('active-operation-pointer-unavailable'));
  assert.equal(missing.next, 'read-current-installation');
  assert.equal(missing.currentOperationCommitted, false);
});
test('later maintenance preserves historical success without proving the current operation committed', () => {
  for (const installedVersionId of ['apv-new', 'apv-later', null]) {
    for (const activeOperationId of [null, 'apo-later']) {
      const value = fixture('Succeeded');
      Object.assign(value.installation, { installedVersionId, revision: 7, activeOperationId });
      const result = inspectOperation(value);
      assert.deepEqual(result.blockers, []);
      assert.equal(result.operationStatus, 'Succeeded');
      assert.equal(result.next, 'read-subsequent-operation-history');
      assert(result.evidenceGaps.includes('installation-advanced-since-success'));
      assert.equal(result.currentOperationCommitted, false);
      assert.equal(result.installedVersionMatchesTarget, installedVersionId === value.target.versionId);
      assert.equal(result.businessVerified, false);
    }
  }
});
test('a committed uninstall has a null version and still needs independent business evidence', () => {
  const value = fixture('Succeeded');
  value.target.versionId = value.operation.targetVersionId = value.installation.installedVersionId = null;
  value.installation.revision = 5; value.installation.activeOperationId = null;
  const result = inspectOperation(value);
  assert.deepEqual(result.blockers, []);
  assert.equal(result.currentOperationCommitted, true);
  assert.equal(result.businessVerified, false);
});
const event = (seq, type, data) => ({ event: { seq, type, data } });
test('history ignores old completed turns and preserves failed tools despite later assistant text', () => {
  const data = { hasMore: false, records: [
    event(4, 'turn/end', { reason: { kind: 'completed' } }),
    event(6, 'user/message', { content: [{ text: 'SYNTHETIC_PRIVATE_USER' }] }),
    event(7, 'tool/call', { callId: 'call-a', name: 'workforce_update_task', arguments: { password: 'SYNTHETIC_PRIVATE_ARGUMENT' } }),
    event(8, 'tool/result', { message: { role: 'tool', toolCallId: 'call-a', isError: true, content: [{ text: 'SYNTHETIC_PRIVATE_RESULT' }] } }),
    event(9, 'assistant/message', { message: { content: [{ text: 'Everything succeeded' }] } })
  ] };
  const result = summarizeHistory(data, 5);
  assert.equal(result.selectedRecords, 4); assert.equal(result.turnsEnded.length, 0); assert.equal(result.failedCalls, 1);
  assert.equal(result.businessVerified, false); assert(!JSON.stringify(result).includes('SYNTHETIC_PRIVATE'));
});
test('history handles V3, pagination, unresolved calls and consistent duplicate pages', () => {
  const call = event(2, 'tool/call', { callId: 'call-a', name: 'read_record' });
  const result = summarizeHistory({ hasMore: true, records: [
    call, event(3, 'tool/result', { message: { content: [{ type: 'tool-result', toolCallId: 'call-a', isError: false }] } }), call,
    event(4, 'tool/call', { callId: 'call-b', name: 'write_record' }),
    event(5, 'tool/result', { message: { role: 'tool', toolCallId: 'outside-page', isError: false } })
  ] }, 1);
  assert.equal(result.duplicateRecords, 1); assert.equal(result.hasOlderPages, true);
  assert.equal(result.toolCalls[0].result, 'succeeded'); assert.equal(result.unresolvedCalls, 1); assert.equal(result.counts.unpairedResults, 1);
  assert.throws(() => summarizeHistory({ hasMore: false, records: [call, event(2, 'assistant/message', {})] }, 1));
  assert.throws(() => summarizeHistory({ records: [] }, 0));
});
async function launchProject(t) {
  const root = await temporary(t);
  await mkdir(join(root, 'config'));
  await mkdir(join(root, 'scripts'));
  await mkdir(join(root, 'app/scripts'), { recursive: true });
  const config = { applicationDirectory: 'app', applicationConfiguration: 'settings.json', url: 'http://localhost:15380' };
  const configuration = join(root, 'config/development.json');
  await writeFile(configuration, JSON.stringify(config));
  const command = 'node scripts/start-development.mjs';
  await writeFile(join(root, 'package.json'), JSON.stringify({ scripts: { start: command, dev: command } }));
  // A synthetic project's public configuration export: the inspector must use
  // its returned paths and never interpret this JSON independently.
  await writeFile(join(root, 'scripts/development-configuration.mjs'), String.raw`
    import { readFile } from 'node:fs/promises';
    import { resolve } from 'node:path';
    export async function developmentConfiguration(configuration, { root }) {
      const input = JSON.parse((await readFile(resolve(root, configuration ?? 'config/development.json'), 'utf8')).replace(/^\uFEFF/u, ''));
      return {
        applicationRoot: resolve(root, input.applicationDirectory),
        applicationConfig: resolve(root, input.applicationDirectory, input.applicationConfiguration),
        connectionScript: input.connectionScript ? resolve(root, input.connectionScript) : null,
        applicationUrl: new URL(input.url),
        environment: { PRIVATE_VALUE: 'SYNTHETIC_CONFIGURATION_SECRET' },
      };
    }
  `);
  for (const name of ['scripts/start-development.mjs', 'app/scripts/start-development.mjs', 'app/settings.json'])
    await writeFile(join(root, name), 'SYNTHETIC_NOT_EXECUTABLE_SECRET');
  return { root, config, configuration };
}

test('launch inspector consumes the project export without requiring a connector, proxy or Markdown', async t => {
  const { root } = await launchProject(t);
  await mkdir(join(root, '.workforce'));
  await writeFile(join(root, '.workforce/development-launch.json'), 'obsolete invalid configuration');
  const result = await inspectLaunch(root);
  assert.equal(result.paths.applicationConfiguration.path, resolve(root, 'app/settings.json'));
  assert.equal(result.applicationOrigin, 'http://localhost:15380');
  assert.equal(result.browserOrigin, result.applicationOrigin);
  assert.equal(result.readyToInvoke, true);
  assert.equal(result.connectionRuntime, 'not-configured');
  assert.equal(result.runtimeHealth, 'not-checked');
  assert.equal(Object.hasOwn(result.paths, 'proxyScript'), false);
  assert.equal(Object.hasOwn(result.paths, 'connectionScript'), false);
  assert(!JSON.stringify(result).includes('SYNTHETIC_'));
});

test('isolated launch inspector follows explicit configuration and reports a missing configured connector', async t => {
  const { root, config } = await launchProject(t);
  const command = 'node "entry with spaces.mjs"';
  await writeFile(join(root, 'package.json'), JSON.stringify({ scripts: { start: command, 'start:local': command, 'start:ui': command } }));
  await writeFile(join(root, 'entry with spaces.mjs'), 'SYNTHETIC_NOT_EXECUTABLE_SECRET');
  Object.assign(config, { connectionScript: 'connect.py', url: 'https://localhost:9443/private?token=SYNTHETIC_QUERY#SYNTHETIC_FRAGMENT' });
  await writeFile(join(root, 'config/custom.json'), '\uFEFF' + JSON.stringify(config));
  const missing = await inspectLaunch(root, 'config/custom.json');
  assert.equal(missing.readyToInvoke, false);
  assert.equal(missing.paths.connectionScript.exists, false);
  await writeFile(join(root, 'connect.py'), 'SYNTHETIC_NOT_EXECUTABLE_SECRET');
  const isolated = join(root, 'isolated inspector.mjs');
  await cp(new URL('../skills/shzw-runtime-operations/modes/workforce/scripts/inspect-launch.mjs', import.meta.url), isolated);
  const run = spawnSync(process.execPath, [isolated, root, 'config/custom.json'], { cwd: root, encoding: 'utf8', windowsHide: true });
  assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(run.stdout);
  assert.equal(result.readyToInvoke, true);
  assert.equal(result.connectionRuntime, 'python');
  assert.equal(result.browserOrigin, 'https://localhost:9443');
  assert.equal(result.paths.startScript.path, join(root, 'entry with spaces.mjs'));
  assert(!Object.hasOwn(result.paths, 'proxyTlsConfiguration'));
  assert(!run.stdout.includes('SYNTHETIC_'));
});

test('launch inspector rejects an obsolete entry, mismatched aliases and unsupported configured connectors', async t => {
  const { root, config, configuration } = await launchProject(t);
  const packagePath = join(root, 'package.json');
  await writeFile(packagePath, JSON.stringify({ scripts: { start: 'pwsh -File Start-Development.ps1' } }));
  assert.equal((await inspectLaunch(root)).entry.registered, false);
  await writeFile(packagePath, JSON.stringify({ scripts: { start: 'node scripts/start-development.mjs', 'start:ui': 'node obsolete.mjs' } }));
  assert.equal((await inspectLaunch(root)).readyToInvoke, false);
  await writeFile(packagePath, JSON.stringify({ scripts: { start: 'node scripts/start-development.mjs' } }));
  config.connectionScript = 'connect.ps1';
  await writeFile(configuration, JSON.stringify(config));
  await writeFile(join(root, 'connect.ps1'), '');
  assert.equal((await inspectLaunch(root)).connectionRuntime, 'unsupported');
  assert.equal((await inspectLaunch(root)).readyToInvoke, false);
  delete config.connectionScript;
  await writeFile(configuration, JSON.stringify(config));
  await rm(join(root, 'app/scripts/start-development.mjs'));
  assert.equal((await inspectLaunch(root)).readyToInvoke, false);
  assert.deepEqual(JSON.parse(await readFile(configuration, 'utf8')), config);
});
test('new helpers execute after isolated copies and reject invalid inputs without echoing contents', async t => {
  const root = await temporary(t);
  for (const [skill, script, extra] of [
    ['shzw-xrain-app-package', 'modes/operations/scripts/inspect-operation.mjs', []],
    ['shzw-runtime-operations', 'modes/agents/scripts/summarize-history.mjs', ['--after-seq', '0']],
    ['shzw-runtime-operations', 'modes/workforce/scripts/inspect-launch.mjs', []]
  ]) {
    const installed = join(root, skill);
    await cp(new URL('../skills/' + skill + '/', import.meta.url), installed, { recursive: true });
    const input = join(root, skill + '.json'); await writeFile(input, 'SYNTHETIC_PRIVATE_INVALID_JSON');
    const run = spawnSync(process.execPath, [join(installed, script), input, ...extra], { cwd: root, encoding: 'utf8', windowsHide: true, env: { ...process.env, NODE_PATH: '', NODE_OPTIONS: '' } });
    assert.equal(run.status, 2); assert.equal(run.stdout, ''); assert(!run.stderr.includes('SYNTHETIC_PRIVATE'));
  }
});

test('copied helpers execute through directory aliases instead of silently exiting', async t => {
  const root = await temporary(t), actual = join(root, 'actual'), alias = join(root, 'directory alias');
  await mkdir(actual);
  await symlink(actual, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const input = join(actual, 'invalid.json');
  await writeFile(input, 'SYNTHETIC_PRIVATE_INVALID_JSON');
  const helpers = [
    ['shzw-runtime-operations', 'modes/workforce/scripts/inspect-launch.mjs', []],
    ['shzw-runtime-operations', 'modes/workforce/scripts/summarize.mjs', []],
    ['shzw-xrain-app-package', 'modes/operations/scripts/inspect-operation.mjs', []],
    ['shzw-xrain-app-package', 'modes/operations/scripts/prepare-resolution.mjs', ['--output', join(actual, 'output.json')]],
    ['shzw-runtime-operations', 'modes/agents/scripts/summarize-history.mjs', ['--after-seq', '0']]
  ];
  for (const skill of new Set(helpers.map(([skill]) => skill)))
    await cp(new URL('../skills/' + skill + '/', import.meta.url), join(actual, skill), { recursive: true });
  for (const [skill, script, args] of helpers) {
    const run = spawnSync(process.execPath, [join(alias, skill, script), input, ...args], { cwd: root, encoding: 'utf8', windowsHide: true });
    assert.equal(run.status, 2, `${script}: ${run.stdout} ${run.stderr}`);
    assert.equal(run.stdout, '');
    assert.ok(!run.stderr.includes('SYNTHETIC_PRIVATE'));
  }
});

test('helper modules remain importable from stdin without invoking their CLI', () => {
  const modules = [
    'shzw-runtime-operations/modes/workforce/scripts/inspect-launch.mjs',
    'shzw-runtime-operations/modes/workforce/scripts/summarize.mjs',
    'shzw-xrain-app-package/modes/operations/scripts/inspect-operation.mjs',
    'shzw-xrain-app-package/modes/operations/scripts/prepare-resolution.mjs',
    'shzw-runtime-operations/modes/agents/scripts/summarize-history.mjs'
  ];
  const input = modules.map(path => `await import(${JSON.stringify(new URL('../skills/' + path, import.meta.url).href)});`).join('\n') + '\nconsole.log("imported");';
  const run = spawnSync(process.execPath, ['--input-type=module', '-'], { input, encoding: 'utf8', windowsHide: true });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout.trim(), 'imported');
  assert.equal(run.stderr, '');
});
