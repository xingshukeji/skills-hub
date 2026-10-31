import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, writeFile, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { once } from 'node:events';

const python = process.env.DESKPILOT_TEST_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const helper = resolve('skills/shzw-deskpilot-cli/tools/observe-view.py');
const fixture = `
import json, sys, threading, time
sys.stdin.reconfigure(encoding='utf-8')
lock = threading.Lock()
workers = []
def emit(value):
    with lock:
        print(json.dumps(value), flush=True)
def slow(request_id):
    time.sleep(.4)
    emit({'id':request_id, 'ok':True, 'result':{'status':'finished'}})
for line in sys.stdin:
    request = json.loads(line)
    request_id = request.get('id', request.get('request_id'))
    method = request['method']
    if method == 'android.observe' and request.get('params',{}).get('fragmented'):
        payload={'id':request_id,'ok':True,'result':{'observation_id':'unicode','count':2,'truncated':False,'elements':[{'text':'Keep target','element_id':'keep'},{'text':'中文🙂'*20000,'element_id':'large'}]}}
        raw=(' \\t'+json.dumps(payload,ensure_ascii=False,separators=(',',':'))+'  \\r\\n').encode('utf-8')
        split=raw.index('中'.encode('utf-8'))+1
        with lock:
            for start,end in [(0,split),(split,split+1),(split+1,4096),(4096,len(raw))]:
                sys.stdout.buffer.write(raw[start:end]);sys.stdout.buffer.flush();time.sleep(.003)
    elif method == 'android.observe':
        nodes = [{'text':'row '+str(i), 'element_id':'e'+str(i), 'observation_id':'o1', 'scrollable':False} for i in range(80)]
        nodes[2]['text'] = 'Save'; nodes[4]['scrollable'] = True; nodes[6]['text'] = 'Edit'; nodes[6]['password'] = True
        emit({'id':request_id, 'ok':True, 'result':{'observation_id':'o1', 'count':80, 'truncated':True, 'elements':nodes}})
    elif method == 'actions.batch':
        emit({'id':request_id, 'ok':True, 'result':{'status':'completed','steps':[{'step_id':'observe','ok':True,'result':{'observation_id':'o2','count':2,'truncated':False,'elements':[{'text':'Save','element_id':'e2'}, {'text':'Other','element_id':'e3'}]}}]}})
    elif method == 'slow':
        thread = threading.Thread(target=slow, args=(request_id,)); thread.start(); workers.append(thread)
    elif method == 'error':
        emit({'id':request_id, 'ok':False, 'error':{'code':'TEST_ERROR','outcome':'unknown','details':{'preserved':True,'steps':[{'step_id':'observed','result':{'observation_id':'o3','truncated':True,'elements':[{'text':'Save','element_id':'e1'},{'text':'Other','element_id':'e2'}]}}]}}})
    elif method == 'invalid_bytes':
        with lock:
            sys.stdout.buffer.write(b'\\xff\\n'); sys.stdout.buffer.flush()
    elif method == 'close':
        for thread in workers: thread.join()
        emit({'id':request_id, 'ok':True, 'result':{'status':'closed'}})
        break
    else:
        emit({'id':request_id, 'ok':True, 'result':{'method':method}})
`;

async function nextLine(iterator) {
  let timer;
  try {
    const result = await Promise.race([
      iterator.next(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('transport response timed out')), 10000); }),
    ]);
    assert.equal(result.done, false, 'transport exited before responding');
    return JSON.parse(result.value);
  } finally {
    clearTimeout(timer);
  }
}

test('focused views retain raw evidence, completeness, errors and cancellation', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'deskpilot-observe-view-'));
  const mock = join(folder, 'mock-cli.py');
  const record = join(folder, 'receipts.ndjson');
  const copiedTools = join(folder, 'standalone skill with spaces', 'tools');
  const copiedHelper = join(copiedTools, 'observe-view.py');
  await mkdir(copiedTools, { recursive: true });
  await copyFile(helper, copiedHelper);
  await writeFile(mock, fixture);
  const child = spawn(python, ['-u', copiedHelper, '--command', python, '--command-arg', mock, '--record', record], { stdio: ['pipe', 'pipe', 'pipe'] });
  let errors = '';
  child.stderr.on('data', data => { errors += data; });
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  const send = value => child.stdin.write(JSON.stringify(value) + '\n');
  try {
    assert.equal((await nextLine(lines)).transport, 'ready');
    send({ request: { id: 'obs', method: 'android.observe', params: {} }, view: { terms: ['save'], flags: ['scrollable'] } });
    const observation = await nextLine(lines);
    assert.equal(observation.result.count, 80);
    assert.equal(observation.result.truncated, true);
    assert.deepEqual(observation.result.elements.map(x => x._source_index), [2, 4]);
    assert.deepEqual(observation.result._view, { source_elements: 80, matched: 2, shown: 2, output_truncated: false });

    send({ inspect: { terms: ['Edit'] } });
    const inspected = await nextLine(lines);
    assert.equal(inspected.cached_observation, true);
    assert.equal(inspected.result.elements[0].element_id, 'e6');
    assert.equal(inspected.result.elements[0].password, true);
    assert.equal(inspected.result.observation_id, 'o1');
    send({ inspect: { terms: ['missing control'] } });
    const noMatch = await nextLine(lines);
    assert.equal(noMatch.result._view.matched, 0);
    assert.equal(noMatch.result.truncated, true);
    send({ inspect: { terms: ['row'], max_items: 1 } });
    const limited = await nextLine(lines);
    assert.equal(limited.result._view.output_truncated, true);
    assert.ok(limited.result._view.matched > 1);
    assert.equal(limited.result.truncated, true);

    send({ request: { id: 'batch', method: 'actions.batch', params: {} }, view: { terms: ['save'] } });
    const batch = await nextLine(lines);
    assert.equal(batch.result.steps[0].result.observation_id, 'o2');
    assert.equal(batch.result.steps[0].result.elements.length, 1);
    assert.equal(batch.result.steps[0].result._view.matched, 1);
    send({ inspect: { terms: ['save'] } });
    assert.equal((await nextLine(lines)).transport_error.code, 'NO_CURRENT_OBSERVATION');

    send({ request: { id: 'error', method: 'error', params: {} }, view: { terms: ['save'] } });
    const failure = await nextLine(lines);
    assert.equal(failure.error.outcome, 'unknown');
    assert.equal(failure.error.details.preserved, true);
    assert.equal(failure.error.details.steps[0].step_id, 'observed');
    assert.equal(failure.error.details.steps[0].result.truncated, true);
    assert.equal(failure.error.details.steps[0].result.elements.length, 1);

    send({ id: 'slow', method: 'slow', params: {} });
    send({ id: 'cancel', method: 'interaction.cancel', params: {} });
    assert.equal((await nextLine(lines)).id, 'cancel');
    assert.equal((await nextLine(lines)).id, 'slow');

    send({ id: 'raw', method: 'android.observe', params: {} });
    assert.equal((await nextLine(lines)).result.elements.length, 80);
    send({ request: { id: 'invalid', method: 'ui.click', params: {} }, view: { terms: [] } });
    assert.equal((await nextLine(lines)).transport_error.code, 'INVALID_INPUT');
    send({ id: 'invalid-unicode', method: 'ui.set_value', params: { value: '\ud800' } });
    assert.equal((await nextLine(lines)).transport_error.code, 'INVALID_INPUT');
    send({ inspect: { terms: ['Edit'] } });
    assert.equal((await nextLine(lines)).result.elements[0].element_id, 'e6');
    send({ id: 'click', method: 'ui.click', params: {} });
    assert.equal((await nextLine(lines)).result.method, 'ui.click');
    send({ inspect: { terms: ['Edit'] } });
    assert.equal((await nextLine(lines)).transport_error.code, 'NO_CURRENT_OBSERVATION');
    send({ request: { id: '片段-utf8', method: 'android.observe', params: { fragmented: true } }, view: { terms: ['Keep target'] } });
    const fragmented = await nextLine(lines);
    assert.equal(fragmented.id, '片段-utf8');
    assert.deepEqual(fragmented.result.elements.map(x => x.element_id), ['keep']);
    assert.equal(fragmented.result._view.source_elements, 2);
    send({ id: 'malformed', method: 'invalid_bytes', params: {} });
    assert.equal((await nextLine(lines)).transport_error.code, 'INVALID_RESPONSE');
    send({ id: 'cancel-after-malformed', method: 'interaction.cancel', params: {} });
    assert.equal((await nextLine(lines)).id, 'cancel-after-malformed');
    send({ request_id: 'alias', method: 'capabilities', params: {} });
    assert.equal((await nextLine(lines)).id, 'alias');
    send({ id: 'close', method: 'close', params: {} });
    assert.equal((await nextLine(lines)).result.status, 'closed');
    const closed = await nextLine(lines);
    assert.equal(closed.transport_error.code, 'STREAM_CLOSED');
    assert.deepEqual(closed.transport_error.pending_ids, ['malformed']);
    const [code] = await once(child, 'exit');
    assert.equal(code, 0, errors);

    const receipts = (await readFile(record, 'utf8')).trim().split('\n').map(JSON.parse);
    const raw = receipts.find(row => row.kind === 'response' && JSON.parse(row.body.raw).id === 'obs');
    assert.equal(JSON.parse(raw.body.raw).result.elements.length, 80);
    assert.equal(JSON.parse(raw.body.raw).result.elements[6].text, 'Edit');
    const fragmentedRaw = receipts.find(row => row.kind === 'response' && JSON.parse(row.body.raw).id === '片段-utf8');
    const expectedFragmented = { id: '片段-utf8', ok: true, result: { observation_id: 'unicode', count: 2, truncated: false,
      elements: [{ text: 'Keep target', element_id: 'keep' }, { text: '中文🙂'.repeat(20000), element_id: 'large' }] } };
    assert.deepEqual(Buffer.from(fragmentedRaw.body.raw, 'utf8'), Buffer.from(' \t' + JSON.stringify(expectedFragmented) + '  ', 'utf8'));
    assert.equal(receipts.filter(row => row.kind === 'request' && JSON.parse(row.body.raw).id === '片段-utf8').length, 1);
    assert.equal(receipts.filter(row => row.kind === 'request' && JSON.parse(row.body.raw).id === 'obs').length, 1);
    assert.equal(receipts.filter(row => row.kind === 'request' && JSON.parse(row.body.raw).id === 'invalid').length, 0);
    assert.equal(receipts.filter(row => row.kind === 'request' && JSON.parse(row.body.raw).id === 'invalid-unicode').length, 0);
    assert.equal(receipts.filter(row => row.kind === 'inspect').length, 4);
    assert.equal(receipts.find(row => row.kind === 'invalid_response').body.raw_base64, '/wo=');

    const before = await readFile(record, 'utf8');
    const refused = spawnSync(python, [helper, '--command', python, '--command-arg', mock, '--record', record], { encoding: 'utf8' });
    assert.equal(refused.status, 1);
    assert.equal(JSON.parse(refused.stdout).transport_error.code, 'RECORD_OPEN_FAILED');
    assert.equal(await readFile(record, 'utf8'), before);
  } finally {
    if (child.exitCode === null) child.kill();
    await rm(record, { force: true });
    await rm(mock, { force: true });
    await rm(copiedHelper, { force: true });
    await rmdir(copiedTools);
    await rmdir(join(folder, 'standalone skill with spaces'));
    await rmdir(folder);
  }
});

test('receipt write failure cannot block cancellation or closing', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'deskpilot-record-failure-'));
  const mock = join(folder, 'mock-cli.py');
  await writeFile(mock, fixture);
  const bootstrap = `
import importlib.util, sys
spec = importlib.util.spec_from_file_location('observe_view', sys.argv[1])
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
class FailingRecord:
    def __init__(self): self.writes = 0
    def write(self, value):
        self.writes += 1
        if self.writes > 1: raise OSError('injected failure')
    def flush(self): pass
    def close(self): pass
module.open = lambda *args, **kwargs: FailingRecord()
raise SystemExit(module.run([sys.executable, sys.argv[2]], 'receipt'))
`;
  const child = spawn(python, ['-u', '-c', bootstrap, helper, mock], { stdio: ['pipe', 'pipe', 'pipe'] });
  let errors = '';
  child.stderr.on('data', data => { errors += data; });
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  const send = value => child.stdin.write(JSON.stringify(value) + '\n');
  try {
    assert.equal((await nextLine(lines)).transport, 'ready');
    send({ id: 'obs', method: 'android.observe', params: {} });
    const observation = await nextLine(lines);
    assert.equal(observation.ok, true);
    assert.equal(observation.record_error.code, 'RECORD_WRITE_FAILED');
    send({ id: 'blocked', method: 'ui.click', params: {} });
    assert.equal((await nextLine(lines)).transport_error.outcome, 'not_dispatched');
    send({ id: 'cancel', method: 'interaction.cancel', params: {} });
    const cancelled = await nextLine(lines);
    assert.equal(cancelled.result.method, 'interaction.cancel');
    assert.equal(cancelled.record_error.code, 'RECORD_WRITE_FAILED');
    send({ id: 'close', method: 'close', params: {} });
    assert.equal((await nextLine(lines)).result.status, 'closed');
    const [code] = await once(child, 'exit');
    assert.equal(code, 0, errors);
  } finally {
    if (child.exitCode === null) child.kill();
    await rm(mock, { force: true });
    await rmdir(folder);
  }
});
