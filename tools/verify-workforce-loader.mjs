import assert from 'node:assert/strict';
import { cp, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Optional maintainer integration check. Skills themselves have no provider dependency.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [flag, modulePath] = process.argv.slice(2);
assert(flag === '--provider' && modulePath && process.argv.length === 4,
  'Usage: node tools/verify-workforce-loader.mjs --provider /path/to/dsh-skill-filesystem/lib/index.js');
const { FileSystemSkillProvider } = await import(pathToFileURL(resolve(modulePath)).href);
assert.equal(typeof FileSystemSkillProvider, 'function');
const temporaryRoot = await mkdtemp(join(tmpdir(), 'workforce skill loader '));
const results = [];
try {
  for (const entry of await readdir(join(root, 'skills'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillRoot = join(temporaryRoot, entry.name, 'skills');
    const installed = join(skillRoot, entry.name);
    await cp(join(root, 'skills', entry.name), installed, { recursive: true });
    const warnings = [];
    const controller = new AbortController();
    const provider = new FileSystemSkillProvider({ get: () => undefined, logger: { warn: message => warnings.push(message) } },
      { invalidate() {}, signal: controller.signal },
      { includeDefaultRoots: false, customSkillDirs: [skillRoot], watch: false, dshHome: temporaryRoot, agentsHome: temporaryRoot });
    try {
      const observation = await provider.list({ cwd: temporaryRoot, signal: controller.signal });
      const catalog = Array.isArray(observation) ? observation : observation.candidates;
      assert.equal(catalog.length, 1, 'Isolated copy must expose exactly one skill.');
      assert.equal(catalog[0].name, entry.name);
      assert(catalog[0].description.length <= 500, 'Description would be truncated in the default Workforce catalog.');
      const loaded = await provider.get(catalog[0], { cwd: temporaryRoot, signal: controller.signal });
      assert.equal(loaded.resourceBase.kind, 'directory');
      assert.equal(resolve(loaded.resourceBase.path), resolve(installed));
      assert(loaded.content.trim().length > 0);
      assert.equal(warnings.length, 0, 'Provider ignored or warned about a skill.');
      const references = [...loaded.content.matchAll(/\[[^\]]*\]\(((?:references|modes)\/[^)#]+)(?:#[^)]*)?\)/g)].map(match => match[1]);
      for (const reference of references) assert((await readFile(join(loaded.resourceBase.path, reference))).length > 0);
      results.push({ skill: entry.name, discovered: true, loaded: true, references: references.length });
    } finally { controller.abort(); await provider.dispose(); }
  }
  console.log(JSON.stringify({ isolatedCopies: true, results }, null, 2));
} finally { await rm(temporaryRoot, { recursive: true, force: true }); }
