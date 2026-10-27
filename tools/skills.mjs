import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument } from 'yaml';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const skillsRoot = join(root, 'skills');
const write = process.argv.includes('--write');
const requestedSkill = process.env.SKILLS_HUB_VALIDATE_SKILL ?? (process.argv.includes('--skill') ? process.argv[process.argv.indexOf('--skill') + 1] : undefined);
if (process.argv.includes('--skill') && !requestedSkill) throw new Error('--skill requires a skill directory name.');
if (write && requestedSkill) throw new Error('Index generation requires the complete catalog; omit --skill.');
const availableNames = (await readdir(skillsRoot, { withFileTypes: true })).filter(item => item.isDirectory()).map(item => item.name).sort();
if (requestedSkill && !availableNames.includes(requestedSkill)) throw new Error(`Skill not found: ${requestedSkill}`);
const names = requestedSkill ? [requestedSkill] : availableNames;
const entries = [];
function assert(condition, message) { if (!condition) throw new Error(message); }
function yaml(text, path) {
  const doc = parseDocument(text, { uniqueKeys: true });
  assert(!doc.errors.length, `Invalid YAML in ${path}: ${doc.errors[0]?.message}`);
  return doc.toJS();
}
async function files(directory) {
  const result = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    assert(!item.isSymbolicLink(), `Skill must not depend on symlinks: ${join(directory, item.name)}`);
    if (item.isDirectory()) result.push(...await files(join(directory, item.name)));
    else result.push(join(directory, item.name));
  }
  return result;
}
async function validateResources(directory) {
  for (const file of await files(directory)) {
    const rel = relative(directory, file);
    assert(!/(^|[\\/])(node_modules|\.git|\.env|profiles\.json|local-test-secrets\.json)([\\/]|$)/.test(rel), `Unexpected dependency or private state inside directory: ${file}`);
    if (!file.endsWith('.md')) continue;
    const markdown = await readFile(file, 'utf8');
    for (const link of markdown.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const href = link[1];
      if (/^(?:https?:|mailto:|#)/.test(href)) continue;
      assert(!isAbsolute(href), `Resource references an absolute local path: ${file}`);
      const destination = resolve(dirname(file), href.split('#')[0]);
      const within = relative(directory, destination);
      assert(within !== '..' && !within.startsWith('..' + (process.platform === 'win32' ? '\\' : '/')) && !isAbsolute(within), `Resource link escapes its directory: ${file}`);
      assert((await stat(destination)).isFile(), `Missing resource reference: ${destination}`);
    }
  }
}
for (const name of names) {
  assert(name.length <= 64 && /^shzw-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name), `Invalid Suhong Zhuwei skill directory: ${name}`);
  const directory = join(skillsRoot, name), path = join(directory, 'SKILL.md');
  const text = await readFile(path, 'utf8');
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]+)$/.exec(text);
  assert(match, `Missing YAML frontmatter or body: ${path}`);
  const metadata = yaml(match[1], path);
  const allowed = new Set(['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools']);
  assert(metadata && typeof metadata === 'object' && !Array.isArray(metadata), `Invalid frontmatter: ${path}`);
  assert(Object.keys(metadata).every(key => allowed.has(key)), `Unknown frontmatter field: ${path}`);
  assert(metadata.name === name, `Skill name must match its directory: ${path}`);
  assert(typeof metadata.description === 'string' && metadata.description.trim().length > 0 && metadata.description.length <= 500, `Skill description must fit the 500-character consumer catalog: ${path}`);
  assert(!metadata.compatibility || (typeof metadata.compatibility === 'string' && metadata.compatibility.length <= 500), `Invalid compatibility field: ${path}`);
  assert(text.split('\n').length <= 500, `Move detailed documentation into references: ${path}`);
  const uiPath = join(directory, 'agents/openai.yaml');
  let uiText;
  try { uiText = await readFile(uiPath, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (uiText !== undefined) {
    const ui = yaml(uiText, uiPath);
    assert(ui && typeof ui === 'object' && !Array.isArray(ui), `Invalid UI configuration: ${uiPath}`);
    if (ui.interface?.display_name !== undefined) assert(typeof ui.interface.display_name === 'string' && ui.interface.display_name.trim(), `Invalid UI display name: ${uiPath}`);
    if (ui.interface?.short_description !== undefined) assert(typeof ui.interface.short_description === 'string' && ui.interface.short_description.length >= 25 && ui.interface.short_description.length <= 64, `UI short description must have 25–64 characters: ${uiPath}`);
    if (ui.interface?.default_prompt !== undefined) assert(typeof ui.interface.default_prompt === 'string' && ui.interface.default_prompt.includes('$' + name), `Default prompt must mention $${name}: ${uiPath}`);
    // Product-specific metadata is optional; implicit invocation defaults to true.
    if (ui.policy?.allow_implicit_invocation !== undefined) assert(typeof ui.policy.allow_implicit_invocation === 'boolean', `Invocation policy must be a boolean: ${uiPath}`);
  }
  await validateResources(directory);
  entries.push({ name, description: metadata.description });
}
if (!requestedSkill) {
  for (const entry of await readdir(join(root, 'support'), { withFileTypes: true })) {
    assert(entry.isDirectory() && /^shzw-[a-z0-9-]+$/.test(entry.name), `Invalid support directory: ${entry.name}`);
    const directory = join(root, 'support', entry.name);
    assert((await readFile(join(directory, 'GUIDE.md'), 'utf8')).trim(), `Missing support guide: ${entry.name}`);
    assert(!(await files(directory)).some(file => file.endsWith('SKILL.md')), `Support must remain outside task discovery: ${entry.name}`);
    await validateResources(directory);
  }
}
const readmePath = join(root, 'README.md');
const readme = await readFile(readmePath, 'utf8');
const start = '<!-- skills:start -->', end = '<!-- skills:end -->';
const index = [start, '| Skill | 用途 |', '| --- | --- |', ...entries.map(item => `| [${item.name}](skills/${item.name}/SKILL.md) | ${item.description.replaceAll('|', '\\|').replaceAll('\n', ' ')} |`), end].join('\n');
assert(readme.includes(start) && readme.includes(end), 'README is missing skill index markers.');
const expected = readme.replace(/<!-- skills:start -->[\s\S]*?<!-- skills:end -->/, index);
if (write) await writeFile(readmePath, expected);
else if (requestedSkill) assert(index.split('\n').slice(3, -1).every(row => readme.includes(row)), 'README entry is stale for the selected skill. Update its generated index entry.');
else assert(expected === readme, 'README skill index is stale. Run npm run index.');
const llmsPath = join(root, 'llms.txt');
const llms = await readFile(llmsPath, 'utf8');
const llmsIndex = [start, ...entries.map(item => `- [${item.name}](https://raw.githubusercontent.com/xingshukeji/skills-hub/main/skills/${item.name}/SKILL.md)：${item.description.replaceAll('\n', ' ')}`), end].join('\n');
assert(llms.includes(start) && llms.includes(end), 'llms.txt is missing skill index markers.');
const expectedLlms = llms.replace(/<!-- skills:start -->[\s\S]*?<!-- skills:end -->/, llmsIndex);
if (write) await writeFile(llmsPath, expectedLlms);
else if (requestedSkill) assert(llmsIndex.split('\n').slice(1, -1).every(row => llms.includes(row)), 'llms.txt entry is stale for the selected skill.');
else assert(expectedLlms === llms, 'llms.txt skill index is stale. Run npm run index.');
console.log(`Validated ${entries.length} self-contained skill(s)${write ? ' and updated README index' : ''}.`);
