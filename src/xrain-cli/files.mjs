import { openAsBlob } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { CliError, isObject, segment } from './core.mjs';
import { request, responseError, writeOnce } from './http.mjs';
import { saveFile } from './data-import.mjs';

const root = '/api/service/files/v1/files';

export async function fileCommands(ctx) {
  const { args, reporter, store } = ctx, action = args.command(1), controller = new AbortController();
  const profile = store.resolve(args, true), { token, source } = store.credential(args, profile, { createSecrets: false });
  if (!token) throw new CliError('The file API requires an authorized service credential.', { code: 'authentication_required' });
  const client = { profile, token, source, timeout: args.timeout(), signal: controller.signal };
  const call = async (method, path, options = {}) => {
    const response = await request(new URL(path, profile.server), { method, token, timeout: args.timeout(), signal: controller.signal, ...options });
    if (!response.ok) throw responseError(response, '', { profile: profile.name, credentialSource: source });
    try { return response.json(); } catch { throw new CliError('Invalid file API receipt.', { code: 'invalid_response' }); }
  };
  const interrupt = () => controller.abort(); process.on('SIGINT', interrupt);
  try {
    if (action === 'upload') {
      const input = resolve(args.required('file')), info = await stat(input), uploaderId = args.required('uploader-id');
      if (!info.isFile()) throw new CliError('Upload requires a regular file.', { code: 'invalid_arguments' });
      const blob = await openAsBlob(input), fileName = args.value('name') ?? basename(input);
      if (blob.size !== info.size) throw new CliError('File changed before upload.', { code: 'invalid_input' });
      const value = await writeOnce(async () => {
        const result = await call('POST', root + '?' + new URLSearchParams({ uploaderId, fileName }), {
          body: blob, headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(info.size) },
        });
        if (!isObject(result) || typeof result.id !== 'string' || !result.id.trim() || result.length !== info.size || result.fileName !== fileName)
          throw new CliError('The file receipt does not match this upload.', { code: 'invalid_response' });
        return result;
      }, 'Upload outcome is unknown. Inspect the original uploader and file metadata before another upload; no retry was sent.',
      { profile: profile.name, server: profile.server, tenant: profile.tenant, uploaderId, fileName, bytes: info.size });
      reporter.print(value); return 0;
    }
    const fileId = args.required('id'), path = `${root}/${segment(fileId)}`;
    if (action === 'preview') { reporter.print(await call('GET', path + '/preview')); return 0; }
    const metadata = await call('GET', path);
    if (!isObject(metadata) || metadata.id !== fileId || !Number.isSafeInteger(metadata.length) || metadata.length < 0 || typeof metadata.contentType !== 'string')
      throw new CliError('The file metadata does not match the requested file.', { code: 'invalid_response' });
    if (action === 'show') { reporter.print(metadata); return 0; }
    const assetId = args.value('asset-id');
    const value = await saveFile(client, 'GET', assetId ? `${path}/preview/assets/${segment(assetId)}/content` : path + '/content', args.required('out'),
      undefined, undefined,
      { contentType: assetId ? null : metadata.contentType, expectedBytes: assetId ? undefined : metadata.length, allowEmpty: true });
    reporter.print({ fileId, ...(assetId ? { assetId } : {}), ...value }); return 0;
  } finally { process.removeListener('SIGINT', interrupt); }
}
