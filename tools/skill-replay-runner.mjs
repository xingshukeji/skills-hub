import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function textEncoding(bytes) {
  if (bytes.length >= 2) {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
  }
  return 'utf-8';
}
function textDecoder(encoding) {
  // Keep the existing UTF-8 BOM behavior; a UTF-16 BOM selects byte order and
  // is removed when producing readable UTF-8 output or matching source lines.
  return new TextDecoder(encoding, { fatal: true, ignoreBOM: encoding === 'utf-8' });
}
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
    // Ancestors of the case directory may be links (for example macOS /var).
    // Compare physical paths on both sides without changing receipt paths.
    const realInput = path.join(fs.realpathSync(base), 'input');
    if (real !== realInput && !real.startsWith(realInput + path.sep)) throw invalid('Resolved path leaves this case input.', 'OUTSIDE_INPUT');
    return file;
  };
  const relative = file => path.relative(input, file).replaceAll('\\', '/');
  const walk = directory => fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
    .flatMap(entry => {
      const file = target(path.join(relative(directory), entry.name));
      return fs.statSync(file).isDirectory() ? walk(file) : [file];
    });
  try {
    const arity = { read: 2, 'read-hex': 2, 'read-range': 4, list: 2, search: 3, 'search-files': null, test: 1 };
    if (!Object.hasOwn(arity, op)) throw invalid('Use read/read-hex <path>, read-range <path> <byte-offset> <byte-length>, list <path>, search <path> <regex>, search-files <regex> <file> [file...], or test.');
    if ((op === 'search-files' ? args.length < 3 : args.length !== arity[op]) || args.some(value => typeof value !== 'string' || !value.length)) {
      throw invalid(`Invalid arguments for ${op}.`);
    }
    if (op === 'read' || op === 'read-hex') {
      const bytes = fs.readFileSync(target(requestedPath));
      result = { path: requestedPath, sha256: hash(bytes), bytes: bytes.length,
        outputBytes: 0, outputSHA256: hash(Buffer.alloc(0)) };
      let rendered = bytes;
      const encoding = textEncoding(bytes);
      if (op === 'read-hex') {
        result.outputEncoding = 'hex'; rendered = Buffer.from(bytes.toString('hex'));
      } else if (encoding !== 'utf-8') {
        result.encoding = encoding; result.outputEncoding = 'utf-8';
        rendered = Buffer.from(textDecoder(encoding).decode(bytes));
      }
      output = rendered;
      result.outputBytes = output.length;
      result.outputSHA256 = output === bytes ? result.sha256 : hash(output);
    } else if (op === 'read-range') {
      const [offset, length] = args.slice(2).map(value => /^(0|[1-9]\d*)$/.test(value) ? Number(value) : NaN);
      if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || length < 1 || !Number.isSafeInteger(offset + length)) {
        throw invalid('Byte offset must be a nonnegative safe integer and byte length a positive safe integer.');
      }
      result = { path: requestedPath, requestedOffset: offset, requestedLength: length,
        bytesRead: 0, outputBytes: 0, outputSHA256: hash(Buffer.alloc(0)) };
      const descriptor = fs.openSync(target(requestedPath), 'r');
      try {
        const size = fs.fstatSync(descriptor).size;
        result.fileBytes = size;
        if (offset > size) throw invalid('Byte offset is past end of file.');
        const readAt = (position, count, kind) => {
          const bytes = Buffer.allocUnsafe(count); let read = 0;
          result[kind + 'BytesRead'] = 0;
          try {
            while (read < count) {
              const n = fs.readSync(descriptor, bytes, read, Math.min(65536, count - read), position + read);
              if (!n) throw invalid('Input changed during bounded read.', 'INPUT_CHANGED');
              read += n; result.bytesRead += n; result[kind + 'BytesRead'] += n;
            }
            return bytes;
          } finally { result[kind + 'SHA256'] = hash(bytes.subarray(0, read)); }
        };
        const probe = readAt(0, Math.min(2, size), 'encodingProbe');
        const encoding = textEncoding(probe);
        result.encoding = encoding; result.outputEncoding = 'utf-8';
        // At most four bytes on either side complete an intersected UTF-8
        // character or UTF-16 surrogate pair. These extra reads are metered too.
        const requestedEnd = Math.min(size, offset + length);
        const windowStart = Math.max(0, offset - 4), windowEnd = Math.min(size, requestedEnd + 4);
        result.windowOffset = windowStart;
        const window = readAt(windowStart, windowEnd - windowStart, 'window');
        let start = offset, end = requestedEnd;
        if (start !== end && encoding === 'utf-8') {
          while (start > windowStart && (window[start - windowStart] & 0xc0) === 0x80) start--;
          while (end < windowEnd && (window[end - windowStart] & 0xc0) === 0x80) end++;
        } else if (start !== end) {
          start -= start % 2; end = Math.min(size, end + end % 2);
          const unit = position => encoding === 'utf-16le'
            ? window.readUInt16LE(position - windowStart) : window.readUInt16BE(position - windowStart);
          if (start + 1 < size && unit(start) >= 0xdc00 && unit(start) <= 0xdfff) start = Math.max(0, start - 2);
          if (end >= 2 && end <= size && unit(end - 2) >= 0xd800 && unit(end - 2) <= 0xdbff) end = Math.min(size, end + 2);
        }
        const bytes = window.subarray(start - windowStart, end - windowStart);
        Object.assign(result, { rangeOffset: start, rangeBytes: bytes.length, rangeSHA256: hash(bytes), hashScope: 'range',
          nextOffset: end, eof: end === size });
        const text = new TextDecoder(encoding, { fatal: true, ignoreBOM: start !== 0 || encoding === 'utf-8' }).decode(bytes);
        if (text.includes('\0')) throw invalid('Requested range contains NUL characters.', 'NON_TEXT_RANGE');
        output = Buffer.from(text);
        result.outputBytes = output.length; result.outputSHA256 = hash(output);
        errorOutput = `Read range: ${JSON.stringify({ encoding, fileBytes: size, rangeOffset: start,
          rangeBytes: bytes.length, nextOffset: end, eof: result.eof })}\n`;
      } finally { fs.closeSync(descriptor); }
    } else if (op === 'list') {
      const file = target(requestedPath), files = fs.statSync(file).isDirectory() ? walk(file).map(relative) : [relative(file)];
      result = { path: requestedPath, files, entries: [], metadataOnly: true, bytesRead: 0 };
      for (const file of files) result.entries.push({ path: file, bytes: fs.statSync(target(file)).size });
      output = files.join('\n') + '\n';
      errorOutput = `File sizes (bytes): ${JSON.stringify(result.entries)}\n`;
    } else if (op === 'search' || op === 'search-files') {
      const query = op === 'search-files' ? args[1] : pattern, regex = new RegExp(query, 'i');
      const files = [], matches = [], skipped = [];
      result = { ...(op === 'search-files' ? { paths: args.slice(2), files: [], duplicatePaths: [], fileResults: [] } : { path: requestedPath }),
        pattern: query, matches, skipped, bytesRead: 0 };
      if (op === 'search-files') {
        const selected = new Map();
        // Resolve the whole selection before reading any content: a bad final
        // path must not leave a partially executed batch looking successful.
        for (const requested of args.slice(2)) {
          const file = target(requested);
          if (!fs.statSync(file).isFile()) throw invalid('search-files accepts files, not directories.');
          const key = fs.realpathSync(file);
          if (selected.has(key)) result.duplicatePaths.push({ path: requested, duplicateOf: selected.get(key) });
          else { selected.set(key, relative(file)); files.push(file); result.files.push(relative(file)); }
        }
      } else {
        const file = target(requestedPath);
        files.push(...(fs.statSync(file).isDirectory() ? walk(file) : [file]));
      }
      for (const file of files) {
        let descriptor, size, encoding, bytesRead = 0;
        const readChunk = length => {
          const buffer = Buffer.allocUnsafe(length);
          const count = fs.readSync(descriptor, buffer, 0, length, null);
          bytesRead += count; result.bytesRead += count;
          return buffer.subarray(0, count);
        };
        const skip = (sample, complete) => {
          const item = { path: relative(file), reason: 'Not supported Unicode text without NUL characters', encoding,
            bytes: complete ? sample.length : size, bytesRead, hashScope: complete ? 'full' : 'prefix',
            ...(complete ? { sha256: hash(sample) } : { sampleSHA256: hash(sample), sampleBytes: sample.length }) };
          skipped.push(item);
          emit({ phase: 'search-file', ...item, matches: [], skipped: true });
        };
        try {
          descriptor = fs.openSync(file, 'r');
          size = fs.fstatSync(descriptor).size;
          // A regular-file read may be short. Finish the bounded probe before
          // deciding whether its first bytes form an encoding marker.
          const probe = []; let remaining = Math.min(8192, size);
          while (remaining) {
            const part = readChunk(remaining);
            if (!part.length) break;
            probe.push(part); remaining -= part.length;
          }
          const prefix = Buffer.concat(probe);
          encoding = textEncoding(prefix);
          const decoder = textDecoder(encoding), textChunks = [];
          const decode = (chunk, stream) => {
            try {
              const text = decoder.decode(chunk, { stream });
              if (text.includes('\0')) return false;
              textChunks.push(text); return true;
            } catch { return false; }
          };
          let nonText = !decode(prefix, prefix.length < size);
          if (nonText) { skip(prefix, prefix.length === size); continue; }
          const chunks = [prefix];
          for (;;) {
            const chunk = readChunk(65536);
            if (!chunk.length) break;
            chunks.push(chunk);
            nonText = !decode(chunk, true);
            if (nonText) { skip(Buffer.concat(chunks), bytesRead === size); break; }
          }
          if (nonText) continue;
          const bytes = Buffer.concat(chunks);
          // The probe is only an early rejection, never proof that a file is text.
          if (!decode(Buffer.alloc(0), false)) { skip(bytes, true); continue; }
          const lines = textChunks.join('').split('\n'), hits = [];
          const byteEncoding = encoding === 'utf-8' ? 'utf8' : 'utf16le';
          let byteOffset = encoding === 'utf-8' ? 0 : 2;
          for (const [index, part] of lines.entries()) {
            const hasNewline = index < lines.length - 1;
            const text = hasNewline && part.endsWith('\r') ? part.slice(0, -1) : part;
            if (regex.test(text)) hits.push({ path: relative(file), line: index + 1, text,
              byteOffset, byteLength: Buffer.byteLength(text, byteEncoding) });
            byteOffset += Buffer.byteLength(part, byteEncoding) + (hasNewline ? Buffer.byteLength('\n', byteEncoding) : 0);
          }
          // Preserve progress even if a later file fails. Scanned bytes are not
          // necessarily content exposed to the model; only returned matches are.
          const sha256 = hash(bytes);
          emit({ phase: 'search-file', path: relative(file), encoding, sha256, bytes: bytes.length, bytesRead, matches: hits });
          if (op === 'search-files') {
            const shown = hits.length <= 6 ? hits : [...hits.slice(0, 3), ...hits.slice(-3)];
            result.fileResults.push({ path: relative(file), encoding, bytes: bytes.length, sha256,
              matchCount: hits.length, omittedMatchCount: hits.length - shown.length,
              ...(hits.length > shown.length ? { omittedByteRange: { offset: hits[3].byteOffset,
                length: Math.max(1, hits.at(-4).byteOffset + hits.at(-4).byteLength - hits[3].byteOffset) } } : {}),
              matches: shown.map(hit => {
                let text = hit.text.slice(0, 240);
                if (text.length < hit.text.length && /[\ud800-\udbff]$/.test(text)) text = text.slice(0, -1);
                return { ...hit, text, textIsExcerpt: text.length < hit.text.length };
              }) });
          }
          matches.push(...hits);
        } catch (error) {
          emit({ phase: 'search-file', path: relative(file), status: 'failed', encoding, bytes: size, bytesRead,
            error: { name: error.name, code: error.code ?? null, message: error.message }, matches: [] });
          throw error;
        } finally {
          if (descriptor !== undefined) fs.closeSync(descriptor);
        }
      }
      output = JSON.stringify(op === 'search-files'
        ? { outputScope: 'preview', matchCount: matches.length, files: result.fileResults, skipped }
        : matches, null, 2) + '\n';
      if (skipped.length) errorOutput = `Search skipped non-text files: ${JSON.stringify(skipped)}\n`;
    } else {
      const files = [];
      result = { files: [], testDirectories: [], missingTestDirectories: [] };
      for (const directory of ['project/tests', 'project/test']) {
        // An absent conventional directory is optional; an existing but
        // inaccessible or broken directory must remain an operation failure.
        try { fs.lstatSync(path.join(input, directory)); }
        catch (error) {
          if (error.code !== 'ENOENT') throw error;
          result.missingTestDirectories.push(directory); continue;
        }
        const file = target(directory);
        if (!fs.statSync(file).isDirectory()) throw invalid('Expected a test directory.', 'NOT_A_DIRECTORY');
        result.testDirectories.push(directory);
        files.push(...walk(file).filter(file => /\.test\.(?:mjs|cjs|js)$/.test(file)));
        result.files = files.map(relative);
      }
      if (!files.length) throw invalid('No existing test files.', 'NO_TESTS');
      // A replay test process owns its test runner; do not inherit the parent
      // runner's private context when this helper itself is under node --test.
      const env = { ...process.env };
      delete env.NODE_TEST_CONTEXT;
      const child = spawnSync(nodeExecutable, ['--test', ...files], { cwd: target('project'), encoding: 'utf8', windowsHide: true, env });
      code = child.status ?? 1;
      result = { ...result, code, signal: child.signal ?? null,
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
