import { CliError, DEFAULT_SERVER, equalIgnoreCase, isObject, jsonInput, origin, segment } from './core.mjs';
import { api, apiValue } from './http.mjs';

export async function profileCommands(ctx, action = ctx.args.command(1)) {
  const { args, store, reporter } = ctx;
  if (action === 'path') { reporter.print(store.configPath); return 0; }
  const config = store.load();
  if (action === 'list') {
    reporter.print(Object.entries(config.profiles).map(([name, profile]) => ({ name, active: equalIgnoreCase(name, config.activeProfile), server: profile.server, tenant: profile.tenant })));
    return 0;
  }
  if (action === 'set') {
    const name = store.canonical(args.value('profile') ?? config.activeProfile, config);
    const existing = config.profiles[name] ?? {};
    const profile = {
      server: origin(args.value('server') ?? existing.server ?? DEFAULT_SERVER),
      tenant: args.value('tenant') ?? existing.tenant,
      bearerToken: args.has('bearer') ? args.value('bearer') : args.has('token-name') ? undefined : existing.bearerToken,
      tokenName: args.value('token-name') ?? store.env.XRAIN_TOKEN_NAME ?? existing.tokenName,
    };
    reporter.secret(profile.bearerToken);
    config.activeProfile = name; config.profiles[name] = profile;
    store.save(config);
    const result = { profile: name, configPath: store.configPath, saved: true };
    if (args.has('check')) {
      reporter.progress(`Saved profile '${name}' at ${store.configPath}. Checking the selected credential...`);
      return api(ctx, 'GET', '/health/ready');
    }
    reporter.print(reporter.json ? result : `Saved profile '${name}' at ${store.configPath}.`);
    return 0;
  }
  if (action === 'show') {
    const profile = store.resolve(args);
    let tokenSource = 'none';
    if (args.value('auth') === 'session') tokenSource = store.loadSession(profile.name, profile.server, profile.tenant) ? 'application-session' : 'none';
    else if (args.has('bearer')) tokenSource = 'option:bearer';
    else if (store.env.XRAIN_TOKEN) tokenSource = 'environment:XRAIN_TOKEN';
    else if (profile.bearerToken) tokenSource = 'profile:bearer';
    else if (profile.tokenName) tokenSource = `local-secret-store:${profile.tokenName}`;
    else if (store.loadSession(profile.name, profile.server, profile.tenant)) tokenSource = 'application-session';
    reporter.print({ configPath: store.configPath, activeProfile: profile.name,
      profile: { server: profile.server, tenant: profile.tenant, tokenName: profile.tokenName, hasBearerToken: !!profile.bearerToken }, tokenSource });
    return 0;
  }
  if (action === 'use' || action === 'remove') {
    const operandIndex = args.command(0) === 'profile' ? 2 : 1;
    const raw = args.value('name') ?? args.value('profile') ?? args.operand(operandIndex) ?? (action === 'remove' ? config.activeProfile : undefined);
    if (!raw) throw new CliError('Profile name is required.');
    const name = store.canonical(raw, config);
    if (!Object.hasOwn(config.profiles, name)) throw new CliError(`Profile '${name}' does not exist.`, { code: 'profile_not_found', hint: 'Run profile list.' });
    if (action === 'use') config.activeProfile = name;
    else {
      // Resolve/delete before removing the canonical spelling from the profile map.
      store.deleteSession(name);
      delete config.profiles[name];
      if (equalIgnoreCase(config.activeProfile, name)) config.activeProfile = Object.keys(config.profiles)[0] ?? 'default';
    }
    store.save(config);
    reporter.print(reporter.json ? { profile: name, action } : action === 'use' ? `Active profile: ${name}` : `Removed profile '${name}'.`);
    return 0;
  }
  throw new CliError('Use profile show, set, use, remove or path.');
}

export async function dataCommands(ctx) {
  const { args } = ctx;
  const action = args.command(1);
  if (!['query', 'get', 'create', 'update', 'delete'].includes(action)) throw new CliError('Use data query, get, create, update or delete.');
  const entity = args.required('entity', args.operand(2));
  const root = `/api/data/v1/entities/${segment(entity)}/records`;
  if (action === 'query') {
    let query = await jsonInput(args, 'query');
    if (query === undefined) {
      query = { page: args.integer('page', 1), pageSize: args.integer('page-size', args.integer('pageSize', 25)), includeTotalCount: !args.has('no-total') };
      if (args.value('search')) query.search = args.value('search');
      if (args.value('fields')) query.fields = args.value('fields').split(',').map(v => v.trim()).filter(Boolean);
      const filter = await jsonInput(args, 'filter', false);
      if (filter !== undefined) query.filter = filter;
      if (args.value('sort')) query.sort = args.value('sort').split(',').filter(Boolean).map(value => {
        const parts = value.split(':').map(v => v.trim());
        const [field, direction = 'asc'] = parts;
        if (parts.length > 2 || !field || !['asc', 'desc'].includes(direction)) throw new CliError('--sort must use field:asc or field:desc.', { code: 'invalid_arguments' });
        return { field, direction };
      });
    }
    if (!isObject(query)) throw new CliError('Query JSON must be an object.');
    return api(ctx, 'POST', root + ':query', query);
  }
  const id = action === 'create' ? undefined : args.required('id', args.operand(args.has('entity') ? 2 : 3));
  const path = id === undefined ? root : root + '/' + segment(id);
  if (action === 'get' || action === 'delete') return api(ctx, action === 'get' ? 'GET' : 'DELETE', path);
  const values = await jsonInput(args, 'values');
  if (!isObject(values)) throw new CliError('Values JSON must be an object. Use --values or --values-json.');
  return api(ctx, action === 'create' ? 'POST' : 'PUT', path, Object.hasOwn(values, 'values') ? values : { values });
}

export async function securityCommands(ctx) {
  const { args, store, reporter } = ctx;
  const kind = args.command(1), action = args.command(2);
  if (kind === 'permissions' && action === 'catalog') return api(ctx, 'GET', '/api/service/authen/v1/security/permissions/catalog');
  if (kind === 'tokens') {
    if (action === 'path') { reporter.print(store.secretPath); return 0; }
    if (!['ensure', 'show'].includes(action)) throw new CliError('Use security tokens ensure, show or path.');
    const secrets = store.secrets(action === 'ensure');
    reporter.print({ path: store.secretPath, configuredTokenNames: [['admin', secrets.adminApiToken], ['guest', secrets.guestApiToken]].filter(([, token]) => !!token).map(([name]) => name) });
    return 0;
  }
  const kinds = { user: ['users', 'user'], users: ['users', 'user'], role: ['roles', 'role'], roles: ['roles', 'role'], 'permission-set': ['permission-sets', 'permission-set'], 'permission-sets': ['permission-sets', 'permission-set'] };
  if (!Object.hasOwn(kinds, kind)) throw new CliError('Use security tokens, user, role or permission-set.');
  const [resource, singular] = kinds[kind];
  const name = args.required(singular, args.value('name') ?? args.operand(3));
  const path = `/api/service/authen/v1/security/${resource}/${segment(name)}`;
  if (['user', 'permission-set'].includes(singular) && ['create', 'ensure'].includes(action)) {
    const isUser = singular === 'user', inputName = isUser ? 'userName' : 'name', resultName = isUser ? 'user' : 'permissionSet';
    const label = isUser ? 'User' : 'Permission set';
    const values = await jsonInput(args, 'values');
    if (values !== undefined && !isObject(values)) throw new CliError(`${label} values JSON must be an object.`, { code: 'invalid_arguments' });
    if (isUser) for (const [key, value] of Object.entries(values ?? {})) if (key.toLowerCase() === 'password') reporter.secret(value);
    if (values && Object.hasOwn(values, inputName) && (typeof values[inputName] !== 'string' || !equalIgnoreCase(values[inputName], name)))
      throw new CliError(`${inputName} in JSON must match --${singular}.`, { code: 'invalid_arguments' });
    if (action === 'ensure') {
      try {
        const value = await apiValue(ctx, 'GET', path);
        reporter.print({ created: false, [resultName]: value });
        return 0;
      } catch (error) {
        if (error.httpStatus !== 404 || error.serverCode !== `platform.authen.${singular.replace('-', '_')}_not_found`) throw error;
      }
    }
    if (!values) throw new CliError(`${label} creation requires values JSON.`, { code: action === 'ensure' ? 'creation_input_required' : 'invalid_arguments',
      hint: 'Use --values-json FILE or pipe JSON with --values-json -. Keep secrets out of command arguments.' });
    const value = await apiValue(ctx, 'POST', `/api/service/authen/v1/security/${resource}`, { ...values, [inputName]: name });
    reporter.print(action === 'ensure' ? { created: true, [resultName]: value } : value);
    return 0;
  }
  if (action === 'show') return api(ctx, 'GET', path);
  const match = /^(grant|revoke)-(role|permission-set|permission)$/.exec(action ?? '');
  const allowed = { user: ['role', 'permission-set'], role: ['permission-set'], 'permission-set': ['permission'] };
  if (!match || !allowed[singular].includes(match[2])) throw new CliError('Invalid security action. Run --help.');
  const raw = args.value('names') ?? args.value('roles') ?? args.value('permission-sets') ?? args.value('permissions');
  if (!raw) throw new CliError('Names are required: --names <name1,name2>.');
  const names = [], seen = new Set();
  for (const value of raw.split(/[,;]/).map(v => v.trim()).filter(Boolean)) if (!seen.has(value.toLowerCase())) { seen.add(value.toLowerCase()); names.push(value); }
  if (!names.length) throw new CliError('At least one name is required.');
  const suffix = { role: 'roles', 'permission-set': 'permission-sets', permission: 'permissions' }[match[2]];
  return api(ctx, match[1] === 'grant' ? 'POST' : 'DELETE', path + '/' + suffix, { names });
}

export async function hostCommands(ctx) {
  const { args, reporter } = ctx;
  const tenantId = args.required('tenant-id');
  const root = `/api/service/authen/v1/host/tenants/${segment(tenantId)}/members`;
  const options = { requireTenant: false };
  if (args.command(3) === 'list') {
    const query = new URLSearchParams({ page: String(args.integer('page', 1)), pageSize: String(args.integer('page-size', 20)) });
    if (args.has('search')) query.set('search', args.value('search'));
    return api(ctx, 'GET', `${root}?${query}`, undefined, options);
  }
  const userId = args.required('user-id');
  for (let page = 1; ; page++) {
    const query = new URLSearchParams({ search: userId, page: String(page), pageSize: '100' });
    const value = await apiValue(ctx, 'GET', `${root}?${query}`, undefined, options);
    if (!Array.isArray(value?.items) || !Number.isSafeInteger(value.totalCount) || value.totalCount < 0 || !Number.isSafeInteger(value.pageSize) || value.pageSize < 1)
      throw new CliError('Invalid tenant member page; no member was created.', { code: 'invalid_response' });
    const member = value.items.find(item => typeof item?.userId === 'string' && equalIgnoreCase(item.userId, userId));
    if (member) { reporter.print({ created: false, member }); return 0; }
    if (page * value.pageSize >= value.totalCount) break;
    if (!value.items.length) throw new CliError('Incomplete tenant member page; no member was created.', { code: 'invalid_response' });
  }
  const member = await apiValue(ctx, 'POST', root, { userId, isAdministrator: false }, options);
  reporter.print({ created: true, member });
  return 0;
}
