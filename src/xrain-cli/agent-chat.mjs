import { randomUUID } from 'node:crypto';
import { CliError, isObject, jsonInput, nonempty, readLimited, segment } from './core.mjs';
import { responseError } from './http.mjs';

const sessions = '/v1/dsh/sessions';
const pendingPath = '/v1/dsh/pending-actions';

async function messageInput(args) {
  let value = args.value('message');
  const file = args.value('message-file');
  if (file) {
    let bytes;
    if (file === '-') {
      if (process.stdin.isTTY) throw new CliError('Pipe the message into stdin when using --message-file -.', { code: 'invalid_arguments' });
      const chunks = []; let size = 0;
      for await (const chunk of process.stdin) {
        const data = Buffer.from(chunk); size += data.length;
        if (size > 256 * 1024) throw new CliError('Message exceeds the size limit.', { code: 'invalid_arguments' });
        chunks.push(data);
      }
      bytes = Buffer.concat(chunks);
    } else bytes = readLimited(file, 256 * 1024, 'Message');
    try { value = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { throw new CliError('Message file must be UTF-8 text.', { code: 'invalid_arguments' }); }
  }
  if (!nonempty(value) || value.length > 64_000 || value.includes('\0'))
    throw new CliError('Message must contain 1 to 64000 characters.', { code: 'invalid_arguments' });
  return value;
}
function textOf(value) {
  return isObject(value) && Array.isArray(value.content)
    ? value.content.filter(item => isObject(item) && item.type === 'text' && typeof item.text === 'string').map(item => item.text).join('') : '';
}
function eventOf(record) { return isObject(record) && isObject(record.event) && isObject(record.event.data) ? record.event : null; }
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
      const source = isObject(message.source) ? message.source : isObject(data.source) ? data.source : {};
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
      const source = isObject(message.source) ? message.source : isObject(data.source) ? data.source : {};
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
  return { sessionId, ...(frame.cursor !== undefined ? { cursor: frame.cursor } : {}), hasMore: frame.hasMore === true, items };
}

async function openStream(ctx, sessionId, headers, runtimeConnection) {
  const { args } = ctx;
  const { runtime, token, profile, source } = runtimeConnection(ctx);
  const controller = new AbortController();
  let expired = false;
  const timeout = setTimeout(() => { expired = true; controller.abort(); }, args.integer('wait-timeout', 120) * 1000);
  const connectTimeout = setTimeout(() => controller.abort(), args.timeout());
  let response;
  try {
    response = await fetch(new URL(`${sessions}/${segment(sessionId)}/stream`, runtime), { method: 'GET', redirect: 'error', signal: controller.signal,
      headers: { Accept: 'text/event-stream', Authorization: `Bearer ${token}`, 'X-XRain-Authorization': `Bearer ${token}`, ...headers } });
  } catch (error) {
    clearTimeout(timeout); clearTimeout(connectTimeout);
    throw new CliError(expired ? 'Waiting for the conversation timed out.' : 'Could not open the conversation stream.', { code: expired ? 'turn_timeout' : 'network_error' });
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
      throw new CliError(expired ? 'Waiting for the conversation timed out.' : 'Conversation response was interrupted.', { code: expired ? 'turn_timeout' : 'network_error' });
    } finally { clearTimeout(timeout); controller.abort(); }
  }
  if (!response.body || !/^text\/event-stream(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) {
    controller.abort(); clearTimeout(timeout);
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
        try { part = await reader.read(); } catch { throw new CliError(expired ? 'Waiting for the conversation timed out.' : 'Conversation stream was interrupted.', { code: expired ? 'turn_timeout' : 'network_error' }); }
        if (part.done) throw new CliError('Conversation stream ended before the turn completed.', { code: 'stream_ended' });
        buffer += decoder.decode(part.value, { stream: true });
        if (buffer.length > 32 * 1024 * 1024) throw new CliError('Conversation event exceeds the size limit.', { code: 'invalid_response' });
      }
    },
    close() { clearTimeout(timeout); controller.abort(); },
  };
}
function actionRequired(sessionId, requestId, items, submitted = true) {
  return new CliError('The conversation requires an explicit answer or approval.', { code: 'action_required',
    hint: submitted ? 'Inspect the pending action and respond explicitly; then wait on the same session and request ID.' : 'This session already has a pending action. The new input was not submitted.',
    details: { sessionId, requestId, submitted, pendingActions: items } });
}
function finish(sessionId, requestId, result) {
  if (result.status !== 'completed') throw new CliError('The agent turn did not complete successfully.', { code: 'turn_failed', details: { sessionId, requestId, ...result } });
  if (!nonempty(result.answer)) throw new CliError('The turn completed without a text reply.', { code: 'no_answer', details: { sessionId, requestId, ...result } });
  return { sessionId, requestId, ...result };
}
async function follow(ctx, sessionId, requestId, text, headers, helpers) {
  let stream, submitted = text === undefined, snapshot = false, initialPending = [], incomplete = false;
  const turn = collector(requestId, text);
  try {
    stream = await openStream(ctx, sessionId, headers, helpers.runtimeConnection);
    while (!snapshot) {
      const frame = await stream.next();
      if (frame?.type === 'stream-error') throw new CliError('Runtime could not follow the conversation.', { code: 'stream_ended' });
      if (frame?.type === 'pending-actions' && Array.isArray(frame.items)) initialPending = frame.items;
      if (frame?.type === 'snapshot') {
        if (!Array.isArray(frame.records)) throw new CliError('Runtime returned an invalid conversation snapshot.', { code: 'invalid_response' });
        snapshot = true; incomplete = frame.hasMore === true;
        if (submitted) for (const record of frame.records) turn.accept(eventOf(record));
      }
    }
    if (turn.result()) return finish(sessionId, requestId, turn.result());
    if (initialPending.length) throw actionRequired(sessionId, requestId, initialPending, submitted);
    if (!submitted) {
      const body = { requestId, content: [{ type: 'text', text }] };
      await helpers.writeOnce(async () => {
        const accepted = await helpers.runtimeValue(ctx, 'POST', `${sessions}/${segment(sessionId)}/inputs`, body, headers);
        if (!isObject(accepted) || accepted.accepted !== true) throw new CliError('Runtime returned an invalid input receipt.', { code: 'invalid_response' });
      }, 'Input outcome is unknown. Inspect the same conversation and request ID before deciding whether to retry.', { sessionId, requestId });
      submitted = true;
    }
    while (true) {
      const frame = await stream.next();
      if (frame?.type === 'stream-error') throw new CliError('Runtime could not follow the conversation.', { code: 'stream_ended' });
      if (frame?.type === 'pending-actions' && Array.isArray(frame.items) && frame.items.length) throw actionRequired(sessionId, requestId, frame.items);
      if (frame?.type === 'event') turn.accept(eventOf(frame));
      if (turn.result()) return finish(sessionId, requestId, turn.result());
    }
  } catch (error) {
    if (error instanceof CliError) {
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
  if (action === 'respond') {
    const ref = helpers.identifier(args.required('action-ref'), 'Action reference');
    const input = await jsonInput(args, 'values');
    if (!isObject(input) || Object.keys(input).some(key => !['outcome', 'answers'].includes(key)) || !Object.keys(input).length)
      throw new CliError('Response JSON must contain an explicit outcome or answers.', { code: 'invalid_arguments' });
    const responseId = helpers.identifier(args.value('request-id') ?? randomUUID(), 'Response ID');
    reporter.progress(`Response ID: ${responseId}`);
    const result = await helpers.writeOnce(async () => {
      const accepted = await helpers.runtimeValue(ctx, 'POST', `${pendingPath}/${segment(ref)}/responses`, { ...input, responseId }, headers);
      if (!isObject(accepted) || accepted.accepted !== true) throw new CliError('Runtime returned an invalid response receipt.', { code: 'invalid_response' });
      return accepted;
    }, 'Response outcome is unknown. Inspect this pending action before retrying.', { actionRef: ref, responseId, ...context });
    reporter.print({ actionRef: ref, responseId, ...result, ...context }); return 0;
  }
  let sessionId = args.value('session-id');
  if (action === 'history') {
    sessionId = helpers.identifier(sessionId, 'Session ID');
    reporter.print(visibleHistory(await helpers.runtimeValue(ctx, 'GET', `${sessions}/${segment(sessionId)}/history`), sessionId)); return 0;
  }
  const text = action === 'wait' ? undefined : await messageInput(args);
  const requestId = helpers.identifier(args.value('request-id') ?? randomUUID(), 'Request ID');
  if (action === 'start') {
    const agentId = helpers.identifier(args.required('agent-id'), 'Agent ID');
    const created = await helpers.writeOnce(async () => {
      const result = await helpers.runtimeValue(ctx, 'POST', sessions, { agentId, source: 'xrain-cli' }, headers);
      if (!isObject(result) || !nonempty(result.sessionId)) throw new CliError('Runtime returned an invalid session receipt.', { code: 'invalid_response' });
      return result;
    }, 'Session creation outcome is unknown. Inspect your conversation list before creating another.', { agentId, ...context });
    sessionId = created.sessionId;
    reporter.progress(`Session ID: ${sessionId}`);
  }
  sessionId = helpers.identifier(sessionId, 'Session ID');
  reporter.progress(`Request ID: ${requestId}`);
  try { reporter.print({ ...await follow(ctx, sessionId, requestId, text, headers, helpers), ...context }); }
  catch (error) {
    if (error instanceof CliError) error.details = { ...error.details, ...context };
    throw error;
  }
  return 0;
}
