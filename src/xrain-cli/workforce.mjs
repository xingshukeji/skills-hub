import { openAsBlob } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { CliError, isObject, readJsonInput, readLimited, registerSecrets, segment } from './core.mjs';
import { writeOnce } from './http.mjs';
import { memberTarget, memberValue as value } from './member-target.mjs';
import { workforceOperations } from './workforce-operations.mjs';
import { commandOutcome } from './runtime-controls.mjs';
import { openBrowser } from './auth.mjs';
import { saveFile } from './data-import.mjs';

export async function workforceCommands(ctx) {
  const { args, reporter } = ctx, operation = workforceOperations.find(row => row.path === ctx.spec.path);
  const { profile, host, appId, identity, send, token, headers } = await memberTarget(ctx, 'workforce',
    { applicationRequired: !operation.native, sessionOnly: !operation.native });
  if (operation.browser) {
    value(await send('GET', operation.route));
    const url = new URL('/#' + operation.browser, host).href;
    const opened = !args.has('no-browser') && await openBrowser(url);
    reporter.print({ url, opened, expectedIdentity: { tenantId: identity.tenantId, userId: identity.userId },
      status: 'requires_browser_interaction', instruction: '在页面确认当前企业和本人身份后操作；绑定、代登录确认及返回原账号均在原页面完成。' });
    return 0;
  }
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
  if (operation.audio) {
    body = args.has('request-json') ? await readJsonInput(args.value('request-json'), 'Speech request', { stdin: ctx.stdin }) : {};
    if (!isObject(body)) throw new CliError('The speech request must be an object.', { code: 'invalid_arguments' });
    if (args.has('file')) {
      if (Object.keys(body).some(key => !['providerId', 'language'].includes(key))) throw new CliError('With --file, speech JSON may select providerId and language.', { code: 'invalid_arguments' });
      const catalog = value(await send('GET', '/api/cli/v1/workbench/speech'));
      if (!isObject(catalog?.selection) || !Number.isSafeInteger(catalog.maxAudioBytes) || catalog.maxAudioBytes < 1)
        throw new CliError('The speech service returned invalid input capabilities.', { code: 'invalid_response' });
      body = { ...catalog.selection, ...body, audioBase64: readLimited(resolve(args.required('file')), catalog.maxAudioBytes, 'Audio').toString('base64') };
    }
  }
  const details = { workforce: host, server: profile.server, tenantId: profile.tenant, userId: identity.userId,
    applicationId: operation.native ? body?.applicationId ?? args.value('application-id') : appId,
    operation: operation.path, target: operation.publication && isObject(body?.target)
      ? Object.fromEntries(['kind', 'userId', 'channelId'].filter(key => typeof body.target[key] === 'string').map(key => [key, body.target[key]]))
      : Object.fromEntries([...operation.route.matchAll(/\{([^}]+)\}/g)].map(([, name]) => [name, args.value(name)])),
    ...Object.fromEntries(['requestId', 'clientMessageId', 'taskId'].filter(key => typeof body?.[key] === 'string').map(key => [key, body[key]])) };
  const command = operation.path === 'workforce session command';
  if (operation.download) {
    const controller = new AbortController(), interrupt = () => controller.abort();
    process.once('SIGINT', interrupt);
    try {
      reporter.print(await saveFile({ profile: { ...profile, server: host }, token, headers, source: 'application-session', timeout: args.timeout(), signal: controller.signal },
        'GET', route, args.required('out'), undefined, undefined, { contentType: null, allowEmpty: true }));
      return 0;
    } finally { process.removeListener('SIGINT', interrupt); }
  }
  let upload;
  if (operation.upload) {
    const path = resolve(args.required('file'));
    const info = await stat(path);
    if (!info.isFile()) throw new CliError('An attachment must be a regular file.', { code: 'invalid_arguments' });
    const blob = await openAsBlob(path);
    if (blob.size !== info.size) throw new CliError('The attachment changed before upload.', { code: 'invalid_input' });
    upload = { body: blob, headers: { 'X-File-Name': encodeURIComponent(basename(path)), 'Content-Type': 'application/octet-stream', 'Content-Length': String(blob.size) } };
  }
  const call = async () => {
    const result = value(await send(operation.method, route, upload ?? { json: body }));
    if (command && !commandOutcome(result)) throw new CliError('Workforce returned an invalid command receipt.', { code: 'invalid_response' });
    if (operation.feedback && result?.saved !== true) throw new CliError('Workforce returned an invalid feedback receipt.', { code: 'invalid_response' });
    if (operation.audio && typeof result?.text !== 'string') throw new CliError('The speech service returned an invalid transcription.', { code: 'invalid_response' });
    if (operation.publication) {
      const expectedId = body?.clientMessageId ?? args.value('request-id');
      if (!isObject(result) || !['accepted', 'saved', 'failed', ...(operation.method === 'GET' ? ['unknown'] : [])].includes(result.status)
        || result.clientMessageId !== expectedId || typeof result.channelId !== 'string' || !result.channelId
        || operation.method === 'GET' && result.channelId !== args.value('channel'))
        throw new CliError('The application message receipt does not match the original request.', { code: 'invalid_response' });
    }
    return result;
  };
  const recovery = operation.publication ? 'Application message outcome is unknown. Preserve the original application, target and clientMessageId. Look up the original request if its channelId is known; do not resend or replay a batch.'
    : operation.path.startsWith('workforce speech ') ? 'Speech outcome is unknown. Read the current speech catalog before another action; do not replay this write or a batch.'
    : 'Workforce outcome is unknown. Read the same Task, message, schedule or original session using the same identity; do not replay this write or a batch.';
  const result = operation.method === 'GET' ? await call() : await writeOnce(call, recovery, details);
  if (command && commandOutcome(result) === 'failed') throw new CliError('The Runtime command reported failure.', { code: 'execution_failed',
    hint: 'Inspect the original session and command result before another action. Do not replay the command or batch.', details: { ...details, result } });
  if (operation.publication && result.status === 'failed') throw new CliError('The application message was not saved.', { code: 'execution_failed', details: { ...details, result } });
  reporter.print(result); return 0;
}
