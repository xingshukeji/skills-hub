import { CliError, isObject, origin } from './core.mjs';
import { applicationId } from './agent-target.mjs';
import { request, requireSuccess } from './http.mjs';

export function memberValue(response) {
  requireSuccess(response);
  if (!response.bytes.length) return null;
  return response.json();
}

// Member operations use the original saved login and application admission.
// Native publication uses its existing authorized executor credential instead.
export async function memberTarget(ctx, option, { applicationRequired = true, sessionOnly = true } = {}) {
  const { args, store } = ctx, profile = store.resolve(args, true);
  const host = origin(args.required(option)), appId = applicationRequired ? applicationId(profile) : undefined;
  if (applicationRequired && !appId) throw new CliError('An actual application ID is required.', { code: 'invalid_arguments' });
  const token = sessionOnly ? store.loadSession(profile.name, profile.server, profile.tenant, profile.scope) : store.credential(args, profile, { createSecrets: false }).token;
  if (!token) throw new CliError(sessionOnly ? 'A matching saved platform login is required.' : 'An authorized platform credential is required.', { code: 'authentication_required' });
  const identity = memberValue(await request(new URL('/api/service/authen/v1/account/context', profile.server), { token, timeout: args.timeout() }));
  if (!isObject(identity) || identity.tenantId !== profile.tenant || typeof identity.userId !== 'string' || !identity.userId)
    throw new CliError('The platform identity does not match the selected target.', { code: 'identity_mismatch' });
  const headers = { ...(appId ? { 'X-XRain-Application-Id': appId } : {}), 'X-XRain-Expected-Tenant-Id': profile.tenant, 'X-XRain-Expected-User-Id': identity.userId };
  return { host, profile, appId, identity, token, headers,
    send: (method, path, options = {}) => request(new URL(path, host), { method, token, timeout: args.timeout(), ...options, headers: { ...headers, ...options.headers } }) };
}
