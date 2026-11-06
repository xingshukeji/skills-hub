import { readFile, realpath, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { CliError, isObject, nonempty, parseJson, randomId, sha256 } from './core.mjs';
import { validPackageId, validVersionId } from './archive.mjs';

const invalid = message => new CliError(message, { code: 'invalid_project' });
const slash = path => path.split(sep).join('/');
function fields(value, allowed, label) {
  if (!isObject(value)) throw invalid(`${label} must be an object.`);
  const unknown = Object.keys(value).filter(key => !allowed.includes(key));
  if (unknown.length) throw invalid(`${label} has unknown fields: ${unknown.join(', ')}.`);
}
function inside(root, path) {
  const rel = relative(root, path);
  return rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel);
}
// Matches the platform SemVer contract, including numeric prerelease identifiers.
const semver = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*)?(\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
export function projectVersion(base, release = false) {
  if (typeof base !== 'string' || !semver.test(base) || base.endsWith('\n') || base.length > 64)
    throw invalid('package.baseVersion must be a platform SemVer of at most 64 characters.');
  const [core, metadata] = base.split('+');
  const version = release ? base : `${core}${core.includes('-') ? '.' : '-'}dev.r${randomBytes(8).toString('hex')}${metadata ? '+' + metadata : ''}`;
  if (version.length > 64) throw invalid('The candidate version exceeds the platform 64-character limit. Use a shorter baseVersion.');
  return version;
}

export class ProjectInputs {
  constructor(root) { this.root = root; this.files = new Map(); }
  async read(file) {
    if (!nonempty(file) || isAbsolute(file) || file.includes('\\') || /[\r\n]/.test(file) || file.split('/').some(part => ['', '.', '..'].includes(part)) ||
        /^(?:\.artifacts|\.local)(?:\/|$)/.test(file)) throw invalid(`Invalid project input path: ${file}. Use a project-relative source file.`);
    const path = resolve(this.root, file);
    let actual;
    try { actual = await realpath(path); } catch { throw invalid(`Project input does not exist: ${file}.`); }
    if (!inside(this.root, actual)) throw invalid(`Project input resolves outside the project: ${file}.`);
    if (!this.files.has(file)) {
      if (!(await stat(path)).isFile()) throw invalid(`Project input is not a file: ${file}.`);
      this.files.set(file, await readFile(path));
    }
    return this.files.get(file);
  }
  async json(file) { return parseJson(await this.read(file), file); }
  async unchanged() {
    for (const [file, content] of this.files) if (!(await readFile(join(this.root, file))).equals(content))
      throw new CliError(`Project input changed during assembly: ${file}. Run the command again.`, { code: 'project_changed' });
  }
  list() { return [...this.files].map(([file, bytes]) => ({ file, sha256: sha256(bytes), bytes: bytes.length })); }
}

async function compiler(inputs) {
  const pkg = await inputs.json('package.json');
  const declared = pkg.devDependencies?.esbuild ?? pkg.dependencies?.esbuild;
  if (!/^\d+\.\d+\.\d+$/.test(declared ?? '')) throw invalid('Module builds require an exact esbuild version in the project package.json and a package-manager lockfile.');
  const locks = ['npm-shrinkwrap.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'].filter(file => existsSync(join(inputs.root, file)));
  if (!locks.length) throw invalid('Module builds require the project package-manager lockfile; install its locked dependencies first.');
  for (const file of locks) await inputs.read(file);
  // Resolve only when module compilation is requested. The standalone CLI does
  // not bundle esbuild, require npm, or change the project's dependencies.
  const require = createRequire(join(inputs.root, 'package.json'));
  let tool;
  try { tool = require('esbuild'); } catch { throw new CliError('The project esbuild dependency is not installed. Install the project locked dependencies first.', { code: 'project_dependency_missing' }); }
  if (tool.version !== declared) throw invalid(`Installed esbuild ${tool.version} does not match project version ${declared}.`);
  return tool;
}

async function scriptSource(inputs, script, kind, tools) {
  fields(script, ['mode', 'file', 'export'], 'script');
  if (!['BizOrchestrationFunction', 'BizOrchestrationVersion'].includes(kind)) throw invalid(`Scripts are not supported for resource kind ${kind}.`);
  if (script.mode === 'frozen') {
    if (Object.hasOwn(script, 'export')) throw invalid('Frozen source has no module export.');
    const source = await inputs.json(script.file);
    if (!nonempty(source)) throw invalid('Frozen source must be a nonempty JSON string.');
    return source;
  }
  if (script.mode !== 'module' || typeof script.export !== 'string' || !/^[A-Za-z_$][\w$]*$/.test(script.export))
    throw invalid('Module scripts require mode=module, a file and a named export.');
  await inputs.read(script.file);
  const tool = tools.compiler ??= await compiler(inputs);
  const loaders = { '.mjs': 'js', '.cjs': 'js', '.js': 'js', '.jsx': 'jsx', '.ts': 'ts', '.mts': 'ts', '.cts': 'ts', '.tsx': 'tsx', '.json': 'json' };
  let result;
  try {
    result = await tool.build({ absWorkingDir: inputs.root,
      stdin: { contents: `export { ${script.export} as invoke } from ${JSON.stringify('./' + script.file)};`, resolveDir: inputs.root, sourcefile: 'xrain-entry.mjs', loader: 'js' },
      bundle: true, write: false, platform: 'neutral', mainFields: ['module', 'main'], format: 'iife', globalName: '__xrain', target: 'es2022',
      charset: 'utf8', minify: false, legalComments: 'none', metafile: true, logLevel: 'silent',
      // Disable implicit tsconfig transforms. Every program input must be known.
      tsconfigRaw: {}, plugins: [{ name: 'project-inputs', setup(build) {
        build.onLoad({ filter: /.*/, namespace: 'file' }, async args => {
          if (!inside(inputs.root, args.path)) throw invalid('Bundled modules must be inside the project.');
          const file = slash(relative(inputs.root, args.path)), loader = loaders[extname(args.path)];
          if (!loader) throw invalid(`Unsupported platform module input: ${file}.`);
          // Package exports/main/type can affect resolution even though esbuild
          // does not list package.json as a program input in its metafile.
          for (let parent = dirname(args.path); inside(inputs.root, parent); parent = dirname(parent)) {
            const manifest = join(parent, 'package.json');
            if (existsSync(manifest)) await inputs.read(slash(relative(inputs.root, manifest)));
            if (parent === inputs.root) break;
          }
          return { contents: await inputs.read(file), loader, resolveDir: dirname(args.path) };
        });
      } }] });
  } catch (error) {
    const messages = error.errors?.map(item => item.text).join('; ');
    throw new CliError(`Cannot compile ${script.file}: ${messages ?? error.message}`, { code: 'project_compile_failed' });
  }
  if (Object.values(result.metafile.outputs).some(output => output.imports.length))
    throw invalid(`Platform source cannot retain runtime module imports: ${script.file}.`);
  const body = `${result.outputFiles[0].text}\nreturn __xrain.invoke(ctx);\n`;
  return kind === 'BizOrchestrationFunction' ? `function(ctx) {\n${body}}` : `function execute(ctx) {\n${body}}`;
}

async function attachSource(inputs, entry, values, kind, tools) {
  const output = { ...values };
  for (const [external, internal] of [['script', 'source'], ['contract', 'contractJson']]) {
    if (!Object.hasOwn(entry, external)) continue;
    if (Object.hasOwn(values, internal)) throw invalid(`${entry.file ?? entry.definition} embeds ${internal} and also declares ${external}. Keep one source.`);
    if (external === 'script') output.source = await scriptSource(inputs, entry.script, kind, tools);
    else {
      if (kind !== 'BizOrchestrationFunction') throw invalid('Only functions accept contractJson.');
      output.contractJson = await inputs.json(entry.contract);
    }
  }
  return output;
}

function gitState(root, inputs, release) {
  const git = (directory, args, input) => execFileSync('git', ['-C', directory, ...args],
    { input, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 });
  let repository, commit, dirty, tracked;
  try {
    repository = git(root, ['rev-parse', '--show-toplevel']).toString().trim();
    commit = git(root, ['rev-parse', 'HEAD']).toString().trim();
    dirty = !!git(root, ['status', '--porcelain', '--untracked-files=all', '--', '.']).length;
    tracked = new Map(git(root, ['ls-tree', '-r', '--full-tree', '-z', commit, '--', '.']).toString().split('\0')
      .filter(Boolean).map(line => {
        const tab = line.indexOf('\t'), header = line.slice(0, tab).split(' ');
        return [line.slice(tab + 1), header[2]];
      }));
  } catch {
    if (release) throw invalid('Release builds require committed project inputs in a Git checkout.');
    return { available: false };
  }
  const uncommittedInputs = [], toHash = [];
  for (const [file] of inputs.files) {
    // Installed module bytes are preserved in the input snapshot, with the
    // committed package manifest and lock; they are not checked into Git.
    if (file.startsWith('node_modules/')) continue;
    const path = slash(relative(repository, join(root, file)));
    if (!tracked.has(path)) uncommittedInputs.push(file);
    else toHash.push({ file, path });
  }
  // Compare actual input bytes with HEAD through Git's clean filters. Git's
  // status/diff can hide files marked assume-unchanged or skip-worktree.
  // Prefixing ./ also prevents a filename beginning with a quote from being
  // interpreted as a C-quoted path by --stdin-paths.
  if (toHash.length) {
    try {
      const hashes = git(repository, ['hash-object', '--stdin-paths'],
        toHash.map(item => `./${item.path}\n`).join('')).toString().trim().split('\n');
      if (hashes.length !== toHash.length) throw Error('unexpected hash count');
      for (const [index, item] of toHash.entries()) if (hashes[index].trim() !== tracked.get(item.path)) uncommittedInputs.push(item.file);
    } catch {
      if (release) throw invalid('Release inputs could not be compared with their committed Git blobs.');
      return { available: true, commit, dirty: true, inputsCommitted: false, uncommittedInputs: toHash.map(item => item.file).concat(uncommittedInputs) };
    }
  }
  if (release && uncommittedInputs.length) throw invalid(`Release inputs are not committed at ${commit.slice(0, 12)}: ${uncommittedInputs.join(', ')}. Commit the complete inputs before --release.`);
  return { available: true, commit, dirty: dirty || uncommittedInputs.length > 0, inputsCommitted: !uncommittedInputs.length, uncommittedInputs };
}

export async function assembleProject(project, { release = false } = {}) {
  const root = await realpath(resolve(project)), inputs = new ProjectInputs(root);
  const descriptor = await inputs.json('xrain-project.json');
  fields(descriptor, ['schemaVersion', 'package', 'records', 'tenantFunctions'], 'xrain-project.json');
  if (descriptor.schemaVersion !== 1) throw invalid('Unsupported project schemaVersion; expected 1.');
  fields(descriptor.package, ['packageId', 'namespace', 'label', 'baseVersion', 'releaseVersionId'], 'package');
  const pkg = descriptor.package;
  if (!validPackageId(pkg.packageId) || !validVersionId(pkg.releaseVersionId)) throw invalid('packageId and releaseVersionId must use the platform apg/apv identities.');
  if (typeof pkg.namespace !== 'string' || !/^[a-z][a-z0-9]{1,15}$/.test(pkg.namespace) || pkg.namespace.endsWith('\n')) throw invalid('Namespace must have 2-16 lowercase letters or digits and start with a letter.');
  if (!nonempty(pkg.label) || pkg.label.length > 256) throw invalid('Label must have 1-256 characters.');
  if (!Array.isArray(descriptor.records) || !Array.isArray(descriptor.tenantFunctions ?? [])) throw invalid('records and tenantFunctions must be arrays.');
  const source = { packageId: pkg.packageId, namespace: pkg.namespace, label: pkg.label,
    versionId: release ? pkg.releaseVersionId : randomId('apv'), version: projectVersion(pkg.baseVersion, release), records: [] };
  const files = new Set(), ids = new Set(), keys = new Set(), tenantFunctions = [], tools = {};
  for (const entry of descriptor.records) {
    fields(entry, ['file', 'script', 'contract'], 'record entry');
    if (files.has(entry.file)) throw invalid(`Resource file is declared twice: ${entry.file}.`);
    files.add(entry.file);
    const record = await inputs.json(entry.file);
    fields(record, ['id', 'kind', 'values'], entry.file);
    if (!nonempty(record.id) || !nonempty(record.kind) || !isObject(record.values)) throw invalid(`Invalid platform resource shape: ${entry.file}.`);
    if (ids.has(record.id)) throw invalid(`Duplicate resource ID: ${record.id}.`);
    ids.add(record.id);
    source.records.push({ ...record, values: await attachSource(inputs, entry, record.values, record.kind, tools) });
  }
  for (const entry of descriptor.tenantFunctions ?? []) {
    fields(entry, ['definition', 'script', 'contract'], 'tenant function entry');
    if (files.has(entry.definition)) throw invalid(`Function definition is declared twice: ${entry.definition}.`);
    files.add(entry.definition);
    const definition = await inputs.json(entry.definition);
    fields(definition, ['key', 'label', 'helpText', 'signature', 'isActive', 'source', 'contractJson'], entry.definition);
    if (!nonempty(definition.key) || !nonempty(definition.label) || (definition.isActive !== undefined && typeof definition.isActive !== 'boolean'))
      throw invalid(`Function definition requires key, label and optional boolean isActive: ${entry.definition}.`);
    if (keys.has(definition.key)) throw invalid(`Duplicate tenant function key: ${definition.key}.`);
    keys.add(definition.key);
    const value = await attachSource(inputs, entry, definition, 'BizOrchestrationFunction', tools);
    if (!nonempty(value.source)) throw invalid(`Function source is required: ${entry.definition}.`);
    tenantFunctions.push(value);
  }
  await inputs.unchanged();
  const git = gitState(root, inputs, release);
  await inputs.unchanged();
  return { root, source, tenantFunctions, inputs, release, git,
    compiler: tools.compiler ? { name: 'esbuild', version: tools.compiler.version, target: 'es2022' } : null };
}
