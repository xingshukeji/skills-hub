import { CliError, isObject, origin, readJsonInput, registerSecrets, segment } from './core.mjs';
import { applicationId } from './agent-target.mjs';
import { request, requireSuccess, writeOnce } from './http.mjs';
import { workforceOperations } from './workforce-operations.mjs';

function value(response) {
  requireSuccess(response);
  if (!response.bytes.length) return null;
  try { return response.json(); } catch { throw new CliError('Workforce returned invalid JSON.', { code: 'invalid_response' }); }
}
export async function workforceCommands(ctx) {
  const { args, store, reporter } = ctx, operation = workforceOperations.find(row => row.path === ctx.spec.path);
  const profile = store.resolve(args, true), host = origin(args.required('workforce')), appId = applicationId(profile);
  if (!appId) throw new CliError('Workforce commands require the actual application ID.', { code: 'invalid_arguments' });
  const token = store.loadSession(profile.name, profile.server, profile.tenant, profile.scope);
  if (!token) throw new CliError('A matching platform login session is required for Workforce.', { code: 'authentication_required' });
  const identity = value(await request(new URL('/api/service/authen/v1/account/context', profile.server), { token, timeout: args.timeout() }));
  if (!isObject(identity) || identity.tenantId !== profile.tenant || typeof identity.userId !== 'string' || !identity.userId)
    throw new CliError('The current platform identity does not match this Workforce target.', { code: 'identity_mismatch' });
  const headers = { 'X-XRain-Application-Id': appId, 'X-XRain-Expected-Tenant-Id': profile.tenant, 'X-XRain-Expected-User-Id': identity.userId };
  let route = operation.route.replace(/\{([^}]+)\}/g, (_match, name) => segment(args.required(name))), body;
  if (operation.query && args.has('query-json')) {
    const query = await readJsonInput(args.value('query-json'), 'Workforce query', { stdin: ctx.stdin });
    if (!isObject(query) || Object.keys(query).some(key => !operation.query.includes(key)) || Object.values(query).some(item => !['number', 'boolean', 'string'].includes(typeof item)))
      throw new CliError('Use only supported native query keys with scalar values.', { code: 'invalid_arguments' });
    const search = new URLSearchParams(Object.entries(query).map(([key, item]) => [key, String(item)]));
    if (search.size) route += '?' + search;
  }
  if (operation.input) {
    body = await readJsonInput(args.required('request-json', args.value('file')), 'Workforce request', { stdin: ctx.stdin });
    if (!isObject(body)) throw new CliError('Workforce requests must be JSON objects.');
    registerSecrets(reporter, body);
    if (ctx.spec.path === 'workforce session create' && Object.keys(body).some(key => !['taskId', 'agentId', 'source', 'requestId'].includes(key)))
      throw new CliError('Session creation accepts taskId, agentId, source and requestId. Task grants remain private to the host.', { code: 'invalid_arguments' });
  }
  const details = { workforce: host, server: profile.server, tenantId: profile.tenant, userId: identity.userId, applicationId: appId,
    operation: operation.path, target: Object.fromEntries([...operation.route.matchAll(/\{([^}]+)\}/g)].map(([, name]) => [name, args.value(name)])),
    ...Object.fromEntries(['requestId', 'clientMessageId', 'taskId'].filter(key => typeof body?.[key] === 'string').map(key => [key, body[key]])) };
  const call = () => request(new URL(route, host), { method: operation.method, token, headers, json: body, timeout: args.timeout() }).then(value);
  const result = operation.method === 'GET' ? await call() : await writeOnce(call,
    'Workforce outcome is unknown. Read the same Task, message, schedule or original session using the same identity; do not replay this write or a batch.', details);
  reporter.print(result); return 0;
}
