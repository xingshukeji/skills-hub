import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fixture, mockServer, respond } from './helpers.mjs';

test('the complete copied CLI Skill performs metadata, Workforce and file operations with Node alone', async t => {
  const f = fixture(t), directory = join(f.directory, 'complete skill with spaces');
  cpSync(new URL('../skills/shzw-xrain-cli/', import.meta.url), directory, { recursive: true });
  const file = join(f.directory, 'download.txt'), bytes = Buffer.from('complete copied artifact');
  let conversation;
  const service = await mockServer(t, (hit, res) => {
    if (hit.url === '/api/service/authen/v1/account/context') return respond(res, { tenantId: 'TEN', userId: 'human' });
    if (hit.url === '/api/metadata/v1/entities/customer/describe') return respond(res, { object: { entityApiName: 'customer' }, fields: [] }, 200, { ETag: '"real-8"' });
    if (hit.url.startsWith('/api/automation/routines?')) {
      const query = new URL(hit.url, service.url).searchParams;
      assert.equal(query.get('page'), '1'); assert.equal(query.get('pageSize'), '20'); return respond(res, { items: [] });
    }
    if (hit.url === '/v1/dsh/ephemeral-runs') {
      assert.equal(hit.headers['x-xrain-application-id'], 'APP'); return respond(res, { answer: 'application text' });
    }
    if (hit.url === '/api/integration/v1/http-interfaces/original/debug/raw') {
      res.writeHead(200, { 'content-type': 'text/plain', 'x-original': 'yes' }); return res.end('raw text');
    }
    if (hit.url === '/api/integration/v1/http-interfaces/large/debug/raw') {
      res.writeHead(200, { 'content-type': 'application/octet-stream' }); return res.end(Buffer.alloc(40 * 1024 * 1024, 65));
    }
    if (hit.url === '/v1/dsh/sessions/original/stream') {
      conversation = res; res.writeHead(200, { 'content-type': 'text/event-stream' }); return res.write('data: ' + JSON.stringify({ type: 'snapshot', records: [], hasMore: false }) + '\n\n');
    }
    if (hit.url === '/v1/dsh/sessions/original/inputs') {
      const input = hit.json(); assert.equal(input.requestId, 'task:original/request'); assert.equal(input.content[0].text.length, 64001);
      respond(res, { accepted: true }, 202);
      for (const [index, [type, data]] of [['turn/start', { turn: 1 }], ['user/message', { source: { kind: 'user', rpcId: input.requestId }, content: input.content }],
        ['turn/end', { turn: 1, reason: { kind: 'completed' } }]].entries()) conversation.write('data: ' + JSON.stringify({ type: 'event', event: { type, seq: index + 1, data } }) + '\n\n');
      return;
    }
    if (hit.url === '/api/service/authen/v1/security/api-debug') {
      res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('security raw text');
    }
    if (hit.url === '/v1/dsh/sessions/original/commands') return respond(res, { execution: { commandId: 'native', result: { kind: 'error', text: 'rejected command' } } });
    if (hit.url === '/api/cli/v1/context') {
      assert.equal(hit.headers.authorization, 'Bearer original-session'); assert.equal(hit.headers['x-xrain-application-id'], 'APP');
      return respond(res, { tenantId: 'TEN', userId: 'human', applicationId: 'APP' });
    }
    if (hit.url === '/api/cli/v1/workbench/sessions/original/feedback') {
      assert.equal(hit.headers.authorization, 'Bearer original-session');
      assert.equal(hit.json().messageId, '7'); return respond(res, { saved: true });
    }
    if (hit.url === '/api/cli/v1/workbench/speech') return respond(res, { selection: { providerId: 'native', language: 'auto' }, maxAudioBytes: 1000 });
    if (hit.url === '/api/cli/v1/workbench/speech/transcribe') {
      assert.deepEqual(hit.json(), { providerId: 'native', language: 'auto', audioBase64: Buffer.from('RIFF fixture').toString('base64') });
      return respond(res, { text: '原语音文字' });
    }
    if (hit.url === '/api/application-messages') {
      assert.equal(hit.headers.authorization, 'Bearer service-file-token'); assert.equal(hit.headers['x-xrain-application-id'], undefined);
      assert.equal(hit.json().applicationId, 'publisher');
      return respond(res, { status: 'accepted', channelId: 'announcement', clientMessageId: 'original-publish' });
    }
    if (hit.url === '/api/application-messages/publisher/channels/announcement/requests/original-publish')
      return respond(res, { status: 'saved', channelId: 'announcement', clientMessageId: 'original-publish' });
    if (hit.url === '/api/cli/v1/mail/ais') {
      assert.equal(hit.headers.authorization, 'Bearer original-session');
      return respond(res, { items: [{ id: 'mail-ai', canUse: true }] });
    }
    if (hit.url === '/api/cli/v1/applications/retail-assistant/context') {
      assert.equal(hit.headers['x-xrain-expected-user-id'], 'human');
      return respond(res, { objectType: 'native-customer', owner: { tenantId: 'TEN', userId: 'human' } });
    }
    if (hit.url === '/api/service/authen/v1/security/tenants') return respond(res, [{ tenantId: 'TEN', userId: 'human' }]);
    if (hit.url === '/api/service/files/v1/files/file-one') return respond(res, { id: 'file-one', length: bytes.length, contentType: 'text/plain' });
    assert.equal(hit.url, '/api/service/files/v1/files/file-one/content');
    res.writeHead(200, { 'content-type': 'text/plain', 'content-length': bytes.length }); res.end(bytes);
  });
  f.store.save({ activeProfile: 'Demo', profiles: { Demo: { server: service.url, runtime: service.url, tenant: 'TEN', applicationId: 'APP', bearerToken: 'service-file-token' } } });
  f.store.saveSession('Demo', service.url, 'TEN', 'original-session', Date.now() + 300000);
  const run = args => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(directory, 'scripts/xrain-cli.mjs'), ...args, '--json'], { cwd: directory, env: f.env, windowsHide: true });
    let stdout = '', stderr = ''; child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject); child.on('close', code => resolve({ code, stdout, stderr, result: JSON.parse(stdout) }));
  });
  const metadata = await run(['metadata', 'entity', 'show', 'customer']); assert.equal(metadata.code, 0, metadata.stdout); assert.equal(metadata.result.data.headers.etag, '"real-8"');
  const context = await run(['workforce', 'context', '--workforce', service.url]); assert.equal(context.code, 0, context.stdout); assert.equal(context.result.data.applicationId, 'APP');
  const feedbackFile = join(f.directory, 'feedback.json'); writeFileSync(feedbackFile, JSON.stringify({ messageId: '7', rating: 'positive', category: null, note: '' }));
  const feedback = await run(['workforce', 'session', 'feedback', 'set', 'original', '--workforce', service.url, '--request-json', feedbackFile]);
  assert.equal(feedback.code, 0, feedback.stdout); assert.equal(feedback.result.data.saved, true);
  const audioFile = join(f.directory, 'speech.wav'); writeFileSync(audioFile, 'RIFF fixture');
  const speech = await run(['workforce', 'speech', 'transcribe', '--workforce', service.url, '--file', audioFile]);
  assert.equal(speech.code, 0, speech.stdout); assert.equal(speech.result.data.text, '原语音文字');
  const publicationFile = join(f.directory, 'publication.json'); writeFileSync(publicationFile, JSON.stringify({ applicationId: 'publisher', target: { kind: 'application' }, clientMessageId: 'original-publish', content: { type: 'text', text: '应用消息' } }));
  const published = await run(['workforce', 'application-message', 'send', '--workforce', service.url, '--auth', 'auto', '--request-json', publicationFile]);
  assert.equal(published.code, 0, published.stdout); assert.equal(published.result.data.status, 'accepted');
  const receipt = await run(['workforce', 'application-message', 'lookup', 'publisher', 'announcement', 'original-publish', '--workforce', service.url, '--auth', 'auto']);
  assert.equal(receipt.code, 0, receipt.stdout); assert.equal(receipt.result.data.status, 'saved');
  const mail = await run(['mail', 'ai', 'list', '--app-url', service.url]); assert.equal(mail.code, 0, mail.stdout); assert.equal(mail.result.data.items[0].id, 'mail-ai');
  const retail = await run(['retail', 'context', '--app-url', service.url]); assert.equal(retail.code, 0, retail.stdout); assert.equal(retail.result.data.objectType, 'native-customer');
  const tenants = await run(['auth', 'tenants']); assert.equal(tenants.code, 0, tenants.stdout); assert.equal(tenants.result.data[0].tenantId, 'TEN');
  const downloaded = await run(['file', 'download', 'file-one', '--out', file]); assert.equal(downloaded.code, 0, downloaded.stdout); assert.deepEqual(readFileSync(file), bytes);
  assert.equal((await run(['routine', 'list'])).code, 0);
  const text = await run(['agent', 'ephemeral', 'generate', 'writer', '--message', 'Rewrite']); assert.equal(text.code, 0, text.stdout);
  assert.equal(text.result.data.answer, 'application text');
  const input = join(f.directory, 'input.json'); writeFileSync(input, '{}');
  const raw = await run(['http', 'interface', 'debug', 'original', '--request-json', input]);
  assert.equal(raw.code, 0, raw.stdout); assert.equal(raw.result.data.body, 'raw text'); assert.equal(raw.result.data.headers['x-original'], 'yes');
  const largeFile = join(f.directory, 'large-response.bin');
  const large = await run(['http', 'interface', 'debug', 'large', '--request-json', input, '--out', largeFile]);
  assert.equal(large.code, 0, large.stdout); assert.equal(large.result.data.bytes, 40 * 1024 * 1024);
  const promptFile = join(f.directory, 'long-prompt.txt'); writeFileSync(promptFile, 'x'.repeat(64001));
  const native = await run(['agent', 'chat', 'send', 'original', '--request-id', 'task:original/request', '--message-file', promptFile]);
  assert.equal(native.code, 0, native.stdout); assert.equal(native.result.data.status, 'completed'); assert.equal(native.result.data.answer, '');
  const security = await run(['security', 'api-debug', '--request-json', input]);
  assert.equal(security.code, 0, security.stdout); assert.equal(security.result.data.body, 'security raw text');
  const command = await run(['agent', 'chat', 'command', 'original', '--line', '/status']);
  assert.equal(command.code, 1, command.stdout); assert.equal(command.result.error.code, 'execution_failed');
});
