import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { existsSync, realpathSync } from 'node:fs';

const statuses = ['Pending', 'WaitingForResolution', 'Running', 'Finalizing', 'Succeeded', 'Failed', 'Cancelled'];
const object = value => value && typeof value === 'object' && !Array.isArray(value);
function assert(value) { if (!value) throw new Error('Invalid receipt bundle; see references/receipt.md.'); }
const id = value => typeof value === 'string' && /^[\w.:-]{1,160}$/.test(value);
const revision = value => Number.isSafeInteger(value) && value >= 0;
function count(value) { assert(Array.isArray(value)); return value.length; }
export function inspectOperation(bundle) {
  assert(object(bundle) && object(bundle.target) && object(bundle.installation));
  const { target, installation: installed, operation: op, preview, components, check } = bundle;
  assert(id(target.tenantId) && id(target.packageId) && (target.versionId === null || id(target.versionId)));
  assert(id(installed.id) && id(installed.tenantId) && id(installed.packageId) && revision(installed.revision));
  assert(installed.installedVersionId === null || id(installed.installedVersionId));
  if (installed.activeOperationId !== undefined) assert(installed.activeOperationId === null || id(installed.activeOperationId));
  const blockers = [], gaps = [];
  if (target.tenantId !== installed.tenantId) blockers.push('tenant-mismatch');
  if (target.packageId !== installed.packageId) blockers.push('package-mismatch');
  let next = 'read-original-operation', counts = null, currentOperationCommitted = false;
  if (op !== undefined) {
    assert(object(op) && id(op.id) && id(op.installationId) && revision(op.sourceRevision) && statuses.includes(op.status));
    assert(op.targetVersionId === null || id(op.targetVersionId));
    assert(object(op.details));
    counts = { bindings: count(op.details.requiredBindings), confirmations: count(op.details.requiredConfirmations), conflicts: count(op.details.conflicts) };
    if (op.installationId !== installed.id) blockers.push('installation-mismatch');
    if (target.operationId !== undefined) { assert(id(target.operationId)); if (target.operationId !== op.id) blockers.push('operation-mismatch'); }
    if (target.versionId !== op.targetVersionId) blockers.push('target-version-mismatch');
    const historicalSuccess = op.status === 'Succeeded' && installed.revision > op.sourceRevision + 1;
    if (installed.activeOperationId && installed.activeOperationId !== op.id && !historicalSuccess) blockers.push('another-active-operation');
    next = {
      Pending: 'observe-original-operation', WaitingForResolution: 'resolve-original-operation',
      Running: 'observe-or-continue-if-interrupted', Finalizing: 'observe-or-continue-if-interrupted',
      Succeeded: 'verify-installed-components-and-user-action', Failed: 'retry-with-new-request-after-root-cause', Cancelled: 'repreview-if-user-renews-request'
    }[op.status];
    if (['Pending', 'WaitingForResolution', 'Failed'].includes(op.status) && op.sourceRevision !== installed.revision) blockers.push('source-revision-changed');
    if (op.status === 'Failed' && (op.details.result?.requiresResubmission === true || op.errorCode === 'application_operation_resubmission_required')) next = 'restore-input-and-repreview-before-resubmission';
    if (op.status === 'Succeeded') {
      if (installed.revision <= op.sourceRevision) blockers.push('successful-operation-revision-not-committed');
      else if (installed.revision > op.sourceRevision + 1) {
        gaps.push('installation-advanced-since-success');
        next = 'read-subsequent-operation-history';
      } else if (installed.installedVersionId !== op.targetVersionId) blockers.push('successful-operation-not-current-installation');
      if (installed.activeOperationId === op.id) blockers.push('successful-operation-still-active');
      if (installed.activeOperationId === undefined) {
        gaps.push('active-operation-pointer-unavailable');
        next = 'read-current-installation';
      }
      currentOperationCommitted = blockers.length === 0 && installed.revision === op.sourceRevision + 1 &&
        installed.installedVersionId === op.targetVersionId && installed.activeOperationId === null;
    }
  } else gaps.push('original-operation-unavailable');
  if (preview !== undefined) {
    assert(object(preview) && revision(preview.revision) && typeof preview.ready === 'boolean');
    if (preview.tenantId !== target.tenantId || preview.targetVersionId !== target.versionId || (preview.installationId !== null && preview.installationId !== installed.id)) blockers.push('preview-target-mismatch');
    if (preview.revision !== installed.revision) blockers.push('preview-stale');
    if (!preview.ready || count(preview.requiredBindings) + count(preview.requiredConfirmations) + count(preview.conflicts) > 0) gaps.push('preview-needs-resolution');
  }
  if (components !== undefined) {
    assert(object(components) && Array.isArray(components.items));
    if (components.installationId !== installed.id || components.tenantId !== installed.tenantId || components.versionId !== installed.installedVersionId || components.revision !== installed.revision) blockers.push('components-stale-or-mismatched');
    if (components.items.some(item => item.effective !== true)) gaps.push('ineffective-components-require-intent-review');
  } else gaps.push('components-not-checked');
  let checkCounts = null;
  if (check !== undefined) {
    assert(object(check) && Array.isArray(check.items));
    if (check.installationId !== installed.id || check.tenantId !== installed.tenantId || check.versionId !== installed.installedVersionId || check.revision !== installed.revision) blockers.push('runtime-check-stale-or-mismatched');
    checkCounts = { passed: 0, failed: 0, notChecked: 0, unknown: 0 };
    for (const item of check.items) checkCounts[{ Passed: 'passed', Failed: 'failed', NotChecked: 'notChecked' }[item.status] ?? 'unknown']++;
    if (checkCounts.failed) gaps.push('runtime-check-failed');
    if (checkCounts.notChecked || checkCounts.unknown) gaps.push('runtime-check-incomplete');
    if (check.scope !== 'CurrentActorObjectReadOnly') gaps.push('runtime-check-scope-unknown');
  } else gaps.push('runtime-check-not-supplied');
  gaps.push('original-user-business-action-not-proven');
  return { operationStatus: op?.status ?? null, next: blockers.length ? 'reconcile-evidence-before-mutation' : next,
    blockers, evidenceGaps: gaps, required: counts, checkCounts,
    installedVersionMatchesTarget: installed.installedVersionId === target.versionId, currentOperationCommitted, businessVerified: false };
}
if (process.argv[1] && existsSync(process.argv[1]) && import.meta.url === pathToFileURL(realpathSync(resolve(process.argv[1]))).href) {
  try {
    assert(process.argv.length === 3);
    const raw = await readFile(process.argv[2], 'utf8'); assert(raw.length <= 8 * 1024 * 1024);
    const result = inspectOperation(JSON.parse(raw));
    console.log(JSON.stringify(result, null, 2));
    if (result.blockers.length) process.exitCode = 1;
  } catch { console.error('Cannot inspect receipt bundle; see references/receipt.md.'); process.exitCode = 2; }
}
