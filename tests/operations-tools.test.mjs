import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { inspectLaunch } from '../skills/workforce-runtime/scripts/inspect-launch.mjs';
import { inspectOperation } from '../skills/xrain-app-operations/scripts/inspect-operation.mjs';
import { summarizeHistory } from '../skills/workforce-agent-troubleshoot/scripts/summarize-history.mjs';

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
  const otherTenant = structuredClone(value); otherTenant.installation.tenantId = 'tenant-other';
  const mismatched = inspectOperation(otherTenant);
  assert.equal(mismatched.installedVersionMatchesTarget, true);
  assert(mismatched.blockers.includes('tenant-mismatch'));
  assert.equal(mismatched.next, 'reconcile-evidence-before-mutation');
  assert(!Object.hasOwn(mismatched, 'installationMatchesTarget'));
  value.check.revision = 4;
  assert(inspectOperation(value).blockers.includes('runtime-check-stale-or-mismatched'));
  value.installation.installedVersionId = 'apv-other';
  assert(inspectOperation(value).blockers.includes('successful-operation-not-current-installation'));
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
test('launch inspector resolves registration bases, separates origins, and does not read app secrets', async t => {
  const root = await temporary(t);
  await mkdir(join(root, '.workforce')); await mkdir(join(root, 'scripts'));
  await mkdir(join(root, 'custom app/scripts'), { recursive: true });
  const command = 'node scripts/start-development.mjs';
  await writeFile(join(root, 'package.json'), JSON.stringify({ scripts: { start: command, dev: command, debug: command } }));
  await writeFile(join(root, '.workforce/development-launch.json'), JSON.stringify({
    applicationDirectory: 'custom app', applicationConfiguration: 'settings.json', connectionScript: 'connect.py', proxyScript: 'proxy.mjs', proxyTlsConfiguration: 'tls.json',
    applicationUrl: 'http://localhost:4870/private?token=SYNTHETIC_QUERY', browserUrl: 'https://localhost:9443/browser#SYNTHETIC_FRAGMENT'
  }));
  for (const name of ['custom app/settings.json', 'custom app/scripts/start-development.mjs', 'connect.py', 'proxy.mjs', 'tls.json', 'scripts/start-development.mjs']) await writeFile(join(root, name), 'SYNTHETIC_APP_SECRET');
  const result = await inspectLaunch(root);
  assert.equal(result.paths.applicationConfiguration.path, resolve(root, 'custom app/settings.json'));
  assert.equal(result.applicationOrigin, 'http://localhost:4870'); assert.equal(result.browserOrigin, 'https://localhost:9443');
  assert.equal(result.readyToInvoke, true); assert.equal(result.entry.aliasesMatch, true); assert.equal(result.runtimeHealth, 'not-checked');
  assert.equal(result.connectionRuntime, 'python');
  assert.equal(result.paths.startScript.path, resolve(root, 'scripts/start-development.mjs'));
  assert(!JSON.stringify(result).includes('SYNTHETIC_'));
  await rm(join(root, 'connect.py'));
  assert.equal((await inspectLaunch(root)).readyToInvoke, false);
});
test('launch inspector follows custom registration and Node entry without reading TLS or app secrets', async t => {
  const root = await temporary(t);
  await mkdir(join(root, 'config')); await mkdir(join(root, 'app/scripts'), { recursive: true });
  const command = 'node "entry with spaces.mjs"';
  await writeFile(join(root, 'package.json'), JSON.stringify({ scripts: { start: command, 'start:local': command, 'start:ui': command } }));
  const config = { applicationDirectory: 'app', applicationConfiguration: 'settings.json', connectionScript: 'connect.mjs', proxyScript: 'proxy.mjs', applicationUrl: 'http://localhost:4800', browserUrl: 'http://localhost:4900' };
  await writeFile(join(root, 'config/custom.json'), '\uFEFF' + JSON.stringify(config));
  for (const name of ['entry with spaces.mjs', 'app/scripts/start-development.mjs', 'app/settings.json', 'connect.mjs', 'proxy.mjs']) await writeFile(join(root, name), 'SYNTHETIC_NOT_EXECUTABLE_SECRET');
  const result = await inspectLaunch(root, 'config/custom.json');
  assert.equal(result.readyToInvoke, true); assert.equal(result.connectionRuntime, 'node');
  assert.equal(result.paths.applicationDirectory.path, join(root, 'app'));
  assert.equal(result.paths.startScript.path, join(root, 'entry with spaces.mjs'));
  assert(!Object.hasOwn(result.paths, 'proxyTlsConfiguration'));
  const isolated = join(root, 'isolated inspector.mjs');
  await cp(new URL('../skills/workforce-runtime/scripts/inspect-launch.mjs', import.meta.url), isolated);
  const run = spawnSync(process.execPath, [isolated, root, 'config/custom.json'], { cwd: root, encoding: 'utf8', windowsHide: true });
  assert.equal(run.status, 0, run.stderr); assert.equal(JSON.parse(run.stdout).readyToInvoke, true);
  assert(!run.stdout.includes('SYNTHETIC_'));
  config.browserUrl = 'https://localhost:4900';
  await writeFile(join(root, 'config/custom.json'), JSON.stringify(config));
  const missingTls = await inspectLaunch(root, 'config/custom.json');
  assert.equal(missingTls.readyToInvoke, false); assert.equal(missingTls.paths.proxyTlsConfiguration.exists, false);
});
test('launch inspector rejects legacy entry, unsupported connector, missing application entry and alias drift', async t => {
  const root = await temporary(t);
  await mkdir(join(root, '.workforce')); await mkdir(join(root, 'app/scripts'), { recursive: true });
  const config = { applicationDirectory: 'app', applicationConfiguration: 'settings.json', connectionScript: 'connect.py', proxyScript: 'proxy.mjs', applicationUrl: 'http://localhost:4800', browserUrl: 'http://localhost:4900' };
  const registration = join(root, '.workforce/development-launch.json');
  await writeFile(registration, JSON.stringify(config));
  for (const name of ['start.mjs', 'Start-Development.ps1', 'app/scripts/start-development.mjs', 'app/settings.json', 'connect.py', 'connect.ps1', 'proxy.mjs']) await writeFile(join(root, name), '');
  const packagePath = join(root, 'package.json');
  await writeFile(packagePath, JSON.stringify({ scripts: { start: 'pwsh -File Start-Development.ps1' } }));
  assert.equal((await inspectLaunch(root)).entry.registered, false);
  await writeFile(packagePath, JSON.stringify({ scripts: { start: 'node start.mjs', 'start:ui': 'node obsolete.mjs' } }));
  assert.equal((await inspectLaunch(root)).readyToInvoke, false);
  await writeFile(packagePath, JSON.stringify({ scripts: { start: 'node start.mjs' } }));
  config.connectionScript = 'connect.ps1'; await writeFile(registration, JSON.stringify(config));
  assert.equal((await inspectLaunch(root)).connectionRuntime, 'unsupported');
  assert.equal((await inspectLaunch(root)).readyToInvoke, false);
  config.connectionScript = 'connect.py'; await writeFile(registration, JSON.stringify(config));
  await rm(join(root, 'app/scripts/start-development.mjs'));
  assert.equal((await inspectLaunch(root)).readyToInvoke, false);
  assert.deepEqual(JSON.parse(await readFile(registration, 'utf8')), config);
});
test('new helpers execute after isolated copies and reject invalid inputs without echoing contents', async t => {
  const root = await temporary(t);
  for (const [skill, script, extra] of [
    ['xrain-app-operations', 'inspect-operation.mjs', []],
    ['workforce-agent-troubleshoot', 'summarize-history.mjs', ['--after-seq', '0']],
    ['workforce-runtime', 'inspect-launch.mjs', []]
  ]) {
    const installed = join(root, skill);
    await cp(new URL('../skills/' + skill + '/', import.meta.url), installed, { recursive: true });
    const input = join(root, skill + '.json'); await writeFile(input, 'SYNTHETIC_PRIVATE_INVALID_JSON');
    const run = spawnSync(process.execPath, [join(installed, 'scripts', script), input, ...extra], { cwd: root, encoding: 'utf8', windowsHide: true, env: { ...process.env, NODE_PATH: '', NODE_OPTIONS: '' } });
    assert.equal(run.status, 2); assert.equal(run.stdout, ''); assert(!run.stderr.includes('SYNTHETIC_PRIVATE'));
  }
});
