import { inflateRawSync, createInflateRaw } from 'node:zlib';
import { openSync, closeSync, readSync, fstatSync, createReadStream, openAsBlob } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { CliError, isObject, parseJson } from './core.mjs';

const MAX_MANIFEST = 1024 * 1024;
export const validPackageId = value => typeof value === 'string' && value.length === 20 && /^apg[a-z0-9]{17}$/.test(value);
export const validVersionId = value => typeof value === 'string' && value.length === 20 && /^apv[a-z0-9]{17}$/.test(value);
const crcTable = Array.from({ length: 256 }, (_, i) => {
  for (let j = 0; j < 8; j++) i = (i & 1) ? 0xedb88320 ^ (i >>> 1) : i >>> 1;
  return i >>> 0;
});
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// Read only the root manifest. Never extract archive paths. Native inflate enforces
// a real output bound even when an untrusted ZIP lies about its uncompressed size.
function manifestEntry(archive) {
    let end = -1;
    for (let i = archive.length - 22; i >= Math.max(0, archive.length - 65557); i--) {
      if (archive.readUInt32LE(i) === 0x06054b50 && i + 22 + archive.readUInt16LE(i + 20) === archive.length) { end = i; break; }
    }
    if (end < 0 || archive.readUInt16LE(end + 4) !== 0 || archive.readUInt16LE(end + 6) !== 0) throw new Error('Invalid ZIP');
    const count = archive.readUInt16LE(end + 10);
    const centralSize = archive.readUInt32LE(end + 12);
    const centralOffset = archive.readUInt32LE(end + 16);
    if (!count || count === 0xffff || count !== archive.readUInt16LE(end + 8) || centralOffset + centralSize !== end) throw new Error('Invalid directory');
    let offset = centralOffset, manifest;
    for (let i = 0; i < count; i++) {
      if (offset + 46 > end || archive.readUInt32LE(offset) !== 0x02014b50) throw new Error('Invalid directory entry');
      const flags = archive.readUInt16LE(offset + 8), method = archive.readUInt16LE(offset + 10);
      const crc = archive.readUInt32LE(offset + 16), compressed = archive.readUInt32LE(offset + 20), size = archive.readUInt32LE(offset + 24);
      const nameLength = archive.readUInt16LE(offset + 28), extraLength = archive.readUInt16LE(offset + 30), commentLength = archive.readUInt16LE(offset + 32);
      const localOffset = archive.readUInt32LE(offset + 42);
      const next = offset + 46 + nameLength + extraLength + commentLength;
      if (next > end || archive.readUInt16LE(offset + 34) !== 0) throw new Error('Invalid directory entry');
      const name = archive.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
      if (name === 'manifest.json') {
        if (manifest || size > MAX_MANIFEST || (flags & 1) || ![0, 8].includes(method) || localOffset + 30 > centralOffset || archive.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('Invalid manifest entry');
        const localNameLength = archive.readUInt16LE(localOffset + 26), localExtraLength = archive.readUInt16LE(localOffset + 28);
        const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
        if (archive.readUInt16LE(localOffset + 6) !== flags || archive.readUInt16LE(localOffset + 8) !== method || dataOffset + compressed > centralOffset ||
            archive.subarray(localOffset + 30, localOffset + 30 + localNameLength).toString('utf8') !== name) throw new Error('Invalid local entry');
        manifest = { dataOffset, compressed, size, crc, method };
      }
      offset = next;
    }
    if (offset !== end || !manifest) throw new Error('Invalid manifest entry');
    return manifest;
}

function manifestValue(bytes, entry) {
  if (bytes.length !== entry.size || bytes.length > MAX_MANIFEST || crc32(bytes) !== entry.crc) throw new Error('Invalid manifest data');
  const manifest = parseJson(bytes, 'Package manifest');
  if (!isObject(manifest) || !validPackageId(manifest.packageId) || !validVersionId(manifest.versionId)) throw new Error('Invalid identity');
  return manifest;
}

const invalidArchive = () => new CliError('The application package ZIP or manifest is invalid (manifest limit: 1 MiB).');

export function readManifest(archive) {
  try {
    const entry = manifestEntry(archive), raw = archive.subarray(entry.dataOffset, entry.dataOffset + entry.compressed);
    return manifestValue(entry.method === 0 ? raw : inflateRawSync(raw, { maxOutputLength: MAX_MANIFEST }), entry);
  } catch { throw invalidArchive(); }
}

// Inspect only ZIP metadata and the bounded root manifest. Package transfer size
// belongs to the receiving service; unrelated entries are never loaded or extracted.
const checkSignal = signal => { if (signal?.aborted) throw new CliError('Stopped reading the artifact.', { code: 'interrupted' }); };

export async function readManifestFile(path, signal) {
  checkSignal(signal);
  const fd = openSync(path, 'r');
  try {
    const info = fstatSync(fd);
    if (!info.isFile()) throw new Error('A package must be a regular file');
    let page = Buffer.alloc(0), pageStart = -1;
    const read = (start, length) => {
      if (start < 0 || length < 0 || start + length > info.size) throw new Error('Invalid ZIP range');
      const aligned = Math.floor(start / 65536) * 65536;
      if (start < pageStart || start + length > pageStart + page.length) {
        pageStart = aligned; page = Buffer.alloc(Math.min(65536, info.size - aligned));
        let received = 0;
        while (received < page.length) { const count = readSync(fd, page, received, page.length - received, aligned + received); if (!count) throw new Error('Incomplete ZIP'); received += count; }
      }
      if (start + length <= pageStart + page.length) return page.subarray(start - pageStart, start - pageStart + length);
      const bytes = Buffer.alloc(length); let received = 0;
      while (received < length) { const count = readSync(fd, bytes, received, length - received, start + received); if (!count) throw new Error('Incomplete ZIP'); received += count; }
      return bytes;
    };
    const entry = manifestEntry({ length: info.size, readUInt16LE: start => read(start, 2).readUInt16LE(),
      readUInt32LE: start => read(start, 4).readUInt32LE(), subarray: (start, end) => read(start, end - start) });
    const chunks = []; let size = 0;
    if (entry.compressed) {
      const source = createReadStream(path, { fd, autoClose: false, start: entry.dataOffset, end: entry.dataOffset + entry.compressed - 1 });
      await pipeline(source, ...(entry.method === 8 ? [createInflateRaw()] : []), async input => {
        for await (const chunk of input) { checkSignal(signal); size += chunk.length; if (size > MAX_MANIFEST) throw new Error('Manifest is too large'); chunks.push(chunk); }
      }, { signal });
    }
    return manifestValue(Buffer.concat(chunks), entry);
  } catch { checkSignal(signal); throw invalidArchive(); }
  finally { closeSync(fd); }
}

export async function artifactSource(path) {
  const info = await stat(path);
  if (!info.isFile()) throw new CliError('An artifact must be a regular file.', { code: 'invalid_arguments' });
  const body = await openAsBlob(path);
  if (body.size !== info.size) throw new CliError('The artifact changed before it could be read.', { code: 'invalid_input' });
  return { body, length: info.size };
}

export async function fileSha256(path, signal) {
  checkSignal(signal);
  const { body } = await artifactSource(path), hash = createHash('sha256');
  for await (const chunk of body.stream()) { checkSignal(signal); hash.update(chunk); }
  return hash.digest('hex');
}
