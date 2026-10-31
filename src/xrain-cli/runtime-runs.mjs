import { CliError, isObject, nonempty, segment } from './core.mjs';
import { messageInput } from './agent-chat.mjs';

// Managed runs are a distinct native protocol; they do not assemble workbench tools.
export async function runtimeRuns(ctx, helpers) {
  const { args, reporter } = ctx, domain = args.command(1), action = args.command(2);
  const connection = helpers.runtimeConnection(ctx);
  const applicationId = domain === 'ephemeral' || action === 'start' ? helpers.applicationId(connection.profile) : undefined;
  const headers = applicationId ? { 'X-XRain-Application-Id': applicationId } : {};
  const context = { runtime: connection.runtime, profile: connection.profile.name, tenant: connection.profile.tenant,
    ...(domain === 'ephemeral' ? { applicationId: applicationId ?? null } : {}) };
  if (domain === 'ephemeral' && action === 'directory') {
    reporter.print(await helpers.runtimeValue(ctx, 'GET', '/v1/dsh/ephemeral-agents', undefined, headers)); return 0;
  }
  if (domain === 'run' && action === 'show') {
    const runId = args.required('run-id');
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(runId)) throw new CliError('An exact native run ID is required.');
    const value = await helpers.runtimeValue(ctx, 'GET', `/xrain/runs/${segment(runId)}`);
    if (!isObject(value) || !['running', 'succeeded', 'failed', 'cancelled'].includes(value.status)) throw new CliError('Runtime returned an invalid run result.', { code: 'invalid_response' });
    if (['failed', 'cancelled'].includes(value.status)) throw new CliError('The managed run did not succeed.', { code: 'run_failed', details: { runId, ...value, ...context } });
    reporter.print({ runId, ...value, ...context }); return 0;
  }
  const agentId = helpers.identifier(args.required('agent-id'), 'Agent ID'), prompt = await messageInput(args, ctx.stdin);
  const ephemeral = domain === 'ephemeral';
  const body = ephemeral ? { agentId, prompt } : { input: { agentId, prompt, applicationId: applicationId ?? null } };
  const controller = new AbortController(), interrupt = () => controller.abort();
  process.once('SIGINT', interrupt);
  try {
    const value = await helpers.writeOnce(async () => {
      const result = await helpers.runtimeValue(ctx, 'POST', ephemeral ? '/v1/dsh/ephemeral-runs' : '/xrain/runs', body, ephemeral ? headers : {}, { signal: controller.signal });
      if (!isObject(result) || (ephemeral ? !nonempty(result.answer) : !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(result.runId ?? '') || result.status !== 'accepted'))
        throw new CliError('Runtime returned an invalid run receipt.', { code: 'invalid_response' });
      return result;
    }, ephemeral ? 'Text generation did not return a confirmed result. No session, tools or history exist; this request was not retried.'
      : 'Run submission outcome is unknown. A lost receipt cannot be recovered by a client request key in this protocol. Do not automatically submit another run.',
    { agentId, applicationId: applicationId ?? null, ...context });
    reporter.print({ ...value, ...context }); return 0;
  } finally { process.removeListener('SIGINT', interrupt); }
}
