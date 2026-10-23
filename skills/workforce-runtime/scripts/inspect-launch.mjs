import { readFile, stat } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import { pathToFileURL } from 'node:url';

function assert(value) { if (!value) throw new Error('Invalid launch registration; see references/startup.md.'); }
const isObject = value => value && typeof value === 'object' && !Array.isArray(value);
async function exists(path, directory = false) {
  try { const value = await stat(path); return directory ? value.isDirectory() : value.isFile(); }
  catch (error) { if (['ENOENT', 'ENOTDIR'].includes(error.code)) return false; throw error; }
}
async function json(path) { const raw = await readFile(path, 'utf8'); assert(raw.length < 1024 * 1024); return JSON.parse(raw.replace(/^\uFEFF/u, '')); }
function text(value) { assert(typeof value === 'string' && value.trim() && !/[\r\n\0]/.test(value)); return value; }
function origin(value) {
  const url = new URL(text(value));
  assert(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password);
  return url.origin;
}
export async function inspectLaunch(directory, registration = '.workforce/development-launch.json') {
  const root = resolve(directory);
  const config = await json(resolve(root, text(registration)));
  assert(isObject(config));
  const pkg = await json(join(root, 'package.json'));
  const scripts = isObject(pkg.scripts) ? pkg.scripts : {};
  // Read the registered entry, never execute package scripts during inspection.
  const start = typeof scripts.start === 'string'
    ? /^node\s+(?:"([^"\r\n]+)"|'([^'\r\n]+)'|([^\s"']+))\s*$/.exec(scripts.start.trim()) : null;
  const entryFile = start && (start[1] ?? start[2] ?? start[3]);
  const registered = Boolean(entryFile && ['.mjs', '.cjs', '.js'].includes(extname(entryFile)));
  const application = resolve(root, text(config.applicationDirectory));
  const paths = {
    applicationDirectory: { path: application, directory: true },
    applicationScript: { path: join(application, 'scripts/start-development.mjs') },
    applicationConfiguration: { path: resolve(application, text(config.applicationConfiguration)) },
    connectionScript: { path: resolve(root, text(config.connectionScript)) },
    proxyScript: { path: resolve(root, text(config.proxyScript)) },
    startScript: { path: registered ? resolve(root, entryFile) : null }
  };
  const applicationOrigin = origin(config.applicationUrl), browserOrigin = origin(config.browserUrl);
  if (new URL(browserOrigin).protocol === 'https:') {
    paths.proxyTlsConfiguration = { path: typeof config.proxyTlsConfiguration === 'string' && config.proxyTlsConfiguration.trim()
      ? resolve(root, text(config.proxyTlsConfiguration)) : null };
  }
  for (const item of Object.values(paths)) item.exists = item.path !== null && await exists(item.path, item.directory);
  const extension = extname(paths.connectionScript.path);
  const connectionRuntime = ['.mjs', '.cjs', '.js'].includes(extension) ? 'node' : extension === '.py' ? 'python' : 'unsupported';
  const aliases = ['start', 'dev', 'preview', 'serve', 'debug', 'start:development', 'start:local', 'start:ui']
    .filter(name => Object.hasOwn(scripts, name));
  const aliasesMatch = registered && aliases.every(name => scripts[name] === scripts.start);
  return {
    root, paths, applicationOrigin, browserOrigin, connectionRuntime,
    entry: { command: 'npm start', cwd: root, registered, aliases, aliasesMatch },
    readyToInvoke: registered && aliasesMatch && connectionRuntime !== 'unsupported' && Object.values(paths).every(item => item.exists),
    requirements: { applicationNodeMajor: 24, connectorCompatibility: 'not-checked', tlsMaterial: 'not-checked' },
    runtimeHealth: 'not-checked', businessAcceptance: 'not-checked'
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    assert(process.argv.length === 3 || process.argv.length === 4);
    const result = await inspectLaunch(process.argv[2], process.argv[3]);
    console.log(JSON.stringify(result, null, 2));
    if (!result.readyToInvoke || !result.entry.aliasesMatch) process.exitCode = 1;
  } catch { console.error('Cannot inspect launch registration; check the project path and registration fields.'); process.exitCode = 2; }
}
