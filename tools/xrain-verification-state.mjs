// Evidence storage for the XRain live verifier, not part of the installed CLI.
import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { writePrivate } from '../src/xrain-cli/store.mjs';
import { parseJson, sha256 } from '../src/xrain-cli/core.mjs';

export const LIVE_PHASES = ['login', 'security', 'prepare-data', 'basic', 'data', 'app', 'market-login', 'market', 'credentials', 'end', 'login-auto', 'report'];

export class VerificationState {
  constructor(path, { artifactSha256, targets, clean = value => value }) {
    this.path = path; this.clean = clean; this.existed = existsSync(path);
    if (!/^[a-f0-9]{64}$/.test(artifactSha256)) throw new Error('Invalid CLI artifact digest.');
    this.binding = Object.freeze({ bundleSha256: artifactSha256, targets: Object.freeze({ ...targets }) });
    if (this.existed) {
      this.report = parseJson(readFileSync(path, 'utf8'), 'Verification report');
      this.validate();
    } else {
      this.report = { runId: randomUUID(), ...this.binding, startedAt: new Date().toISOString(), node: process.versions.node,
        server: targets.server, exchange: targets.exchange, checks: [], phases: {}, fixtures: {} };
    }
  }
  sameBinding(value) {
    return value?.bundleSha256 === this.binding.bundleSha256 && value?.targets?.server === this.binding.targets.server &&
      value?.targets?.exchange === this.binding.targets.exchange && value?.targets?.tenant === this.binding.targets.tenant;
  }
  verifyArtifact(path) {
    if (sha256(readFileSync(path)) !== this.binding.bundleSha256) throw new Error('The CLI artifact changed during verification. Stop this run and select a new XRAIN_LIVE_DIRECTORY.');
  }
  validate() {
    const report = this.report;
    const mismatch = () => { throw new Error('Verification evidence does not match this run, CLI artifact or targets. Keep the old evidence and select a new XRAIN_LIVE_DIRECTORY.'); };
    if (!report || typeof report.runId !== 'string' || !/^[a-f0-9-]{36}$/i.test(report.runId) || !this.sameBinding(report) || !Array.isArray(report.checks) ||
        !report.phases || typeof report.phases !== 'object' || Array.isArray(report.phases) || !report.fixtures || typeof report.fixtures !== 'object' || Array.isArray(report.fixtures)) mismatch();
    const names = new Set();
    for (const check of report.checks) {
      if (!check || typeof check.name !== 'string' || names.has(check.name) || !['passed', 'failed'].includes(check.status) || check.runId !== report.runId || !this.sameBinding(check)) mismatch();
      names.add(check.name);
    }
    for (const phase of Object.values(report.phases)) if (!phase || !['started', 'passed', 'failed'].includes(phase.status) || phase.runId !== report.runId || !this.sameBinding(phase)) mismatch();
  }
  bound(value) { return { ...value, runId: this.report.runId, ...this.binding, at: new Date().toISOString() }; }
  save() {
    this.validate();
    writePrivate(this.path, JSON.stringify(this.clean(this.report), null, 2) + '\n');
  }
  record(name, status, details = {}) {
    const entry = this.bound({ ...details, name, status });
    const previous = this.report.checks.findIndex(check => check.name === name);
    if (previous < 0) this.report.checks.push(entry); else this.report.checks[previous] = entry;
    delete this.report.summary;
    this.save();
    appendFileSync(join(dirname(this.path), 'evidence.jsonl'), JSON.stringify(this.clean(entry)) + '\n', { mode: 0o600 });
    return entry;
  }
  phase(name, status) {
    if (![...LIVE_PHASES, 'inspect'].includes(name)) throw new Error('Unknown verification phase.');
    this.report.phases[name] = this.bound({ status });
    if (name !== 'report' || status === 'started') delete this.report.summary;
    this.save();
  }
  summarize(required) {
    this.validate();
    const failed = this.report.checks.filter(item => item.status !== 'passed');
    const missing = required.filter(name => !this.report.checks.some(check => check.name === name && check.status === 'passed'));
    const summary = this.bound({ status: failed.length || missing.length ? 'failed' : 'passed', total: this.report.checks.length,
      passed: this.report.checks.length - failed.length, failed: failed.length, requiredCapabilitiesCovered: required.length - missing.length,
      requiredCapabilities: required.length, missing, completedAt: new Date().toISOString() });
    this.report.summary = summary;
    this.save();
    return summary;
  }
  remaining(mode) {
    this.validate();
    if (mode === 'all' && (this.report.checks.length || Object.keys(this.report.phases).length)) throw new Error('This run already contains evidence. Use resume or choose a new XRAIN_LIVE_DIRECTORY.');
    if (mode === 'resume' && !this.existed) throw new Error('No verification run exists to resume. Start all or a single phase first.');
    const interrupted = LIVE_PHASES.filter(name => name !== 'report' && this.report.phases[name] && this.report.phases[name].status !== 'passed');
    if (interrupted.length) throw new Error(`Incomplete phases require inspection before replay: ${interrupted.join(', ')}. Check existing state and publish status, then explicitly run the affected phase before resuming.`);
    return LIVE_PHASES.filter(name => this.report.phases[name]?.status !== 'passed');
  }
}
