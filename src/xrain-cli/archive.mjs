import { inflateRawSync } from 'node:zlib';
import { CliError, isObject, parseJson } from './core.mjs';

export const MAX_ARCHIVE = 16 * 1024 * 1024;
export const MAX_SOURCE = 32 * 1024 * 1024;
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
export function readManifest(archive) {
  try {
    if (archive.length > MAX_ARCHIVE) throw new Error('Too large');
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
        const raw = archive.subarray(dataOffset, dataOffset + compressed);
        const bytes = method === 0 ? raw : inflateRawSync(raw, { maxOutputLength: MAX_MANIFEST });
        if (bytes.length !== size || bytes.length > MAX_MANIFEST || crc32(bytes) !== crc) throw new Error('Invalid manifest data');
        manifest = parseJson(bytes, 'Package manifest');
      }
      offset = next;
    }
    if (offset !== end || !isObject(manifest) || !validPackageId(manifest.packageId) || !validVersionId(manifest.versionId)) throw new Error('Invalid identity');
    return manifest;
  } catch { throw new CliError('The application package ZIP or manifest is invalid (manifest limit: 1 MiB).'); }
}
