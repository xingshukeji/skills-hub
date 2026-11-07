import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isUtf8 } from 'node:buffer';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function invalid(message, code = 'INVALID_ARGUMENTS') { return Object.assign(new Error(message), { code }); }
const descriptorWriter = descriptor => ({ write(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  for (let offset = 0; offset < bytes.length;) offset += fs.writeSync(descriptor, bytes, offset, bytes.length - offset);
} });
function report(stderr, message) { try { stderr.write(message); } catch { /* The trace is the remaining evidence when output is unavailable. */ } }

export function inspectReplayTrace(events) {
  const invocations = new Map();
  for (const event of events) {
    if (event.schemaVersion !== 2 || !event.invocationId) throw invalid('Invalid replay event.');
    if (event.phase === 'start') {
      if (invocations.has(event.invocationId)) throw invalid('Duplicate invocation start.');
      invocations.set(event.invocationId, { start: event, progress: [], finish: null });
    } else {
      const invocation = invocations.get(event.invocationId);
      if (!invocation || invocation.finish) throw invalid('Event outside active invocation.');
      if (event.phase === 'finish') {
        if (!Number.isInteger(event.exitCode) || event.status !== (event.exitCode === 0 ? 'succeeded' : 'failed')) {
          throw invalid('Exit status and recorded result disagree.');
        }
        invocation.finish = event;
      } else if (event.phase === 'search-file') invocation.progress.push(event);
      else throw invalid('Unknown replay event phase.');
    }
  }
  const rows = [...invocations.values()];
  return { complete: rows.every(row => row.finish !== null), invocations: rows };
}

// This is evaluation instrumentation, not a sandbox. A missing finish event means
// an interrupted/unknown invocation; never infer success from its start event.
export function runReplay({ caseDirectory, args, nodeExecutable = process.execPath,
  stdout = descriptorWriter(1), stderr = descriptorWriter(2) }) {
  const base = path.resolve(caseDirectory), input = path.join(base, 'input');
  const invocationId = randomUUID(), trace = path.join(base, 'output', 'trace.jsonl');
  const emit = event => fs.appendFileSync(trace, JSON.stringify({ schemaVersion: 2,
    invocationId, at: new Date().toISOString(), ...event }) + '\n');
  const [op, requestedPath, pattern] = args;
  // Journal before parsing, path resolution, or any input read. If journaling
  // fails, do not execute the requested operation.
  try { emit({ phase: 'start', op: op ?? null, args }); }
  catch (error) { report(stderr, `Trace unavailable; operation not executed: ${error.code ?? error.name}\n`); return 1; }
  let code = 0, result = {}, output = '', errorOutput = '';
  const inside = file => file === input || file.startsWith(input + path.sep);
  const target = value => {
    const file = path.resolve(input, value);
    if (!inside(file)) throw invalid('Path leaves this case input.', 'OUTSIDE_INPUT');
    const real = fs.realpathSync(file);
    if (!inside(real)) throw invalid('Resolved path leaves this case input.', 'OUTSIDE_INPUT');
    return file;
  };
  const relative = file => path.relative(input, file).replaceAll('\\', '/');
  const walk = directory => fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
    .flatMap(entry => {
      const file = target(path.join(relative(directory), entry.name));
      return fs.statSync(file).isDirectory() ? walk(file) : [file];
    });
  try {
    const arity = { read: 2, list: 2, search: 3, test: 1 };
    if (!Object.hasOwn(arity, op)) throw invalid('Use read <path>, list <path>, search <path> <regex>, or test.');
    if (args.length !== arity[op] || args.some(value => typeof value !== 'string' || !value.length)) {
      throw invalid(`Invalid arguments for ${op}.`);
    }
    if (op === 'read') {
      const bytes = fs.readFileSync(target(requestedPath));
      result = { path: requestedPath, sha256: hash(bytes), bytes: bytes.length };
      output = bytes;
    } else if (op === 'list') {
      const file = target(requestedPath), files = fs.statSync(file).isDirectory() ? walk(file).map(relative) : [relative(file)];
      result = { path: requestedPath, files }; output = files.join('\n') + '\n';
    } else if (op === 'search') {
      const regex = new RegExp(pattern, 'i'), file = target(requestedPath);
      const files = fs.statSync(file).isDirectory() ? walk(file) : [file], matches = [], skipped = [];
      result = { path: requestedPath, pattern, matches, skipped, bytesRead: 0 };
      for (const file of files) {
        let descriptor, size, bytesRead = 0;
        const readChunk = length => {
          const buffer = Buffer.allocUnsafe(length);
          const count = fs.readSync(descriptor, buffer, 0, length, null);
          bytesRead += count; result.bytesRead += count;
          return buffer.subarray(0, count);
        };
        const skip = (sample, complete) => {
          const item = { path: relative(file), reason: 'Not UTF-8 text without NUL bytes',
            bytes: complete ? sample.length : size, bytesRead, hashScope: complete ? 'full' : 'prefix',
            ...(complete ? { sha256: hash(sample) } : { sampleSHA256: hash(sample), sampleBytes: sample.length }) };
          skipped.push(item);
          emit({ phase: 'search-file', ...item, matches: [], skipped: true });
        };
        try {
          descriptor = fs.openSync(file, 'r');
          size = fs.fstatSync(descriptor).size;
          const prefix = readChunk(Math.min(8192, size));
          const decoder = new TextDecoder('utf-8', { fatal: true });
          let nonText = prefix.includes(0);
          if (!nonText) {
            try {
              // A valid multi-byte character may straddle the probe boundary.
              decoder.decode(prefix, { stream: prefix.length < size });
            } catch { nonText = true; }
          }
          if (nonText) { skip(prefix, prefix.length === size); continue; }
          const chunks = [prefix];
          for (;;) {
            const chunk = readChunk(65536);
            if (!chunk.length) break;
            chunks.push(chunk);
            nonText = chunk.includes(0);
            if (!nonText) {
              try { decoder.decode(chunk, { stream: true }); } catch { nonText = true; }
            }
            if (nonText) { skip(Buffer.concat(chunks), bytesRead === size); break; }
          }
          if (nonText) continue;
          const bytes = Buffer.concat(chunks);
          // The probe is only an early rejection, never proof that a file is text.
          if (bytes.includes(0) || !isUtf8(bytes)) { skip(bytes, true); continue; }
          const lines = bytes.toString().split(/\r?\n/);
          const hits = lines.flatMap((text, index) => regex.test(text) ? [{ path: relative(file), line: index + 1, text }] : []);
          // Preserve progress even if a later file fails. Scanned bytes are not
          // necessarily content exposed to the model; only returned matches are.
          emit({ phase: 'search-file', path: relative(file), sha256: hash(bytes), bytes: bytes.length, bytesRead, matches: hits });
          matches.push(...hits);
        } catch (error) {
          emit({ phase: 'search-file', path: relative(file), status: 'failed', bytes: size, bytesRead,
            error: { name: error.name, code: error.code ?? null, message: error.message }, matches: [] });
          throw error;
        } finally {
          if (descriptor !== undefined) fs.closeSync(descriptor);
        }
      }
      output = JSON.stringify(matches, null, 2) + '\n';
      if (skipped.length) errorOutput = `Search skipped non-text files: ${JSON.stringify(skipped)}\n`;
    } else {
      const files = walk(target('project/tests')).filter(file => file.endsWith('.test.mjs'));
      if (!files.length) throw invalid('No existing test files.', 'NO_TESTS');
      // A replay test process owns its test runner; do not inherit the parent
      // runner's private context when this helper itself is under node --test.
      const env = { ...process.env };
      delete env.NODE_TEST_CONTEXT;
      const child = spawnSync(nodeExecutable, ['--test', ...files], { cwd: target('project'), encoding: 'utf8', windowsHide: true, env });
      code = child.status ?? 1;
      result = { files: files.map(relative), code, signal: child.signal ?? null,
        stdout: child.stdout ?? '', stderr: child.stderr ?? '' };
      if (child.error) result.error = { name: child.error.name, code: child.error.code, message: child.error.message };
      output = result.stdout; errorOutput = result.stderr;
    }
  } catch (error) {
    code = 1;
    result.error = { name: error.name, code: error.code ?? null, message: error.message };
    errorOutput = `${error.code ?? error.name}: ${error.message}\n`;
  }
  try { stdout.write(output); stderr.write(errorOutput); }
  catch (error) {
    result.operationExitCode = code;
    if (result.error) result.operationError = result.error;
    code = 1;
    result.error = { stage: 'output', name: error.name, code: error.code ?? null, message: error.message };
  }
  try { emit({ phase: 'finish', op: op ?? null, args, status: code === 0 ? 'succeeded' : 'failed', exitCode: code, ...result }); }
  catch (error) { report(stderr, `Trace incomplete; invocation outcome not fully recorded: ${error.code ?? error.name}\n`); return 1; }
  return code;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  let caseDirectory = path.dirname(fileURLToPath(import.meta.url));
  if (args[0] === '--case') { caseDirectory = args[1] ?? caseDirectory; args.splice(0, 2); }
  process.exitCode = runReplay({ caseDirectory, args });
}
