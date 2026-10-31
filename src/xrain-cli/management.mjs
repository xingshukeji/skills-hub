import { CliError, isObject, readJsonInput, registerSecrets, segment } from './core.mjs';
import { apiValue, writeOnce } from './http.mjs';
import { securityOperations } from './security-operations.mjs';
import { applicationOperations, hostOperations } from './application-operations.mjs';
import { requireNewCredentialPath, saveCredentialFile } from './store.mjs';
import { resolve } from 'node:path';
import { metadataOperations } from './metadata-operations.mjs';
import { workflowOperations, settingsOperations } from './workflow-operations.mjs';
import { deliveryOperations } from './delivery-operations.mjs';
import { rawOutput } from './raw-response.mjs';

export const managementOperations = [...securityOperations, ...applicationOperations, ...hostOperations, ...metadataOperations, ...workflowOperations, ...settingsOperations, ...deliveryOperations];
export const routeParameters = route => [...route.matchAll(/\{([^}]+)\}/g)].map(match => match[1]);
const pageOptions = new Map([['page', 'page'], ['page-size', 'pageSize'], ['search', 'search'], ['status', 'status']]);
export const operationOptions = operation => [...routeParameters(operation.route),
  ...(operation.credentialOutput || operation.raw ? ['out'] : []),
  ...Object.values(operation.headers ?? {}),
  ...(operation.input ? ['request-json', 'file'] : []),
  ...(operation.query ? ['query-json', ...[...pageOptions].filter(([, key]) => operation.query.includes(key)).map(([key]) => key)] : [])];

function memberOutput(value) {
  if (Array.isArray(value)) return value.map(memberOutput);
  if (!isObject(value)) return value;
  const { accountIsActive: _account, ...item } = value;
  if (Array.isArray(item.items)) item.items = item.items.map(memberOutput);
  return item;
}

export async function managementCommand(ctx) {
  const operation = managementOperations.find(item => item.path === ctx.spec.path);
  if (!operation) return false;
  const { args, reporter } = ctx;
  const profile = ctx.store.resolve(args, !operation.host);
  const credentialOutput = operation.credentialOutput ? resolve(args.required('out')) : undefined;
  if (credentialOutput) requireNewCredentialPath(credentialOutput);
  const headers = Object.fromEntries(Object.entries(operation.headers ?? {}).map(([header, option]) => {
    const value = args.required(option);
    if (!/^[\x20-\x7e]{1,1024}$/.test(value)) throw new CliError(`--${option} must be a printable header value.`, { code: 'invalid_arguments' });
    return [header, value];
  }));
  let route = operation.route.replace(/\{([^}]+)\}/g, (_match, name) => segment(args.required(name))), targetTenantId;
  if (operation.query) {
    const individual = [...pageOptions].filter(([option, key]) => operation.query.includes(key) && args.has(option));
    if (args.has('query-json') && individual.length) throw new CliError('Use a complete --query-json file or individual query options.', { code: 'invalid_arguments' });
    const supplied = args.has('query-json') ? await readJsonInput(args.value('query-json'), 'Query parameters', { stdin: ctx.stdin }) :
      Object.fromEntries(individual.map(([option, key]) => [key, option === 'page' || option === 'page-size' ? args.integer(option) : args.value(option)]));
    if (!isObject(supplied) || Object.keys(supplied).some(key => !operation.query.includes(key)) ||
        Object.values(supplied).some(value => value !== null && !['string', 'number', 'boolean'].includes(typeof value)))
      throw new CliError('Query JSON must use supported parameter names and scalar values.', { code: 'invalid_arguments' });
    const query = { ...operation.queryDefaults, ...supplied };
    for (const key of operation.requiredQuery ?? []) if (query[key] === undefined || query[key] === null || query[key] === '')
      throw new CliError(`Query parameter ${key} is required. Supply --query-json.`, { code: 'invalid_arguments' });
    if (typeof query.tenantId === 'string') targetTenantId = query.tenantId;
    const search = new URLSearchParams(Object.entries(query).filter(([, value]) => value !== null).map(([key, value]) => [key, String(value)]));
    if (search.size) route += '?' + search;
  }
  let body;
  if (operation.input) {
    body = await readJsonInput(args.required('request-json', args.value('file')), 'Request JSON', { stdin: ctx.stdin });
    if (operation.input === 'object' && !isObject(body) || operation.input === 'array' && !Array.isArray(body))
      throw new CliError(`Request JSON must be an ${operation.input}.`, { code: 'invalid_arguments' });
    registerSecrets(reporter, body);
    for (const field of operation.secretInput ?? []) if (typeof body?.[field] === 'string') reporter.secret(body[field]);
  }
  const write = operation.method !== 'GET' && !operation.readOnly;
  const selectors = isObject(body) ? Object.fromEntries(['requestId', 'idempotencyKey', 'whatId', 'operationId', 'versionId', 'applicationId', 'installationId', 'expectedRevision', 'entityCode', 'resourceId', 'recordId', 'subjectUserId', 'catalogKey', 'tokenId']
    .filter(key => ['string', 'number'].includes(typeof body[key])).map(key => [key, body[key]])) : {};
  const mutation = { resource: operation.route, target: { ...Object.fromEntries(['entityApiName', 'fieldApiName'].filter(key => typeof body?.[key] === 'string').map(key => [key, body[key]])),
      ...Object.fromEntries(routeParameters(operation.route).map(name => [name, args.value(name)])) },
      ...(targetTenantId !== undefined ? { targetTenantId } : {}),
      ...(headers['Idempotency-Key'] ? { requestKey: headers['Idempotency-Key'] } : {}),
      ...(headers['If-Match'] ? { ifMatch: headers['If-Match'] } : {}),
      ...selectors, readback: operation.readback ?? ['security', 'directory'] };
  const call = signal => apiValue(ctx, operation.method, route, body, { requireTenant: !operation.host, resolvedProfile: profile, headers, responseHeaders: operation.responseHeaders, sessionOnly: operation.sessionOnly, signal,
    raw: operation.raw, validate: value => (!operation.outcome || ['succeeded', 'failed', 'unknown'].includes(operation.outcome(value))) && (!operation.validate || operation.validate(value, { args, body })),
    ...(write ? { mutation } : {}) });
  const context = { operation: operation.path, profile: profile.name, server: profile.server, tenant: profile.tenant ?? null, ...mutation };
  let value = operation.raw ? await writeOnce(() => rawOutput(ctx, call, context),
    'Debug outcome is unknown. Inspect the original response and any effects before another action; do not replay this request or batch.', context) : await call();
  const outcome = operation.outcome?.(value);
  if (outcome === 'failed' || outcome === 'unknown') throw new CliError(outcome === 'unknown' ? 'The service reported an unknown outcome.' : 'The execution reported failure.', { code: outcome === 'unknown' ? 'outcome_unknown' : 'execution_failed',
    hint: 'Inspect the returned result and any effects before another action. Do not replay the batch.',
    details: { ...context, result: value } });
  if (operation.select) {
    if (!isObject(value) || !Object.hasOwn(value, operation.select)) throw new CliError('The server returned an invalid catalog.', { code: 'invalid_response' });
    value = value[operation.select];
  }
  if (credentialOutput) {
    const token = value?.api_token ?? value?.apiToken;
    if (typeof token !== 'string' || !token) throw new CliError('The server returned an invalid credential receipt.', { code: write ? 'outcome_unknown' : 'invalid_response',
      hint: 'Inspect the existing server token list before issuing another token.', details: { operation: operation.path } });
    reporter.secret(token);
    const metadata = Object.fromEntries(['subjectUserId', 'expiresAtUtc', 'expires_at_utc'].filter(key => value[key] !== undefined).map(key => [key === 'expires_at_utc' ? 'expiresAtUtc' : key, value[key]]));
    try { saveCredentialFile(credentialOutput, token, profile, metadata); }
    catch { throw new CliError('The credential was returned by the server but could not be saved. Inspect the original token list; do not issue another automatically.', { code: 'credential_save_failed', details: { operation: operation.path, ...metadata } }); }
    reporter.print({ output: credentialOutput, ...metadata, protection: process.platform === 'win32' ? 'dpapi-current-user' : 'file-mode-0600' });
    return true;
  }
  reporter.print(operation.members ? memberOutput(value) : value);
  return true;
}
