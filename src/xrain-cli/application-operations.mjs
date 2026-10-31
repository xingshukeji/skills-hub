const applications = '/api/xrain/v1/applications';
const app = applications + '/{application-id}';
const define = (path, method, route, options = {}) => ({ path: 'application ' + path, method, route, readback: ['application', 'list'], ...options });

export const applicationOperations = [
  define('list', 'GET', applications),
  define('capabilities', 'GET', applications + '/capabilities'),
  define('show', 'GET', app),
  define('create', 'POST', applications, { input: 'object' }),
  define('update', 'PATCH', app, { input: 'object' }),
  define('grant-baseline get', 'GET', applications + '/grant-baseline'),
  define('grant-baseline set', 'PUT', applications + '/grant-baseline', { input: 'object' }),
  define('grant-baseline impact', 'POST', applications + '/grant-baseline/impact', { input: 'object', readOnly: true }),
  ...[['publication', 'publication-scope'], ['resources', 'resources'], ['administrators', 'administrators'], ['grant-ceiling', 'grant-ceiling']].flatMap(([name, suffix]) => [
    define(`${name} get`, 'GET', `${app}/${suffix}`), define(`${name} set`, 'PUT', `${app}/${suffix}`, { input: 'object' }),
  ]),
  define('resource-catalog', 'GET', app + '/resource-catalog'),
  define('grant-directory', 'GET', app + '/grant-directory'),
  define('authorization-impact', 'POST', app + '/authorization-impact', { input: 'object', readOnly: true }),
  ...[['role', 'roles'], ['permission-set', 'permission-sets']].flatMap(([name, suffix]) => [
    define(`${name} list`, 'GET', `${app}/${suffix}`), define(`${name} create`, 'POST', `${app}/${suffix}`, { input: 'object' }),
    define(`${name} update`, 'PATCH', `${app}/${suffix}/{id}`, { input: 'object' }),
    define(`${name} delete`, 'DELETE', `${app}/${suffix}/{id}`, { input: 'object' }),
  ]),
  define('role users', 'PUT', app + '/roles/{id}/users', { input: 'object' }),
  define('role permission-sets', 'PUT', app + '/roles/{id}/permission-sets', { input: 'object' }),
  define('permission-set items', 'PUT', app + '/permission-sets/{id}/items', { input: 'object' }),
  define('execution-authorization get', 'GET', app + '/execution-authorization'),
  define('execution-authorization grant', 'PUT', app + '/execution-authorization/grants', { input: 'object' }),
  define('message-robot set', 'PUT', app + '/message-robot', { input: 'object' }),
  define('message-authorization', 'POST', app + '/message-authorization', { input: 'object' }),
  define('admission', 'POST', app + '/admission', { input: 'object', readOnly: true }),
  define('directory members', 'GET', app + '/directory/members'),
  define('directory departments', 'GET', app + '/directory/departments'),
];

const tenants = '/api/service/authen/v1/host/tenants';
const tenant = tenants + '/{tenant-id}';
const host = (path, method, route, options = {}) => ({ path: 'host ' + path, method, route, host: true, readback: ['host', 'tenant', 'list'], ...options });
export const hostOperations = [
  host('tenant list', 'GET', tenants, { query: ['page', 'pageSize', 'search', 'isActive'] }),
  host('tenant create', 'POST', tenants, { input: 'object', headers: { 'Idempotency-Key': 'request-key' } }),
  host('tenant show', 'GET', tenant),
  host('tenant update', 'PATCH', tenant, { input: 'object', headers: { 'If-Match': 'if-match' } }),
  ...['activate', 'suspend'].map(action => host('tenant ' + action, 'POST', tenant + '/' + action)),
  host('tenant connection set', 'PUT', tenant + '/connections/{name}', { input: 'object' }),
  host('tenant connection check', 'POST', tenant + '/connections/{name}/validate', { readOnly: true }),
  host('tenant member create', 'POST', tenant + '/members', { input: 'object' }),
  host('tenant member update', 'PUT', tenant + '/members/{user-id}', { input: 'object' }),
  host('tenant member delete', 'DELETE', tenant + '/members/{user-id}'),
  host('user ai get', 'GET', '/api/service/authen/v1/host/users/{user-id}/ai'),
  host('user ai set', 'PUT', '/api/service/authen/v1/host/users/{user-id}/ai', { input: 'object' }),
];
