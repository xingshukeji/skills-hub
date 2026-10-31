import { Args, CliError, readJsonInput } from './core.mjs';
import { validateCommand } from './schema.mjs';
import { exposeApplicationConfirmations } from './app-management.mjs';

export async function batchCommands(ctx) {
  const plan = await readJsonInput(ctx.args.required('file'), 'Batch JSON');
  if (!Array.isArray(plan)) throw new CliError('Batch JSON must be an array of command argument arrays.', { code: 'invalid_arguments' });
  // Validate the entire command shape before the first side effect. Payload and
  // server validation still happen per step; a batch is not a transaction.
  const commands = [];
  for (const row of plan) {
    if (!Array.isArray(row) || !row.length || row.some(value => typeof value !== 'string')) throw new CliError('Each batch item must be a nonempty array of strings.', { code: 'invalid_arguments' });
    const args = new Args(row), spec = validateCommand(args);
    if (['batch', 'auth login', 'app login'].includes(spec.path)) throw new CliError('Nested batches and login are not supported inside a batch. Log in before running it.', { code: 'invalid_arguments' });
    if (['file', 'query-json', 'values-json', 'filter-json', 'request-json', 'message-file', 'context-json', 'options-json'].some(name => args.value(name) === '-') || ['query', 'values', 'filter'].some(name => args.value(name) === '@-'))
      throw new CliError('Batch steps must use files or inline JSON instead of sharing stdin.', { code: 'invalid_arguments' });
    commands.push(spec.path);
  }
  const results = [];
  for (const [index, argv] of plan.entries()) {
    let stdout = '', stderr = '';
    const code = await ctx.execute(argv.includes('--json') ? argv : [...argv, '--json'], {
      stdout: { write(value) { stdout += value; } }, stderr: { write(value) { stderr += value; } },
    });
    const result = JSON.parse(stdout);
    if (/^app (?:preview|install|operation|policy)(?: |$)/.test(commands[index])) {
      exposeApplicationConfirmations(ctx.reporter, result.data);
      exposeApplicationConfirmations(ctx.reporter, result.error?.details?.operation);
    }
    results.push({ index, ...result });
    if (stderr) ctx.reporter.progress(stderr.trimEnd());
    if (code !== 0) throw new CliError(`Batch stopped at step ${index + 1}.`, { code: code === 130 ? 'interrupted' : 'batch_failed',
      hint: 'Earlier completed operations remain in effect. Inspect the failed step and current state before retrying.', details: { results, failedIndex: index } });
  }
  ctx.reporter.print(results);
  return 0;
}
