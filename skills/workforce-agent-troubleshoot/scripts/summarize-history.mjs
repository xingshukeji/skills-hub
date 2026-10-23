import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const object = value => value && typeof value === 'object' && !Array.isArray(value);
const safeName = value => typeof value === 'string' && /^[\w.:-]{1,160}$/.test(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
function assert(value) { if (!value) throw new Error('Invalid history or watermark; see references/history.md.'); }
function resultOf(message) {
  if (!object(message)) return null;
  if (message.role === 'tool' && safeName(message.toolCallId)) return { id: message.toolCallId, failed: message.isError === true };
  const blocks = Array.isArray(message.content) ? message.content.filter(block => object(block) && block.type === 'tool-result' && safeName(block.toolCallId)) : [];
  if (blocks.length !== 1) return null;
  return { id: blocks[0].toolCallId, failed: blocks[0].isError === true };
}
export function summarizeHistory(history, afterSeq) {
  assert(object(history) && Array.isArray(history.records) && typeof history.hasMore === 'boolean' && integer(afterSeq));
  const records = new Map();
  let duplicates = 0;
  for (const record of history.records) {
    assert(object(record) && object(record.event));
    const event = record.event;
    assert(integer(event.seq) && typeof event.type === 'string' && object(event.data));
    if (records.has(event.seq)) { assert(JSON.stringify(records.get(event.seq)) === JSON.stringify(event)); duplicates++; }
    else records.set(event.seq, event);
  }
  const selected = [...records.values()].filter(event => event.seq > afterSeq).sort((a, b) => a.seq - b.seq);
  const calls = new Map(), ended = [], counts = { userMessages: 0, assistantMessages: 0, approvalsAsked: 0, unpairedResults: 0, unknownEvents: 0 };
  for (const { seq, type, data } of selected) {
    if (type === 'tool/call') {
      assert(safeName(data.callId) && safeName(data.name) && !calls.has(data.callId));
      calls.set(data.callId, { seq, name: data.name, result: 'unresolved' });
    } else if (type === 'tool/result') {
      const result = resultOf(data.message), call = result && calls.get(result.id);
      if (!call) counts.unpairedResults++;
      else { assert(call.result === 'unresolved'); call.result = result.failed ? 'failed' : 'succeeded'; }
    } else if (type === 'assistant/message') counts.assistantMessages++;
    else if (type === 'user/message') counts.userMessages++;
    else if (type === 'approval/asked') counts.approvalsAsked++;
    else if (type === 'turn/end') ended.push({ seq, reason: ['completed', 'cancelled', 'failed'].includes(data.reason?.kind) ? data.reason.kind : 'unknown' });
    else counts.unknownEvents++;
  }
  return { afterSeq, selectedRecords: selected.length, duplicateRecords: duplicates, hasOlderPages: history.hasMore,
    firstSeq: selected[0]?.seq ?? null, lastSeq: selected.at(-1)?.seq ?? null,
    counts, turnsEnded: ended, toolCalls: [...calls.values()],
    unresolvedCalls: [...calls.values()].filter(call => call.result === 'unresolved').length,
    failedCalls: [...calls.values()].filter(call => call.result === 'failed').length,
    businessVerified: false, requiresOriginalTaskReadback: true };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    assert(process.argv.length === 5 && process.argv[3] === '--after-seq' && /^\d+$/.test(process.argv[4]));
    const raw = await readFile(process.argv[2], 'utf8'); assert(raw.length <= 8 * 1024 * 1024);
    console.log(JSON.stringify(summarizeHistory(JSON.parse(raw), Number(process.argv[4])), null, 2));
  } catch { console.error('Cannot summarize history; check the export and committed watermark.'); process.exitCode = 2; }
}
