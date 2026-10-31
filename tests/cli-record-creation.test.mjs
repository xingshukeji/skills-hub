import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fixture, mockServer, respond } from './helpers.mjs';

function client(t, bundled) {
  const f = fixture(t);
  if (!bundled) return f;
  const skill = join(f.directory, 'isolated-skill');
  cpSync('skills/shzw-xrain-cli', skill, { recursive: true });
  return { ...f, run(argv) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [join(skill, 'scripts/xrain-cli.mjs'), ...argv], { cwd: f.directory, env: f.env, windowsHide: true });
      let stdout = '', stderr = '';
      child.stdout.on('data', value => { stdout += value; }); child.stderr.on('data', value => { stderr += value; });
      child.on('error', reject); child.on('close', code => resolve({ code, stdout, stderr }));
    });
  } };
}

const path = '/api/data/v1/entities/customer/records';
const receipt = values => ({ entityCode: 'customer', recordId: 'persisted-record', createdAt: '2026-10-31T00:00:00Z', updatedAt: '2026-10-31T00:00:00Z', values });
const create = (key, name = 'Acme') => ['data', 'create', 'customer', '--request-key', key, '--values', JSON.stringify({ name }), '--json'];
const lookup = key => ['data', 'creation-result', 'customer', '--request-key', key, '--json'];

for (const bundled of [false, true]) {
  const label = bundled ? 'copied standalone CLI' : 'source CLI';
  test(`${label}: a lost creation receipt is recovered by its original key without replay or identity fallback`, async t => {
    const f = client(t, bundled), key = 'fixed-order-creation', persisted = new Map();
    let output = '', deny = false, writes = 0;
    const server = await mockServer(t, (hit, res) => {
      assert.equal(hit.headers.authorization, 'Bearer synthetic-record-token');
      assert.ok(!Object.keys(hit.headers).some(name => /tenant|actor|user-id/.test(name)));
      if (hit.url === path + ':creationResult') {
        assert.equal(hit.method, 'POST'); assert.deepEqual(Object.keys(hit.json()), ['requestKey']);
        if (deny) return respond(res, { errorCode: 'platform.forbidden' }, 403);
        const record = persisted.get(hit.json().requestKey);
        return respond(res, { status: record ? 'completed' : 'unknown', record: record ?? null });
      }
      assert.equal(hit.url, path); assert.equal(hit.method, 'POST');
      if (!bundled) assert.match(output, /Request key: fixed-order-creation/);
      const body = hit.json(); writes++;
      assert.equal(body.requestKey, key);
      if (persisted.has(key)) {
        if (JSON.stringify(persisted.get(key).values) !== JSON.stringify(body.values)) return respond(res, { errorCode: 'platform.runtime.creation_key_conflict' }, 409);
        return respond(res, persisted.get(key));
      }
      persisted.set(key, receipt(body.values));
      res.destroy(); // The server persisted the record before losing the reply.
    });
    f.profile(server.url, 'tenant-demo', 'synthetic-record-token');
    const lost = await f.run(create(key), { onOutput: value => { output += value; } });
    assert.equal(lost.code, 1, lost.stdout);
    assert.equal(JSON.parse(lost.stdout).error.code, 'outcome_unknown');
    assert.equal(JSON.parse(lost.stdout).error.details.requestKey, key);
    assert.match(lost.stderr, /Request key: fixed-order-creation/);
    assert.equal(writes, 1); assert.equal(server.hits.length, 1);
    const recovered = await f.run(lookup(key));
    assert.equal(recovered.code, 0, recovered.stdout);
    assert.deepEqual(JSON.parse(recovered.stdout).data, { status: 'completed', record: persisted.get(key), requestKey: key });
    assert.equal(writes, 1);
    const repeat = await f.run(create(key));
    assert.equal(repeat.code, 0, repeat.stdout);
    assert.equal(JSON.parse(repeat.stdout).data.recordId, 'persisted-record'); assert.equal(persisted.size, 1);
    const changed = await f.run(create(key, 'Different'));
    assert.equal(changed.code, 1); assert.equal(JSON.parse(changed.stdout).error.httpStatus, 409);
    assert.equal(JSON.parse(changed.stdout).error.details.requestKey, key);
    assert.equal(persisted.size, 1); assert.equal(writes, 3);
    const unknown = await f.run(lookup('unseen-key'));
    assert.deepEqual(JSON.parse(unknown.stdout).data, { status: 'unknown', record: null, requestKey: 'unseen-key' });
    deny = true;
    const denied = await f.run(lookup(key));
    assert.equal(denied.code, 1); assert.equal(JSON.parse(denied.stdout).error.code, 'permission_denied');
    assert.equal(JSON.parse(denied.stdout).error.details.requestKey, key);
    assert.equal(writes, 3); assert.equal(server.hits.length, 6);
    assert.ok(!(lost.stdout + lost.stderr + recovered.stdout).includes('synthetic-record-token'));
  });

  test(`${label}: explicit JSON keys are preserved and old targets get no automatic key or fallback`, async t => {
    const f = client(t, bundled); let legacy = false;
    const server = await mockServer(t, (hit, res) => {
      if (hit.url.endsWith(':creationResult')) return respond(res, {}, 404);
      if (legacy && Object.hasOwn(hit.json(), 'requestKey')) return respond(res, { errorCode: 'unsupported_field' }, 400);
      respond(res, receipt(hit.json().values), 201);
    });
    f.profile(server.url, 't', 'synthetic-record-token');
    const envelope = { values: { name: 'Envelope' }, requestKey: 'envelope-key' };
    const file = join(f.directory, 'values.json'); writeFileSync(file, JSON.stringify(envelope));
    const supplied = await f.run(['data', 'create', 'customer', '--values-json', file, '--json']);
    assert.equal(supplied.code, 0, supplied.stdout); assert.deepEqual(server.hits.at(-1).json(), envelope);
    legacy = true;
    const rejected = await f.run(create('unsupported-key'));
    assert.equal(rejected.code, 1); assert.equal(JSON.parse(rejected.stdout).error.httpStatus, 400);
    assert.equal(server.hits.length, 2); // No retry without the supplied key.
    const missing = await f.run(lookup('unsupported-key'));
    assert.equal(missing.code, 1); assert.equal(JSON.parse(missing.stdout).error.code, 'not_found');
    assert.equal(JSON.parse(missing.stdout).error.details.requestKey, 'unsupported-key');
    assert.equal(server.hits.length, 3);
    const plain = await f.run(['data', 'create', 'customer', '--values', '{"name":"Legacy"}', '--json']);
    assert.equal(plain.code, 0, plain.stdout);
    assert.deepEqual(server.hits.at(-1).json(), { values: { name: 'Legacy' } });
    assert.equal(server.hits.length, 4);
  });

  test(`${label}: invalid creation receipts never become successful or trigger a second write`, async t => {
    const f = client(t, bundled); let reply;
    const server = await mockServer(t, (hit, res) => respond(res, reply));
    f.profile(server.url, 't', 'synthetic-record-token');
    for (reply of [{ accepted: true }, { ...receipt({}), entityCode: '' }, { status: 'completed', record: null }]) {
      const result = await f.run(create('receipt-key'));
      assert.equal(result.code, 1); assert.equal(JSON.parse(result.stdout).error.code, 'outcome_unknown');
      assert.equal(JSON.parse(result.stdout).error.details.requestKey, 'receipt-key');
    }
    for (reply of [{ status: 'completed', record: null }, { status: 'unknown', record: receipt({}) }, { status: 'completed', record: { ...receipt({}), entityCode: 42 } }]) {
      const result = await f.run(lookup('receipt-key'));
      assert.equal(result.code, 1); assert.equal(JSON.parse(result.stdout).error.code, 'invalid_response');
      assert.equal(JSON.parse(result.stdout).error.details.requestKey, 'receipt-key');
    }
    assert.equal(server.hits.length, 6);
  });

  test(`${label}: a supported API name can return its canonical entity code`, async t => {
    const f = client(t, bundled), record = receipt({ name: 'Alias' });
    const server = await mockServer(t, (hit, res) => {
      assert.match(hit.url, /^\/api\/data\/v1\/entities\/CustomerApi\/records/);
      respond(res, hit.url.endsWith(':creationResult') ? { status: 'completed', record } : record);
    });
    f.profile(server.url, 't', 'synthetic-record-token');
    const created = await f.run(['data', 'create', 'CustomerApi', '--request-key', 'alias-key', '--values', '{"name":"Alias"}', '--json']);
    assert.equal(created.code, 0, created.stdout); assert.equal(JSON.parse(created.stdout).data.entityCode, 'customer');
    const found = await f.run(['data', 'creation-result', 'CustomerApi', '--request-key', 'alias-key', '--json']);
    assert.equal(found.code, 0, found.stdout); assert.equal(JSON.parse(found.stdout).data.record.entityCode, 'customer');
    assert.equal(server.hits.length, 2);
  });

  test(`${label}: malformed keys and a missing batch lookup key fail before writes`, async t => {
    const f = client(t, bundled), server = await mockServer(t, (hit, res) => respond(res, receipt({})));
    f.profile(server.url, 't', 'synthetic-record-token');
    for (const argv of [lookup(' '), lookup('k'.repeat(161)), ['data', 'creation-result', 'customer', '--json'],
      [...create('option-key').slice(0, -1), '--values-json', 'not-read.json', '--json'],
      ['data', 'create', 'customer', '--request-key', 'option-key', '--values', '{"values":{},"requestKey":"json-key"}', '--json'],
      ['data', 'create', 'customer', '--values', '{"values":{},"requestKey":42}', '--json']]) {
      const result = await f.run(argv); assert.equal(result.code, 1, result.stdout);
    }
    const workflow = join(f.directory, 'workflow.json');
    writeFileSync(workflow, JSON.stringify([create('never-written').slice(0, -1), ['data', 'creation-result', 'customer']]));
    const batch = await f.run(['batch', '--file', workflow, '--json']);
    assert.equal(batch.code, 1, batch.stdout); assert.equal(server.hits.length, 0);
  });
}
