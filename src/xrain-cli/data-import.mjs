import { randomBytes } from 'node:crypto';
import { openAsBlob } from 'node:fs';
import { link, lstat, open, stat, unlink } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { CliError, isObject, nonempty, parseJson, readJsonInput, segment } from './core.mjs';
import { responseError } from './http.mjs';

const protocol = 'xrain-import-jobs-v1';
const mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const jsonLimit = 32 * 1024 * 1024;
const idPattern = /^[0-9a-f]{32}$/i;
const statuses = new Set(['checking', 'invalid', 'ready', 'queued', 'running', 'paused', 'completed', 'canceled', 'expired']);
const defaultOptions = { uniqueField: 'Id', filePurpose: 'sourceImport', blankPolicy: 'preserve' };
const invalid = message => new CliError(message, { code: 'invalid_arguments' });
const invalidResponse = message => new CliError(message, { code: 'invalid_response' });

export async function exportRecordsFile(ctx) {
  const controller = new AbortController(), interrupt = () => controller.abort();
  process.on('SIGINT', interrupt);
  try {
    const client = makeClient(ctx, controller.signal);
    const body = await readJsonInput(ctx.args.required('request-json', ctx.args.value('file')), 'Export request');
    if (!isObject(body) || !isObject(body.query)) throw invalid('Export request requires a query object.');
    const capabilities = await jsonRequest(client, 'GET', `${client.root}/exports/capabilities`);
    if (!Number.isSafeInteger(capabilities?.maximumFileBytes) || capabilities.maximumFileBytes < 1)
      throw invalidResponse('This server does not advertise a supported export file limit.');
    const value = await saveFile(client, 'POST', `${client.root}/records:exportFile`, ctx.args.required('out'), capabilities.maximumFileBytes, body);
    ctx.reporter.print({ entityCode: client.entity, ...value });
  } finally { process.removeListener('SIGINT', interrupt); }
}

function requireId(value, label) {
  if (!idPattern.test(value ?? '')) throw invalid(`${label} must be 32 hexadecimal characters.`);
  return value.toLowerCase();
}

function makeClient(ctx, signal) {
  const profile = ctx.store.resolve(ctx.args, true);
  const { token, source } = ctx.store.credential(ctx.args, profile, { createSecrets: false });
  if (ctx.args.value('auth') === 'session' && !token)
    throw new CliError('A matching browser session is required.', { code: 'authentication_required', hint: 'Run auth status, then auth login for this profile.' });
  const application = ctx.args.value('application');
  if (application !== undefined && (application.length > 100 || application !== application.trim() || /[\x00-\x1f\x7f,]/.test(application))) throw invalid('--application is invalid.');
  const entity = ctx.args.required('entity');
  const root = `/api/data/v1/entities/${segment(entity)}`;
  return { profile, source, token, signal, entity, root, timeout: ctx.args.timeout(), application };
}

function abortError(client, error, deadline) {
  if (error instanceof CliError) return error;
  if (client.signal.aborted) return new CliError('Stopped locally; the server job may still be running.', { code: 'interrupted' });
  if (deadline !== undefined && performance.now() >= deadline)
    return new CliError('Stopped waiting; the server job may still be running.', { code: 'import_wait_timeout' });
  if (['TimeoutError', 'AbortError'].includes(error?.name))
    return new CliError('HTTP request timed out.', { code: 'timeout', hint: 'Check connectivity or set --timeout.' });
  return new CliError('HTTP request failed. Check the server URL and connectivity.', { code: 'network_error' });
}

async function send(client, method, path, { json, body, deadline, accept = 'application/json' } = {}) {
  const remaining = deadline === undefined ? Infinity : deadline - performance.now();
  if (remaining <= 0) throw abortError(client, new Error(), deadline);
  const timeout = Math.max(1, Math.ceil(Math.min(client.timeout, remaining)));
  const headers = new Headers({ Accept: accept, 'Accept-Encoding': 'identity' });
  if (client.token) headers.set('Authorization', `Bearer ${client.token}`);
  if (client.application) headers.set('X-XRain-Import-Application', client.application);
  const request = { method, headers, signal: AbortSignal.any([client.signal, AbortSignal.timeout(timeout)]) };
  if (json !== undefined) { headers.set('Content-Type', 'application/json'); request.body = JSON.stringify(json); }
  else if (body !== undefined) request.body = body;
  try { return await fetch(new URL(path, client.profile.server), request); }
  catch (error) { throw abortError(client, error, deadline); }
}

async function boundedBytes(client, response, limit, deadline) {
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > limit)) {
    await response.body?.cancel();
    throw invalidResponse('The server response exceeds the supported size or has an invalid length.');
  }
  const chunks = []; let size = 0;
  try {
    if (response.body) for await (const chunk of response.body) {
      size += chunk.length;
      if (size > limit) throw invalidResponse('The server response exceeds the supported size.');
      chunks.push(chunk);
    }
  } catch (error) { throw abortError(client, error, deadline); }
  return Buffer.concat(chunks);
}

async function requireResponse(client, response, deadline) {
  if (response.ok) return response;
  const bytes = await boundedBytes(client, response, jsonLimit, deadline);
  throw responseError({ ok: false, status: response.status, headers: response.headers,
    json: () => parseJson(bytes, 'Server response') }, '', { credentialSource: client.source, profile: client.profile.name });
}

async function jsonRequest(client, method, path, options = {}) {
  const response = await send(client, method, path, options);
  await requireResponse(client, response, options.deadline);
  const bytes = await boundedBytes(client, response, jsonLimit, options.deadline);
  try { return parseJson(bytes, 'Server response'); }
  catch { throw invalidResponse('The server returned invalid JSON.'); }
}

function validatedJob(value, entity, expectedId, expectedRequest) {
  const counts = value?.progress && ['sourceRows', 'checkedSourceRows', 'outputRows', 'committedOutputRows', 'remainingOutputRows']
    .map(key => value.progress[key]);
  const summary = value?.summary && ['sourceRows', 'outputRows', 'created', 'updated', 'deleted', 'unchanged', 'notFoundSkipped',
    'transformSkipped', 'clearedFields', 'sourceErrors', 'outputErrors'].map(key => value.summary[key]);
  if (!isObject(value) || value.entityCode !== entity || value.protocol !== protocol || value.commitMode !== 'chunked' ||
      !idPattern.test(value.jobId ?? '') || !idPattern.test(value.requestId ?? '') ||
      (expectedId && value.jobId.toLowerCase() !== expectedId) || (expectedRequest && value.requestId.toLowerCase() !== expectedRequest) ||
      !statuses.has(value.status) || !Number.isSafeInteger(value.version) || value.version < 0 ||
      !Number.isSafeInteger(value.planRevision) || value.planRevision < 0 || !nonempty(value.phase) ||
      !counts || counts.some(count => !Number.isSafeInteger(count) || count < 0) || !isObject(value.summary) ||
      !summary || summary.some(count => !Number.isSafeInteger(count) || count < 0) ||
      !['planned', 'processed'].includes(value.summaryKind) || !['complete', 'partial', 'unavailable'].includes(value.detailsStatus) ||
      !Number.isFinite(Date.parse(value.createdAt)) || !Number.isFinite(Date.parse(value.updatedAt)) ||
      ['canConfirm', 'canContinue', 'canRecheck', 'pauseRequested', 'cancelRequested', 'sourceComplete', 'canDownloadRemaining']
        .some(key => typeof value[key] !== 'boolean') ||
      (value.viewVersion != null && !nonempty(value.viewVersion)))
    throw invalidResponse('The server returned an invalid or mismatched import job.');
  return value;
}

async function capabilities(client, options, requireSupported = true, deadline) {
  const value = await jsonRequest(client, 'GET', `${client.root}/imports/capabilities`, { deadline });
  const jobs = value?.jobs;
  if (!isObject(value) || value.entityCode !== client.entity || !isObject(jobs) || jobs.protocol !== protocol ||
      !Array.isArray(jobs.commitModes) || !jobs.commitModes.includes('chunked') ||
      !Number.isSafeInteger(jobs.limits?.maximumFileBytes) || jobs.limits.maximumFileBytes <= 0)
    throw new CliError('This server does not advertise the required import job protocol and file limit.', { code: 'import_jobs_unavailable' });
  if (requireSupported && jobs.supported !== true)
    throw new CliError('Chunked import is unavailable for this object.', { code: 'import_jobs_unavailable', details: { reasons: jobs.unavailableReasons ?? [] } });
  const orchestrationId = options?.importBinding?.orchestrationId;
  if (requireSupported && orchestrationId) {
    const definition = Array.isArray(value.orchestrations) && value.orchestrations.find(item => item.id === orchestrationId);
    const contract = definition?.import;
    if (!contract || contract.version !== 2 || ['transform', 'normalizeIdentity', 'prepareRecord', 'validate']
      .some(phase => !(phase === 'transform' && options.filePurpose === 'recordMaintenance') &&
        contract[phase] === true && contract.phaseScopes?.[phase] !== 'independentRows'))
      throw new CliError('The selected import binding does not advertise independent processing for every enabled stage.', {
        code: 'import_binding_unavailable', hint: 'Inspect the current object and import binding before continuing.' });
  }
  return jobs;
}

async function importOptions(args) {
  const value = args.has('options-json') ? await readJsonInput(args.value('options-json'), 'Import options') : { ...defaultOptions };
  if (!isObject(value) || Buffer.byteLength(JSON.stringify(value)) > 65536) throw invalid('Import options must be a JSON object of at most 65536 bytes.');
  return value;
}

function query(fields) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  return params.size ? `?${params}` : '';
}

function pageSize(args) {
  const value = args.integer('page-size', 50);
  if (value > 200) throw invalid('--page-size cannot exceed 200.');
  return value;
}

function hint(entity, jobId, requestId) {
  return jobId ? `Use data import show --entity ${JSON.stringify(entity)} --job ${jobId} with the same server, identity, tenant and application.` :
    `Use data import list --entity ${JSON.stringify(entity)} --request-id ${requestId} with the same server, identity, tenant and application before retrying.`;
}

function contextualError(error, entity, requestId, job, knownJobId) {
  const code = error.code ?? 'operation_failed';
  const serverRequestId = error.requestId;
  const id = job?.requestId ?? requestId, jobId = job?.jobId ?? knownJobId;
  return new CliError(error.message, { code, httpStatus: error.httpStatus, serverCode: error.serverCode,
    requestId: id ?? serverRequestId,
    hint: [id || jobId ? hint(entity, jobId, id) : undefined, error.hint].filter(Boolean).join(' ') || undefined,
    details: { ...error.details, ...(serverRequestId && serverRequestId !== id ? { serverRequestId } : {}),
      ...(id ? { requestId: id } : {}), ...(jobId ? { jobId } : {}), ...(job ? { job } : {}) } });
}

function outputJob(ctx, job) {
  const committed = job.progress.committedOutputRows;
  const message = job.status === 'ready' ? (committed ? `已提交 ${committed} 条，剩余资料预检通过，待确认。` : '预检通过，待确认。') :
    job.status === 'completed' ? '导入完成。' : job.status === 'paused' ? '导入已暂停，可按允许的操作继续。' :
    job.status === 'canceled' ? '本次导入已结束；已提交的记录保留。' :
    job.status === 'invalid' ? '预检未通过，请查看问题。' :
    job.status === 'expired' ? '预检计划已过期，请查看可用操作。' :
    job.cancelRequested ? '结束请求已记录，正在等待当前处理结束。' :
    job.pauseRequested ? '暂停请求已记录，正在等待当前处理结束。' :
    job.status === 'checking' ? '文件正在预检，尚未确认写入。' : '请求已受理；请查看作业状态。';
  ctx.reporter.print({ ...job, message });
  return 0;
}

function waitDecision(job, mode) {
  if (mode === 'pause' && ['paused', 'completed'].includes(job.status)) return 'success';
  if (mode === 'cancel' && ['canceled', 'completed'].includes(job.status)) return 'success';
  if (mode === 'check' && ['ready', 'completed'].includes(job.status)) return 'success';
  if (mode === 'observe' && ['ready', 'completed'].includes(job.status)) return 'success';
  if (mode === 'execute' && job.status === 'completed') return 'success';
  if (['invalid', 'paused', 'expired', 'canceled'].includes(job.status) || (mode === 'execute' && job.status === 'ready')) return 'failure';
  return 'continue';
}

async function waitJob(ctx, client, initial, mode, deadline) {
  let job = initial, lastVersion;
  for (;;) {
    const decision = waitDecision(job, mode);
    if (decision === 'success') return job;
    if (decision === 'failure') throw new CliError(`Import stopped in state ${job.status}.`, { code: 'import_job_stopped', details: { job } });
    if (job.version !== lastVersion) ctx.reporter.progress(`Import ${job.jobId}: ${job.status}; committed ${job.progress.committedOutputRows}.`);
    lastVersion = job.version;
    const left = deadline - performance.now();
    if (left <= 0) throw new CliError('Stopped waiting; the server job may still be running.', { code: 'import_wait_timeout', details: { job } });
    try { await delay(Math.min(ctx.args.integer('poll-interval', 2) * 1000, left), undefined, { signal: client.signal }); }
    catch (error) { throw contextualError(abortError(client, error, deadline), client.entity, job.requestId, job); }
    if (performance.now() >= deadline) throw new CliError('Stopped waiting; the server job may still be running.', { code: 'import_wait_timeout', details: { job } });
    try {
      const next = validatedJob(await jsonRequest(client, 'GET', `${client.root}/imports/jobs/${segment(job.jobId)}`, { deadline }), client.entity, job.jobId.toLowerCase(), job.requestId.toLowerCase());
      if (next.version < job.version) throw invalidResponse('The server returned an older import job state.');
      job = next;
    } catch (error) { throw contextualError(error, client.entity, job.requestId, job); }
  }
}

async function checkDestination(path) {
  try { await lstat(path); throw new CliError('Output already exists. Choose a new path.', { code: 'output_exists' }); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}

export async function saveFile(client, method, path, outputPath, limit, json, { contentType = mime, expectedBytes, allowEmpty = false } = {}) {
  const output = resolve(outputPath);
  await checkDestination(output);
  const response = await send(client, method, path, { json, accept: contentType ?? '*/*' });
  await requireResponse(client, response);
  const returnedType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  const encoding = response.headers.get('content-encoding');
  const contentLength = response.headers.get('content-length');
  if ((contentType && returnedType !== contentType.split(';', 1)[0].trim().toLowerCase()) || (encoding && encoding.toLowerCase() !== 'identity') ||
      (contentLength !== null && (!/^\d+$/.test(contentLength) || Number(contentLength) > limit))) {
    await response.body?.cancel();
    throw invalidResponse('The download has an invalid content type, encoding or length.');
  }
  const temporary = join(dirname(output), `.${basename(output)}.${randomBytes(12).toString('hex')}.part`);
  let file, created = false, size = 0;
  try {
    file = await open(temporary, 'wx', 0o600); created = true;
    if (response.body) for await (const chunk of response.body) {
      size += chunk.length;
      if (size > limit) throw invalidResponse('The download exceeds the import file limit.');
      let offset = 0;
      while (offset < chunk.length) {
        const result = await file.write(chunk, offset, chunk.length - offset);
        if (!result.bytesWritten) throw new Error('Failed to write download.');
        offset += result.bytesWritten;
      }
    }
    if ((!allowEmpty && !size) || (contentLength !== null && size !== Number(contentLength)) || (expectedBytes !== undefined && size !== expectedBytes)) throw invalidResponse('The download was incomplete.');
    await file.sync(); await file.close(); file = undefined;
    // A same-directory hard link is an atomic create that cannot replace a file
    // created by another process after the initial destination check.
    await link(temporary, output);
  } catch (error) {
    if (error.code === 'EEXIST') throw new CliError('Output already exists. Choose a new path.', { code: 'output_exists' });
    if (error instanceof CliError) throw error;
    if (client.signal.aborted) throw abortError(client, error);
    if (['TimeoutError', 'AbortError'].includes(error.name)) throw abortError(client, error);
    if (error.code && !['ECONNRESET', 'EPIPE', 'UND_ERR_SOCKET'].includes(error.code)) throw error;
    throw new CliError('The download did not complete; the existing destination was preserved.', { code: 'download_incomplete' });
  } finally {
    if (file) await file.close().catch(() => {});
    if (created) await unlink(temporary).catch(() => {});
  }
  return { output, bytes: size };
}

export async function dataImportCommands(ctx) {
  const { args, reporter } = ctx;
  const action = args.command(2);
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.on('SIGINT', interrupt);
  let client, requestId, job, requestedJobId;
  try {
    client = makeClient(ctx, controller.signal);
    const root = `${client.root}/imports/jobs`;
    const wait = action === 'wait' || args.has('wait');
    const deadline = wait ? performance.now() + args.integer('wait-timeout', 300) * 1000 : undefined;
    if (action === 'template') {
      const options = await importOptions(args), out = args.required('out');
      const jobs = await capabilities(client, options, true, deadline);
      reporter.print(await saveFile(client, 'POST', `${client.root}/imports/template`, out, jobs.limits.maximumFileBytes, options));
      return 0;
    }
    if (action === 'check') {
      requestId = requireId(args.value('request-id') ?? randomBytes(16).toString('hex'), '--request-id');
      reporter.progress(`Request ID: ${requestId}. ${hint(client.entity, undefined, requestId)}`);
      const options = await importOptions(args), input = resolve(args.required('file'));
      if (extname(input).toLowerCase() !== '.xlsx') throw invalid('--file must be an XLSX file.');
      const jobs = await capabilities(client, options, true, deadline);
      const info = await stat(input);
      if (!info.isFile() || info.size < 1 || info.size > jobs.limits.maximumFileBytes) throw invalid('The XLSX is empty, not a regular file, or exceeds the server file limit.');
      const blob = await openAsBlob(input, { type: mime });
      if (blob.size !== info.size || blob.size > jobs.limits.maximumFileBytes) throw invalid('The XLSX changed or exceeds the server file limit.');
      const form = new FormData();
      form.set('file', blob, 'import.xlsx'); form.set('options', JSON.stringify(options)); form.set('requestId', requestId);
      form.set('coordination', protocol); form.set('commitMode', 'chunked');
      job = validatedJob(await jsonRequest(client, 'POST', root, { body: form, deadline }), client.entity, undefined, requestId);
      if (wait) job = await waitJob(ctx, client, job, 'check', deadline);
      return outputJob(ctx, job);
    }
    if (action === 'list') {
      if (args.has('request-id')) requestId = requireId(args.value('request-id'), '--request-id');
      const filter = { requestId, importSourceKey: args.value('import-source-key'), status: args.value('status'), cursor: args.value('cursor'), pageSize: pageSize(args) };
      const result = await jsonRequest(client, 'GET', root + query(filter));
      if (!isObject(result) || !Array.isArray(result.items) || (result.nextCursor != null && !nonempty(result.nextCursor))) throw invalidResponse('The import job list is invalid.');
      for (const item of result.items) validatedJob(item, client.entity, undefined, requestId);
      reporter.print(result); return 0;
    }
    const jobId = requestedJobId = requireId(args.required('job'), '--job');
    const path = `${root}/${segment(jobId)}`;
    if (action === 'download') {
      const purpose = args.required('purpose'), out = args.required('out');
      if (!['result', 'issues', 'maintenance', 'remaining'].includes(purpose)) throw invalid('--purpose must be result, issues, maintenance or remaining.');
      const jobs = await capabilities(client, undefined, false);
      reporter.print({ jobId, purpose, ...await saveFile(client, 'GET', `${path}/file${query({ purpose })}`, out, jobs.limits.maximumFileBytes) });
      return 0;
    }
    if (action === 'show' || action === 'wait') {
      job = validatedJob(await jsonRequest(client, 'GET', path, { deadline }), client.entity, jobId);
      if (wait) job = await waitJob(ctx, client, job, 'observe', deadline);
      return outputJob(ctx, job);
    }
    if (action === 'rows' || action === 'issues') {
      let viewVersion = args.value('view-version');
      if (!viewVersion) {
        job = validatedJob(await jsonRequest(client, 'GET', path), client.entity, jobId);
        viewVersion = job.viewVersion;
      }
      if (!nonempty(viewVersion)) throw new CliError('The job does not yet have a readable view.', { code: 'import_job_view_not_ready' });
      const fields = { viewVersion, cursor: args.value('cursor'), pageSize: pageSize(args),
        sourceRow: args.integer('source-row'), ...(action === 'rows' ? { action: args.value('action'), matchValue: args.value('match-value') } : { code: args.value('code') }) };
      const result = await jsonRequest(client, 'GET', `${path}/${action}${query(fields)}`);
      if (!isObject(result) || result.viewVersion !== viewVersion || !Array.isArray(result.items) ||
          !Number.isSafeInteger(result.planRevision) || result.planRevision < 0 || !Number.isSafeInteger(result.totalCount) || result.totalCount < 0 ||
          !['complete', 'partial', 'unavailable'].includes(result.detailsStatus) || (result.nextCursor != null && !nonempty(result.nextCursor)))
        throw invalidResponse('The import page is invalid or belongs to another view.');
      reporter.print(result); return 0;
    }
    let body, mode;
    if (action === 'confirm') { body = { planRevision: args.integer('plan-revision'), commitMode: 'chunked' }; mode = 'execute'; }
    else if (action === 'resume') {
      const resume = args.required('action');
      if (!['continue', 'recheck'].includes(resume)) throw invalid('--action must be continue or recheck.');
      const revision = args.required('plan-revision');
      if (!/^\d+$/.test(revision) || !Number.isSafeInteger(Number(revision))) throw invalid('--plan-revision must be a nonnegative integer.');
      body = { planRevision: Number(revision), action: resume }; mode = resume === 'recheck' ? 'check' : undefined;
    } else if (action === 'pause' || action === 'cancel') mode = action;
    else throw invalid('Unknown import command. Run data import --help.');
    if (action === 'confirm' && !body.planRevision) throw invalid('--plan-revision is required.');
    job = validatedJob(await jsonRequest(client, 'POST', `${path}/${action}`, { json: body, deadline }), client.entity, jobId);
    if (action === 'resume' && !mode) mode = job.status === 'checking' || job.status === 'ready' ? 'check' : 'execute';
    if (wait) job = await waitJob(ctx, client, job, mode, deadline);
    return outputJob(ctx, job);
  } catch (error) {
    const last = error.details?.job ?? job;
    if (client && (requestId || last || requestedJobId)) throw contextualError(error, client.entity, requestId, last, requestedJobId);
    throw error;
  } finally { process.removeListener('SIGINT', interrupt); }
}
