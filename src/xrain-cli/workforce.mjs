import { closeSync, existsSync, openSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { CliError, isObject, readJsonInput, readLimited, registerSecrets, segment } from './core.mjs';
import { writeOnce } from './http.mjs';
import { memberTarget, memberValue as value } from './member-target.mjs';
import { workforceOperations } from './workforce-operations.mjs';
import { commandOutcome } from './runtime-controls.mjs';
import { openBrowser } from './auth.mjs';

export async function workforceCommands(ctx) {
  const { args, reporter } = ctx, operation = workforceOperations.find(row => row.path === ctx.spec.path);
  const { profile, host, appId, identity, send } = await memberTarget(ctx, 'workforce');
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
  const details = { workforce: host, server: profile.server, tenantId: profile.tenant, userId: identity.userId, applicationId: appId,
    operation: operation.path, target: Object.fromEntries([...operation.route.matchAll(/\{([^}]+)\}/g)].map(([, name]) => [name, args.value(name)])),
    ...Object.fromEntries(['requestId', 'clientMessageId', 'taskId'].filter(key => typeof body?.[key] === 'string').map(key => [key, body[key]])) };
  const command = operation.path === 'workforce session command';
  if (operation.download) {
    const output = resolve(args.required('out'));
    if (existsSync(output)) throw new CliError('Output already exists.', { code: 'output_exists' });
    const response = await send('GET', route, { limit: 25 * 1024 * 1024 });
    // Error JSON must never be saved as an attachment.
    if (!response.ok) value(response);
    let file, saved = false;
    try { file = openSync(output, 'wx', 0o600); writeFileSync(file, response.bytes); saved = true; }
    catch (error) { throw new CliError(error.code === 'EEXIST' ? 'Output already exists.' : 'Could not save the attachment.', { code: error.code === 'EEXIST' ? 'output_exists' : 'output_write_failed' }); }
    finally { if (file !== undefined) { closeSync(file); if (!saved) unlinkSync(output); } }
    reporter.print({ output, bytes: response.bytes.length }); return 0;
  }
  let upload;
  if (operation.upload) {
    const path = resolve(args.required('file'));
    upload = { body: readLimited(path, 25 * 1024 * 1024, 'Attachment') };
    upload.headers = { 'X-File-Name': encodeURIComponent(basename(path)), 'Content-Type': 'application/octet-stream', 'Content-Length': String(upload.body.length) };
  }
  const call = async () => {
    const result = value(await send(operation.method, route, upload ?? { json: body }));
    if (command && !commandOutcome(result)) throw new CliError('Workforce returned an invalid command receipt.', { code: 'invalid_response' });
    return result;
  };
  const result = operation.method === 'GET' ? await call() : await writeOnce(call,
    'Workforce outcome is unknown. Read the same Task, message, schedule or original session using the same identity; do not replay this write or a batch.', details);
  if (command && commandOutcome(result) === 'failed') throw new CliError('The Runtime command reported failure.', { code: 'execution_failed',
    hint: 'Inspect the original session and command result before another action. Do not replay the command or batch.', details: { ...details, result } });
  reporter.print(result); return 0;
}
