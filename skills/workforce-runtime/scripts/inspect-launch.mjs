import { readFile, stat } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { existsSync, realpathSync } from 'node:fs';

async function exists(path, directory = false) {
  try { const value = await stat(path); return directory ? value.isDirectory() : value.isFile(); }
  catch (error) { if (['ENOENT', 'ENOTDIR'].includes(error.code)) return false; throw error; }
}

export async function inspectLaunch(directory, configuration) {
  const root = resolve(directory);
  // The target project owns configuration fields, defaults and precedence.
  // Import its configuration reader, never the application/start entrypoint.
  const { developmentConfiguration } = await import(pathToFileURL(join(root, 'scripts/development-configuration.mjs')).href);
  const { applicationRoot, applicationConfig, connectionScript, applicationUrl } = await developmentConfiguration(configuration, { root });
  const pkg = JSON.parse((await readFile(join(root, 'package.json'), 'utf8')).replace(/^\uFEFF/u, ''));
  const scripts = pkg.scripts ?? {};
  const start = typeof scripts.start === 'string'
    ? /^node\s+(?:"([^"\r\n]+)"|'([^'\r\n]+)'|([^\s"']+))\s*$/.exec(scripts.start.trim()) : null;
  const entryFile = start && (start[1] ?? start[2] ?? start[3]);
  const registered = Boolean(entryFile && ['.mjs', '.cjs', '.js'].includes(extname(entryFile)));
  const paths = {
    applicationDirectory: { path: applicationRoot, directory: true },
    applicationScript: { path: join(applicationRoot, 'scripts/start-development.mjs') },
    applicationConfiguration: { path: applicationConfig },
    startScript: { path: registered ? resolve(root, entryFile) : null },
    ...(connectionScript ? { connectionScript: { path: connectionScript } } : {}),
  };
  for (const item of Object.values(paths)) item.exists = item.path !== null && await exists(item.path, item.directory);
  const extension = connectionScript ? extname(connectionScript).toLowerCase() : null;
  const connectionRuntime = extension === null ? 'not-configured'
    : ['.mjs', '.cjs', '.js'].includes(extension) ? 'node' : extension === '.py' ? 'python' : 'unsupported';
  const aliases = ['start', 'dev', 'preview', 'serve', 'debug', 'start:development', 'start:local', 'start:ui']
    .filter(name => Object.hasOwn(scripts, name));
  const aliasesMatch = registered && aliases.every(name => scripts[name] === scripts.start);
  return {
    root, paths, applicationOrigin: applicationUrl.origin, browserOrigin: applicationUrl.origin, connectionRuntime,
    entry: { command: 'npm start', cwd: root, registered, aliases, aliasesMatch },
    readyToInvoke: registered && aliasesMatch && connectionRuntime !== 'unsupported' && Object.values(paths).every(item => item.exists),
    requirements: { applicationNodeMajor: 24, connectorCompatibility: connectionScript ? 'not-checked' : 'not-configured' },
    runtimeHealth: 'not-checked', businessAcceptance: 'not-checked',
  };
}

if (process.argv[1] && existsSync(process.argv[1]) && import.meta.url === pathToFileURL(realpathSync(resolve(process.argv[1]))).href) {
  try {
    if (process.argv.length !== 3 && process.argv.length !== 4) throw new Error('invalid arguments');
    const result = await inspectLaunch(process.argv[2], process.argv[3]);
    console.log(JSON.stringify(result, null, 2));
    if (!result.readyToInvoke) process.exitCode = 1;
  } catch { console.error('Cannot inspect development configuration; check the project configuration reader and its inputs.'); process.exitCode = 2; }
}
