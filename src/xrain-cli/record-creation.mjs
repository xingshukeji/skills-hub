import { CliError, isObject, nonempty } from './core.mjs';
import { apiValue } from './http.mjs';

export function creationKey(value) {
  if (!nonempty(value) || value.length > 160)
    throw new CliError('requestKey must be a nonempty string of at most 160 characters.', { code: 'invalid_arguments' });
  return value;
}

// The endpoint also accepts an API name or case variant; its canonical code may differ.
const isRecord = value => isObject(value) && nonempty(value.entityCode) && nonempty(value.recordId) && isObject(value.values);
const recovery = 'Use data creation-result with the same entity, --request-key, target and identity before another write. Keep the original key and values; the CLI does not retry automatically.';

function contextualError(error, entity, key, write = false) {
  if (!(error instanceof CliError)) return error;
  const unknown = write && (['network_error', 'timeout', 'invalid_response'].includes(error.code) || error.httpStatus === 408 || error.httpStatus >= 500);
  return new CliError(error.message, { code: unknown ? 'outcome_unknown' : error.code,
    httpStatus: error.httpStatus, serverCode: error.serverCode, requestId: error.requestId,
    hint: [error.hint, recovery].filter(Boolean).join(' '), details: { ...error.details, entityCode: entity, requestKey: key } });
}

export async function createRecord(ctx, entity, path, input) {
  const body = { ...input };
  if (ctx.args.has('request-key')) {
    if (Object.hasOwn(body, 'requestKey')) throw new CliError('Supply requestKey in JSON or --request-key, not both.', { code: 'invalid_arguments' });
    body.requestKey = ctx.args.value('request-key');
  }
  if (body.requestKey == null) {
    ctx.reporter.print(await apiValue(ctx, 'POST', path, body));
    return 0;
  }
  const key = creationKey(body.requestKey);
  ctx.reporter.progress(`Request key: ${key}`);
  try {
    const record = await apiValue(ctx, 'POST', path, body);
    if (!isRecord(record)) throw new CliError('The server returned an invalid creation receipt.', { code: 'invalid_response' });
    ctx.reporter.print(record);
    return 0;
  } catch (error) { throw contextualError(error, entity, key, true); }
}

export async function creationResult(ctx, entity, path) {
  const key = creationKey(ctx.args.required('request-key'));
  try {
    const value = await apiValue(ctx, 'POST', path + ':creationResult', { requestKey: key });
    if (!isObject(value) || !['unknown', 'completed'].includes(value.status) ||
        (value.status === 'completed' ? !isRecord(value.record) : value.record != null))
      throw new CliError('The server returned an invalid creation result.', { code: 'invalid_response' });
    ctx.reporter.print({ ...value, requestKey: key });
    return 0;
  } catch (error) { throw contextualError(error, entity, key); }
}
