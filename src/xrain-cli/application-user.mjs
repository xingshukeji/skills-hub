import { CliError, isObject, readJsonInput, registerSecrets, segment } from './core.mjs';
import { memberTarget, memberValue } from './member-target.mjs';
import { writeOnce } from './http.mjs';
import { commandOutcome } from './runtime-controls.mjs';
import { applicationUserOperations } from './application-user-operations.mjs';

export async function applicationUserCommand(ctx) {
  const operation = applicationUserOperations.find(row => row.path === ctx.spec.path);
  if (!operation) return false;
  const { args, reporter } = ctx, target = await memberTarget(ctx, 'app-url');
  const url = new URL(operation.route.replace(/\{([^}]+)\}/g, (_, name) => segment(args.required(name))), target.host);
  for (const [key, value] of Object.entries(operation.queryDefaults ?? {})) url.searchParams.set(key, value);
  if (operation.query && args.has('query-json')) {
    const query = await readJsonInput(args.value('query-json'), 'Application query', { stdin: ctx.stdin });
    if (!isObject(query) || Object.entries(query).some(([key, value]) => !operation.query.includes(key) ||
        !['string', 'boolean', 'number'].includes(typeof value) && !(operation.repeatedQuery?.includes(key) && Array.isArray(value) && value.every(item => typeof item === 'string'))))
      throw new CliError('Use native supported query keys and scalar values; repeated query keys also accept arrays of strings.', { code: 'invalid_arguments' });
    for (const [key, value] of Object.entries(query)) {
      if (Array.isArray(value)) for (const item of value) url.searchParams.append(key, item);
      else url.searchParams.set(key, String(value));
    }
  }
  let body;
  if (operation.input) {
    body = await readJsonInput(args.required('request-json', args.value('file')), 'Application request', { stdin: ctx.stdin });
    if (!isObject(body)) throw new CliError('The application request must be an object.', { code: 'invalid_arguments' });
    registerSecrets(reporter, body);
    if (operation.path === 'retail conversation start') body.source ??= 'retail-assistant';
  }
  const details = { application: target.host, applicationId: target.appId, server: target.profile.server, tenantId: target.identity.tenantId, userId: target.identity.userId,
    operation: operation.path, target: Object.fromEntries([...operation.route.matchAll(/\{([^}]+)\}/g)].map(([, name]) => [name, args.value(name)])),
    ...Object.fromEntries(['requestId', 'agentId'].filter(key => typeof body?.[key] === 'string').map(key => [key, body[key]])) };
  const command = operation.path === 'retail session command';
  const call = async () => {
    const result = memberValue(await target.send(operation.method, url.pathname + url.search, { json: body }));
    if (operation.draft && (result?.status !== 'Saved' || typeof result.internetMessageId !== 'string' || !result.internetMessageId))
      throw new CliError('The mailbox did not return a saved draft receipt.', { code: 'invalid_response' });
    if (command && !commandOutcome(result)) throw new CliError('The Runtime command receipt is invalid.', { code: 'invalid_response' });
    return result;
  };
  const result = operation.method === 'GET' || operation.readOnly ? await call() : await writeOnce(call,
    'The application outcome is unknown. Read the same customer, conversation or mailbox using the same identity before another write. Do not replay this request or batch.', details);
  if (command && commandOutcome(result) === 'failed') throw new CliError('The Runtime command reported failure.', { code: 'execution_failed', details: { ...details, result } });
  reporter.print(result); return true;
}
