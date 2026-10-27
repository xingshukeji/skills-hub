import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { prepareResolution } from '../skills/shzw-xrain-app-operations/scripts/prepare-resolution.mjs';
import { request } from '../tools/capability-lab.mjs';
import { cases } from '../evals/workforce/capability-lab-cases.mjs';

function fixture() {
  const state = structuredClone(cases.find(row => row.id === 'l01').seed);
  return { state, bundle: { target: state.target, installation: state.installation, operation: state.operation,
    selections: { bindings: [{ recordId: 'apr-connector', binding: 'baseAddress', value: 'https://orders.example.invalid' }],
      configuration: [{ recordId: 'apr-view', property: 'fieldNames', present: true, value: ['name', 'amount'] }], confirmations: [] } } };
}

test('prepared managed configuration reaches the target while preserving tenant properties', () => {
  const { state, bundle } = fixture(), original = structuredClone(bundle);
  const prepared = prepareResolution(bundle);
  assert.deepEqual(bundle, original);
  assert.equal(prepared.method, 'POST');
  assert.equal(prepared.path, '/api/application/v1/operations/apo-1/resolve');
  assert.deepEqual(JSON.parse(JSON.stringify(prepared.body)), { expectedRevision: 7,
    tenantBindings: { 'apr-connector/baseAddress': 'https://orders.example.invalid' },
    configurationChanges: { 'apr-view/fieldNames': { present: true, value: ['name', 'amount'] } } });
  assert.equal(request(state, prepared.method, prepared.path, prepared.body).status, 200);
  assert.equal(state.operation.status, 'Succeeded'); assert.equal(state.installation.installedVersionId, 'apv-2');
  assert.equal(state.label, original.operation.details.conflicts[0].tenantValue.label);
  assert.deepEqual(state.fieldNames, ['name', 'amount']);
  assert.equal(prepared.businessVerified, false); assert.equal(prepared.serviceValidationPending, true);
});

test('confirmation tokens require explicit matching choices and use the current receipt', () => {
  const { bundle } = fixture();
  bundle.operation.details.requiredConfirmations = [{ recordId: 'apr-sec', unit: 'permissions', token: 'SYNTHETIC_CURRENT_TOKEN' }];
  assert.throws(() => prepareResolution(bundle), /confirmation-choice-missing/);
  bundle.selections.confirmations = [{ recordId: 'apr-sec', unit: 'permissions', token: 'SYNTHETIC_OLD_TOKEN' }];
  assert.throws(() => prepareResolution(bundle), /invalid-confirmation-choice/);
  bundle.selections.confirmations = [{ recordId: 'apr-sec', unit: 'permissions' }];
  assert.deepEqual(prepareResolution(bundle).body.confirmations, [{ recordId: 'apr-sec', unit: 'permissions', token: 'SYNTHETIC_CURRENT_TOKEN' }]);
  bundle.selections.confirmations.push({ recordId: 'apr-sec', unit: 'permissions' });
  assert.throws(() => prepareResolution(bundle), /duplicate-confirmation-choice/);
});

test('old property merges, uneditable changes and ambiguous presence cannot become requests', () => {
  const { bundle } = fixture();
  const generic = structuredClone(bundle); generic.operation.details.conflicts[0].unit = 'Label';
  assert.throws(() => prepareResolution(generic), /use-managed-editor-for-conflict/);
  const selection = structuredClone(bundle); selection.selections.resolutions = [{ recordId: 'apr-view', unit: 'Label', resolution: 'KeepTenant' }];
  assert.throws(() => prepareResolution(selection), /invalid-selections/);
  const readonly = structuredClone(bundle); readonly.selections.configuration[0].property = 'name';
  assert.throws(() => prepareResolution(readonly), /property-not-editable/);
  const absent = structuredClone(bundle); absent.selections.configuration[0].present = false;
  assert.throws(() => prepareResolution(absent), /invalid-configuration-presence/);
  delete absent.selections.configuration[0].value;
  assert.deepEqual(prepareResolution(absent).body.configurationChanges['apr-view/fieldNames'], { present: false });
});

test('unfinished, duplicate, stale, cross-tenant or inactive inputs fail before a body is produced', () => {
  for (const [mutate, code] of [
    [value => { value.selections.bindings = []; }, 'binding-choice-missing'],
    [value => { value.selections.configuration = []; }, 'configuration-choice-missing'],
    [value => { value.selections.bindings.push(value.selections.bindings[0]); }, 'duplicate-binding-choice'],
    [value => { value.selections.bindings[0].recordId = 'not-requested'; }, 'binding-not-requested'],
    [value => { value.installation.revision++; }, 'receipt-requires-reconciliation'],
    [value => { value.installation.tenantId = 'other-tenant'; }, 'receipt-requires-reconciliation'],
    [value => { value.installation.activeOperationId = null; }, 'operation-not-active'],
    [value => { value.operation.status = 'Running'; }, 'operation-not-waiting'],
    [value => { value.operation.errorCode = 'managed_policy_upgrade_required'; }, 'policy-migration-required']
  ]) {
    const { bundle } = fixture(); mutate(bundle);
    assert.throws(() => prepareResolution(bundle), new RegExp(code));
  }
});

test('copied skill prepares private files without stdout secrets and refuses overwrites', async t => {
  const root = await mkdtemp(join(tmpdir(), 'resolve skill '));
  t.after(() => rm(root, { recursive: true, force: true }));
  const skill = join(root, 'copied skill');
  await cp(resolve('skills/shzw-xrain-app-operations'), skill, { recursive: true });
  const { bundle } = fixture();
  bundle.selections.bindings[0].value = 'SYNTHETIC_PRIVATE_BINDING';
  bundle.operation.details.requiredConfirmations = [{ recordId: 'apr-sec', unit: 'permissions', token: 'SYNTHETIC_PRIVATE_CONFIRMATION' }];
  bundle.selections.confirmations = [{ recordId: 'apr-sec', unit: 'permissions' }];
  const input = join(root, 'private input.json'), output = join(root, 'private body.json');
  await writeFile(input, JSON.stringify(bundle));
  const run = args => spawnSync(process.execPath, [join(skill, 'scripts/prepare-resolution.mjs'), ...args], { encoding: 'utf8', cwd: root });
  const first = run([input, '--output', output]); assert.equal(first.status, 0, first.stderr);
  assert(![first.stdout, first.stderr].join('').includes('SYNTHETIC_PRIVATE'));
  const written = await readFile(output, 'utf8'); assert(written.includes('SYNTHETIC_PRIVATE_CONFIRMATION'));
  assert.equal(JSON.parse(first.stdout).businessVerified, false);
  const again = run([input, '--output', output]); assert.equal(again.status, 2); assert.match(again.stderr, /output-exists/);
  assert.equal(await readFile(output, 'utf8'), written);
  bundle.selections.bindings[0].value = { secret: 'SYNTHETIC_PRIVATE_INVALID' };
  bundle.selections.configuration[0].property = 'unsupported';
  await writeFile(input, JSON.stringify(bundle));
  const bad = run([input, '--output', join(root, 'bad body.json')]);
  assert.equal(bad.status, 2); assert(!bad.stderr.includes('SYNTHETIC_PRIVATE'));
  await assert.rejects(readFile(join(root, 'bad body.json')));
  const help = run(['--help']); assert.equal(help.status, 0); assert.match(help.stdout, /No requests are sent/);
});
