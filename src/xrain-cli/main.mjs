import { Args, CliError, Reporter, segment } from './core.mjs';
import { Store } from './store.mjs';
import { api } from './http.mjs';
import { dataCommands, hostCommands, profileCommands, securityCommands } from './commands.mjs';
import { appCommands } from './app.mjs';
import { authCommands, doctor } from './diagnostics.mjs';
import { batchCommands } from './batch.mjs';
import { agentCommands } from './agents.mjs';
import { commandHelp, validateCommand } from './schema.mjs';
import { hostSettingsCommands, userSettingsCommands } from './settings.mjs';

export const HELP = commandHelp(new Args([]));

async function dispatch(ctx) {
  const { args } = ctx;
  switch (args.command(0)) {
    case 'login': return profileCommands(ctx, 'set');
    case 'logout': return profileCommands(ctx, 'remove');
    case 'profile': return profileCommands(ctx);
    case 'auth': return authCommands(ctx);
    case 'doctor': return doctor(ctx);
    case 'batch': return batchCommands(ctx);
    case 'security': return securityCommands(ctx);
    case 'host': return args.command(1) === 'settings' ? hostSettingsCommands(ctx) : hostCommands(ctx);
    case 'user': return userSettingsCommands(ctx);
    case 'data': return dataCommands(ctx);
    case 'app': return appCommands(ctx);
    case 'agent': return agentCommands(ctx);
    case 'health': {
      const action = args.command(1) ?? 'ready';
      return api(ctx, 'GET', new Map([['ready', '/health/ready'], ['live', '/health/live'], ['healthz', '/healthz']]).get(action));
    }
    case 'metadata': {
      const action = args.command(1);
      const path = action === 'standards' ? '/api/metadata/v1/standards/entity-design' : action === 'entities' ? '/api/metadata/v1/objects' :
        `/api/metadata/v1/entities/${segment(args.required('entity'))}/describe`;
      return api(ctx, 'GET', path);
    }
  }
}

function localError(error) {
  if (error instanceof CliError) return error;
  if (error.code === 'ENOENT') return new CliError('File or directory not found. Check the supplied paths.', { code: 'file_not_found' });
  if (error.code === 'EEXIST') return new CliError('Output already exists. Choose a new path; existing files are never overwritten.', { code: 'output_exists' });
  if (['EACCES', 'EPERM'].includes(error.code)) return new CliError('Cannot access the file or directory. Check local permissions.', { code: 'local_permission_denied' });
  return new CliError('The operation failed. Check the input and local file access; no credentials were printed.', { code: 'operation_failed' });
}

export async function main(argv = process.argv.slice(2), { env = process.env, stdin = process.stdin, stdout = process.stdout, stderr = process.stderr, store: sharedStore } = {}) {
  const reporter = new Reporter(stdout, stderr);
  reporter.json = argv.includes('--json');
  reporter.secret(env.XRAIN_TOKEN);
  let code = 0, store, previousReporter;
  try {
    const [major, minor] = process.versions.node.split('.').map(Number);
    if (major < 22 || (major === 22 && minor < 12)) throw new CliError('Node.js 22.12.0 or newer is required.', { code: 'unsupported_runtime' });
    const args = new Args(argv);
    reporter.secret(args.value('bearer'));
    if (args.command(0) === 'help') { args.commands.shift(); args.options.set('help', true); }
    if (!args.commands.length || args.has('help')) reporter.print(commandHelp(args));
    else {
      const spec = validateCommand(args);
      store = sharedStore ?? new Store(env, reporter);
      previousReporter = store.reporter;
      store.reporter = reporter;
      const ctx = { args, store, reporter, stdin, spec, execute: (next, io) => main(next, { env, store, ...io }) };
      code = await dispatch(ctx);
    }
  } catch (error) { reporter.error(localError(error)); code = error.code === 'interrupted' ? 130 : 1; }
  finally {
    if (store) store.reporter = previousReporter;
    reporter.finish(code);
  }
  return code;
}
