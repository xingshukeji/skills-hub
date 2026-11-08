import { setTimeout as delay } from 'node:timers/promises';
import { CliError, isObject, segment } from './core.mjs';
import { memberTarget, memberValue } from './member-target.mjs';

const statuses = new Set(['Running', 'Succeeded', 'Failed', 'Cancelled', 'Skipped']);

export async function waitScheduleRun(ctx, operation) {
  const { args, reporter } = ctx;
  const scheduleId = args.required('schedule-id'), runId = args.required('run-id');
  const seconds = args.integer('wait-timeout', 120), interval = args.integer('poll-interval', 1);
  const route = operation.route.replace('{schedule-id}', segment(scheduleId)).replace('{run-id}', segment(runId));
  const controller = new AbortController(), deadline = performance.now() + seconds * 1000;
  const waitDeadlineAt = new Date(Date.now() + seconds * 1000).toISOString();
  let interrupted = false, lastRun, target;
  const interrupt = () => { interrupted = true; controller.abort(); };
  const timer = setTimeout(() => controller.abort(), seconds * 1000);
  process.once('SIGINT', interrupt);
  const recovery = () => ({ scheduleId, runId, workforce: args.required('workforce'), profile: target?.profile.name ?? args.value('profile') ?? null,
    waitDeadlineAt, waitTimeoutSeconds: seconds, ...(target ? { workforce: target.host, applicationId: target.appId,
    server: target.profile.server, tenantId: target.identity.tenantId, userId: target.identity.userId } : {}),
    lastRun: lastRun ?? null, serverCancelled: false, businessSuccess: 'unverified',
    nextStep: 'Read or wait for this same run with the original identity. Inspect its conversation and business result; do not start a replacement.' });
  const check = () => { if (controller.signal.aborted || performance.now() >= deadline) throw new Error('observation stopped'); };
  try {
    target = await memberTarget(ctx, 'workforce', { signal: controller.signal });
    while (true) {
      check();
      const run = memberValue(await target.send('GET', route));
      check();
      if (!isObject(run) || run.id !== runId || run.scheduleId !== scheduleId || !statuses.has(run.status))
        throw new CliError('Workforce returned a run receipt that does not match the original target.', { code: 'invalid_response' });
      lastRun = run;
      if (run.status !== 'Running') {
        reporter.print({ ...recovery(), waitStatus: 'terminal', run });
        return 0;
      }
      await delay(Math.min(interval * 1000, Math.max(1, deadline - performance.now())), undefined, { signal: controller.signal });
    }
  } catch (error) {
    if (controller.signal.aborted || performance.now() >= deadline) throw new CliError(
      interrupted ? 'Stopped observing the original run; server work was not cancelled.' : 'Run observation budget expired; server work was not cancelled.', {
        code: interrupted ? 'schedule_wait_interrupted' : 'schedule_wait_timeout', details: recovery(),
      });
    if (error instanceof CliError) {
      error.details = { ...error.details, ...recovery() };
      error.hint = 'This read did not confirm execution. Inspect the original run; do not create, cancel or replay work because observation failed.';
    }
    throw error;
  } finally {
    clearTimeout(timer);
    process.removeListener('SIGINT', interrupt);
    controller.abort();
  }
}
