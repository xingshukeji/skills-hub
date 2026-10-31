import { equalIgnoreCase, isObject, nonempty } from './core.mjs';

const base = '/api/metadata/v1';
const entity = base + '/entities/{entity}';
const match = { 'If-Match': 'if-match' };
const create = { ...match, 'Idempotency-Key': 'request-key' };
const remove = { ...match, 'X-Impact-Token': 'impact-token' };
const define = (path, method, route, options = {}) => ({ path: 'metadata ' + path, method, route, readback: ['metadata', 'entities'], ...options });
const versioned = value => isObject(value) && Number.isSafeInteger(value.metadataRevision) && value.metadataRevision >= 0 && nonempty(value.etag);
const mutation = kind => (value, { args, body }) => {
  if (!versioned(value) || !isObject(value.object) || !nonempty(value.object.objectId) || !nonempty(value.object.entityApiName)) return false;
  const expectedEntity = args.value('entity') ?? body?.entityApiName;
  if (expectedEntity && ![value.object.entityApiName, value.object.entityCode].some(name => equalIgnoreCase(name, expectedEntity))) return false;
  if (kind === 'object') return true;
  const expectedField = body?.fieldApiName ?? args.value('field');
  return isObject(value.field) && nonempty(value.field.fieldId) && nonempty(value.field.fieldApiName) &&
    (!expectedField || equalIgnoreCase(value.field.fieldApiName, expectedField));
};

export const metadataOperations = [
  define('entity list', 'GET', base + '/objects', { responseHeaders: ['etag'] }),
  define('entity business-objects', 'GET', base + '/business-objects', { responseHeaders: ['etag'] }),
  define('entity show', 'GET', entity + '/describe', { responseHeaders: ['etag'] }),
  define('entity create', 'POST', base + '/entities', { input: 'object', headers: create, validate: mutation('object') }),
  define('entity update', 'PATCH', entity, { input: 'object', headers: match, validate: mutation('object') }),
  define('entity delete-impact', 'GET', entity + '/delete-impact'),
  define('entity delete', 'DELETE', entity, { headers: remove }),
  define('field list', 'GET', entity + '/fields', { responseHeaders: ['etag'] }),
  define('field create', 'POST', entity + '/fields', { input: 'object', headers: create, validate: mutation('field') }),
  define('field update', 'PATCH', entity + '/fields/{field}', { input: 'object', headers: match, validate: mutation('field') }),
  define('field delete-impact', 'GET', entity + '/fields/{field}/delete-impact'),
  define('field delete', 'DELETE', entity + '/fields/{field}', { headers: remove }),
  define('field reconcile-permissions', 'POST', entity + '/fields/{field}:reconcilePermissions'),
  define('field retry-deployment', 'POST', entity + '/fields/{field}:retryDeployment', { headers: match, validate: mutation('field') }),
  define('field revise-deployment', 'PATCH', entity + '/fields/{field}/failed-deployment', { input: 'object', headers: create, validate: mutation('field') }),
  define('field abandon-deployment', 'DELETE', entity + '/fields/{field}/failed-deployment', { headers: match,
    validate: (value, { args }) => versioned(value) && nonempty(value.fieldId) && equalIgnoreCase(value.fieldApiName, args.value('field')) && typeof value.fieldRemoved === 'boolean' }),
  define('view list', 'GET', entity + '/views', { responseHeaders: ['etag'] }),
  define('view field-catalog', 'GET', entity + '/view-field-catalog', { responseHeaders: ['etag'] }),
  define('view show', 'GET', entity + '/views/{view}'),
  define('view query', 'GET', entity + '/views/{view}/runtime-query'),
  define('view create', 'POST', entity + '/views', { input: 'object', headers: match }),
  define('view patch', 'PATCH', entity + '/views/{view}', { input: 'object', headers: match }),
  define('view update', 'PUT', entity + '/views/{view}', { input: 'object', headers: match }),
  define('view delete', 'DELETE', entity + '/views/{view}', { headers: match }),
  define('entity permission', 'GET', entity + '/permission'),
  define('entity access-governance', 'GET', entity + '/access-governance'),
  ...[['sharing-rule', '/sharing-rules'], ['sharing-formula', '/sharing-rule-formulas']].flatMap(([name, suffix]) => [
    define(`${name} list`, 'GET', base + suffix), define(`${name} show`, 'GET', `${base}${suffix}/{id}`),
    define(`${name} create`, 'POST', base + suffix, { input: 'object' }),
    define(`${name} update`, 'PUT', `${base}${suffix}/{id}`, { input: 'object' }),
    define(`${name} delete`, 'DELETE', `${base}${suffix}/{id}`),
  ]),
  define('sharing-rule patch', 'PATCH', base + '/sharing-rules/{id}', { input: 'object' }),
  ...[['record-type', '/record-types'], ['trigger', '/triggers']].flatMap(([name, suffix]) => [
    define(`${name} list`, 'GET', entity + suffix), define(`${name} create`, 'POST', entity + suffix, { input: 'object' }),
    define(`${name} update`, 'PUT', `${entity}${suffix}/{id}`, { input: 'object' }),
    define(`${name} delete`, 'DELETE', `${entity}${suffix}/{id}`),
  ]),
  define('record-type patch', 'PATCH', entity + '/record-types/{id}', { input: 'object' }),
  define('record-type picklist-options', 'GET', entity + '/record-types/picklist-options', { query: ['recordTypeId'] }),
  define('trigger dispatches', 'GET', entity + '/triggers/dispatches', { query: ['triggerId', 'eventType', 'status', 'eventId', 'from', 'to', 'toExclusive', 'page', 'pageSize'] }),
  define('picklist list', 'GET', base + '/picklists', { query: ['page', 'pageSize', 'search', 'isActive', 'sources'], queryDefaults: { page: 1, pageSize: 20 } }),
  define('picklist show', 'GET', base + '/picklists/{id}'),
  define('picklist create', 'POST', base + '/picklists', { input: 'object' }),
  define('picklist clone', 'POST', base + '/picklists/{id}/clone', { input: 'object' }),
  define('picklist patch', 'PATCH', base + '/picklists/{id}', { input: 'object' }),
  define('picklist update', 'PUT', base + '/picklists/{id}', { input: 'object' }),
  define('picklist delete', 'DELETE', base + '/picklists/{id}'),
  define('picklist-item list', 'GET', base + '/picklists/{id}/items', { query: ['page', 'pageSize', 'search', 'isActive', 'sources'], queryDefaults: { page: 1, pageSize: 20 } }),
  define('picklist-item create', 'POST', base + '/picklists/{id}/items', { input: 'object' }),
  define('picklist-item patch', 'PATCH', base + '/picklists/{id}/items/{item-id}', { input: 'object' }),
  define('picklist-item update', 'PUT', base + '/picklists/{id}/items/{item-id}', { input: 'object' }),
  define('picklist-item delete', 'DELETE', base + '/picklists/{id}/items/{item-id}'),
  define('dblink catalog', 'GET', base + '/dblink/catalog'),
  define('dblink table', 'GET', base + '/dblink/schemas/{schema}/tables/{table}', { query: ['previewLimit'] }),
];
