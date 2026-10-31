import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { CliError, isObject, jsonInput, nonempty, readJsonInput, segment } from './core.mjs';
import { responseError } from './http.mjs';
import { sessionControl } from './runtime-controls.mjs';

const sessions = '/v1/dsh/sessions';
const pendingPath = '/v1/dsh/pending-actions';

export async function messageInput(args, stdin = process.stdin) {
  let value = args.value('message');
  const file = args.value('message-file');
  if (file) {
    let bytes;
    if (file === '-') {
      if (stdin.isTTY) throw new CliError('Pipe the message into stdin when using --message-file -.', { code: 'invalid_arguments' });
      const chunks = [];
      for await (const chunk of stdin) chunks.push(Buffer.from(chunk));
      bytes = Buffer.concat(chunks);
    } else bytes = await readFile(file);
    try { value = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { throw new CliError('Message file must be UTF-8 text.', { code: 'invalid_arguments' }); }
  }
  if (!nonempty(value)) throw new CliError('A nonempty message is required.', { code: 'invalid_arguments' });
  return value;
}
function textOf(value) {
  return isObject(value) && Array.isArray(value.content)
    ? value.content.filter(item => isObject(item) && item.type === 'text' && typeof item.text === 'string').map(item => item.text).join('') : '';
}
function eventOf(record) { return isObject(record) && isObject(record.event) && isObject(record.event.data) ? record.event : null; }
function sourceOf(data) {
  const message = isObject(data.message) ? data.message : data;
  return isObject(message.source) ? message.source : isObject(data.source) ? data.source : {};
}
function toolResult(data) {
  const message = isObject(data.message) ? data.message : {};
  const block = Array.isArray(message.content) ? message.content.find(part => isObject(part) && part.type === 'tool-result') : undefined;
  const callId = data.callId ?? message.toolCallId ?? block?.toolCallId ?? (isObject(message.source) ? message.source.callId : undefined);
  const failed = data.error !== undefined || message.isError === true || block?.isError === true;
  const recognized = message.role === 'tool' || !!block;
  return { callId, status: failed ? 'failed' : recognized ? 'succeeded' : 'unknown' };
}

function collector(requestId, expectedText) {
  let currentTurn, targetTurn, found = false, answer = '', result;
  const tools = new Map();
  function accept(event) {
    if (!event || result) return;
    const data = event.data;
    if (event.type === 'turn/start') {
      currentTurn = Number.isSafeInteger(data.turn) ? data.turn : undefined;
      if (found && targetTurn === undefined) targetTurn = currentTurn;
      return;
    }
    if (event.type === 'user/message') {
      const message = isObject(data.message) ? data.message : data;
      const source = sourceOf(data);
      if (source.rpcId === requestId && (expectedText === undefined || textOf(message) === expectedText)) {
        found = true;
        targetTurn = Number.isSafeInteger(data.turn) ? data.turn : currentTurn;
      }
      return;
    }
    if (found && targetTurn === undefined && event.type === 'assistant/message' && Number.isSafeInteger(data.turn)) targetTurn = data.turn;
    if (!found || targetTurn === undefined || (Number.isSafeInteger(data.turn) && data.turn !== targetTurn) ||
        (!Number.isSafeInteger(data.turn) && currentTurn !== undefined && currentTurn !== targetTurn)) return;
    if (event.type === 'assistant/message') {
      const text = textOf(data.message ?? data);
      if (text) answer = text;
    } else if (event.type === 'tool/call' && nonempty(data.callId) && nonempty(data.name)) {
      tools.set(data.callId, { name: data.name, status: 'pending' });
    } else if (event.type === 'tool/result') {
      const result = toolResult(data), tool = tools.get(result.callId);
      if (tool) tool.status = result.status;
    } else if (event.type === 'turn/end') {
      const reason = isObject(data.reason) ? data.reason.kind : undefined;
      result = { status: reason === 'completed' ? 'completed' : 'failed', reason: typeof reason === 'string' ? reason : 'unknown', answer, toolCalls: [...tools.values()] };
    }
  }
  return { accept, result: () => result, found: () => found };
}

function visibleHistory(frame, sessionId) {
  if (!isObject(frame) || frame.type !== 'snapshot' || !Array.isArray(frame.records))
    throw new CliError('Runtime returned an invalid conversation history.', { code: 'invalid_response' });
  const items = [];
  for (const record of frame.records) {
    const event = eventOf(record); if (!event) continue;
    const data = event.data;
    const base = { ...(Number.isFinite(event.seq) ? { seq: event.seq } : {}), ...(Number.isSafeInteger(data.turn) ? { turn: data.turn } : {}) };
    if (event.type === 'user/message' || event.type === 'assistant/message') {
      const message = isObject(data.message) ? data.message : data;
      const source = sourceOf(data);
      if (event.type === 'user/message' && source.kind && source.kind !== 'user') continue;
      const text = textOf(message);
      if (text) items.push({ ...base, type: event.type, text, ...(source.rpcId ? { requestId: source.rpcId } : {}) });
    } else if (event.type === 'turn/start' || event.type === 'turn/end') {
      items.push({ ...base, type: event.type, ...(isObject(data.reason) && typeof data.reason.kind === 'string' ? { reason: data.reason.kind } : {}) });
    } else if (event.type === 'tool/call' && typeof data.name === 'string') {
      items.push({ ...base, type: event.type, name: data.name, ...(typeof data.callId === 'string' ? { callId: data.callId } : {}) });
    } else if (event.type === 'tool/result') {
      const result = toolResult(data);
      items.push({ ...base, type: event.type, status: result.status, ...(typeof result.callId === 'string' ? { callId: result.callId } : {}) });
    }
  }
  const nextBeforeSeq = frame.hasMore === true ? historyBoundary(frame, frame.cursor) : undefined;
  return { sessionId, ...(frame.cursor !== undefined ? { cursor: frame.cursor } : {}), hasMore: frame.hasMore === true,
    ...(nextBeforeSeq !== undefined ? { nextBeforeSeq } : {}), items };
}

function historyBoundary(page, throughSeq, beforeSeq) {
  if (!Number.isSafeInteger(throughSeq) || throughSeq < -1 || !isObject(page) ||
      !Array.isArray(page.records) || typeof page.hasMore !== 'boolean')
    throw new CliError('Runtime returned an invalid history page.', { code: 'invalid_response' });
  let previous = -1;
  for (const record of page.records) {
    const seq = record?.event?.seq;
    if (!Number.isSafeInteger(seq) || seq <= previous || seq > throughSeq || (beforeSeq !== undefined && seq >= beforeSeq))
      throw new CliError('Runtime returned an unordered or mismatched history page.', { code: 'invalid_response' });
    previous = seq;
  }
  const first = page.records[0]?.event?.seq;
  if (page.hasMore && (first === undefined || first === 0))
    throw new CliError('Runtime history pagination did not advance.', { code: 'invalid_response' });
  return first;
}

async function historyPage(ctx, sessionId, throughSeq, beforeSeq, maxMessages, headers, helpers, budget) {
  budget?.check();
  const query = new URLSearchParams({ throughSeq, maxMessages });
  if (beforeSeq !== undefined) query.set('beforeSeq', beforeSeq);
  let page;
  try {
    page = await helpers.runtimeValue(ctx, 'GET', `${sessions}/${segment(sessionId)}/history?${query}`,
      undefined, headers, { signal: budget?.signal });
  } catch (error) { budget?.check(); throw error; }
  budget?.check();
  historyBoundary(page, throughSeq, beforeSeq);
  return { ...page, type: 'snapshot', cursor: throughSeq };
}

async function restoreHistory(ctx, sessionId, requestId, snapshot, headers, helpers, budget) {
  if (snapshot.hasMore !== true) return snapshot;
  const pages = [snapshot.records], throughSeq = snapshot.cursor;
  let page = snapshot, seenRequest = false;
  // Read backwards until this request and its turn start are present, then
  // replay forwards so tools and terminal events retain their original order.
  const anchored = records => {
    for (let i = records.length - 1; i >= 0; i--) {
      const event = eventOf(records[i]);
      if (event?.type === 'user/message' && sourceOf(event.data).rpcId === requestId) seenRequest = true;
      if (seenRequest && event?.type === 'turn/start' && Number.isSafeInteger(event.data.turn)) return true;
    }
    return false;
  };
  let beforeSeq = historyBoundary(page, throughSeq);
  while (page.hasMore && !anchored(page.records)) {
    page = await historyPage(ctx, sessionId, throughSeq, beforeSeq, 100, headers, helpers, budget);
    pages.push(page.records);
    beforeSeq = page.records[0]?.event?.seq;
  }
  return { records: pages.reverse().flat(), hasMore: page.hasMore };
}

function turnBudget(args) {
  const controller = new AbortController(), milliseconds = args.integer('wait-timeout', 120) * 1000;
  const deadline = performance.now() + milliseconds;
  const timeout = setTimeout(() => controller.abort(), milliseconds);
  return {
    signal: controller.signal,
    expired: () => controller.signal.aborted || performance.now() >= deadline,
    check() {
      if (controller.signal.aborted || performance.now() >= deadline)
        throw new CliError('Waiting for the conversation timed out.', { code: 'turn_timeout' });
    },
    close() { clearTimeout(timeout); controller.abort(); },
  };
}

async function openStream(ctx, sessionId, headers, runtimeConnection, budget) {
  const { args } = ctx;
  const { runtime, token, profile, source } = runtimeConnection(ctx);
  const controller = new AbortController();
  const connectTimeout = setTimeout(() => controller.abort(), args.timeout());
  const signal = AbortSignal.any([controller.signal, budget.signal]);
  let response;
  try {
    response = await fetch(new URL(`${sessions}/${segment(sessionId)}/stream`, runtime), { method: 'GET', redirect: 'error', signal,
      headers: { Accept: 'text/event-stream', Authorization: `Bearer ${token}`, 'X-XRain-Authorization': `Bearer ${token}`, ...headers } });
  } catch (error) {
    clearTimeout(connectTimeout);
    throw new CliError(budget.expired() ? 'Waiting for the conversation timed out.' : 'Could not open the conversation stream.', { code: budget.expired() ? 'turn_timeout' : 'network_error' });
  }
  clearTimeout(connectTimeout);
  if (!response.ok) {
    try {
      const reader = response.body?.getReader(), chunks = []; let size = 0;
      if (reader) while (true) {
        const part = await reader.read(); if (part.done) break;
        size += part.value.length;
        if (size > 1024 * 1024) throw new CliError('Runtime error response exceeds the size limit.', { code: 'invalid_response' });
        chunks.push(part.value);
      }
      const text = Buffer.concat(chunks.map(chunk => Buffer.from(chunk))).toString('utf8');
      throw responseError({ status: response.status, headers: response.headers, json: () => JSON.parse(text) }, '', { credentialSource: source, profile: profile.name });
    } catch (error) {
      if (error instanceof CliError) throw error;
      throw new CliError(budget.expired() ? 'Waiting for the conversation timed out.' : 'Conversation response was interrupted.', { code: budget.expired() ? 'turn_timeout' : 'network_error' });
    } finally { controller.abort(); }
  }
  if (!response.body || !/^text\/event-stream(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) {
    controller.abort();
    throw new CliError('Runtime returned an invalid conversation stream.', { code: 'invalid_response' });
  }
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '';
  return {
    async next() {
      while (true) {
        const boundary = /\r?\n\r?\n/.exec(buffer);
        if (boundary) {
          const block = buffer.slice(0, boundary.index); buffer = buffer.slice(boundary.index + boundary[0].length);
          const data = block.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n');
          if (!data) continue;
          try { return JSON.parse(data); } catch { throw new CliError('Runtime returned an invalid conversation event.', { code: 'invalid_response' }); }
        }
        let part;
        try { part = await reader.read(); } catch { throw new CliError(budget.expired() ? 'Waiting for the conversation timed out.' : 'Conversation stream was interrupted.', { code: budget.expired() ? 'turn_timeout' : 'network_error' }); }
        if (part.done) throw new CliError('Conversation stream ended before the turn completed.', { code: 'stream_ended' });
        buffer += decoder.decode(part.value, { stream: true });
        if (buffer.length > 32 * 1024 * 1024) throw new CliError('Conversation event exceeds the size limit.', { code: 'invalid_response' });
      }
    },
    close() { controller.abort(); },
  };
}
function actionRequired(sessionId, requestId, items, submitted = true) {
  return new CliError('The conversation requires an explicit answer or approval.', { code: 'action_required',
    hint: submitted ? 'Inspect the pending action and respond explicitly; then wait on the same session and request ID.' : 'This session already has a pending action. The new input was not submitted.',
    details: { sessionId, requestId, submitted, pendingActions: items } });
}
function finish(sessionId, requestId, result) {
  if (result.status !== 'completed') throw new CliError('The agent turn did not complete successfully.', { code: 'turn_failed', details: { sessionId, requestId, ...result } });
  return { sessionId, requestId, ...result };
}
async function follow(ctx, sessionId, requestId, text, headers, helpers, budget) {
  let stream, submitted = text === undefined, inputAttempted = false, snapshot = false, initialPending = [], incomplete = false;
  const turn = collector(requestId, text);
  try {
    budget.check();
    stream = await openStream(ctx, sessionId, headers, helpers.runtimeConnection, budget);
    while (!snapshot) {
      const frame = await stream.next();
      if (frame?.type === 'stream-error') throw new CliError('Runtime could not follow the conversation.', { code: 'stream_ended' });
      if (frame?.type === 'pending-actions' && Array.isArray(frame.items)) initialPending = frame.items;
      if (frame?.type === 'snapshot') {
        if (!Array.isArray(frame.records)) throw new CliError('Runtime returned an invalid conversation snapshot.', { code: 'invalid_response' });
        snapshot = true; incomplete = frame.hasMore === true;
        if (submitted) {
          const history = await restoreHistory(ctx, sessionId, requestId, frame, headers, helpers, budget);
          incomplete = history.hasMore === true;
          for (const record of history.records) turn.accept(eventOf(record));
        }
      }
    }
    if (turn.result()) return finish(sessionId, requestId, turn.result());
    if (initialPending.length) throw actionRequired(sessionId, requestId, initialPending, submitted);
    let submission = Promise.resolve();
    if (!submitted) {
      budget.check();
      const body = { requestId, content: [{ type: 'text', text }] };
      inputAttempted = true;
      submission = helpers.writeOnce(async () => {
        const accepted = await helpers.runtimeValue(ctx, 'POST', `${sessions}/${segment(sessionId)}/inputs`, body, headers, { signal: budget.signal });
        if (!isObject(accepted) || accepted.accepted !== true) throw new CliError('Runtime returned an invalid input receipt.', { code: 'invalid_response' });
      }, 'Input outcome is unknown. Inspect the same conversation and request ID before deciding whether to retry.', { sessionId, requestId })
        .then(() => { submitted = true; });
    }
    const following = (async () => {
      while (true) {
        const frame = await stream.next();
        if (frame?.type === 'stream-error') throw new CliError('Runtime could not follow the conversation.', { code: 'stream_ended' });
        if (frame?.type === 'pending-actions' && Array.isArray(frame.items) && frame.items.length) {
          await submission;
          throw actionRequired(sessionId, requestId, frame.items);
        }
        if (frame?.type === 'event') turn.accept(eventOf(frame));
        if (turn.result()) return finish(sessionId, requestId, turn.result());
      }
    })();
    // A correlated terminal event is sufficient even if its HTTP receipt is late.
    // Observe both promises so closing after that event cannot leak a rejection.
    await Promise.race([submission, following]);
    return await following;
  } catch (error) {
    if (error instanceof CliError) {
      if (inputAttempted && !submitted && ['turn_timeout', 'network_error', 'stream_ended', 'invalid_response'].includes(error.code)) {
        error.code = 'outcome_unknown';
        error.hint = 'Input outcome is unknown. Do not resend. Read history or wait on this session and request ID.';
      }
      error.details = { ...error.details, sessionId, requestId, ...(incomplete && !turn.found() ? { historyIncomplete: true } : {}) };
      if (['turn_timeout', 'network_error', 'stream_ended', 'invalid_response'].includes(error.code))
        error.hint = submitted ? 'Do not resend. Read history or wait on this session and request ID.' : 'The input was not submitted. Inspect the created session before continuing.';
    }
    throw error;
  } finally { stream?.close(); }
}

export async function chatCommands(ctx, helpers) {
  const { args, reporter } = ctx, action = args.command(2);
  const connection = helpers.runtimeConnection(ctx);
  const app = ['start', 'send', 'wait', 'respond'].includes(action) ? helpers.applicationId(connection.profile) : undefined;
  const context = { runtime: connection.runtime, applicationId: app ?? null };
  const headers = app ? { 'X-XRain-Application-Id': app } : {};
  if (action === 'list') {
    const path = args.has('all') ? sessions : `${sessions}?source=xrain-cli`;
    const result = await helpers.runtimeValue(ctx, 'GET', path);
    if (!isObject(result) || !Array.isArray(result.items)) throw new CliError('Runtime returned an invalid conversation list.', { code: 'invalid_response' });
    reporter.print(result); return 0;
  }
  if (action === 'pending') {
    const result = await helpers.runtimeValue(ctx, 'GET', pendingPath);
    if (!isObject(result) || !Array.isArray(result.items)) throw new CliError('Runtime returned invalid pending actions.', { code: 'invalid_response' });
    const id = args.has('session-id') ? helpers.identifier(args.value('session-id'), 'Session ID') : undefined;
    reporter.print({ items: id ? result.items.filter(item => item?.sessionId === id) : result.items }); return 0;
  }
  if (action === 'respond' || action === 'cancel-question') {
    const ref = helpers.identifier(args.required('action-ref'), 'Action reference');
    const input = action === 'respond' ? await jsonInput(args, 'values') : {};
    if (!isObject(input) || Object.keys(input).some(key => !['outcome', 'answers'].includes(key)) || action === 'respond' && !Object.keys(input).length)
      throw new CliError('Response JSON must contain an explicit outcome or answers.', { code: 'invalid_arguments' });
    const responseId = args.value('request-id') ?? randomUUID();
    reporter.progress(`Response ID: ${responseId}`);
    const result = await helpers.writeOnce(async () => {
      const accepted = await helpers.runtimeValue(ctx, 'POST', `${pendingPath}/${segment(ref)}/${action === 'respond' ? 'responses' : 'cancel'}`, { ...input, responseId }, headers);
      if (!isObject(accepted) || accepted.accepted !== true) throw new CliError('Runtime returned an invalid response receipt.', { code: 'invalid_response' });
      return accepted;
    }, 'Response outcome is unknown. Inspect this pending action before retrying.', { actionRef: ref, responseId, ...context });
    reporter.print({ actionRef: ref, responseId, ...result, ...context }); return 0;
  }
  if (await sessionControl(ctx, helpers, connection)) return 0;
  let sessionId = args.value('session-id');
  if (action === 'history') {
    sessionId = helpers.identifier(sessionId, 'Session ID');
    const page = args.has('through-seq')
      ? await historyPage(ctx, sessionId, Number(args.value('through-seq')),
        args.has('before-seq') ? Number(args.value('before-seq')) : undefined, args.integer('page-size', 100), headers, helpers)
      : await helpers.runtimeValue(ctx, 'GET', `${sessions}/${segment(sessionId)}/history`);
    reporter.print(visibleHistory(page, sessionId)); return 0;
  }
  const text = action === 'wait' ? undefined : await messageInput(args, ctx.stdin);
  const requestId = args.value('request-id') ?? randomUUID();
  reporter.progress(`Request ID: ${requestId}`);
  const budget = turnBudget(args);
  try {
    if (action === 'start') {
      const agentId = helpers.identifier(args.required('agent-id'), 'Agent ID');
      let primaryObjectRef;
      if (args.has('context-json')) {
        primaryObjectRef = await readJsonInput(args.value('context-json'), 'Primary object reference');
        if (!isObject(primaryObjectRef) || Object.keys(primaryObjectRef).length !== 3 ||
            !['businessSourceId', 'objectType', 'objectId'].every(key => nonempty(primaryObjectRef[key]) && primaryObjectRef[key].length <= 160))
          throw new CliError('Primary object reference requires businessSourceId, objectType and objectId, each at most 160 characters.', { code: 'invalid_arguments' });
      }
      const created = await helpers.writeOnce(async () => {
        const result = await helpers.runtimeValue(ctx, 'POST', sessions, { agentId, source: 'xrain-cli', ...(primaryObjectRef ? { primaryObjectRef } : {}) }, headers, { signal: budget.signal });
        if (!isObject(result) || !nonempty(result.sessionId)) throw new CliError('Runtime returned an invalid session receipt.', { code: 'invalid_response' });
        return result;
      }, 'Session creation outcome is unknown. Inspect your conversation list before creating another.', { agentId, requestId, ...context });
      sessionId = created.sessionId;
      reporter.progress(`Session ID: ${sessionId}`);
    }
    sessionId = helpers.identifier(sessionId, 'Session ID');
    reporter.print({ ...await follow(ctx, sessionId, requestId, text, headers, helpers, budget), ...context });
  }
  catch (error) {
    if (error instanceof CliError) error.details = { ...error.details, ...context };
    throw error;
  } finally { budget.close(); }
  return 0;
}
