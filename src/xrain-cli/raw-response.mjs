import { closeSync, openSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CliError, registerSecrets } from './core.mjs';
import { responseError } from './http.mjs';

// Reserve an explicit output before a debug request can cause external effects.
export async function rawOutput(ctx, call, context) {
  const output = ctx.args.has('out') ? resolve(ctx.args.required('out')) : undefined;
  const controller = new AbortController(), interrupt = () => controller.abort();
  process.once('SIGINT', interrupt);
  let file, saved = false, result;
  try {
    if (output) {
      try { file = openSync(output, 'wx', 0o600); }
      catch (error) { throw new CliError(error.code === 'EEXIST' ? 'Output already exists. Choose a new path.' : 'Cannot create the output file.', {
        code: error.code === 'EEXIST' ? 'output_exists' : 'output_write_failed', details: { output } }); }
    }
    const response = await call(controller.signal);
    result = { statusCode: response.status, headers: Object.fromEntries(response.headers) };
    registerSecrets(ctx.reporter, result.headers);
    try { registerSecrets(ctx.reporter, response.json()); } catch {}
    if (file !== undefined) {
      try { writeFileSync(file, response.bytes); }
      catch { throw new CliError('The response was received but could not be saved. Do not repeat the debug request automatically.', {
        code: 'output_write_failed', details: { ...result, output } }); }
      saved = true;
      Object.assign(result, { output, bytes: response.bytes.length });
    } else {
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
      const error = responseError(response);
      error.details = { response: result };
      error.hint ||= 'Inspect the original response and any effects before another action. This debug request was not retried.';
      throw error;
    }
    return result;
  } catch (error) {
    if (error instanceof CliError) error.details = { ...context, ...error.details };
    throw error;
  } finally {
    process.removeListener('SIGINT', interrupt);
    if (file !== undefined) {
      closeSync(file);
      if (!saved) unlinkSync(output);
    }
  }
}
