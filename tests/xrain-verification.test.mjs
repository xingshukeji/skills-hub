import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Reporter, sha256 } from '../src/xrain-cli/core.mjs';
import { VerificationState, LIVE_PHASES } from '../tools/xrain-verification-state.mjs';
import { fixture } from './helpers.mjs';

const targets = { server: 'http://127.0.0.1:5410', exchange: 'http://localhost:5380', tenant: 'tenant-xrain-demo' };
const digest = 'a'.repeat(64);

test('verification receipts bind the run, artifact and environment and summaries cannot survive a rerun', t => {
  const f = fixture(t), path = join(f.directory, 'report.json');
  const reporter = new Reporter(); reporter.secret('synthetic-evidence-secret');
  const state = new VerificationState(path, { artifactSha256: digest, targets, clean: value => reporter.clean(value) });
  state.phase('basic', 'started'); state.record('health', 'passed', { note: 'synthetic-evidence-secret', password: 'not-for-report' }); state.phase('basic', 'passed');
  const summary = state.summarize(['health']);
  assert.equal(summary.status, 'passed'); assert.equal(summary.runId, state.report.runId);
  const saved = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(saved.checks[0].runId, saved.runId); assert.equal(saved.checks[0].bundleSha256, digest); assert.deepEqual(saved.checks[0].targets, targets);
  assert.ok(!readFileSync(path, 'utf8').includes('synthetic-evidence-secret')); assert.ok(!readFileSync(path, 'utf8').includes('not-for-report'));
  const resumed = new VerificationState(path, { artifactSha256: digest, targets });
  assert.equal(resumed.report.runId, saved.runId);
  resumed.record('health', 'failed');
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).summary, undefined);
  assert.equal(resumed.summarize(['health']).status, 'failed');
  assert.equal(resumed.report.checks.length, 1);
});

test('verification refuses old, mismatched and mixed receipts without overwriting their evidence', t => {
  const f = fixture(t), path = join(f.directory, 'report.json');
  writeFileSync(path, JSON.stringify({ checks: [{ name: 'old', status: 'passed' }], bundleSha256: digest, fixtures: {} }));
  const legacy = readFileSync(path);
  assert.throws(() => new VerificationState(path, { artifactSha256: digest, targets }), /does not match/);
  assert.deepEqual(readFileSync(path), legacy);
  const freshPath = join(f.directory, 'fresh.json');
  const state = new VerificationState(freshPath, { artifactSha256: digest, targets }); state.record('health', 'passed');
  const before = readFileSync(freshPath);
  assert.throws(() => new VerificationState(freshPath, { artifactSha256: 'b'.repeat(64), targets }), /does not match/);
  assert.throws(() => new VerificationState(freshPath, { artifactSha256: digest, targets: { ...targets, tenant: 'other' } }), /does not match/);
  assert.deepEqual(readFileSync(freshPath), before);
  const forged = JSON.parse(before); forged.checks[0].bundleSha256 = 'b'.repeat(64); writeFileSync(freshPath, JSON.stringify(forged));
  assert.throws(() => new VerificationState(freshPath, { artifactSha256: digest, targets }), /does not match/);
});

test('verification detects an artifact changing after a run was opened', t => {
  const f = fixture(t), artifact = join(f.directory, 'cli.mjs');
  writeFileSync(artifact, 'initial CLI');
  const state = new VerificationState(join(f.directory, 'report.json'), { artifactSha256: sha256(readFileSync(artifact)), targets });
  state.verifyArtifact(artifact);
  writeFileSync(artifact, 'different CLI');
  assert.throws(() => state.verifyArtifact(artifact), /changed during verification/);
});

test('resume skips completed phases but never automatically replays an interrupted publish phase', t => {
  const f = fixture(t), path = join(f.directory, 'report.json');
  const fresh = new VerificationState(path, { artifactSha256: digest, targets });
  assert.deepEqual(fresh.remaining('all'), LIVE_PHASES);
  fresh.phase('login', 'passed');
  const resumed = new VerificationState(path, { artifactSha256: digest, targets });
  assert.ok(!resumed.remaining('resume').includes('login'));
  assert.throws(() => resumed.remaining('all'), /already contains evidence/);
  resumed.phase('app', 'started');
  assert.throws(() => new VerificationState(path, { artifactSha256: digest, targets }).remaining('resume'), /Incomplete phases require inspection/);
  resumed.phase('app', 'passed');
  assert.ok(!new VerificationState(path, { artifactSha256: digest, targets }).remaining('resume').includes('app'));
});

function execute(f, argv) {
  return new Promise((done, reject) => {
    const child = spawn(process.execPath, [resolve('tools/verify-live.mjs'), ...argv], { cwd: process.cwd(), env: f.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = ''; child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject); child.on('close', code => done({ code, stdout, stderr }));
  });
}

test('live verification help and plan work without logging in or creating a run', async t => {
  const f = fixture(t), dir = join(f.directory, 'preview only');
  const help = await execute(f, ['help', '--dir', dir]);
  assert.equal(help.code, 0, help.stderr); assert.equal(existsSync(dir), false);
  const plan = await execute(f, ['all', '--plan', '--dir', dir]);
  assert.equal(plan.code, 0, plan.stderr); assert.deepEqual(JSON.parse(plan.stdout).phases, LIVE_PHASES); assert.equal(existsSync(dir), false);
});

test('live report refuses historical receipts and incomplete runs instead of reporting a false pass', async t => {
  const f = fixture(t), path = join(f.directory, 'report.json');
  writeFileSync(path, JSON.stringify({ checks: [{ name: 'help', status: 'passed' }], summary: { status: 'passed' } }));
  const historical = readFileSync(path);
  const legacy = await execute(f, ['report', '--dir', f.directory]);
  assert.equal(legacy.code, 1); assert.match(legacy.stderr, /does not match/); assert.deepEqual(readFileSync(path), historical);
  const dir = join(f.directory, 'fresh');
  const state = new VerificationState(join(dir, 'report.json'), { artifactSha256: sha256(readFileSync(resolve('skills/shzw-xrain-cli/scripts/xrain-cli.mjs'))), targets });
  state.record('help', 'passed');
  const partial = await execute(f, ['report', '--dir', dir]);
  assert.equal(partial.code, 1); assert.equal(JSON.parse(partial.stdout).status, 'failed');
  const final = JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8'));
  assert.ok(final.summary.missing.length > 0); assert.equal(final.phases.report.status, 'failed');
  assert.equal(existsSync(join(dir, 'verification.lock')), false);
});
