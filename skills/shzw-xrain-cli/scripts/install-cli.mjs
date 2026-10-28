#!/usr/bin/env node
import { chmodSync, constants, existsSync, lstatSync, mkdirSync, openSync, closeSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const marker = 'Managed by shzw-xrain-cli';

function options(argv) {
  let binDir, json = false;
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i];
    if (value === '--json') {
      if (json) throw new Error('Duplicate --json.');
      json = true;
    } else if (value === '--bin-dir') {
      if (binDir !== undefined || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error('--bin-dir requires one directory.');
      binDir = argv[++i];
    } else if (value === '--help') {
      return { help: true, json };
    } else throw new Error('Use --bin-dir DIRECTORY, --json or --help.');
  }
  return { binDir: resolve(binDir ?? join(homedir(), '.local', 'bin')), json };
}

function wrapper(source, windows) {
  if (/[\r\n]/u.test(source)) throw new Error('The skill path must not contain a newline.');
  const owner = `${marker} ${Buffer.from(source).toString('base64url')}`;
  if (windows) {
    // Percent expansion occurs inside quoted batch paths; delayed expansion is disabled.
    const quoted = source.replaceAll('%', '%%');
    return `@echo off\r\nrem ${owner}\r\nsetlocal DisableDelayedExpansion\r\nnode "${quoted}" %*\r\nexit /b %ERRORLEVEL%\r\n`;
  }
  const quoted = `'${source.replaceAll("'", "'\\''")}'`;
  return `#!/bin/sh\n# ${owner}\nexec node ${quoted} "$@"\n`;
}

function pathContains(directory, windows) {
  const normalize = value => {
    try { value = realpathSync(value); } catch { value = resolve(value); }
    return windows ? value.toLowerCase() : value;
  };
  const expected = normalize(directory);
  return (process.env.PATH ?? '').split(delimiter).filter(Boolean).some(value => normalize(value) === expected);
}

export function install({ binDir, source = join(dirname(fileURLToPath(import.meta.url)), 'xrain-cli.mjs'), windows = process.platform === 'win32' }) {
  source = resolve(source);
  if (!lstatSync(source).isFile()) throw new Error('The bundled XRain CLI is missing.');
  mkdirSync(binDir, { recursive: true, mode: 0o700 });
  const target = join(binDir, windows ? 'xrain-cli.cmd' : 'xrain-cli');
  const content = wrapper(source, windows);
  let status = 'installed';
  try {
    const fd = openSync(target, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o755);
    try { writeFileSync(fd, content); } finally { closeSync(fd); }
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const existing = lstatSync(target);
    if (!existing.isFile() || existing.size > 65536) throw new Error('The command path is occupied by an unrelated file.');
    const previous = readFileSync(target, 'utf8');
    const prefix = windows ? `@echo off\r\nrem ${marker} ` : `#!/bin/sh\n# ${marker} `;
    const owner = previous.startsWith(prefix) ? previous.slice(prefix.length).split(/\r?\n/u, 1)[0] : '';
    if (!/^[A-Za-z0-9_-]+$/u.test(owner))
      throw new Error('The command path is occupied by an unrelated file.');
    const previousSource = Buffer.from(owner, 'base64url').toString('utf8');
    if (!previousSource || previous !== wrapper(previousSource, windows))
      throw new Error('The command path is occupied by an unrelated file.');
    const sameSource = windows ? previousSource.toLowerCase() === source.toLowerCase() : previousSource === source;
    if (!sameSource && existsSync(previousSource))
      throw new Error('Another installed skill owns this command. Use its path or the bundled script.');
    if (previous === content) {
      status = 'unchanged';
      if (!windows && !(existing.mode & 0o100)) { chmodSync(target, existing.mode | 0o100); status = 'updated'; }
    }
    else {
      const temporary = join(binDir, `.xrain-cli-${randomBytes(8).toString('hex')}.tmp`);
      try {
        writeFileSync(temporary, content, { flag: 'wx', mode: 0o755 });
        if (!lstatSync(target).isFile() || readFileSync(target, 'utf8') !== previous)
          throw new Error('The command changed during installation; retry.');
        renameSync(temporary, target);
        status = 'updated';
      } finally { if (existsSync(temporary)) unlinkSync(temporary); }
    }
  }
  return { commandPath: target, source, status, onPath: pathContains(binDir, windows) };
}

const direct = () => {
  if (!process.argv[1]) return false;
  try {
    const invoked = realpathSync(resolve(process.argv[1])), current = realpathSync(fileURLToPath(import.meta.url));
    return process.platform === 'win32' ? invoked.toLowerCase() === current.toLowerCase() : invoked === current;
  } catch { return false; }
};

if (direct()) {
  const json = process.argv.includes('--json');
  try {
    const selected = options(process.argv.slice(2));
    if (selected.help) {
      console.log('Usage: node install-cli.mjs [--bin-dir DIRECTORY] [--json]\nRegisters xrain-cli for this user without npm.');
    } else {
      const data = install(selected);
      console.log(json ? JSON.stringify({ ok: true, data }, null, 2) :
        `XRain CLI ${data.status}: ${data.commandPath}${data.onPath ? '' : '\nThe directory is not on PATH; use the full path or add it to PATH.'}`);
    }
  } catch (error) {
    const message = error.code === 'ENOENT' ? 'The bundled CLI or target directory is unavailable.' : error.message;
    if (json) console.log(JSON.stringify({ ok: false, error: { code: 'installation_failed', message } }, null, 2));
    else console.error(message);
    process.exitCode = 1;
  }
}
