import { closeSync, openSync, unlinkSync, writeSync, fsyncSync, fstatSync, lstatSync } from 'node:fs';
import { resolve } from 'node:path';
import { CliError, registerSecrets } from './core.mjs';
import { responseError, requestError } from './http.mjs';

// Reserve an explicit output before a debug request can cause external effects.
export async function rawOutput(ctx, call, context) {
  const output = ctx.args.has('out') ? resolve(ctx.args.required('out')) : undefined;
  const controller = new AbortController(), interrupt = () => controller.abort();
  process.once('SIGINT', interrupt);
  let file, saved = false, result, response, created;
  const ownsOutput = () => { try { const current = lstatSync(output, { bigint: true }); return current.ino === created.ino && current.dev === created.dev; } catch { return false; } };
  try {
    if (output) {
      try { file = openSync(output, 'wx', 0o600); created = fstatSync(file, { bigint: true }); }
      catch (error) { throw new CliError(error.code === 'EEXIST' ? 'Output already exists. Choose a new path.' : 'Cannot create the output file.', {
        code: error.code === 'EEXIST' ? 'output_exists' : 'output_write_failed', details: { output } }); }
    }
    response = await call(controller.signal);
    result = { statusCode: response.status, headers: Object.fromEntries(response.headers) };
    registerSecrets(ctx.reporter, result.headers);
    let errorResponse = response;
    if (file !== undefined) {
      const encoding = response.headers.get('content-encoding'), length = response.headers.get('content-length');
      if (length !== null && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length))))
        throw new CliError('The raw response has an invalid length.', { code: 'invalid_response' });
      const diagnostics = []; let bytes = 0, diagnosticBytes = 0;
      // Only small error diagnostics are copied into memory; file bytes have no
      // local business limit and are written as they arrive.
      const buffered = ArrayBuffer.isView(response.bytes) ? response.bytes : undefined;
      for await (const chunk of buffered ? [buffered] : response.body ?? []) {
        bytes += chunk.length;
        if (!response.ok && diagnosticBytes <= 65536) {
          diagnosticBytes += chunk.length;
          if (diagnosticBytes <= 65536) diagnostics.push(chunk); else diagnostics.length = 0;
        }
        try {
          let offset = 0;
          while (offset < chunk.length) {
            const written = writeSync(file, chunk, offset, chunk.length - offset);
            if (!written) throw new Error('The output could not be written.');
            offset += written;
          }
        } catch { throw new CliError('The response could not be saved. Do not repeat the debug request automatically.', {
          code: 'output_write_failed', details: { ...result, output } }); }
      }
      if ((!encoding || encoding.toLowerCase() === 'identity') && length !== null && bytes !== Number(length))
        throw new CliError('The raw response was incomplete.', { code: 'invalid_response' });
      if (!ownsOutput()) throw new CliError('The output path changed while receiving the response.', { code: 'output_write_failed' });
      try { fsyncSync(file); }
      catch { throw new CliError('The response could not be saved. Do not repeat the debug request automatically.', {
        code: 'output_write_failed', details: { ...result, output } }); }
      errorResponse = { ok: response.ok, status: response.status, headers: response.headers, json: () => JSON.parse(Buffer.concat(diagnostics).toString('utf8')) };
      try { registerSecrets(ctx.reporter, errorResponse.json()); } catch {}
      saved = true;
      Object.assign(result, { output, bytes });
    } else {
      try { registerSecrets(ctx.reporter, response.json()); } catch {}
      // TextDecoder rejects invalid UTF-8 instead of silently changing raw bytes.
      const contentType = response.headers.get('content-type') ?? '', charset = /charset\s*=\s*"?([^;"\s]+)/i.exec(contentType)?.[1];
      const textual = /^(?:text\/|application\/(?:json\b|[^;]+\+json\b|xml\b|[^;]+\+xml\b|javascript\b|x-www-form-urlencoded\b))/i.test(contentType);
      let text;
      if (textual && (!charset || /^(utf-?8|us-ascii)$/i.test(charset))) {
        try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(response.bytes); } catch {}
      }
      Object.assign(result, text === undefined ? { encoding: 'base64', body: response.bytes.toString('base64') } : { encoding: 'utf8', body: text });
    }
    if (!response.ok) {
      const error = responseError(errorResponse);
      error.details = { response: result };
      error.hint ||= 'Inspect the original response and any effects before another action. This debug request was not retried.';
      throw error;
    }
    return result;
  } catch (error) {
    const failure = controller.signal.aborted ? new CliError('Stopped receiving the response; the external action may have already happened.', {
      code: 'outcome_unknown', hint: 'Inspect the original operation before another write. Do not replay this debug request or batch.' }) : requestError(error);
    failure.details = { ...context, ...(result ? { response: result } : {}), ...failure.details };
    throw failure;
  } finally {
    process.removeListener('SIGINT', interrupt);
    await response?.body?.cancel().catch(() => {});
    if (file !== undefined) {
      closeSync(file);
      if (!saved && ownsOutput()) unlinkSync(output);
    }
  }
}
