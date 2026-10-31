import { CliError, isObject, jsonInput, nonempty, segment } from './core.mjs';

const reads = { subagents: 'subagents', commands: 'commands', models: 'models' };
const writes = new Set(['cancel', 'command', 'model']);

export async function sessionControl(ctx, helpers, connection) {
  const { args, reporter } = ctx, action = args.command(2);
  if (!Object.hasOwn(reads, action) && !writes.has(action)) return false;
  const sessionId = helpers.identifier(args.required('session-id'), 'Session ID');
  const root = `/v1/dsh/sessions/${segment(sessionId)}`;
  if (Object.hasOwn(reads, action)) {
    const value = await helpers.runtimeValue(ctx, 'GET', `${root}/${reads[action]}`);
    if (!isObject(value) || action === 'commands' && !Array.isArray(value.items) ||
        action === 'subagents' && (!isObject(value.catalog) || !Array.isArray(value.summaries)) ||
        action === 'models' && !isObject(value.catalog))
      throw new CliError('Runtime returned an invalid session catalog.', { code: 'invalid_response' });
    reporter.print(value); return true;
  }
  let body, suffix = action;
  if (action === 'command') {
    const line = args.required('line');
    if (line.length > 16_384 || !/^\/[a-z][a-z0-9_-]*(?:\s|$)/u.test(line))
      throw new CliError('--line must contain one Runtime slash command, at most 16384 characters.', { code: 'invalid_arguments' });
    body = { line }; suffix = 'commands';
  } else if (action === 'model') {
    body = await jsonInput(args, 'values');
    if (!isObject(body) || Object.keys(body).some(key => !['provider', 'model', 'reasoningEffort'].includes(key)) ||
        !nonempty(body.provider) || !nonempty(body.model) || body.reasoningEffort !== undefined && !nonempty(body.reasoningEffort))
      throw new CliError('Model selection requires provider and model, with optional reasoningEffort.', { code: 'invalid_arguments' });
  }
  const details = { operation: ctx.spec.path, profile: connection.profile.name, runtime: connection.runtime, sessionId };
  const value = await helpers.writeOnce(async () => {
    const result = await helpers.runtimeValue(ctx, 'POST', `${root}/${suffix}`, body);
    if (!isObject(result) || action === 'cancel' && result.accepted !== true ||
        action === 'command' && !Object.hasOwn(result, 'execution'))
      throw new CliError('Runtime returned an invalid operation receipt.', { code: 'invalid_response' });
    return result;
  }, action === 'cancel'
    ? 'Stop outcome is unknown. Inspect this session and its pending actions. Do not assume that earlier external effects were undone.'
    : 'Operation outcome is unknown. Read this session, its command catalog or model state before another write; do not automatically replay the command.', details);
  reporter.print({ ...value, ...details }); return true;
}
