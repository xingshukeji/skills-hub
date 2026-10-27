import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { existsSync, realpathSync } from 'node:fs';
import { inspectOperation } from './inspect-operation.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => Object.hasOwn(value, key);
const segment = value => typeof value === 'string' && /^[\w.$:-]{1,160}$/.test(value);
function requireInput(value, code) { if (!value) { const error = new Error(code); error.code = code; throw error; } }
function fields(value, allowed, code) { requireInput(object(value) && Object.keys(value).every(key => allowed.includes(key)), code); }
function key(recordId, member) {
  requireInput(segment(recordId) && segment(member), 'invalid-choice-key');
  return recordId + '/' + member;
}
function index(rows, member) {
  requireInput(Array.isArray(rows), 'invalid-requirements');
  const result = new Map();
  for (const row of rows) {
    requireInput(object(row), 'invalid-requirements');
    const id = key(row.recordId, row[member]);
    requireInput(!result.has(id), 'duplicate-requirement'); result.set(id, row);
  }
  return result;
}
function jsonValue(value) {
  try {
    const serialized = JSON.stringify(value);
    requireInput(serialized !== undefined, 'invalid-json-value');
    return JSON.parse(serialized);
  } catch { requireInput(false, 'invalid-json-value'); }
}

// Prepare only reviewed input for an existing waiting operation. No network or approval decisions.
export function prepareResolution(bundle) {
  let inspection;
  try { inspection = inspectOperation(bundle); } catch { requireInput(false, 'invalid-receipt'); }
  requireInput(!inspection.blockers.length, 'receipt-requires-reconciliation');
  const { installation, operation, selections } = bundle;
  requireInput(operation?.status === 'WaitingForResolution', 'operation-not-waiting');
  requireInput(installation.activeOperationId === operation.id, 'operation-not-active');
  requireInput(operation.errorCode !== 'managed_policy_upgrade_required', 'policy-migration-required');
  fields(selections, ['bindings', 'configuration', 'confirmations'], 'invalid-selections');
  const selected = {};
  for (const name of ['bindings', 'configuration', 'confirmations']) {
    selected[name] = selections[name] ?? [];
    requireInput(Array.isArray(selected[name]), 'invalid-selections');
  }
  const bindings = index(operation.details.requiredBindings, 'binding');
  const confirmations = index(operation.details.requiredConfirmations, 'unit');
  const conflicts = index(operation.details.conflicts, 'unit');
  for (const conflict of conflicts.values()) {
    requireInput(conflict.unit === '$configuration' && conflict.isDeletion === false &&
      Array.isArray(conflict.editableProperties) && conflict.editableProperties.length > 0 &&
      conflict.editableProperties.every(segment), 'use-managed-editor-for-conflict');
  }
  const tenantBindings = Object.create(null), configurationChanges = Object.create(null), acceptedConfirmations = [];
  for (const row of selected.bindings) {
    fields(row, ['recordId', 'binding', 'value'], 'invalid-binding-choice');
    const id = key(row.recordId, row.binding);
    requireInput(bindings.has(id), 'binding-not-requested');
    requireInput(!own(tenantBindings, id), 'duplicate-binding-choice');
    requireInput(own(row, 'value'), 'binding-value-missing');
    tenantBindings[id] = jsonValue(row.value);
  }
  requireInput(bindings.size === Object.keys(tenantBindings).length, 'binding-choice-missing');
  const resolvedRecords = new Set();
  for (const row of selected.configuration) {
    fields(row, ['recordId', 'property', 'present', 'value'], 'invalid-configuration-choice');
    const id = key(row.recordId, row.property), conflict = conflicts.get(key(row.recordId, '$configuration'));
    requireInput(conflict?.editableProperties.includes(row.property), 'property-not-editable');
    requireInput(!own(configurationChanges, id), 'duplicate-configuration-choice');
    requireInput(typeof row.present === 'boolean' && own(row, 'value') === row.present, 'invalid-configuration-presence');
    configurationChanges[id] = row.present ? { present: true, value: jsonValue(row.value) } : { present: false };
    resolvedRecords.add(row.recordId);
  }
  requireInput(resolvedRecords.size === conflicts.size, 'configuration-choice-missing');
  const acceptedKeys = new Set();
  for (const row of selected.confirmations) {
    fields(row, ['recordId', 'unit'], 'invalid-confirmation-choice');
    const id = key(row.recordId, row.unit), required = confirmations.get(id);
    requireInput(required && typeof required.token === 'string' && required.token.length > 0, 'confirmation-not-requested');
    requireInput(!acceptedKeys.has(id), 'duplicate-confirmation-choice'); acceptedKeys.add(id);
    acceptedConfirmations.push({ recordId: row.recordId, unit: row.unit, token: required.token });
  }
  requireInput(acceptedKeys.size === confirmations.size, 'confirmation-choice-missing');
  requireInput(bindings.size + conflicts.size + confirmations.size > 0, 'no-resolution-input');
  const body = { expectedRevision: installation.revision };
  if (bindings.size) body.tenantBindings = tenantBindings;
  if (conflicts.size) body.configurationChanges = configurationChanges;
  if (confirmations.size) body.confirmations = acceptedConfirmations;
  return { method: 'POST', path: '/api/application/v1/operations/' + operation.id + '/resolve', body,
    counts: { bindings: bindings.size, configurationProperties: Object.keys(configurationChanges).length, confirmations: confirmations.size },
    serviceValidationPending: true, businessVerified: false };
}

if (process.argv[1] && existsSync(process.argv[1]) && import.meta.url === pathToFileURL(realpathSync(resolve(process.argv[1]))).href) {
  if (process.argv.length === 3 && process.argv[2] === '--help') {
    console.log('Usage: node prepare-resolution.mjs INPUT.json --output NEW_PRIVATE_BODY.json\nPrepare reviewed binding/configuration/confirmation input for an existing waiting operation. No requests are sent. See references/receipt.md.');
  } else {
    try {
      requireInput(process.argv.length === 5 && process.argv[3] === '--output', 'invalid-arguments');
      const raw = await readFile(process.argv[2], 'utf8'); requireInput(raw.length <= 8 * 1024 * 1024, 'input-too-large');
      const result = prepareResolution(JSON.parse(raw));
      await writeFile(process.argv[4], JSON.stringify(result.body, null, 2) + '\n', { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      console.log(JSON.stringify({ method: result.method, path: result.path, bodyFileWritten: true, counts: result.counts,
        serviceValidationPending: true, businessVerified: false }, null, 2));
    } catch (error) {
      const codes = new Set(['invalid-arguments', 'input-too-large', 'invalid-receipt', 'receipt-requires-reconciliation', 'operation-not-waiting',
        'operation-not-active', 'policy-migration-required', 'invalid-selections', 'invalid-requirements', 'invalid-choice-key', 'duplicate-requirement',
        'use-managed-editor-for-conflict', 'invalid-binding-choice', 'binding-not-requested', 'duplicate-binding-choice', 'binding-value-missing',
        'invalid-json-value', 'binding-choice-missing', 'invalid-configuration-choice', 'property-not-editable', 'duplicate-configuration-choice',
        'invalid-configuration-presence', 'configuration-choice-missing', 'invalid-confirmation-choice', 'confirmation-not-requested',
        'duplicate-confirmation-choice', 'confirmation-choice-missing', 'no-resolution-input']);
      const code = error.code === 'EEXIST' ? 'output-exists' : codes.has(error.code) ? error.code : 'invalid-or-unavailable-input';
      console.error('Cannot prepare resolve request (' + code + '). No request was sent.'); process.exitCode = 2;
    }
  }
}
