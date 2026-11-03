import { CliError, isObject } from './core.mjs';
import { request, responseError } from './http.mjs';
import { writeOnce } from './agents.mjs';

function connection(ctx) {
  const profile = ctx.store.resolve(ctx.args, true);
  const { token, source } = ctx.store.credential(ctx.args, profile, { createSecrets: false });
  if (!token) throw new CliError('A matching credential is required.', { code: 'authentication_required', hint: 'Use auth login and --auth session for this profile.' });
  const target = { server: profile.server, profile: profile.name, scope: 'user', tenantId: profile.tenant };
  return { target, async call(method, path, json) {
    const response = await request(new URL(path, profile.server), { method, token, json, timeout: ctx.args.timeout(), limit: 1024 * 1024 });
    if (!response.ok) throw responseError(response, '', { ...target, credentialSource: source });
    try { return response.json(); }
    catch { throw new CliError('Settings API returned invalid JSON.', { code: 'invalid_response', details: target }); }
  } };
}
const preferences = {
  'send-shortcut': { key: 'sendShortcut', values: ['enter', 'ctrlEnter'], defaultValue: 'enter' },
  'unread-badge': { key: 'showUnreadBadge', values: ['true', 'false'], defaultValue: 'true' },
};
export async function userSettingsCommands(ctx) {
  const setting = ctx.args.required('setting'), preference = preferences[setting];
  const { target, call } = connection(ctx), settingApp = 'workforce';
  const path = `/api/tenant/v1/settings/${settingApp}/${preference.key}`;
  const validate = value => {
    if (!isObject(value) || value.settingApp !== settingApp || value.key !== preference.key || !preference.values.includes(value.value))
      throw new CliError('The personal setting response is invalid.', { code: 'invalid_response' });
    return value;
  };
  let result;
  if (ctx.args.command(2) === 'get') {
    try { result = { configured: true, ...validate(await call('GET', path)) }; }
    catch (error) {
      if (error.httpStatus !== 404 || error.serverCode !== 'platform.tenant_user_setting.not_found') throw error;
      result = { configured: false, settingApp, key: preference.key, value: null, defaultValue: preference.defaultValue };
    }
  } else {
    const value = ctx.args.required('value');
    result = await writeOnce(async () => {
      const saved = validate(await call('PUT', path, { value }));
      if (saved.value !== value) throw new CliError('The personal setting receipt does not match the requested value.', { code: 'invalid_response' });
      return { configured: true, ...saved };
    }, 'Read the same personal setting before deciding whether to retry. This API has no conditional-write contract.', { ...target, setting, requestedValue: value });
  }
  ctx.reporter.print({ ...target, setting, ...result }); return 0;
}
