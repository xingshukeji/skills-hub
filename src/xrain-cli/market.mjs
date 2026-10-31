import { accessSync, constants, copyFileSync, existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { CliError, nonempty } from './core.mjs';
import { appClient } from './app.mjs';
import { fileSha256, readManifestFile, validPackageId, validVersionId } from './archive.mjs';
import { requireSuccess, requireStreamSuccess, writeOnce } from './http.mjs';
import { saveResponse } from './data-import.mjs';

function newOutput(value) {
  const path = resolve(value);
  if (existsSync(path)) throw new CliError('Output already exists.', { code: 'output_exists' });
  accessSync(dirname(path), constants.W_OK);
  return path;
}
function save(path, bytes) {
  const temporary = path + '.' + randomBytes(8).toString('hex') + '.part';
  try { writeFileSync(temporary, bytes, { flag: 'wx' }); copyFileSync(temporary, path, constants.COPYFILE_EXCL); }
  finally { if (existsSync(temporary)) unlinkSync(temporary); }
}
function receipt(response) {
  requireSuccess(response);
  try { return response.json(); }
  catch { throw new CliError('Market returned invalid JSON.', { code: 'invalid_response' }); }
}
export async function marketCommands(ctx) {
  const { args, reporter } = ctx;
  if (!args.has('exchange')) throw new CliError('Market commands require an explicit --exchange URL and its independent login.', { code: 'invalid_arguments' });
  const action = args.command(1), id = args.required('package');
  if (!validPackageId(id)) throw new CliError('An exact package ID is required.', { code: 'invalid_arguments' });
  const { send, root, profile, source } = appClient(ctx, { allowAnonymous: ['show', 'versions', 'manifest', 'components', 'download'].includes(action) }), path = `${root}/packages/${id}`;
  if (action === 'rename' || action === 'publication' || action === 'unpublish') {
    let body, method = 'PUT', suffix = '/publication';
    if (action === 'rename') {
      const label = args.required('label').trim();
      if (!label || label.length > 256) throw new CliError('Label must have 1-256 characters.');
      body = { label }; method = 'PATCH'; suffix = '';
    } else {
      const expected = args.required('expected-published-version');
      if (expected !== 'null' && !validVersionId(expected)) throw new CliError('Use the observed version ID, or literal null for an unpublished package.');
      const versionId = action === 'unpublish' ? null : args.required('version-id');
      if (versionId !== null && !validVersionId(versionId)) throw new CliError('An exact version ID is required.');
      body = { versionId, expectedPublishedVersionId: expected === 'null' ? null : expected };
    }
    const result = await writeOnce(async () => {
      const value = receipt(await send(method, path + suffix, { json: body }));
      if (value?.id !== id || action === 'rename' && value.label !== body.label || action !== 'rename' && value.publishedVersionId !== body.versionId)
        throw new CliError('Market returned a mismatched maintenance receipt.', { code: 'invalid_response' });
      return value;
    }, 'Market write outcome is unknown. Use app status --exchange with this package and the original market identity before another write; do not refresh the expected version and replay.',
    { packageId: id, exchange: args.value('exchange'), expectedPublishedVersionId: body.expectedPublishedVersionId, readBack: 'app status --exchange' });
    reporter.print(result); return 0;
  }
  const versionId = args.value('version-id');
  if (['manifest', 'components', 'download'].includes(action) && !validVersionId(versionId)) throw new CliError('--version-id must contain an exact version ID.');
  const output = args.has('out') ? newOutput(args.value('out')) : undefined;
  if (action !== 'download') {
    const suffix = action === 'show' ? '' : action === 'versions' ? '/versions' : `/versions/${versionId}/${action}`;
    const result = receipt(await send('GET', path + suffix));
    if (output) { save(output, Buffer.from(JSON.stringify(result, null, 2) + '\n')); reporter.print({ output, packageId: id, versionId }); }
    else reporter.print(result);
    return 0;
  }
  const metadata = receipt(await send('GET', `${path}/versions/${versionId}/manifest`));
  if (metadata?.packageId !== id || metadata?.versionId !== versionId || !/^[a-f0-9]{64}$/i.test(metadata.fileSha256 ?? '') || !nonempty(metadata.digest))
    throw new CliError('Market returned invalid artifact metadata.', { code: 'invalid_response' });
  const controller = new AbortController(), interrupt = () => controller.abort();
  process.once('SIGINT', interrupt);
  let response, hash;
  try {
    response = await requireStreamSuccess(await send('GET', `${path}/versions/${versionId}/artifact`, { stream: true, signal: controller.signal,
      headers: { Accept: '*/*', 'Accept-Encoding': 'identity' } }));
    await saveResponse({ profile, source, signal: controller.signal }, response, output, undefined, { contentType: null,
      verify: async temporary => {
        const manifest = await readManifestFile(temporary, controller.signal); hash = await fileSha256(temporary, controller.signal);
        if (manifest.packageId !== id || manifest.versionId !== versionId || manifest.version !== metadata.version ||
            hash !== metadata.fileSha256.toLowerCase() || response.headers.get('x-appkg-file-sha256')?.toLowerCase() !== hash ||
            response.headers.get('x-appkg-package-id') !== id || response.headers.get('x-appkg-version-id') !== versionId ||
            response.headers.get('x-appkg-package-digest') !== metadata.digest)
          throw new CliError('Market artifact identity or digest does not match its metadata.', { code: 'integrity_failed' });
      } });
    reporter.print({ output, packageId: id, versionId, packageSha256: hash, digest: metadata.digest }); return 0;
  } finally { process.removeListener('SIGINT', interrupt); await response?.body?.cancel().catch(() => {}); }
}
