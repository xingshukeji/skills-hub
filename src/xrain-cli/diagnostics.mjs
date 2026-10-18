import { CliError } from './core.mjs';
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
  report.probe = { method: 'GET', path, httpStatus: response.status, scope: 'This probe does not certify access to other endpoints or operations.' };
  if (!response.ok) throw responseError(response, '', { authentication: report });
  if (!credential.token) throw new CliError('The server is reachable, but no usable credential is selected.', { code: 'authentication_required', hint: 'Run auth login or configure an already authorized API credential.', details: report });
  report.remoteValidation = 'accepted_by_probe';
  reporter.print(report);
  return 0;
}
