import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { fixture, mockServer, respond } from './helpers.mjs';
import { readCredentialFile } from '../src/xrain-cli/store.mjs';

const output = result => JSON.parse(result.stdout);
const jsonFile = (f, body) => { const path = join(f.directory, 'query.json'); writeFileSync(path, JSON.stringify(body)); return path; };

for (const scope of ['tenant', 'host']) test(`self token issuance uses only the saved ${scope} login and saves a protected target-bound credential`, async t => {
  const f = fixture(t); let lose = false;
  const service = await mockServer(t, (hit, res) => {
    assert.equal(hit.headers.authorization, 'Bearer current-login');
    assert.equal(hit.url, '/api/service/authen/v1/account/api-token');
    assert.deepEqual(hit.json(), { endTimeUtc: null });
    if (lose) return res.destroy();
    respond(res, { api_token: 'issued-personal-token', expires_at_utc: new Date(Date.now() + 300000).toISOString() });
  });
  const tenant = scope === 'host' ? null : 'TEN';
  f.store.save({ activeProfile: 'Demo', profiles: { Demo: { server: service.url, tenant, scope } } });
  f.store.saveSession('Demo', service.url, tenant, 'current-login', Date.now() + 300000, scope);
  f.env.XRAIN_TOKEN = 'unrelated-service-token';
  const file = jsonFile(f, { endTimeUtc: null }), out = join(f.directory, 'credential.json');
  const args = ['auth', 'api-token', 'create', '--request-json', file, '--out', out, '--json'];
  const result = await f.run(args);
  assert.equal(result.code, 0, result.stdout);
  assert.equal(readCredentialFile(out, { server: service.url, tenant, scope }), 'issued-personal-token');
  assert.equal(result.stdout.includes('issued-personal-token'), false);
  assert.equal(f.store.loadSession('Demo', service.url, tenant, scope), 'current-login');
  assert.equal(output(await f.run(args)).error.code, 'output_exists'); assert.equal(service.hits.length, 1);
  writeFileSync(file, JSON.stringify({ subjectUserId: 'someone-else' }));
  const rejectedOut = join(f.directory, 'not-created.json');
  assert.equal(output(await f.run([...args.slice(0, -3), '--out', rejectedOut, '--json'])).error.code, 'invalid_arguments');
  assert.equal(service.hits.length, 1); assert.equal(existsSync(rejectedOut), false);
  writeFileSync(file, JSON.stringify({ endTimeUtc: null })); lose = true;
  const unknownOut = join(f.directory, 'lost.json');
  const unknown = await f.run(['auth', 'api-token', 'create', '--request-json', file, '--out', unknownOut, '--json']);
  assert.equal(output(unknown).error.code, 'outcome_unknown');
  assert.match(output(unknown).error.hint, /no client request key/);
  assert.equal(existsSync(unknownOut), false); assert.equal(service.hits.length, 2);
});

test('package capabilities and publication candidates remain original read-only platform results in tenant and Host scopes', async t => {
  const f = fixture(t), capabilities = { canInstall: false, canSubmit: true, canReview: false, canPublish: false, canCreateApplication: true };
  const candidates = [{ id: 'original-package', canInstall: false, canReview: true, publishedVersionId: null }];
  let denied = false;
  const service = await mockServer(t, (hit, res) => {
    assert.equal(hit.method, 'GET'); assert.equal(hit.headers.authorization, 'Bearer current-login');
    respond(res, denied ? { error: 'application_package.forbidden' } : hit.url.endsWith('/capabilities') ? capabilities : candidates, denied ? 403 : 200);
  });
  for (const scope of ['tenant', 'host']) {
    const tenant = scope === 'host' ? null : 'TEN';
    f.store.save({ activeProfile: 'Demo', profiles: { Demo: { server: service.url, tenant, scope } } });
    f.store.saveSession('Demo', service.url, tenant, 'current-login', Date.now() + 300000, scope);
    for (const [action, expected] of [['capabilities', capabilities], ['candidates', candidates]]) {
      const result = await f.run(['app', action, '--json']); assert.equal(result.code, 0, result.stdout);
      assert.deepEqual(output(result).data, expected);
    }
  }
  denied = true;
  assert.equal(output(await f.run(['app', 'candidates', '--json'])).error.serverCode, 'application_package.forbidden');
  assert.equal(service.hits.length, 5);
});

test('ordinary visible member lookup uses the narrow tenant directory and preserves paging and original refusals', async t => {
  const f = fixture(t); let denied = false;
  const service = await mockServer(t, (hit, res) => {
    assert.equal(hit.headers.authorization, 'Bearer member-session');
    assert.equal(hit.headers['x-tenant-id'], undefined);
    respond(res, denied ? { errorCode: 'platform.tenant_member_profile.not_found' } : { items: [{ userId: 'known-person', name: '可见成员', isAI: false }], totalCount: 1 }, denied ? 404 : 200);
  });
  f.profile(service.url, 'TEN'); f.store.saveSession('Demo', service.url, 'TEN', 'member-session', Date.now() + 300000);
  const list = await f.run(['member', 'list', '--page', '2', '--page-size', '7', '--search', '可见成员', '--auth', 'session', '--json']);
  assert.equal(list.code, 0, list.stdout);
  assert.equal(new URL(service.hits[0].url, service.url).searchParams.get('search'), '可见成员');
  assert.equal(new URL(service.hits[0].url, service.url).searchParams.get('page'), '2');
  assert.equal(new URL(service.hits[0].url, service.url).pathname, '/api/tenant/v1/members');
  denied = true;
  const missing = await f.run(['member', 'show', 'known-person', '--auth', 'session', '--json']);
  assert.equal(output(missing).error.serverCode, 'platform.tenant_member_profile.not_found');
  assert.equal(service.hits[1].url, '/api/tenant/v1/members/known-person');
  assert.equal(service.hits.length, 2, 'no administrator-directory fallback');
});

test('Host member discovery preserves its explicit target tenant and native filters', async t => {
  const f = fixture(t), service = await mockServer(t, (hit, res) => {
    assert.equal(hit.headers.authorization, 'Bearer host-session');
    respond(res, { items: [{ userId: 'member-id', roles: ['user'] }], totalCount: 1, page: 3, pageSize: 8 });
  });
  f.store.save({ activeProfile: 'Host', profiles: { Host: { server: service.url, scope: 'host' } } });
  f.store.saveSession('Host', service.url, null, 'host-session', Date.now() + 300000, 'host');
  const result = await f.run(['host', 'tenant', 'member', 'list', 'target', '--auth', 'session', '--query-json', jsonFile(f, { page: 3, pageSize: 8, isActive: false, search: '张' }), '--json']);
  assert.equal(result.code, 0, result.stdout);
  assert.deepEqual(output(result).data.items[0].roles, ['user']);
  const url = new URL(service.hits[0].url, service.url);
  assert.equal(url.pathname, '/api/service/authen/v1/host/tenants/target/members');
  assert.equal(url.searchParams.get('isActive'), 'false');
  assert.equal(url.searchParams.get('pageSize'), '8');
});

test('employee definition choices and known-member validation do not fetch the stronger full definition catalog', async t => {
  const f = fixture(t); let denied = false;
  const service = await mockServer(t, (hit, res) => {
    assert.equal(hit.headers['x-xrain-authorization'], 'Bearer member-token');
    respond(res, denied ? { error: 'AGENT_DEFINITIONS_FORBIDDEN' } : { items: [{ agentId: 'assistant', enabled: false }] }, denied ? 403 : 200);
  });
  f.profile(service.url, 'TEN', 'member-token');
  for (const args of [['employee-options'], ['member', 'known/person']]) {
    const result = await f.run(['agent', 'definition', ...args, '--runtime', service.url, '--json']);
    assert.equal(result.code, 0, result.stdout);
  }
  assert.deepEqual(service.hits.map(hit => hit.url), ['/v1/dsh/agent-definitions/employee-options', '/v1/dsh/agent-definitions/members/known%2Fperson']);
  denied = true;
  const refused = await f.run(['agent', 'definition', 'employee-options', '--runtime', service.url, '--json']);
  assert.equal(output(refused).error.serverCode, 'AGENT_DEFINITIONS_FORBIDDEN');
  assert.equal(service.hits.length, 3);
});

test('Workforce assistant discovery, subscription cancellation and older schedule results stay in the original host context', async t => {
  const f = fixture(t), platform = await mockServer(t, (_hit, res) => respond(res, { tenantId: 'TEN', userId: 'human' }));
  const failedRun = { id: 'original-run', status: 'Failed', errorCode: 'original.tool_failure' };
  let denied = false;
  const host = await mockServer(t, (hit, res) => {
    assert.equal(hit.headers.authorization, 'Bearer member-session');
    assert.equal(hit.headers['x-xrain-expected-user-id'], 'human');
    assert.equal(hit.headers['x-xrain-application-id'], 'APP');
    respond(res, denied ? { error: { code: 'application.admission_denied' } } : hit.url.endsWith('/runs/original-run') ? failedRun : { items: [], nextCursor: 'original-cursor' }, denied ? 403 : 200);
  });
  f.store.save({ activeProfile: 'Demo', profiles: { Demo: { server: platform.url, tenant: 'TEN', applicationId: 'APP' } } });
  f.store.saveSession('Demo', platform.url, 'TEN', 'member-session', Date.now() + 300000);
  const run = args => f.run(['workforce', ...args, '--workforce', host.url, '--json']);
  for (const args of [['agent', 'list'], ['agent', 'catalog', '--query-json', jsonFile(f, { search: '助手', page: 2 })],
    ['agent', 'subscribe', 'chosen'], ['agent', 'unsubscribe', 'chosen']]) assert.equal((await run(args)).code, 0);
  assert.deepEqual(host.hits.slice(0, 4).map(hit => [hit.method, hit.url.split('?')[0]]), [
    ['GET', '/api/cli/v1/workbench/agents'], ['GET', '/api/cli/v1/workbench/agent-catalog'],
    ['POST', '/api/cli/v1/workbench/agents/chosen/subscription'], ['DELETE', '/api/cli/v1/workbench/agents/chosen/subscription'],
  ]);
  const history = await run(['schedule', 'history', 'original', '--query-json', jsonFile(f, { before: 'saved-cursor' })]);
  assert.equal(output(history).data.nextCursor, 'original-cursor');
  assert.equal(host.hits[4].url, '/api/cli/v1/task-schedules/original/history?before=saved-cursor');
  const result = await run(['schedule', 'run', 'show', 'original', 'original-run']);
  assert.equal(result.code, 0, 'reading a failed run succeeds as a query'); assert.deepEqual(output(result).data, failedRun);
  denied = true;
  assert.equal(output(await run(['agent', 'list'])).error.serverCode, 'application.admission_denied');
  assert.equal(host.hits.length, 7);
});

test('retail cancellation uses that application and preserves an unknown result without a second DELETE', async t => {
  const f = fixture(t), platform = await mockServer(t, (_hit, res) => respond(res, { tenantId: 'TEN', userId: 'human' }));
  const app = await mockServer(t, (hit, res) => {
    assert.equal(hit.method, 'DELETE'); assert.equal(hit.url, '/api/cli/v1/applications/retail-assistant/assistant/agents/chosen/subscription');
    assert.equal(hit.headers['x-xrain-application-id'], 'RETAIL');
    res.destroy();
  });
  f.store.save({ activeProfile: 'Demo', profiles: { Demo: { server: platform.url, tenant: 'TEN', applicationId: 'RETAIL' } } });
  f.store.saveSession('Demo', platform.url, 'TEN', 'member-session', Date.now() + 300000);
  const result = await f.run(['retail', 'unsubscribe', 'chosen', '--app-url', app.url, '--json']);
  assert.equal(output(result).error.code, 'outcome_unknown'); assert.equal(app.hits.length, 1);
});

test('the complete standalone Skill supports tenant switching and the aligned user entrypoints in new processes', async t => {
  const f = fixture(t), directory = join(f.directory, 'installed-skill');
  cpSync(fileURLToPath(new URL('../skills/shzw-xrain-cli/', import.meta.url)), directory, { recursive: true });
  assert.equal(existsSync(join(directory, 'node_modules')), false);
  const service = await mockServer(t, (hit, res) => {
    if (hit.url === '/api/service/authen/v1/account/context') return respond(res, { scope: 'tenant', tenantId: hit.headers.authorization === 'Bearer source-session' ? 'SOURCE' : 'DESTINATION', userId: 'human' });
    if (hit.url.endsWith('/DESTINATION/switch')) return respond(res, { userId: 'human', tenantId: 'DESTINATION', access_token: 'destination-session', expires_at_utc: new Date(Date.now() + 300000).toISOString() });
    assert.equal(hit.headers.authorization, hit.url.includes('/host/tenants/') ? 'Bearer host-session' : 'Bearer destination-session');
    if (hit.url === '/api/application/v1/capabilities') return respond(res, { canInstall: false, canSubmit: true, canReview: false, canPublish: false, canCreateApplication: true });
    if (hit.url.endsWith('/api-token')) return respond(res, { api_token: 'protected-token', expires_at_utc: new Date(Date.now() + 300000).toISOString() });
    if (hit.url.startsWith('/api/cli/v1/')) {
      assert.equal(hit.headers['x-xrain-expected-tenant-id'], 'DESTINATION');
      assert.equal(hit.headers['x-xrain-application-id'], 'APP');
    }
    respond(res, { items: [{ userId: 'human', agentId: 'chosen' }], totalCount: 1 });
  });
  f.store.save({ activeProfile: 'Demo', profiles: { Demo: { server: service.url, tenant: 'SOURCE', applicationId: 'old-app', runtime: service.url }, Host: { server: service.url, scope: 'host' } } });
  f.store.saveSession('Demo', service.url, 'SOURCE', 'source-session', Date.now() + 300000);
  f.store.saveSession('Host', service.url, null, 'host-session', Date.now() + 300000, 'host');
  const run = args => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(directory, 'scripts/xrain-cli.mjs'), ...args, '--json'], { cwd: directory, env: f.env, windowsHide: true });
    let stdout = '', stderr = '';
    child.stdout.on('data', bytes => { stdout += bytes; }); child.stderr.on('data', bytes => { stderr += bytes; });
    child.once('error', reject); child.once('close', code => resolve({ code, stdout, stderr }));
  });
  const switchResult = await run(['auth', 'switch-tenant', 'DESTINATION']);
  assert.equal(switchResult.code, 0, switchResult.stdout + switchResult.stderr);
  const query = jsonFile(f, { isActive: false });
  for (const args of [
    ['member', 'list', '--auth', 'session'],
    ['host', 'tenant', 'member', 'list', 'target', '--profile', 'Host', '--auth', 'session', '--query-json', query],
    ['agent', 'definition', 'employee-options', '--runtime', service.url],
    ['agent', 'definition', 'member', 'human', '--runtime', service.url],
    ['workforce', 'agent', 'list', '--workforce', service.url, '--application-id', 'APP'],
    ['workforce', 'schedule', 'run', 'show', 'original', 'run', '--workforce', service.url, '--application-id', 'APP'],
    ['retail', 'unsubscribe', 'chosen', '--app-url', service.url, '--application-id', 'APP'],
    ['app', 'capabilities'],
  ]) {
    const result = await run(args); assert.equal(result.code, 0, result.stdout + result.stderr);
    assert.equal(result.stdout.includes('destination-session'), false);
  }
  const tokenOut = join(f.directory, 'standalone-credential.json');
  const issued = await run(['auth', 'api-token', 'create', '--request-json', jsonFile(f, {}), '--out', tokenOut]);
  assert.equal(issued.code, 0, issued.stdout + issued.stderr);
  assert.equal(readCredentialFile(tokenOut, { server: service.url, tenant: 'DESTINATION', scope: 'tenant' }), 'protected-token');
});
