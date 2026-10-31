import { setTimeout as delay } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import { CliError, isObject, nonempty, randomId, readJsonInput, segment } from './core.mjs';
import { requireSuccess, writeOnce } from './http.mjs';

const activeStatuses = new Set(['Pending', 'Running', 'Finalizing']);
const statuses = new Set([...activeStatuses, 'WaitingForResolution', 'Succeeded', 'Failed', 'Cancelled']);
const installFields = ['versionId', 'expectedRevision', 'tenantBindings', 'confirmations', 'maintainInstalledVersion'];
const requestFields = {
  preview: installFields,
  install: [...installFields, 'requestId'],
  resolve: ['expectedRevision', 'resolutions', 'tenantBindings', 'confirmations', 'configurationChanges'],
  retry: ['requestId', 'expectedRevision'],
  uninstall: ['requestId', 'expectedRevision'],
  'policy-apply': ['targetPolicyVersion', 'expectedRevision', 'restorePackageProperties', 'tenantBindings', 'configurationChanges', 'confirmations', 'requestId'],
  'policy-convert': ['targetPolicyVersion', 'expectedRevision'],
};
const invalid = message => new CliError(message, { code: 'invalid_arguments' });

// Impact tokens bind an explicit decision to the server's current preview. They
// are not login credentials. Exempt only these DTO fields, never arbitrary tokens
// in bindings, plans, server errors or other commands (including batch steps).
export function exposeApplicationConfirmations(reporter, value) {
  for (const container of [value, value?.details]) {
    if (!Array.isArray(container?.requiredConfirmations)) continue;
    for (const item of container.requiredConfirmations) {
      if (isObject(item) && nonempty(item.recordId) && nonempty(item.unit) && nonempty(item.token))
        reporter.visibleField(item, 'token');
    }
  }
}

function output(ctx, value) {
  exposeApplicationConfirmations(ctx.reporter, value);
  ctx.reporter.print(value);
  return 0;
}

async function input(args, action) {
  const path = args.value('request-json') ?? args.value('file');
  const value = path === undefined ? {} : await readJsonInput(path, 'Application request');
  if (!isObject(value)) throw invalid('Application request must be a JSON object.');
  if (Object.keys(value).some(key => !requestFields[action].includes(key)))
    throw invalid(`Unsupported ${action} request field. Allowed fields: ${requestFields[action].join(', ')}.`);
  const body = { ...value };
  for (const [option, field] of [['version-id', 'versionId'], ['expected-revision', 'expectedRevision'],
    ['request-id', 'requestId'], ['maintain-installed-version', 'maintainInstalledVersion']]) {
    if (!args.has(option)) continue;
    if (Object.hasOwn(body, field)) throw invalid(`Supply ${field} in JSON or --${option}, not both.`);
    const raw = args.value(option);
    if (option === 'expected-revision' && !/^[0-9]+$/.test(raw)) throw invalid('--expected-revision must be a nonnegative integer.');
    body[field] = option === 'expected-revision' ? Number(raw) : raw;
  }
  if (['preview', 'install'].includes(action) && !nonempty(body.versionId))
    throw invalid('An exact versionId is required via --version-id or --request-json. Use app versions to select it.');
  if ((body.expectedRevision != null && (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0)) ||
    (['resolve', 'uninstall'].includes(action) && body.expectedRevision == null))
    throw invalid('expectedRevision must be a nonnegative safe integer; resolve requires the revision you inspected.');
  if (body.requestId != null && (typeof body.requestId !== 'string' || body.requestId.length !== 20 || !/^apo[A-Za-z0-9]{17}$/.test(body.requestId)))
    throw invalid('requestId must be a 20-character operation ID starting with apo.');
  if (Object.hasOwn(body, 'maintainInstalledVersion') && typeof body.maintainInstalledVersion !== 'boolean')
    throw invalid('maintainInstalledVersion must be a boolean.');
  for (const field of ['tenantBindings', 'resolutions', 'configurationChanges'])
    if (body[field] != null && !isObject(body[field])) throw invalid(`${field} must be a JSON object.`);
  if (body.confirmations != null && (!Array.isArray(body.confirmations) || body.confirmations.some(item =>
    !isObject(item) || !nonempty(item.recordId) || !nonempty(item.unit) || !nonempty(item.token))))
    throw invalid('confirmations must contain the chosen server-provided {recordId,unit,token} entries.');
  return body;
}

function operationResponse(value, expectedId, expectedVersion, previous) {
  if (!isObject(value) || value.id !== expectedId || !nonempty(value.installationId) || !statuses.has(value.status) ||
    (expectedVersion !== undefined && value.targetVersionId !== expectedVersion) ||
    (previous && (value.installationId !== previous.installationId || value.targetVersionId !== previous.targetVersionId)))
    throw new CliError('The server returned an invalid or mismatched application operation.', { code: 'invalid_response' });
  return value;
}

function queryHint(id) {
  return `Use app operation show --operation ${id} with the same target/profile before any further write.`;
}

function contextualError(error, context, operation) {
  const needsQuery = !error.httpStatus || error.httpStatus >= 500;
  const recovery = context.operationId ? queryHint(context.operationId) :
    `Use app versions --package ${context.packageId} with the same platform profile to check whether the import was accepted.`;
  return new CliError(error instanceof CliError ? error.message : 'Application request failed.', {
    code: error.code ?? 'operation_failed', httpStatus: error.httpStatus, serverCode: error.serverCode, requestId: error.requestId,
    hint: needsQuery && !error.code?.startsWith('operation_') ? [recovery, error.hint].filter(Boolean).join(' ') : error.hint,
    details: { ...error.details, ...context, ...(operation ? { operation } : {}) },
  });
}

function operationError(operation, code, message, hint) {
  return new CliError(message, { code, serverCode: operation.errorCode ?? undefined, hint,
    details: { operationId: operation.id, installationId: operation.installationId, operation } });
}

function checkOutcome(operation, cancel = false) {
  if (operation.status === 'WaitingForResolution') throw operationError(operation, 'operation_requires_resolution',
    'The operation requires input; installation has not completed.',
    'Inspect requiredBindings, requiredConfirmations and conflicts, then use app operation resolve with the current expectedRevision and your choices.');
  if (operation.status === 'Failed') throw operationError(operation, 'operation_failed', 'The application operation failed.',
    'Inspect errorCode and details. Correct the cause before an explicit retry; requiresResubmission needs the original change submitted again.');
  if (operation.status === 'Cancelled' && !cancel) throw operationError(operation, 'operation_cancelled', 'The application operation was cancelled.',
    'Inspect the current installation before starting a new change.');
}

function waitSettings(args, wait) {
  return { deadline: wait ? performance.now() + args.integer('wait-timeout', 300) * 1000 : undefined,
    interval: args.integer('poll-interval', 2) * 1000 };
}

function remaining(settings) {
  return settings.deadline === undefined ? undefined : Math.max(1, Math.ceil(settings.deadline - performance.now()));
}

async function waitOperation(ctx, api, operation, settings) {
  let lastStatus;
  while (activeStatuses.has(operation.status)) {
    if (operation.status !== lastStatus) ctx.reporter.progress(`Operation ${operation.id}: ${operation.status}.`);
    lastStatus = operation.status;
    const left = settings.deadline - performance.now();
    if (left <= 0) throw operationError(operation, 'operation_wait_timeout', 'Stopped waiting; the server operation may still be running.',
      `Use app operation wait --operation ${operation.id} with the same target/profile to resume observation.`);
    await delay(Math.min(settings.interval, left));
    if (performance.now() >= settings.deadline) continue;
    try {
      const response = requireSuccess(await api.send('GET', `${api.root}/operations/${segment(operation.id)}`, { timeout: remaining(settings) }));
      operation = operationResponse(response.json(), operation.id, undefined, operation);
    } catch (error) {
      if (error.code === 'timeout' && performance.now() >= settings.deadline)
        throw operationError(operation, 'operation_wait_timeout', 'Stopped waiting; the server operation may still be running.',
          `Use app operation wait --operation ${operation.id} with the same target/profile to resume observation.`);
      throw contextualError(error, { operationId: operation.id, installationId: operation.installationId }, operation);
    }
  }
  return operation;
}

async function submit(ctx, api, path, body, context, { cancel = false, method = 'POST' } = {}) {
  const settings = waitSettings(ctx.args, ctx.args.has('wait'));
  let operation;
  ctx.reporter.progress(`Submitting operation ${context.operationId}. Keep this ID if the response is interrupted.`);
  try {
    const response = requireSuccess(await api.send(method, path, { ...(body === undefined ? {} : { json: body }), timeout: remaining(settings) }));
    operation = operationResponse(response.json(), context.operationId, context.versionId);
    if (context.installationId && operation.installationId !== context.installationId)
      throw new CliError('The operation does not belong to the requested installation.', { code: 'invalid_response' });
    if (ctx.args.has('wait')) operation = await waitOperation(ctx, api, operation, settings);
    checkOutcome(operation, cancel);
    return output(ctx, operation);
  } catch (error) {
    // A waiting error carries the latest observation, which may be newer than the
    // POST response. Retain it even when the polling helper exits by throwing.
    const latest = error.details?.operation ?? operation;
    exposeApplicationConfirmations(ctx.reporter, latest);
    throw contextualError(error, context, latest);
  }
}

export async function appManagementCommands(ctx, createClient) {
  const { args } = ctx;
  const action = args.command(1);
  if (action === 'components') {
    const packageId = args.required('package'), versionId = args.required('version-id'), api = createClient();
    return output(ctx, requireSuccess(await api.send('GET', `${api.root}/packages/${segment(packageId)}/versions/${segment(versionId)}/components`)).json());
  }
  if (action === 'withdraw') {
    const packageId = args.required('package'), requestId = args.required('request-id'), api = createClient();
    return output(ctx, await writeOnce(async () => operationResponse(requireSuccess(await api.send('POST', `${api.root}/packages/${segment(packageId)}/requests/${segment(requestId)}/withdraw`)).json(), requestId),
      'Withdrawal outcome is unknown. Read the original package and submission before another write.', { packageId, requestId }));
  }
  if (action === 'uninstall') {
    const installationId = args.required('installation'), body = await input(args, 'uninstall'), api = createClient();
    body.requestId ??= randomId('apo');
    return writeOnce(() => submit(ctx, api, `${api.root}/installations/${segment(installationId)}`, body,
      { installationId, requestId: body.requestId, operationId: body.requestId }, { method: 'DELETE' }), queryHint(body.requestId), { installationId, operationId: body.requestId });
  }
  if (action === 'policy') {
    const installationId = args.required('installation'), api = createClient();
    if (args.command(2) === 'preview') return output(ctx, requireSuccess(await api.send('POST', `${api.root}/installations/${segment(installationId)}/policy:preview`)).json());
    const body = await input(args, 'policy-apply');
    if (!Number.isSafeInteger(body.targetPolicyVersion) || body.targetPolicyVersion < 1 || body.expectedRevision == null)
      throw invalid('Policy application requires targetPolicyVersion and expectedRevision.');
    body.requestId ??= randomId('apo');
    return writeOnce(() => submit(ctx, api, `${api.root}/installations/${segment(installationId)}/policy:apply`, body,
      { installationId, requestId: body.requestId, operationId: body.requestId }), queryHint(body.requestId), { installationId, operationId: body.requestId });
  }
  if (action === 'component') {
    const installationId = args.required('installation'), recordId = args.required('id'), api = createClient();
    if (!args.has('expected-revision')) throw invalid('--expected-revision is required. Read the original installation first.');
    const rawRevision = args.value('expected-revision');
    if (!/^[0-9]+$/.test(rawRevision) || !Number.isSafeInteger(Number(rawRevision))) throw invalid('--expected-revision must be a nonnegative safe integer.');
    const result = await writeOnce(async () => {
      const value = requireSuccess(await api.send('POST', `${api.root}/installations/${segment(installationId)}/components/${segment(recordId)}:restore`, { json: { expectedRevision: Number(rawRevision) } })).json();
      if (value?.id !== installationId) throw new CliError('The restored installation does not match the target.', { code: 'invalid_response' });
      return value;
    }, 'Restore outcome is unknown. Read the original installation and component before another write.', { installationId, recordId });
    return output(ctx, result);
  }
  if (action === 'list' || action === 'versions') {
    const api = createClient();
    const path = action === 'list' ? '/packages' : `/packages/${segment(args.required('package'))}/versions`;
    const result = requireSuccess(await api.send('GET', api.root + path)).json();
    if (!Array.isArray(result)) throw new CliError('The server returned an invalid application list.', { code: 'invalid_response' });
    return output(ctx, result);
  }
  if (action === 'import') {
    const packageId = args.required('package'), versionId = args.required('version-id');
    const api = createClient();
    try {
      const result = requireSuccess(await api.send('POST', `${api.root}/exchange/packages/${segment(packageId)}/versions/${segment(versionId)}:import`)).json();
      if (result?.packageId !== packageId || result?.versionId !== versionId)
        throw new CliError('The import response does not match the requested package version.', { code: 'invalid_response' });
      return output(ctx, result);
    } catch (error) { throw contextualError(error, { packageId, versionId }); }
  }
  if (action === 'preview' || action === 'install') {
    const packageId = args.required('package');
    const body = await input(args, action), api = createClient();
    const path = `${api.root}/packages/${segment(packageId)}/${action}`;
    if (action === 'preview') {
      const result = requireSuccess(await api.send('POST', path, { json: body })).json();
      if (result?.targetVersionId !== body.versionId || typeof result.ready !== 'boolean')
        throw new CliError('The preview response does not match the requested version.', { code: 'invalid_response' });
      return output(ctx, result);
    }
    body.requestId ??= randomId('apo');
    return submit(ctx, api, path, body, { packageId, versionId: body.versionId, requestId: body.requestId, operationId: body.requestId });
  }
  if (action === 'installation') {
    const id = args.required('installation'), api = createClient();
    const sub = args.command(2);
    if (sub !== 'show') {
      const suffix = sub === 'components' ? '/components' : sub === 'history' ? '/operations?' + new URLSearchParams({ page: String(args.integer('page', 1)), pageSize: String(args.integer('page-size', 20)) }) : '/check';
      return output(ctx, requireSuccess(await api.send(sub === 'check' ? 'POST' : 'GET', `${api.root}/installations/${segment(id)}${suffix}`)).json());
    }
    const result = requireSuccess(await api.send('GET', `${api.root}/installations/${segment(id)}`)).json();
    if (result?.id !== id) throw new CliError('The installation response does not match the requested ID.', { code: 'invalid_response' });
    return output(ctx, result);
  }
  if (action === 'operation') {
    const id = args.required('operation'), operationAction = args.command(2);
    if (operationAction === 'policy-apply') {
      const body = await input(args, 'policy-convert'), api = createClient();
      if (!Number.isSafeInteger(body.targetPolicyVersion) || body.targetPolicyVersion < 1 || body.expectedRevision == null)
        throw invalid('Operation policy conversion requires targetPolicyVersion and expectedRevision.');
      return writeOnce(() => submit(ctx, api, `${api.root}/operations/${segment(id)}/policy:apply`, body, { operationId: id }), queryHint(id), { operationId: id });
    }
    const body = requestFields[operationAction] ? await input(args, operationAction) : undefined;
    if (operationAction === 'retry') {
      body.requestId ??= randomId('apo');
      if (body.requestId === id) throw invalid('Retry requires a new requestId, different from the failed operation ID.');
    }
    const api = createClient(), path = `${api.root}/operations/${segment(id)}`;
    if (operationAction === 'show' || operationAction === 'wait') {
      const settings = waitSettings(args, operationAction === 'wait');
      let operation;
      try {
        operation = operationResponse(requireSuccess(await api.send('GET', path, { timeout: remaining(settings) })).json(), id);
        if (operationAction === 'wait') {
          operation = await waitOperation(ctx, api, operation, settings);
          checkOutcome(operation);
        }
        return output(ctx, operation);
      } catch (error) {
        const latest = error.details?.operation ?? operation;
        exposeApplicationConfirmations(ctx.reporter, latest);
        throw contextualError(error, { operationId: id }, latest);
      }
    }
    const operationId = operationAction === 'retry' ? body.requestId : id;
    return submit(ctx, api, `${path}/${operationAction}`, body,
      { operationId, ...(operationAction === 'retry' ? { sourceOperationId: id, requestId: body.requestId } : {}) },
      { cancel: operationAction === 'cancel' });
  }
  throw invalid('Unknown application command. Run app --help.');
}
