import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { main } from '../src/xrain-cli/main.mjs';
import { Args, Reporter } from '../src/xrain-cli/core.mjs';
import { Store } from '../src/xrain-cli/store.mjs';
import { crc32 } from '../src/xrain-cli/archive.mjs';

export const PACKAGE_ID = 'apg0123456789abcdefg';
export const VERSION_ID = 'apv0123456789abcdefg';

export function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'xrain-cli-test-'));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^xrain(?:_|__)/i.test(key)));
  env.XRAIN_HOME = join(directory, 'state');
  const store = new Store(env);
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return { directory, env, store,
    async run(argv, extra = {}) {
      let stdout = '', stderr = '';
      const code = await main(argv, { env, stdin: extra.stdin, stdout: { write(value) { stdout += value; extra.onOutput?.(value); } }, stderr: { write(value) { stderr += value; extra.onOutput?.(value); } } });
      return { code, stdout, stderr };
    },
    context(argv) {
      const reporter = new Reporter({ write() {} }, { write() {} });
      return { args: new Args(argv), store: new Store(env, reporter), reporter };
    },
    profile(server, tenant = 'tenant-demo', bearerToken) {
      store.save({ activeProfile: 'Demo', profiles: { Demo: { server, tenant, ...(bearerToken ? { bearerToken } : {}) } } });
    },
  };
}

export async function mockServer(t, handler) {
  const hits = [], errors = [];
  const server = createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      const hit = { method: req.method, url: req.url, headers: req.headers, body, json: () => JSON.parse(body.toString()) };
      hits.push(hit);
      await handler(hit, res);
    } catch (error) { errors.push(error); if (!res.headersSent) res.writeHead(500); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); assert.deepEqual(errors, []); });
  return { url, hits, server };
}

export function respond(res, value, status = 200, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(value));
}

export function zip(entries, { deflate = true } = {}) {
  const locals = [], central = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const bytes = Buffer.isBuffer(data) ? data : Buffer.from(typeof data === 'string' ? data : JSON.stringify(data));
    const raw = deflate ? deflateRawSync(bytes) : bytes, filename = Buffer.from(name), method = deflate ? 8 : 0;
    const crc = crc32(bytes);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(raw.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(filename.length, 26);
    locals.push(local, filename, raw);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50); dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6); dir.writeUInt16LE(method, 10);
    dir.writeUInt32LE(crc, 16); dir.writeUInt32LE(raw.length, 20); dir.writeUInt32LE(bytes.length, 24); dir.writeUInt16LE(filename.length, 28); dir.writeUInt32LE(offset, 42);
    central.push(dir, filename);
    offset += local.length + filename.length + raw.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

export function appArchive(overrides = {}) {
  return zip([['manifest.json', { packageId: PACKAGE_ID, versionId: VERSION_ID, version: '1.0.0', ...overrides }], ['records/data.json', '[]']]);
}

export function makeDirectory(path) { mkdirSync(path, { recursive: true }); return path; }
