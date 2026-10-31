const define = (path, method, route, options = {}) => ({ path, method, route, ...options });
const orchestration = '/api/orchestration/v1';
const routine = '/api/automation/routines';
const integration = '/api/integration/v1';
const connector = integration + '/connectors/{connector}';
const iface = integration + '/http-interfaces';

export const workflowOperations = [
  define('orchestration list', 'GET', orchestration + '/definitions'),
  define('orchestration versions', 'GET', orchestration + '/definitions/{id}/versions'),
  define('orchestration callables', 'GET', orchestration + '/callables'),
  define('orchestration create', 'POST', orchestration + '/definitions', { input: 'object' }),
  define('orchestration update', 'PUT', orchestration + '/definitions/{id}', { input: 'object' }),
  define('orchestration delete', 'DELETE', orchestration + '/definitions/{id}'),
  define('orchestration debug', 'POST', orchestration + '/debug', { input: 'object' }),
  define('orchestration policy get', 'GET', orchestration + '/policy'),
  define('orchestration policy set', 'PUT', orchestration + '/policy', { input: 'object' }),
  define('function list', 'GET', orchestration + '/functions'),
  define('function create', 'POST', orchestration + '/functions', { input: 'object' }),
  define('function update', 'PUT', orchestration + '/functions/{id}', { input: 'object' }),
  define('function delete', 'DELETE', orchestration + '/functions/{id}'),
  define('routine list', 'GET', routine, { query: ['page', 'pageSize', 'search', 'status', 'sources'] }),
  define('routine show', 'GET', routine + '/{id}'),
  define('routine create', 'POST', routine, { input: 'object' }),
  ...['definition', 'schedule', 'owner'].map(action => define('routine ' + action, 'PUT', `${routine}/{id}/${action}`, { input: 'object' })),
  ...['enable', 'pause'].map(action => define('routine ' + action, 'POST', `${routine}/{id}/${action}`)),
  define('routine run', 'POST', routine + '/{id}/runs'),
  define('routine delete', 'DELETE', routine + '/{id}'),
  ...['versions', 'active-runs', 'history'].map(action => define('routine ' + action, 'GET', `${routine}/{id}/${action}`)),
  define('routine schedule-preview', 'POST', routine + '/schedule-preview', { input: 'object', readOnly: true }),
  define('routine execution-user get', 'GET', routine + '/execution-user'),
  define('routine execution-user set', 'PUT', routine + '/execution-user', { input: 'object' }),
  define('http connector list', 'GET', integration + '/connectors'),
  define('http connector show', 'GET', connector),
  define('http connector create', 'POST', integration + '/connectors', { input: 'object' }),
  define('http connector update', 'PUT', connector, { input: 'object' }),
  define('http connector patch', 'PATCH', connector, { input: 'object' }),
  define('http connector delete', 'DELETE', connector),
  define('http connector token-set', 'POST', connector + '/token', { input: 'object' }),
  define('http connector token-clear', 'DELETE', connector + '/token'),
  define('http request list', 'GET', connector + '/http-requests'),
  define('http request show', 'GET', connector + '/http-requests/{name}'),
  define('http request create', 'POST', connector + '/http-requests', { input: 'object' }),
  define('http request update', 'PUT', connector + '/http-requests/{name}', { input: 'object' }),
  define('http request delete', 'DELETE', connector + '/http-requests/{name}'),
  define('http request debug', 'POST', integration + '/http-requests/{connector}/{name}/debug', { input: 'json' }),
  define('http interface list', 'GET', iface, { query: ['requestId', 'triggerOnly'] }),
  define('http interface catalog', 'GET', iface + '/catalog', { query: ['status'] }),
  define('http interface create', 'POST', iface, { input: 'object' }),
  define('http interface update', 'PUT', iface + '/{id}', { input: 'object' }),
  define('http interface delete', 'DELETE', iface + '/{id}'),
  define('http interface from-orchestration', 'POST', iface + '/from-orchestration/{id}', { input: 'object' }),
  define('http interface policy get', 'GET', iface + '/{id}/orchestration-policy'),
  define('http interface policy set', 'PUT', iface + '/{id}/orchestration-policy', { input: 'object' }),
  define('http interface invoke', 'POST', iface + '/{id}', { input: 'json' }),
  define('http interface debug', 'POST', iface + '/{id}/debug/raw', { input: 'json' }),
];

export const settingsOperations = [
  define('variable list', 'GET', '/api/variables/items', { host: true, query: ['tenantId'] }),
  define('variable set', 'PUT', '/api/variables/items', { host: true, query: ['tenantId'], input: 'object', secretInput: ['value'] }),
  define('user regional get', 'GET', '/api/service/authen/v1/account/regional-preferences', { host: true }),
  define('user regional set', 'PUT', '/api/service/authen/v1/account/regional-preferences', { host: true, input: 'object' }),
  define('tenant regional get', 'GET', '/api/tenant/v1/settings/regional-defaults'),
  define('tenant regional set', 'PUT', '/api/tenant/v1/settings/regional-defaults', { input: 'object' }),
  define('time resolve', 'POST', '/api/service/authen/v1/account/temporal/resolve', { input: 'object', readOnly: true }),
  define('time day-range', 'POST', '/api/service/authen/v1/account/temporal/day-range', { input: 'object', readOnly: true }),
  define('recycle resources', 'GET', '/api/service/recycle-bin/v1/resources'),
  define('recycle list', 'GET', '/api/service/recycle-bin/v1/resources/{resource}/items', { query: ['page', 'pageSize', 'search'] }),
  define('recycle restore', 'POST', '/api/service/recycle-bin/v1/resources/{resource}/items/{id}/restore'),
];

for (const operation of [...workflowOperations, ...settingsOperations]) {
  const root = operation.path.split(' ')[0];
  operation.readback = root === 'http' ? ['http', 'interface', 'catalog'] : root === 'routine' ? ['routine', 'list'] :
    root === 'function' ? ['function', 'list'] : root === 'orchestration' ? ['orchestration', 'list'] :
      root === 'variable' ? ['variable', 'list'] : root === 'recycle' ? ['recycle', 'resources'] : operation.path.split(' ').slice(0, 2).concat('get');
}
