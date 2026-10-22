import { CliError, httpUrl, parseJson } from './core.mjs';

export async function request(url, { method = 'GET', token, json, body, headers = {}, timeout = 100000, limit = 32 * 1024 * 1024 } = {}) {
  url = httpUrl(url);
  const options = { method, redirect: 'error', signal: AbortSignal.timeout(timeout), headers: { Accept: 'application/json', ...headers } };
  if (token) options.headers.Authorization = `Bearer ${token}`;
  if (json !== undefined) { options.body = JSON.stringify(json); options.headers['Content-Type'] = 'application/json'; }
  else if (body !== undefined) options.body = body;
  try {
    const response = await fetch(url, options);
    if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); throw new CliError('HTTP response exceeds the size limit.'); }
    const chunks = [];
    let size = 0;
    if (response.body) for await (const chunk of response.body) {
      size += chunk.length;
      if (size > limit) { throw new CliError('HTTP response exceeds the size limit.'); }
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    return { ok: response.ok, status: response.status, headers: response.headers, bytes,
      json: () => parseJson(bytes, 'Server response'), text: () => bytes.toString('utf8') };
  } catch (error) {
    if (error instanceof CliError) throw error;
    if (['TimeoutError', 'AbortError'].includes(error.name)) throw new CliError('HTTP request timed out.', { code: 'timeout', hint: 'Check connectivity or set --timeout to an appropriate number of seconds.' });
    throw new CliError('HTTP request failed. Check the server URL, connectivity and TLS certificate. Redirects are not followed.', { code: 'network_error' });
  }
}

export function responseError(response, hint = '', context = {}) {
  let body;
  try { body = response.json(); } catch { body = undefined; }
  const candidate = body?.errorCode;
  const serverCode = typeof candidate === 'string' && /^[a-z0-9_.-]{1,160}$/i.test(candidate) ? candidate : undefined;
  const methodRejected = serverCode?.endsWith('authentication_method_not_allowed');
  const code = methodRejected ? 'authentication_method_not_allowed' : response.status === 401 ? 'authentication_failed' : response.status === 403 ? 'permission_denied' : response.status === 404 ? 'not_found' : response.status === 409 ? 'conflict' : 'http_error';
  const defaultHint = methodRejected ? 'This endpoint does not accept the selected credential type. Run auth login and select --auth session for browser management commands.' :
    response.status === 401 ? 'Run auth status to inspect the selected credential. Reauthenticate with auth login if the browser session was rejected; check XRAIN_TOKEN when using automatic selection.' :
      response.status === 403 ? 'Check the account, tenant membership and required permission on the server.' : '';
  const requestId = response.headers?.get('x-request-id');
  return new CliError(`XRain request failed (HTTP ${response.status}${serverCode ? ', ' + serverCode : ''}).`, {
    code, httpStatus: response.status, serverCode, hint: hint || defaultHint || undefined,
    requestId: requestId && /^[a-z0-9_.:-]{1,160}$/i.test(requestId) ? requestId : undefined,
    details: { ...context, ...(body !== undefined ? { response: body } : {}) },
  });
}

export function requireSuccess(response, hint = '') {
  if (response.ok) return response;
  throw responseError(response, hint);
}

export async function apiValue(ctx, method, path, json) {
  const profile = ctx.store.resolve(ctx.args, true);
  const { token, source } = ctx.store.credential(ctx.args, profile);
  if (ctx.args.value('auth') === 'session' && !token) throw new CliError('A matching browser session is required.', { code: 'authentication_required', hint: 'Run auth status, then auth login for this profile.' });
  const response = await request(new URL(path, profile.server), { method, token, json, timeout: ctx.args.timeout() });
  let result;
  try { result = response.json(); } catch { result = response.text(); }
  if (!response.ok) throw responseError(response, '', { credentialSource: source, profile: profile.name });
  return response.bytes.length ? result : null;
}

export async function api(ctx, method, path, json) {
  ctx.reporter.print(await apiValue(ctx, method, path, json));
  return 0;
}
