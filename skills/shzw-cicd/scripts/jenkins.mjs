#!/usr/bin/env node
import { readFile, writeFile, rename, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';

const help = `Usage: node jenkins.mjs <jobs|inspect|trigger|status> [options]

  jobs     List jobs; --job may name a folder.
  inspect  Show --job parameters and recent builds.
  trigger  Submit --job once; --run-file is required.
  status   Query --run-file, or --job with --build.

Options:
  --url URL               Jenkins base URL (or JENKINS_URL)
  --job NAME              Job or folder path, e.g. team/service
  --parameters-file FILE  JSON object of scalar build parameters
  --run-file FILE         Private run receipt, outside the skill directory
  --build NUMBER          Exact build number for status
  --help                  Show this help

Requires Node.js 22.12+. Credentials: JENKINS_USER and JENKINS_TOKEN.
Use HTTPS; HTTP is allowed only for loopback. Requests are not redirected
or automatically retried. Output is JSON; status.result is the build result.
`;

class UserError extends Error {}
class RequestError extends UserError {
  constructor(method, status) {
    super(`Jenkins ${method} request failed (HTTP ${status}); inspect the original run before another trigger.`);
    this.status = status;
  }
}
const secrets = new Set();
function json(value) {
  return JSON.stringify(value, (_key, item) => {
    if (typeof item !== 'string') return item;
    for (const secret of secrets) item = item.replaceAll(secret, '[REDACTED]');
    return item;
  }, 2) + '\n';
}
async function readJson(file, label) {
  try { return JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, '')); }
  catch { throw new UserError(`Cannot read ${label}; provide a valid UTF-8 JSON file.`); }
}
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function id(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new UserError(`Invalid ${label}.`);
  return value;
}
function baseUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new UserError('Provide a Jenkins HTTP(S) URL.'); }
  if (url.username || url.password || url.search || url.hash) {
    throw new UserError('Provide a Jenkins URL without credentials, query parameters or fragments.');
  }
  const loopback = url.hostname === 'localhost' || url.hostname === '[::1]' || /^127(?:\.\d+){3}$/.test(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new UserError('Use HTTPS for Jenkins; HTTP is supported only on loopback.');
  }
  return url.href.replace(/\/+$/, '');
}
function jobPath(name) {
  if (typeof name !== 'string' || !name || /[\\\x00-\x1f\x7f]/.test(name)) throw new UserError('Provide a valid job name.');
  const parts = name.split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) throw new UserError('Invalid job name.');
  return '/job/' + parts.map(encodeURIComponent).join('/job/');
}
async function saveRun(file, value, create = false) {
  const destination = resolve(file);
  if (create) {
    try { await writeFile(destination, json(value), { flag: 'wx', mode: 0o600 }); }
    catch (error) {
      throw new UserError(error.code === 'EEXIST'
        ? 'Run file already exists; query it or choose a new file.'
        : 'Cannot create the run file; check its parent directory and permissions.');
    }
    return;
  }
  const temporary = destination + '.' + randomUUID() + '.tmp';
  try {
    await writeFile(temporary, json(value), { flag: 'wx', mode: 0o600 });
    await rename(temporary, destination);
  } catch {
    throw new UserError('Cannot update the run file; inspect the original run before another trigger.');
  } finally { await rm(temporary, { force: true }).catch(() => {}); }
}
function client(url) {
  const headers = new Headers({ Accept: 'application/json' });
  const user = process.env.JENKINS_USER, token = process.env.JENKINS_TOKEN;
  if (Boolean(user) !== Boolean(token)) throw new UserError('Set both JENKINS_USER and JENKINS_TOKEN.');
  if (!user && process.env.CICD_CREDENTIAL_REF) {
    throw new UserError('Inject JENKINS_USER and JENKINS_TOKEN through your credential manager; platform-specific credential files are not read.');
  }
  if (user) {
    if (user.includes(':')) throw new UserError('JENKINS_USER must not contain a colon.');
    const encoded = Buffer.from(`${user}:${token}`, 'utf8').toString('base64');
    secrets.add(token); secrets.add(encoded);
    headers.set('Authorization', `Basic ${encoded}`);
  }
  const cookies = new Map();
  async function request(path, method = 'GET', body) {
    const currentHeaders = new Headers(headers);
    if (cookies.size) currentHeaders.set('Cookie', [...cookies.values()].join('; '));
    let response;
    try {
      response = await fetch(url + path, {
        method, headers: currentHeaders, body, redirect: 'manual', signal: AbortSignal.timeout(30_000),
      });
    } catch { throw new RequestError(method, 0); }
    if (!response.ok) {
      await response.body?.cancel();
      throw new RequestError(method, response.status);
    }
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(';', 1)[0], separator = pair.indexOf('=');
      if (separator > 0) {
        cookies.set(pair.slice(0, separator), pair);
        const value = pair.slice(separator + 1);
        if (value) secrets.add(value);
      }
    }
    return response;
  }
  async function get(path) {
    const response = await request(path);
    try { return await response.json(); }
    catch { throw new UserError('Jenkins returned an unreadable JSON response.'); }
  }
  async function crumb() {
    let value;
    try { value = await get('/crumbIssuer/api/json'); }
    catch (error) { if (error instanceof RequestError && error.status === 404) return; throw error; }
    const field = value?.crumbRequestField;
    if (typeof field !== 'string' || !/^[A-Za-z0-9_-]+$/.test(field) ||
        /^(authorization|cookie|host|content-type|content-length|connection|transfer-encoding|accept)$/i.test(field) ||
        typeof value.crumb !== 'string' || !value.crumb || /[\r\n]/.test(value.crumb)) {
      throw new UserError('Jenkins returned an invalid CSRF crumb.');
    }
    secrets.add(value.crumb);
    headers.set(field, value.crumb);
  }
  return { get, request, crumb };
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs({ allowPositionals: true, options: {
      url: { type: 'string' }, job: { type: 'string' }, build: { type: 'string' },
      'parameters-file': { type: 'string' }, 'run-file': { type: 'string' }, help: { type: 'boolean' },
    } });
  } catch { throw new UserError('Invalid arguments; run with --help.'); }
  const options = parsed.values, action = parsed.positionals[0] ?? 'jobs';
  if (options.help) { process.stdout.write(help); return; }
  const allowed = {
    jobs: ['url', 'job'], inspect: ['url', 'job'],
    trigger: ['url', 'job', 'parameters-file', 'run-file'], status: ['url', 'job', 'build', 'run-file'],
  };
  if (parsed.positionals.length > 1 || !Object.hasOwn(allowed, action) ||
      Object.keys(options).some(key => !allowed[action].includes(key))) throw new UserError('Invalid arguments; run with --help.');
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 12)) throw new UserError('Requires Node.js 22.12 or newer.');
  const runFile = options['run-file'];
  let url = options.url || process.env.JENKINS_URL, job = options.job, build, run;
  if (options.build !== undefined) {
    if (!/^[1-9]\d*$/.test(options.build)) throw new UserError('Invalid build number.');
    build = id(Number(options.build), 'build number');
  }
  if (action === 'status' && runFile) {
    const saved = await readJson(runFile, 'run file');
    if (!object(saved)) throw new UserError('Invalid run file.');
    const savedUrl = baseUrl(saved.jenkinsUrl);
    jobPath(saved.job);
    if (job !== undefined && job !== saved.job) throw new UserError('Job differs from the saved run.');
    if (url && baseUrl(url) !== savedUrl) throw new UserError('Jenkins URL differs from the saved run.');
    if (saved.buildNumber != null) {
      id(saved.buildNumber, 'saved build number');
      if (build && build !== saved.buildNumber) throw new UserError('Build differs from the saved run.');
      build = saved.buildNumber;
    }
    if (saved.queueId != null) id(saved.queueId, 'saved queue ID');
    url = savedUrl; job = saved.job;
    run = { jenkinsUrl: url, job, submittedAt: saved.submittedAt, status: saved.status,
      queueId: saved.queueId ?? null, buildNumber: saved.buildNumber ?? null };
  }
  url = baseUrl(url);
  const path = job !== undefined || action !== 'jobs' ? jobPath(job) : '';
  if (action === 'trigger' && !runFile) throw new UserError('Provide --run-file before triggering a build.');
  if (action === 'status' && !run && !build) throw new UserError('Provide a build number or a saved run file.');
  const api = client(url);
  if (action === 'jobs') return api.get(path + '/api/json?tree=jobs[name,color,url]');
  if (action === 'inspect') {
    const details = await api.get(path + '/api/json?tree=fullName,buildable,inQueue,lastBuild[number,result,building,url],property[parameterDefinitions[name,type,choices,defaultParameterValue[value]]],builds[number,queueId,building,result,url]{0,5}');
    for (const property of details.property ?? []) {
      for (const parameter of property.parameterDefinitions ?? []) {
        // Only expose defaults for ordinary boolean/choice inputs, never credentials.
        const ordinary = ['BooleanParameterDefinition', 'ChoiceParameterDefinition'].includes(parameter.type) &&
          !/password|secret|token|credential|api.?key/i.test(parameter.name ?? '');
        if (!ordinary) { delete parameter.choices; delete parameter.defaultParameterValue; }
      }
    }
    return details;
  }
  if (action === 'trigger') {
    const form = new URLSearchParams();
    if (options['parameters-file']) {
      const parameters = await readJson(options['parameters-file'], 'parameters file');
      if (!object(parameters)) throw new UserError('Parameters file must contain a JSON object.');
      for (const [name, value] of Object.entries(parameters)) {
        if (!['string', 'number', 'boolean'].includes(typeof value) || (typeof value === 'number' && !Number.isFinite(value))) {
          throw new UserError('Use scalar job parameters.');
        }
        form.set(name, String(value));
      }
    }
    await api.crumb();
    run = { jenkinsUrl: url, job, submittedAt: new Date().toISOString(), status: 'submission-result-unknown', queueId: null, buildNumber: null };
    await saveRun(runFile, run, true);
    const response = await api.request(path + (options['parameters-file'] ? '/buildWithParameters' : '/build'), 'POST', form);
    await response.body?.cancel();
    let location;
    try { location = new URL(response.headers.get('Location'), url + '/'); } catch { /* Checked below. */ }
    const base = new URL(url), prefix = base.pathname.replace(/\/$/, '') + '/queue/item/';
    const suffix = location?.pathname.startsWith(prefix) ? location.pathname.slice(prefix.length) : '';
    if (!response.headers.get('Location') || !location || location.origin !== base.origin ||
        location.username || location.password || location.search || location.hash || !/^[1-9]\d*\/?$/.test(suffix)) {
      throw new UserError('Trigger returned an unexpected queue location; inspect the original job before retrying.');
    }
    run.queueId = id(Number(suffix.replace(/\/$/, '')), 'queue ID');
    run.status = 'queued';
    await saveRun(runFile, run);
    return run;
  }
  if (!build && run?.queueId && run.status !== 'cancelled') {
    let queue;
    try { queue = await api.get(`/queue/item/${run.queueId}/api/json`); }
    catch (error) {
      if (!(error instanceof RequestError) || error.status !== 404) throw error;
      const history = await api.get(path + '/api/json?tree=builds[number,queueId]{0,50}');
      const match = history.builds?.find(item => item.queueId === run.queueId);
      queue = match ? { executable: { number: match.number } } : null;
    }
    if (queue?.executable) build = id(queue.executable.number, 'queued build number');
    else if (queue?.cancelled) run.status = 'cancelled';
    else run.status = queue === null ? 'unknown' : 'queued';
  }
  if (build) {
    const details = await api.get(`${path}/${build}/api/json?tree=number,url,queueId,building,result,timestamp,duration,artifacts[fileName,relativePath]`);
    if (details.number !== build || (run?.queueId && details.queueId !== run.queueId)) throw new UserError('Build identity differs from the requested run.');
    run = { jenkinsUrl: url, job, submittedAt: run?.submittedAt, queueId: details.queueId, buildNumber: details.number,
      url: details.url, status: details.building ? 'running' : 'completed', result: details.result,
      timestamp: details.timestamp, duration: details.duration, artifacts: details.artifacts ?? [] };
  }
  if (runFile) await saveRun(runFile, run);
  return run;
}

try {
  const result = await main();
  if (result !== undefined) process.stdout.write(json(result));
} catch (error) {
  process.stderr.write((error instanceof UserError ? error.message : 'Unable to complete the Jenkins operation.') + '\n');
  process.exitCode = 1;
}
