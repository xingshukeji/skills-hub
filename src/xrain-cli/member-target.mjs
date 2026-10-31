import { CliError, isObject, origin } from './core.mjs';
import { applicationId } from './agent-target.mjs';
import { request, requireSuccess } from './http.mjs';

export function memberValue(response) {
  requireSuccess(response);
  if (!response.bytes.length) return null;
  return response.json();
}

// Independent applications receive the same member credential, never a service
// token or browser cookie. The application verifies it and admission again.
export async function memberTarget(ctx, option) {
  const { args, store } = ctx, profile = store.resolve(args, true);
  const host = origin(args.required(option)), appId = applicationId(profile);
  if (!appId) throw new CliError('An actual application ID is required.', { code: 'invalid_arguments' });
  const token = store.loadSession(profile.name, profile.server, profile.tenant, profile.scope);
  if (!token) throw new CliError('A matching saved platform login is required.', { code: 'authentication_required' });
  const identity = memberValue(await request(new URL('/api/service/authen/v1/account/context', profile.server), { token, timeout: args.timeout() }));
  if (!isObject(identity) || identity.tenantId !== profile.tenant || typeof identity.userId !== 'string' || !identity.userId)
    throw new CliError('The platform identity does not match the selected target.', { code: 'identity_mismatch' });
  const headers = { 'X-XRain-Application-Id': appId, 'X-XRain-Expected-Tenant-Id': profile.tenant, 'X-XRain-Expected-User-Id': identity.userId };
  return { host, profile, appId, identity, token, headers,
    send: (method, path, options = {}) => request(new URL(path, host), { method, token, timeout: args.timeout(), ...options, headers: { ...headers, ...options.headers } }) };
}
