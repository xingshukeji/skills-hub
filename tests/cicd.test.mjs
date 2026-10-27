import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mockToken = 'synthetic-cicd-test-token';
const job = 'suite/unit name';
const jobPath = '/job/suite/job/unit%20name';

async function setup(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'cicd-skill-'));
  await cp(join(root, 'skills/shzw-cicd'), join(directory, 'installed skill'), { recursive: true });
  const requests = [];
  const prefix = options.prefix ?? '';
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    const parsed = new URL(request.url, 'http://127.0.0.1');
    const path = parsed.pathname.slice(prefix.length);
    requests.push({ path: parsed.pathname, query: parsed.searchParams, method: request.method, body, headers: request.headers });
    const json = (value, status = 200, headers = {}) => {
      response.writeHead(status, { 'content-type': 'application/json', ...headers });
      response.end(JSON.stringify(value));
    };
    if (path === '/crumbIssuer/api/json') {
      return json({ crumbRequestField: 'Jenkins-Crumb', crumb: 'mock-crumb' }, options.crumbStatus ?? 200,
        { 'set-cookie': ['JSESSIONID=synthetic-session; Path=/', 'ROUTE=synthetic-route; Path=/'] });
    }
    if (request.method === 'POST') {
      if (options.dropTrigger) return request.socket.destroy();
      return json({ message: mockToken }, options.triggerStatus ?? 201,
        { location: options.location ?? `${url}/queue/item/42/` });
    }
    // Jenkins may remove a queue item before a later status invocation.
    if (path === '/queue/item/42/api/json') return options.queue ? json(options.queue) : json({}, 404);
    if (path === jobPath + '/api/json') {
      if (parsed.searchParams.get('tree').startsWith('fullName')) {
        return json({ fullName: job, buildable: true, property: [{ parameterDefinitions: [
          { name: 'DEPLOY', type: 'BooleanParameterDefinition', defaultParameterValue: { value: false } },
          { name: 'ENVIRONMENT', type: 'ChoiceParameterDefinition', choices: ['test-a', 'test-b'], defaultParameterValue: { value: 'test-a' } },
          { name: 'PASSWORD', type: 'PasswordParameterDefinition', defaultParameterValue: { value: 'synthetic-job-password' } },
          { name: 'API_KEY', type: 'ChoiceParameterDefinition', choices: ['synthetic-api-key'], defaultParameterValue: { value: 'synthetic-api-key' } },
          { name: 'CUSTOM_INPUT', type: 'StringParameterDefinition', defaultParameterValue: { value: 'synthetic-private-default' } },
        ] }], lastBuild: { number: 18, result: 'SUCCESS' } });
      }
      return json({ builds: options.noHistory ? [] : [{ number: 18, queueId: 43 }, { number: 17, queueId: 42 }] });
    }
    if (path === jobPath + '/17/api/json') {
      return json({ number: 17, queueId: options.queueId ?? 42, building: options.building ?? false, result: options.building ? null : (options.result ?? 'SUCCESS'),
        timestamp: 1_800_000_000_000, duration: 1200, url: `${url}${jobPath}/17/`, artifacts: [{ fileName: 'checks.json', relativePath: 'reports/checks.json' }] });
    }
    if (options.redirect) {
      return json({ message: mockToken }, 302, { location: options.redirect });
    }
    return json({ jobs: [{ name: 'suite' }] });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}${prefix}`;
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  return { directory, requests, url };
}

function invoke(directory, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(directory, 'installed skill/scripts/jenkins.mjs'), ...args], {
      cwd: directory, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PATH: '', NODE_PATH: '', NODE_OPTIONS: '', JENKINS_USER: 'synthetic-user', JENKINS_TOKEN: mockToken, JENKINS_URL: '', CICD_CREDENTIAL_REF: '', ...env }
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', value => { stdout += value; });
    child.stderr.on('data', value => { stderr += value; });
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}

test('copied skill lists and inspects jobs with Node alone, including folders and context paths', async t => {
  const { directory, requests, url } = await setup(t, { prefix: '/jenkins' });
  const help = await invoke(directory, ['--help']);
  assert.equal(help.code, 0, help.stderr);
  assert.equal(requests.length, 0);
  const jobs = await invoke(directory, ['jobs'], { JENKINS_URL: url });
  assert.equal(jobs.code, 0, jobs.stderr);
  assert.equal(JSON.parse(jobs.stdout).jobs[0].name, 'suite');
  const folder = await invoke(directory, ['jobs', '--url', url, '--job', 'suite']);
  assert.equal(folder.code, 0, folder.stderr);
  assert.equal(requests.at(-1).path, '/jenkins/job/suite/api/json');
  const inspect = await invoke(directory, ['inspect', '--url', url, '--job', job]);
  assert.equal(inspect.code, 0, inspect.stderr);
  const parameters = JSON.parse(inspect.stdout).property[0].parameterDefinitions;
  assert.equal(parameters[0].name, 'DEPLOY');
  assert.equal(parameters[0].defaultParameterValue.value, false);
  assert.deepEqual(parameters[1].choices, ['test-a', 'test-b']);
  assert.equal(parameters[1].defaultParameterValue.value, 'test-a');
  assert(parameters.slice(2).every(parameter => !('defaultParameterValue' in parameter) && !('choices' in parameter)));
  for (const privateValue of ['synthetic-job-password', 'synthetic-api-key', 'synthetic-private-default']) assert(!inspect.stdout.includes(privateValue));
  assert.equal(JSON.parse(inspect.stdout).lastBuild.number, 18);
  assert(requests.every(request => request.method === 'GET'));
});

test('trigger follows its own build after queue expiry and keeps a reusable private receipt', async t => {
  const { directory, requests, url } = await setup(t, { prefix: '/jenkins' });
  const parameters = join(directory, 'parameters.json'), run = join(directory, '运行 回执.json');
  await writeFile(parameters, '\uFEFF' + JSON.stringify({ CHECKS_ONLY: true, NEGATIVE_CHECK: false, COUNT: 2, LABEL: '测试 & = + %' }));
  const args = ['trigger', '--url', url, '--job', job, '--parameters-file', parameters, '--run-file', run];
  const trigger = await invoke(directory, args);
  assert.equal(trigger.code, 0, trigger.stderr);
  assert.equal(JSON.parse(trigger.stdout).queueId, 42);
  const posted = requests.find(request => request.method === 'POST');
  assert.equal(posted.path, '/jenkins' + jobPath + '/buildWithParameters');
  assert.equal(posted.headers['jenkins-crumb'], 'mock-crumb');
  assert.match(posted.headers.cookie, /JSESSIONID=synthetic-session/);
  assert.match(posted.headers.cookie, /ROUTE=synthetic-route/);
  assert.match(posted.headers['content-type'], /application\/x-www-form-urlencoded/);
  assert.equal(new URLSearchParams(posted.body).get('CHECKS_ONLY'), 'true');
  assert.equal(new URLSearchParams(posted.body).get('NEGATIVE_CHECK'), 'false');
  assert.equal(new URLSearchParams(posted.body).get('COUNT'), '2');
  assert.equal(new URLSearchParams(posted.body).get('LABEL'), '测试 & = + %');
  const status = await invoke(directory, ['status', '--run-file', run]);
  assert.equal(status.code, 0, status.stderr);
  const receipt = JSON.parse(status.stdout);
  assert.equal(receipt.buildNumber, 17);
  assert.equal(receipt.result, 'SUCCESS');
  assert.equal(receipt.submittedAt, JSON.parse(trigger.stdout).submittedAt);
  assert.equal(receipt.duration, 1200);
  assert.equal(receipt.artifacts[0].relativePath, 'reports/checks.json');
  const statusAgain = await invoke(directory, ['status', '--run-file', run]);
  assert.equal(statusAgain.code, 0, statusAgain.stderr);
  const duplicate = await invoke(directory, args);
  assert.equal(duplicate.code, 1);
  assert.equal(requests.filter(request => request.method === 'POST').length, 1);
  assert(![trigger.stdout, status.stdout, statusAgain.stdout, await readFile(run, 'utf8')].join('').includes(mockToken));
  assert(requests.every(request => request.headers.authorization === `Basic ${Buffer.from(`synthetic-user:${mockToken}`).toString('base64')}`));
  if (process.platform !== 'win32') assert.equal((await stat(run)).mode & 0o777, 0o600);
});

test('queued, running and failed builds remain distinct from a successful status query', async t => {
  const options = { queue: { why: 'Waiting for an executor' }, building: true };
  const { directory, requests, url } = await setup(t, options);
  const run = join(directory, 'run.json');
  assert.equal((await invoke(directory, ['trigger', '--url', url, '--job', job, '--run-file', run])).code, 0);
  assert.equal(requests.find(request => request.method === 'POST').path, jobPath + '/build');
  assert.equal(JSON.parse((await invoke(directory, ['status', '--run-file', run])).stdout).status, 'queued');
  options.queue = { executable: { number: 17 } };
  const running = await invoke(directory, ['status', '--run-file', run]);
  assert.equal(JSON.parse(running.stdout).status, 'running');
  options.building = false; options.result = 'FAILURE';
  const completed = await invoke(directory, ['status', '--run-file', run]);
  assert.equal(completed.code, 0);
  assert.equal(JSON.parse(completed.stdout).status, 'completed');
  assert.equal(JSON.parse(completed.stdout).result, 'FAILURE');
});

test('cancelled and expired unresolvable queues are retained without selecting another build', async t => {
  for (const cancelled of [true, false]) {
    const options = { queue: cancelled ? { cancelled: true } : null, noHistory: true };
    const { directory, requests, url } = await setup(t, options);
    const run = join(directory, 'run.json');
    await writeFile(run, JSON.stringify({ jenkinsUrl: url, job, queueId: 42, buildNumber: null, status: 'queued' }));
    const result = await invoke(directory, ['status', '--run-file', run]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).status, cancelled ? 'cancelled' : 'unknown');
    options.queue = null;
    const again = await invoke(directory, ['status', '--run-file', run]);
    assert.equal(JSON.parse(again.stdout).status, cancelled ? 'cancelled' : 'unknown');
    assert(requests.every(request => request.method === 'GET' && !request.path.includes('/17/')));
  }
});

test('failed, disconnected and redirected submissions preserve an unknown receipt and are never retried', async t => {
  for (const options of [{ triggerStatus: 503 }, { dropTrigger: true }, { triggerStatus: 307 }]) {
    const { directory, requests, url } = await setup(t, options);
    const run = join(directory, 'run.json');
    const result = await invoke(directory, ['trigger', '--url', url, '--job', job, '--run-file', run]);
    assert.equal(result.code, 1);
    const receipt = await readFile(run, 'utf8');
    assert.equal(JSON.parse(receipt).status, 'submission-result-unknown');
    assert(![result.stdout, result.stderr, receipt].join('').includes(mockToken));
    const before = requests.length;
    const status = await invoke(directory, ['status', '--run-file', run]);
    assert.equal(JSON.parse(status.stdout).status, 'submission-result-unknown');
    assert.equal(requests.length, before);
    assert.equal(requests.filter(request => request.method === 'POST').length, 1);
  }
});

test('redirects and unexpected queue locations do not send credentials to another destination', async t => {
  const sink = await setup(t);
  const { directory, requests, url } = await setup(t, { redirect: sink.url });
  const response = await invoke(directory, ['jobs', '--url', url]);
  assert.equal(response.code, 1);
  assert.equal(requests.length, 1);
  assert.equal(sink.requests.length, 0);
  for (const location of [sink.url + '/queue/item/42/', '/outside/queue/item/42/', '/queue/item/42/?token=secret', '/queue/item/42/#fragment']) {
    const target = await setup(t, { location });
    const run = join(target.directory, 'run.json');
    const result = await invoke(target.directory, ['trigger', '--url', target.url, '--job', job, '--run-file', run]);
    assert.equal(result.code, 1);
    assert.equal(JSON.parse(await readFile(run, 'utf8')).queueId, null);
    assert.equal(target.requests.filter(request => request.method === 'POST').length, 1);
  }
  assert.equal(sink.requests.length, 0);
});

test('receipt conflicts and mismatched build identities cannot overwrite the saved run', async t => {
  const options = {};
  const { directory, requests, url } = await setup(t, options);
  const run = join(directory, 'old-powershell-receipt.json');
  const original = '\uFEFF' + JSON.stringify({ jenkinsUrl: url, job, queueId: 42, buildNumber: 17, status: 'running' });
  await writeFile(run, original);
  for (const extra of [['--job', 'other'], ['--build', '18'], ['--url', 'https://example.invalid']]) {
    assert.equal((await invoke(directory, ['status', '--run-file', run, ...extra])).code, 1);
  }
  assert.equal(requests.length, 0);
  options.queueId = 99;
  assert.equal((await invoke(directory, ['status', '--run-file', run])).code, 1);
  assert.equal(await readFile(run, 'utf8'), original);
  options.queueId = 42;
  assert.equal((await invoke(directory, ['status', '--run-file', run])).code, 0);
  const explicit = await invoke(directory, ['status', '--url', url, '--job', job, '--build', '17']);
  assert.equal(JSON.parse(explicit.stdout).buildNumber, 17);
});

test('invalid inputs and incomplete credentials are rejected before requests without echoing secrets', async t => {
  const { directory, requests, url } = await setup(t);
  const run = join(directory, 'run.json');
  for (const args of [
    ['jobs', '--url', 'http://example.invalid'], ['jobs', '--url', `https://user:${mockToken}@example.invalid`],
    ['inspect', '--url', url, '--job', '../escape'], ['trigger', '--url', url, '--job', job],
    ['status', '--url', url, '--job', job, '--build', '1.2'], ['jobs', '--url', url, '--token', mockToken],
  ]) {
    const result = await invoke(directory, args);
    assert.equal(result.code, 1);
    assert(![result.stdout, result.stderr].join('').includes(mockToken));
  }
  const parameters = join(directory, 'parameters.json');
  for (const value of ['[]', '{"x":null}', '{"x":[]}', '{"x":{}}', `invalid ${mockToken}`]) {
    await writeFile(parameters, value);
    const result = await invoke(directory, ['trigger', '--url', url, '--job', job, '--run-file', run, '--parameters-file', parameters]);
    assert.equal(result.code, 1);
    assert(![result.stdout, result.stderr].join('').includes(mockToken));
  }
  for (const env of [{ JENKINS_TOKEN: '' }, { JENKINS_USER: '' }, { JENKINS_USER: '', JENKINS_TOKEN: '', CICD_CREDENTIAL_REF: 'legacy.xml' }]) {
    assert.equal((await invoke(directory, ['jobs', '--url', url], env)).code, 1);
  }
  assert.equal(requests.length, 0);
});

test('CSRF absence is supported but authentication failures cannot trigger a build', async t => {
  for (const crumbStatus of [404, 401]) {
    const { directory, requests, url } = await setup(t, { crumbStatus, location: '/queue/item/42/' });
    const parameters = join(directory, 'parameters.json');
    await writeFile(parameters, '{}');
    const result = await invoke(directory, ['trigger', '--url', url, '--job', job, '--run-file', join(directory, 'run.json'), '--parameters-file', parameters]);
    assert.equal(result.code, crumbStatus === 404 ? 0 : 1, result.stderr);
    const posts = requests.filter(request => request.method === 'POST');
    assert.equal(posts.length, crumbStatus === 404 ? 1 : 0);
    if (posts.length) assert.equal(posts[0].path, jobPath + '/buildWithParameters');
  }
});

test('two concurrent triggers cannot share a receipt and submit twice', async t => {
  const { directory, requests, url } = await setup(t);
  const args = ['trigger', '--url', url, '--job', job, '--run-file', join(directory, 'run.json')];
  const results = await Promise.all([invoke(directory, args), invoke(directory, args)]);
  assert.deepEqual(results.map(result => result.code).sort(), [0, 1]);
  assert.equal(requests.filter(request => request.method === 'POST').length, 1);
});
