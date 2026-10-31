import { CliError, isObject, readJsonInput, segment } from './core.mjs';
import { api, apiValue } from './http.mjs';
import { exportRecordsFile } from './data-import.mjs';

const queryActions = { export: 'export', count: 'count', distinct: 'distinct', single: 'single', 'single-or-default': 'singleOrDefault', first: 'first', 'first-or-default': 'firstOrDefault' };
const batchActions = { 'batch-create': ['batchCreate', 'records'], 'batch-update': ['batchUpdate', 'records'], 'batch-delete': ['batchDelete', 'recordIds'] };

async function input(args) {
  const value = await readJsonInput(args.required('request-json', args.value('file')), 'Request JSON');
  if (!isObject(value)) throw new CliError('Request JSON must be an object.', { code: 'invalid_arguments' });
  return value;
}
function page(args, search = false) {
  const query = new URLSearchParams({ page: String(args.integer('page', 1)), pageSize: String(args.integer('page-size', 25)) });
  if (search && args.has('search')) query.set('search', args.value('search'));
  return '?' + query;
}

export async function dataOperations(ctx) {
  const { args, reporter } = ctx, action = args.command(1);
  if (action === 'capabilities') { await api(ctx, 'GET', '/api/data/v1/query-capabilities'); return true; }
  if (action === 'query-batch') {
    const body = await input(args);
    if (!Array.isArray(body.queries) || !body.queries.length || body.queries.some(item => !isObject(item) || typeof item.entityCode !== 'string' || !isObject(item.query)))
      throw new CliError('queries must contain entityCode and query objects.', { code: 'invalid_arguments' });
    await api(ctx, 'POST', '/api/data/v1/records:queryBatch', body); return true;
  }
  if (!Object.hasOwn(queryActions, action) && !Object.hasOwn(batchActions, action) &&
      !['field-options', 'original-values', 'history', 'owner-transfer', 'share', 'export-file', 'export-capabilities'].includes(action)) return false;
  const entityCode = args.required('entity'), root = `/api/data/v1/entities/${segment(entityCode)}`, records = `${root}/records`;
  if (action === 'export-file') { await exportRecordsFile(ctx); return true; }
  if (action === 'export-capabilities') { await api(ctx, 'GET', `${root}/exports/capabilities`); return true; }
  if (Object.hasOwn(queryActions, action)) { await api(ctx, 'POST', `${records}:${queryActions[action]}`, await input(args)); return true; }
  if (Object.hasOwn(batchActions, action)) {
    const [suffix, key] = batchActions[action], body = await input(args);
    if (!Array.isArray(body[key]) || !body[key].length || body.allOrNone !== undefined && typeof body.allOrNone !== 'boolean')
      throw new CliError(`Supply a nonempty ${key} array and optional boolean allOrNone.`, { code: 'invalid_arguments' });
    const recordIds = key === 'recordIds' ? body.recordIds : action === 'batch-update' ? body.records.map(item => item?.recordId) : undefined;
    if (recordIds?.some(id => typeof id !== 'string' || !id)) throw new CliError('Each record ID must be a nonempty string.', { code: 'invalid_arguments' });
    const value = await apiValue(ctx, 'POST', `${records}:${suffix}`, body, { mutation: {
      entityCode, recordCount: body[key].length, ...(recordIds ? { recordIds } : {}), readback: ['data', 'query', entityCode],
    } });
    if (isObject(value) && Array.isArray(value.results) && value.results.some(item => item?.success === false))
      throw new CliError('One or more collection items failed. Inspect each result before another write.', { code: 'collection_failed', details: { entityCode, result: value } });
    reporter.print(value); return true;
  }
  if (action === 'field-options') { await api(ctx, 'GET', `${root}/fields/${segment(args.required('field'))}/options${page(args, true)}`); return true; }
  const recordId = args.required('id'), record = `${records}/${segment(recordId)}`;
  const recovery = { mutation: { entityCode, recordId, readback: ['data', 'get', entityCode, recordId] } };
  if (action === 'history') { await api(ctx, 'GET', `${record}/history${page(args)}`); return true; }
  if (action === 'original-values') {
    const fields = args.required('fields').split(',').map(field => field.trim()).filter(Boolean);
    if (!fields.length) throw new CliError('--fields must name at least one field.', { code: 'invalid_arguments' });
    await api(ctx, 'POST', `${record}/original-values`, { fields }); return true;
  }
  if (action === 'owner-transfer') { await api(ctx, 'POST', `${record}:transferOwner`, await input(args), recovery); return true; }
  const sub = args.command(2), shares = `${record}/shares`;
  if (sub === 'list' || sub === 'recipients') await api(ctx, 'GET', shares + (sub === 'list' ? page(args) : `/recipients${page(args, true)}`));
  else if (sub === 'capability') await api(ctx, 'GET', shares + '/capability');
  else if (sub === 'eligibility') await api(ctx, 'GET', shares + '/eligibility?' + new URLSearchParams({ userId: args.required('user-id') }));
  else {
    const path = sub === 'grant' ? shares : `${shares}/${segment(args.required('share-id'))}`;
    await api(ctx, sub === 'grant' ? 'POST' : sub === 'update' ? 'PATCH' : 'DELETE', path, sub === 'revoke' ? undefined : await input(args), {
      mutation: { entityCode, recordId, ...(args.has('share-id') ? { shareId: args.value('share-id') } : {}), readback: ['data', 'share', 'list', entityCode, recordId] },
    });
  }
  return true;
}
