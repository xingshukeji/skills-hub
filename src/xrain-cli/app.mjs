import { mkdirSync, writeFileSync, copyFileSync, constants, unlinkSync, existsSync, accessSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { CliError, isObject, nonempty, parseJson, randomId, readLimited, sha256 } from './core.mjs';
import { request, requireSuccess, writeOnce } from './http.mjs';
import { browserLogin } from './auth.mjs';
import { MAX_ARCHIVE, MAX_SOURCE, readManifest, validPackageId } from './archive.mjs';
import { appManagementCommands } from './app-management.mjs';

export function appClient(ctx, { allowHost = false } = {}) {
  const market = ctx.args.has('exchange');
  const profile = market ? ctx.store.market(ctx.args) : ctx.store.resolve(ctx.args, !allowHost);
  if (!market && allowHost && profile.scope !== 'host' && !profile.tenant)
    throw new CliError('Tenant is required unless an explicit Host profile is selected.', { code: 'tenant_required' });
  const token = ctx.store.loadSession(profile.name, profile.server, profile.tenant, profile.scope);
  if (!token) throw new CliError(market ? 'Market login is required or expired. Run app login --exchange <url>.' : 'App login is required or expired. Run app login --server <url>.', {
    code: 'authentication_required', hint: 'Use auth status to inspect the session, then auth login for this target.' });
  return { root: market ? '/api/exchange/v1' : '/api/application/v1',
    send: (method, path, options = {}) => request(new URL(path, profile.server), { ...options, method, token,
      timeout: Math.min(ctx.args.timeout(), options.timeout ?? Infinity) }) };
}
const client = appClient;

export function initApp(ctx) {
  const namespace = ctx.args.required('namespace');
  const label = ctx.args.required('label').trim();
  if (namespace.length < 2 || namespace.length > 16 || !/^[a-z][a-z0-9]+$/.test(namespace)) throw new CliError('Namespace must have 2-16 lowercase letters or digits and start with a letter.');
  if (!label.length || label.length > 256) throw new CliError('Label must have 1-256 characters.');
  const directory = resolve(ctx.args.value('dir') ?? namespace);
  const path = join(directory, 'source.json');
  const picklistId = randomId('006');
  const source = { packageId: randomId('apg'), namespace, label, versionId: randomId('apv'), version: '1.0.0', records: [
    { id: picklistId, kind: 'BizPicklist', values: { label: '状态', name: namespace + '__status', isActive: true } },
    { id: randomId('007'), kind: 'BizPicklistItem', values: { label: '待处理', name: 'new', isActive: true, refPicklistId: picklistId } },
  ] };
  mkdirSync(directory, { recursive: true });
  writeFileSync(path, JSON.stringify(source, null, 2) + '\n', { flag: 'wx' });
  ctx.reporter.print(ctx.reporter.json ? { source: path, packageId: source.packageId, versionId: source.versionId, version: source.version } : `Created ${path}`);
  return 0;
}

export async function buildApp(ctx, save) {
  if (ctx.args.has('exchange')) throw new CliError('Build requires an XRain platform profile; --exchange is only for login, logout, publish or status.');
  const sourcePath = resolve(ctx.args.value('source') ?? 'source.json');
  const source = readLimited(sourcePath, MAX_SOURCE, 'Source JSON');
  const parsed = parseJson(source, 'Source JSON');
  if (!isObject(parsed)) throw new CliError('Source JSON must be an object.');
  let output = save && ctx.args.has('output') ? resolve(ctx.args.value('output')) : undefined;
  if (save && !output && validPackageId(parsed.packageId) && typeof parsed.version === 'string' && parsed.version.length <= 64 && /^[0-9A-Za-z.+-]+$/.test(parsed.version))
    output = join(dirname(sourcePath), `${parsed.packageId}-${parsed.version}.appkg`);
  if (output) {
    if (existsSync(output)) throw new CliError(`Output already exists: ${output}`, { code: 'output_exists' });
    accessSync(dirname(output), constants.W_OK);
  }
  const { send, root } = client(ctx);
  const response = requireSuccess(await send('POST', root + '/packages:build', { body: source, headers: { 'Content-Type': 'application/json' }, limit: MAX_ARCHIVE }));
  const sourceHash = sha256(source), fileHash = sha256(response.bytes);
  if (response.headers.get('x-appkg-source-sha256')?.trim().toLowerCase() !== sourceHash) throw new CliError('Build response source digest does not match the local source.');
  if (response.headers.get('x-appkg-file-sha256')?.trim().toLowerCase() !== fileHash) throw new CliError('Build response archive digest is invalid.');
  const packageId = response.headers.get('x-appkg-package-id')?.trim(), version = response.headers.get('x-appkg-version')?.trim();
  if (!validPackageId(packageId) || !version || version.length > 64 || !/^[0-9A-Za-z.+-]+$/.test(version)) throw new CliError('Build response package identity is invalid.');
  const manifest = readManifest(response.bytes);
  if (manifest.packageId !== packageId || (manifest.version !== undefined && manifest.version !== version)) throw new CliError('Build response manifest does not match its headers.');
  if ((validPackageId(parsed.packageId) && parsed.packageId !== packageId) ||
      (typeof parsed.version === 'string' && parsed.version !== version) ||
      (typeof parsed.versionId === 'string' && parsed.versionId !== manifest.versionId)) throw new CliError('Build response package identity does not match the source.');
  if (!save) { ctx.reporter.print(ctx.reporter.json ? { source: sourcePath, packageId, version, sourceSha256: sourceHash, packageSha256: fileHash, validated: true } : `Validated ${sourcePath}; package ${packageId}, version ${version}.`); return 0; }
  output ??= join(dirname(sourcePath), `${packageId}-${version}.appkg`);
  if (existsSync(output)) throw new CliError(`Output already exists: ${output}`, { code: 'output_exists' });
  const temporary = `${output}.${randomBytes(8).toString('hex')}.part`;
  try {
    writeFileSync(temporary, response.bytes, { flag: 'wx' });
    // Exclusive copy works on filesystems without hard links and refuses to
    // overwrite a destination that appeared while the build was in progress.
    copyFileSync(temporary, output, constants.COPYFILE_EXCL);
  } finally { if (existsSync(temporary)) unlinkSync(temporary); }
  ctx.reporter.print({ output, sourceSha256: sourceHash, packageSha256: fileHash });
  return 0;
}

async function published(send, root) {
  const result = requireSuccess(await send('GET', root + '/my-published')).json();
  if (!Array.isArray(result) || result.some(item => !item || !validPackageId(item.id))) throw new CliError('The server returned an invalid package list.');
  return result;
}

export async function publishApp(ctx) {
  const path = resolve(ctx.args.required('file', ctx.args.operand(2)));
  const bytes = readLimited(path, MAX_ARCHIVE, 'Package');
  const manifest = readManifest(bytes);
  const { send, root } = client(ctx);
  const packages = await published(send, root);
  const current = packages.find(item => item.id === manifest.packageId);
  const headers = { 'Content-Type': 'application/octet-stream' };
  if (nonempty(current?.publishedVersionId)) headers['X-Appkg-Expected-Published-Version'] = current.publishedVersionId;
  try {
    const result = requireSuccess(await send('POST', root + '/packages:publish', { body: bytes, headers })).json();
    if (result.packageId !== manifest.packageId || result.versionId !== manifest.versionId) throw new CliError('The publish response does not match the local package.');
    ctx.reporter.print({ packageId: result.packageId, versionId: result.versionId, version: result.version, published: true });
  } catch (error) {
    throw new CliError(error instanceof CliError ? error.message : 'Publish failed.', {
      code: error instanceof CliError ? error.code : 'publish_failed', httpStatus: error.httpStatus, serverCode: error.serverCode, requestId: error.requestId, details: error.details,
      hint: 'Run app status before retrying; the server may have accepted this version.',
    });
  }
  return 0;
}

export async function appStatus(ctx) {
  const { send, root } = client(ctx);
  const packages = await published(send, root);
  const filter = ctx.args.value('package');
  const selected = packages.filter(item => !filter || item.id === filter || item.namespace === filter);
  const statuses = [];
  for (const item of selected) {
    const versions = requireSuccess(await send('GET', `${root}/packages/${encodeURIComponent(item.id)}/versions`)).json();
    if (!Array.isArray(versions)) throw new CliError('The server returned an invalid version list.');
    statuses.push({ id: item.id, namespace: item.namespace, label: item.label, publishedVersionId: item.publishedVersionId,
      versions: versions.filter(v => ctx.args.has('exchange') || v.publishedAt != null).map(v => ({ id: v.id, version: v.version, digest: v.digest, publishedAt: v.publishedAt ?? v.createdAt })) });
  }
  // Preserve the legacy single-object text result; machine mode always has one
  // array, including when no applications match. Multiple text results also form
  // one JSON document instead of several concatenated objects.
  ctx.reporter.print(!ctx.reporter.json && statuses.length === 1 ? statuses[0] : statuses);
  return 0;
}

export async function appCommands(ctx) {
  switch (ctx.args.command(1)) {
    case 'login': return browserLogin(ctx);
    case 'logout': {
      const profile = ctx.args.has('exchange') ? ctx.store.market(ctx.args) : ctx.store.resolve(ctx.args);
      ctx.store.deleteSession(profile.name);
      ctx.reporter.print(ctx.reporter.json ? { profile: profile.name, authenticated: false } : `Logged out of app profile '${profile.name}'.`);
      return 0;
    }
    case 'init': return initApp(ctx);
    case 'check': return buildApp(ctx, false);
    case 'build': return buildApp(ctx, true);
    case 'publish': return publishApp(ctx);
    case 'status': return appStatus(ctx);
    case 'import-file': {
      const bytes = readLimited(resolve(ctx.args.required('file')), MAX_ARCHIVE, 'Package'), manifest = readManifest(bytes);
      const api = client(ctx, { allowHost: true });
      const result = await writeOnce(async () => {
        const response = requireSuccess(await api.send('POST', api.root + '/packages:import', { body: bytes, headers: { 'Content-Type': 'application/octet-stream' } }));
        let value;
        try { value = response.json(); } catch { throw new CliError('The import response is invalid.', { code: 'invalid_response' }); }
        if (value?.packageId !== manifest.packageId || value?.versionId !== manifest.versionId)
          throw new CliError('The import response does not match this package.', { code: 'invalid_response' });
        return value;
      }, 'Import outcome is unknown. Read the original package versions before importing again; this command does not install or publish.', { packageId: manifest.packageId, versionId: manifest.versionId });
      ctx.reporter.print(result); return 0;
    }
    default: return appManagementCommands(ctx, options => client(ctx, options));
  }
}
