import { CliError, isObject } from './core.mjs';
import { request, responseError } from './http.mjs';
import { writeOnce } from './agents.mjs';

const MIB = 1024 * 1024;
const hostPath = '/api/host/v1/settings/agent-definition-limit';
const validBytes = value => Number.isSafeInteger(value) && value > 0;

export function settingBytes(args) {
  const raw = args.value('mib') ?? args.value('bytes');
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw ?? ''))
    throw new CliError('Supply a positive numeric size.', { code: 'invalid_arguments' });
  const value = args.has('mib') ? Math.round(Number(raw) * MIB) : Number(raw);
  if (!validBytes(value) || Number(raw) <= 0)
    throw new CliError('Size must convert to a positive safe integer number of bytes.', { code: 'invalid_arguments' });
  return value;
}
export function expectedBytes(args) {
  if (!args.has('expected-bytes')) return undefined;
  const raw = args.value('expected-bytes');
  if (raw === 'null') return null;
  if (!/^\d+$/.test(raw) || !validBytes(Number(raw)))
    throw new CliError('--expected-bytes must be a positive safe integer or null.', { code: 'invalid_arguments' });
  return Number(raw);
}

function connection(ctx, personal = false) {
  const profile = ctx.store.resolve(ctx.args, personal);
  const { token, source } = ctx.store.credential(ctx.args, profile, { createSecrets: false });
  if (!token) throw new CliError('A matching credential is required.', { code: 'authentication_required', hint: 'Use auth login and --auth session for this profile.' });
  const target = { server: profile.server, profile: profile.name, scope: personal ? 'user' : 'host', ...(personal ? { tenantId: profile.tenant } : {}) };
  return { target, async call(method, path, json) {
    const response = await request(new URL(path, profile.server), { method, token, json, timeout: ctx.args.timeout(), limit: 1024 * 1024 });
    if (!response.ok) throw responseError(response, '', { ...target, credentialSource: source });
    try { return response.json(); }
    catch { throw new CliError('Settings API returned invalid JSON.', { code: 'invalid_response', details: target }); }
  } };
}
function limitValue(value) {
  if (!isObject(value) || !(value.maxDefinitionBytes === null || validBytes(value.maxDefinitionBytes)) || !validBytes(value.defaultMaxDefinitionBytes))
    throw new CliError('Settings API returned an invalid definition limit.', { code: 'invalid_response' });
  return { maxDefinitionBytes: value.maxDefinitionBytes, maxDefinitionMiB: value.maxDefinitionBytes === null ? null : value.maxDefinitionBytes / MIB,
    defaultMaxDefinitionBytes: value.defaultMaxDefinitionBytes, defaultMaxDefinitionMiB: value.defaultMaxDefinitionBytes / MIB };
}

export async function hostSettingsCommands(ctx) {
  const setting = ctx.args.required('setting'), settingValue = ctx.args.command(2) === 'set' ? settingBytes(ctx.args) : undefined;
  const expected = expectedBytes(ctx.args);
  const { target, call } = connection(ctx);
  const read = async () => limitValue(await call('GET', hostPath));
  const current = await read();
  if (settingValue === undefined) { ctx.reporter.print({ ...target, setting, ...current }); return 0; }
  if (expected !== undefined && expected !== current.maxDefinitionBytes)
    throw new CliError('The observed Host setting changed. Review it before saving.', { code: 'conflict', details: {
      ...target, setting, expectedMaxDefinitionBytes: expected, currentMaxDefinitionBytes: current.maxDefinitionBytes, requestedMaxDefinitionBytes: settingValue,
    } });
  if (current.maxDefinitionBytes === settingValue) { ctx.reporter.print({ ...target, setting, changed: false, ...current }); return 0; }
  const body = { maxDefinitionBytes: settingValue, expectedMaxDefinitionBytes: expected === undefined ? current.maxDefinitionBytes : expected };
  try {
    const result = await writeOnce(async () => {
      const saved = limitValue(await call('PUT', hostPath, body));
      if (saved.maxDefinitionBytes !== settingValue) throw new CliError('Settings API returned a mismatched save receipt.', { code: 'invalid_response' });
      return saved;
    }, 'The write outcome is unknown. Read the same Host setting; do not repeat the PUT automatically.', { ...target, setting, request: body });
    ctx.reporter.print({ ...target, setting, changed: true, previousMaxDefinitionBytes: current.maxDefinitionBytes, ...result });
  } catch (error) {
    if (error.code === 'conflict') error.details = { ...error.details, ...target, setting, request: body };
    if (error.code === 'outcome_unknown') {
      try {
        const observed = await read();
        error.details.readBack = { ...observed, matchesRequested: observed.maxDefinitionBytes === settingValue, provesThisWrite: false };
      } catch (readError) { error.details.readBack = { status: 'unavailable', code: readError.code, httpStatus: readError.httpStatus }; }
    }
    throw error;
  }
  return 0;
}

const preferences = {
  'send-shortcut': { key: 'sendShortcut', values: ['enter', 'ctrlEnter'], defaultValue: 'enter' },
  'unread-badge': { key: 'showUnreadBadge', values: ['true', 'false'], defaultValue: 'true' },
};
export async function userSettingsCommands(ctx) {
  const setting = ctx.args.required('setting'), preference = preferences[setting];
  const { target, call } = connection(ctx, true), settingApp = 'workforce';
  const path = `/api/tenant/v1/settings/${settingApp}/${preference.key}`;
  const validate = value => {
    if (!isObject(value) || value.settingApp !== settingApp || value.key !== preference.key || !preference.values.includes(value.value))
      throw new CliError('The personal setting response is invalid.', { code: 'invalid_response' });
    return value;
  };
  let result;
  if (ctx.args.command(2) === 'get') {
    try { result = { configured: true, ...validate(await call('GET', path)) }; }
    catch (error) { if (error.httpStatus !== 404) throw error; result = { configured: false, settingApp, key: preference.key, value: null, defaultValue: preference.defaultValue }; }
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
