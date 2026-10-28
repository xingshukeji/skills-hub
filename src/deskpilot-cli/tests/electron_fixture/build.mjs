// Maintainer-only fixture build; all dependencies resolve from explicit local files.
import { build } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const [directory, modules] = process.argv.slice(2);
if (!directory || !modules) throw new Error('Supply fixture output and local React node_modules paths.');
const source = dirname(fileURLToPath(import.meta.url));
await mkdir(directory, { recursive: true });
await copyFile(join(source, 'index.html'), join(directory, 'index.html'));
await build({ entryPoints: [join(source, 'renderer.jsx')], outfile: join(directory, 'renderer.js'),
  bundle: true, platform: 'browser', nodePaths: [modules], define: { 'process.env.NODE_ENV': '"development"' } });
