import { CliError, isObject, nonempty } from './core.mjs';
import { browserLogin } from './auth.mjs';
import { request, responseError } from './http.mjs';

export async function authCommands(ctx) {
  const { args, store, reporter } = ctx;
  if (args.command(1) === 'login') return browserLogin(ctx);
  const market = args.has('exchange'), profile = market ? store.market(args) : store.resolve(args);
  if (args.command(1) === 'status') {
    reporter.print(store.authStatus(args, profile, market));
    return 0;
  }
  if (args.command(1) === 'whoami') {
    const { token, source } = store.credential(args, profile, { createSecrets: false });
    const details = { profile: profile.name, server: profile.server, credentialSource: source };
    if (!token) throw new CliError('No usable credential is selected.', {
      code: 'authentication_required', hint: 'Run auth status and use the authorized credential for this target.', details,
    });
    let response;
    try {
      response = await request(new URL('/api/service/authen/v1/account/context', profile.server), {
        token, timeout: args.timeout(), limit: 1024 * 1024,
      });
    } catch (error) {
      if (error instanceof CliError) error.details = details;
      throw error;
    }
    if (!response.ok) throw responseError(response, '', details);
    let value;
    try { value = response.json(); } catch {
      throw new CliError('XRain returned an invalid identity context.', { code: 'invalid_response', details });
    }
    if (!isObject(value) || !nonempty(value.userId) ||
        !Object.hasOwn(value, 'tenantId') ||
        !['tenant', 'host'].includes(value.scope) ||
        (value.scope === 'tenant' ? !nonempty(value.tenantId) : value.tenantId !== null)) {
      throw new CliError('XRain returned an invalid identity context.', { code: 'invalid_response', details });
    }
    reporter.print({ ...details, configuredTenant: profile.tenant ?? null,
      userId: value.userId, tenantId: value.tenantId, scope: value.scope,
      remoteValidation: 'identity_confirmed' });
    return 0;
  }
  store.deleteSession(profile.name);
  reporter.print(reporter.json ? { profile: profile.name, authenticated: false } : `Logged out of app profile '${profile.name}'.`);
  return 0;
}

export async function doctor(ctx) {
  const { args, store, reporter } = ctx;
  const market = args.has('exchange'), profile = market ? store.market(args) : store.resolve(args, true);
  const report = store.authStatus(args, profile, market);
  const credential = market ? { token: store.loadSession(profile.name, profile.server, profile.tenant), source: 'application-session' } : store.credential(args, profile, { createSecrets: false });
  const path = market ? '/api/exchange/v1/my-published' : '/health/ready';
  let response;
  try { response = await request(new URL(path, profile.server), { token: credential.token, timeout: args.timeout(), limit: 1024 * 1024 }); }
  catch (error) { if (error instanceof CliError) error.details = { authentication: report }; throw error; }
  report.probe = { method: 'GET', path, httpStatus: response.status, scope: market
    ? 'This probe does not certify access to other endpoints or operations.'
    : 'Readiness can be public and does not validate the selected identity or business access.' };
  if (!response.ok) throw responseError(response, '', { authentication: report });
  if (!credential.token) throw new CliError('The server is reachable, but no usable credential is selected.', { code: 'authentication_required', hint: 'Run auth login or configure an already authorized API credential.', details: report });
  report.remoteValidation = market ? 'accepted_by_probe' : 'not_checked';
  reporter.print(report);
  return 0;
}
