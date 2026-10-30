import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';

export class CliError extends Error {
  constructor(message, { code = 'invalid_input', hint, httpStatus, serverCode, details, requestId } = {}) {
    super(message);
    Object.assign(this, { code, hint, httpStatus, serverCode, details, requestId });
  }
}
export const DEFAULT_SERVER = 'http://127.0.0.1:5410';
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const randomId = prefix => prefix + randomBytes(9).toString('hex').slice(0, 17);
export const nonempty = value => typeof value === 'string' && value.trim().length > 0;
export const equalIgnoreCase = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();
export const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function segment(value) {
  if (value === '.' || value === '..') throw new CliError('Resource names cannot be dot path segments.');
  return encodeURIComponent(value);
}

const flags = new Set(['help', 'json', 'device', 'no-browser', 'no-total', 'check', 'wait', 'maintain-installed-version', 'mine', 'all']);
const valued = new Set(('server tenant tenant-id user-id bearer token-name auth profile name timeout exchange namespace label dir source output file package entity id query query-json values values-json filter filter-json page page-size search fields sort user role permission-set roles permission-sets permissions names version-id installation operation request-json expected-revision request-id wait-timeout poll-interval runtime agent-id application-id visibility decision workspace-id preset session-id action-ref message message-file').split(' '));
const optionName = name => name.toLowerCase() === 'pagesize' ? 'page-size' : name.toLowerCase();

export class Args {
  constructor(argv) {
    this.options = new Map();
    this.commands = [];
    let positional = false;
    for (let i = 0; i < argv.length; i++) {
      let item = argv[i];
      if (!positional && item === '--') { positional = true; continue; }
      if (!positional && item === '-h') item = '--help';
      if (positional || !item.startsWith('--')) { this.commands.push(item); continue; }
      const match = /^--([^=]+)(?:=(.*))?$/s.exec(item);
      if (!match) throw new CliError('Invalid option. Run --help.');
      const key = optionName(match[1]);
      if (this.options.has(key)) throw new CliError(`--${key} was supplied more than once.`, { code: 'invalid_arguments' });
      if (flags.has(key)) {
        if (match[2] !== undefined) throw new CliError(`--${key} does not take a value.`);
        this.options.set(key, true);
      } else {
        if (!valued.has(key)) throw new CliError(`Unknown option --${key}. Run --help.`);
        const value = match[2] ?? (argv[i + 1]?.startsWith('--') ? undefined : argv[++i]);
        if (!nonempty(value)) throw new CliError(`--${key} requires a value.`);
        this.options.set(key, value);
      }
    }
  }
  value(name) { return this.options.get(optionName(name)); }
  has(name) { return this.options.has(optionName(name)); }
  command(index) { return this.commands[index]?.toLowerCase(); }
  operand(index) { return this.commands[index]; }
  required(name, fallback) {
    const value = this.value(name) ?? fallback;
    if (!nonempty(value)) throw new CliError(`--${name} is required.`);
    return value;
  }
  integer(name, fallback) {
    const value = this.value(name);
    if (value === undefined) return fallback;
    if (!/^[0-9]+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) <= 0)
      throw new CliError(`--${name} must be a positive integer.`);
    return Number(value);
  }
  timeout() {
    const seconds = this.integer('timeout', 100);
    if (seconds > 86400) throw new CliError('--timeout cannot exceed 86400 seconds.');
    return seconds * 1000;
  }
}

export function httpUrl(value, label = 'Server URL') {
  let url;
  try { url = new URL(value); } catch { throw new CliError(`${label} must be an absolute http or https URL.`); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash)
    throw new CliError(`${label} must be an http or https URL without credentials or a fragment.`);
  return url;
}

export function origin(value) {
  const url = httpUrl(value);
  if (url.pathname !== '/' || url.search) throw new CliError('Server URL must be an origin without a path or query.');
  return url.origin;
}

export function parseJson(text, label = 'Input') {
  try { return JSON.parse(String(text).replace(/^\uFEFF/, '')); }
  catch { throw new CliError(`${label} must be valid JSON.`); }
}

export function readLimited(path, limit, label = 'File') {
  if (statSync(path).size > limit) throw new CliError(`${label} exceeds the ${limit / 1024 / 1024} MiB limit.`);
  const data = readFileSync(path);
  if (data.length > limit) throw new CliError(`${label} exceeds its size limit.`);
  return data;
}

export async function readJsonInput(path, label = 'JSON input') {
  // Read pipes as a stream so a producer may deliver JSON gradually. A terminal
  // is rejected instead of unexpectedly waiting for interactive input.
  if (path !== '-') return parseJson(readLimited(path, 32 * 1024 * 1024, label), label);
  if (process.stdin.isTTY) throw new CliError('Pipe JSON into stdin when using -.', { code: 'invalid_arguments' });
  const chunks = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bytes.length;
    if (total > 32 * 1024 * 1024) throw new CliError('JSON stdin exceeds the 32 MiB limit.');
    chunks.push(bytes);
  }
  return parseJson(Buffer.concat(chunks), label);
}

export async function jsonInput(args, name, allowFile = true) {
  const file = args.value(`${name}-json`) ?? (allowFile ? args.value('file') : undefined);
  const inline = args.value(name);
  if (file) return readJsonInput(file);
  if (inline?.startsWith('@')) return readJsonInput(inline.slice(1));
  return inline === undefined ? undefined : parseJson(inline, 'JSON input');
}

const sensitiveKey = /^(authorization|bearer(?:token)?|access[_-]?token|refresh[_-]?token|id[_-]?token|identityToken|token|adminApiToken|guestApiToken|client[_-]?secret|password)$/i;
export class Reporter {
  constructor(stdout = process.stdout, stderr = process.stderr) {
    this.stdout = stdout; this.stderr = stderr; this.secrets = new Set(); this.json = false; this.results = [];
    this.visibleFields = new WeakMap();
  }
  secret(value) { if (nonempty(value)) this.secrets.add(value); return value; }
  // Only a command that owns a non-credential field may exempt its key. Known
  // credential values are still removed by clean(), including from that field.
  visibleField(object, key) {
    if (!this.visibleFields.has(object)) this.visibleFields.set(object, new Set());
    this.visibleFields.get(object).add(key);
  }
  clean(value) {
    if (Array.isArray(value)) return value.map(item => this.clean(item));
    if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
      sensitiveKey.test(key) && !this.visibleFields.get(value)?.has(key) ? '[REDACTED]' : this.clean(item)]));
    if (typeof value !== 'string') return value;
    let result = value;
    for (const secret of this.secrets) result = result.replaceAll(secret, '[REDACTED]');
    return result
      .replace(/(^|[\r\n"'=:\s]\s*)Bearer\s+[A-Za-z0-9._~+/-]{16,}=*/gi, '$1Bearer [REDACTED]')
      .replace(/(^|[\r\n"'=:]\s*)Bearer\s+[^\s"'<>]+/gi, '$1Bearer [REDACTED]');
  }
  print(value, error = false) {
    if (this.json && !error) { this.results.push(value); return; }
    const text = typeof value === 'string' ? this.clean(value) : JSON.stringify(this.clean(value), null, 2);
    (error ? this.stderr : this.stdout).write(text + '\n');
  }
  progress(value) { this.stderr.write(this.clean(value) + '\n'); }
  error(error) {
    this.failure = Object.fromEntries(Object.entries({ code: error.code, message: error.message,
      httpStatus: error.httpStatus, serverCode: error.serverCode, requestId: error.requestId, hint: error.hint, details: error.details }).filter(([, value]) => value !== undefined));
    if (!this.json) {
      this.print(error.message + (error.hint ? ' ' + error.hint : ''), true);
      if (error.details !== undefined) this.print(error.details, true);
    }
  }
  finish(code) {
    if (!this.json) return;
    const result = this.failure ? { ok: false, error: this.failure } : { ok: code === 0, data: this.results.length === 1 ? this.results[0] : this.results.length ? this.results : null };
    this.stdout.write(JSON.stringify(this.clean(result), null, 2) + '\n');
  }
}
