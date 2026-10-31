import { CliError, httpUrl, parseJson } from './core.mjs';

export async function request(url, { method = 'GET', token, json, body, headers = {}, timeout = 100000, signal, limit = 32 * 1024 * 1024 } = {}) {
  url = httpUrl(url);
  const requestTimeout = AbortSignal.timeout(timeout);
  const options = { method, redirect: 'error', signal: signal ? AbortSignal.any([signal, requestTimeout]) : requestTimeout,
    headers: { Accept: 'application/json', ...headers } };
  if (token) options.headers.Authorization = `Bearer ${token}`;
  if (json !== undefined) { options.body = JSON.stringify(json); options.headers['Content-Type'] = 'application/json'; }
  else if (body !== undefined) options.body = body;
  try {
    const response = await fetch(url, options);
    if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); throw new CliError('HTTP response exceeds the size limit.', { code: 'response_too_large' }); }
    const chunks = [];
    let size = 0;
    if (response.body) for await (const chunk of response.body) {
      size += chunk.length;
      if (size > limit) { throw new CliError('HTTP response exceeds the size limit.', { code: 'response_too_large' }); }
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    return { ok: response.ok, status: response.status, headers: response.headers, bytes,
      json: () => { try { return parseJson(bytes, 'Server response'); } catch { throw new CliError('Server returned invalid JSON.', { code: 'invalid_response' }); } }, text: () => bytes.toString('utf8') };
  } catch (error) {
    if (error instanceof CliError) throw error;
    if (['TimeoutError', 'AbortError'].includes(error.name)) throw new CliError('HTTP request timed out.', { code: 'timeout', hint: 'Check connectivity or set --timeout to an appropriate number of seconds.' });
    throw new CliError('HTTP request failed. Check the server URL, connectivity and TLS certificate. Redirects are not followed.', { code: 'network_error' });
  }
}

export function responseError(response, hint = '', context = {}) {
  let body;
  try { body = response.json(); } catch { body = undefined; }
  const candidate = body?.errorCode ?? (typeof body?.error === 'object' ? body.error?.code : body?.error);
  const serverCode = typeof candidate === 'string' && /^[a-z0-9_.-]{1,160}$/i.test(candidate) ? candidate : undefined;
  const methodRejected = serverCode?.endsWith('authentication_method_not_allowed');
  const code = methodRejected ? 'authentication_method_not_allowed' : response.status === 401 ? 'authentication_failed' : response.status === 403 ? 'permission_denied' : response.status === 404 ? 'not_found' : response.status === 409 ? 'conflict' : 'http_error';
  const defaultHint = methodRejected ? 'This endpoint does not accept the selected credential type. Run auth login and select --auth session for management commands.' :
    response.status === 401 ? 'Run auth status to inspect the selected credential. Reauthenticate with auth login if the session was rejected; check XRAIN_TOKEN when using automatic selection.' :
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

export async function writeOnce(action, hint, details) {
  try { return await action(); }
  catch (error) {
    if (error instanceof CliError && (['network_error', 'timeout', 'invalid_response', 'response_too_large'].includes(error.code) || error.httpStatus === 408 || error.httpStatus >= 500)) {
      error.code = 'outcome_unknown';
      error.hint = hint;
      error.details = { ...error.details, ...details };
    }
    throw error;
  }
}

export async function apiValue(ctx, method, path, json, { requireTenant = true, resolvedProfile, mutation, headers, responseHeaders, sessionOnly = false } = {}) {
  const profile = resolvedProfile ?? ctx.store.resolve(ctx.args, requireTenant);
  const { token, source } = sessionOnly ? { token: ctx.store.loadSession(profile.name, profile.server, profile.tenant, profile.scope), source: 'application-session' } : ctx.store.credential(ctx.args, profile);
  if ((sessionOnly || ctx.args.value('auth') === 'session') && !token) throw new CliError('A matching saved session is required.', { code: 'authentication_required', hint: 'Run auth status, then auth login for this profile.' });
  const perform = async () => {
    const response = await request(new URL(path, profile.server), { method, token, json, timeout: ctx.args.timeout(), headers });
    if (!response.ok) throw responseError(response, '', { credentialSource: source, profile: profile.name });
    let value = null;
    if (response.bytes.length) {
      try { value = response.json(); }
      catch {
        if (mutation) throw new CliError('The server returned an invalid write receipt.', { code: 'invalid_response' });
        value = response.text();
      }
    }
    return responseHeaders ? { value, headers: Object.fromEntries(responseHeaders.map(name => [name, response.headers.get(name)]).filter(([, value]) => value !== null)) } : value;
  };
  if (!mutation) return perform();
  const { hint = 'The write outcome is unknown. Inspect the original resource using the same target and identity before another write. Current state alone does not prove this operation succeeded. Do not replay a batch.', ...recovery } = mutation;
  const details = { operation: ctx.spec?.path, profile: profile.name, server: profile.server, tenant: profile.tenant ?? null,
    credentialSource: source, ...recovery };
  try { return await writeOnce(perform, hint, details); }
  catch (error) {
    if (error instanceof CliError) error.details = { ...error.details, ...details };
    throw error;
  }
}

export async function api(ctx, method, path, json, options) {
  ctx.reporter.print(await apiValue(ctx, method, path, json, options));
  return 0;
}
