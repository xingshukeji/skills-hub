import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { CliError, isObject } from './core.mjs';
import { memberTarget, memberValue } from './member-target.mjs';

// The application owns Excel parsing, quotation execution and assertions.
// CLI transports files and cases; it never implements quotation arithmetic.
export async function anbangCommands(ctx) {
  const { args, reporter } = ctx, action = args.command(2);
  const controller = new AbortController(), interrupt = () => controller.abort();
  process.once('SIGINT', interrupt);
  try {
    const target = await memberTarget(ctx, 'workforce', { signal: controller.signal });
    const call = async (name, input = {}) => memberValue(await target.send('POST', '/api/anbang-sales/admin/verification/' + name, { json: input }));
    await call('context');
    let cases;
    if (action === 'defaults') {
      cases = await call('default');
      if (typeof cases.contentBase64 !== 'string') throw new CliError('Invalid default workbook receipt.', { code: 'invalid_response' });
      const bytes = Buffer.from(cases.contentBase64, 'base64');
      if (createHash('sha256').update(bytes).digest('hex') !== cases.digest) throw new CliError('Default workbook digest mismatch.', { code: 'invalid_response' });
      await writeFile(args.required('out'), bytes, { flag: 'wx' });
      reporter.print({ out: args.value('out'), digest: cases.digest, count: cases.rows?.length, tenantId: target.identity.tenantId }); return 0;
    }
    if (args.has('cases')) {
      const bytes = await readFile(args.value('cases'));
      cases = await call('open', { contentBase64: bytes.toString('base64') });
      if (cases.digest !== createHash('sha256').update(bytes).digest('hex')) throw new CliError('Workbook digest mismatch.', { code: 'invalid_response' });
    } else cases = await call('default');
    if (!Array.isArray(cases.rows) || !Array.isArray(cases.errors)) throw new CliError('Invalid workbook receipt.', { code: 'invalid_response' });
    const wanted = args.value('case')?.split(',').map(s => s.trim());
    if (wanted?.some(id => !cases.rows.some(row => row.id === id))) throw new CliError('One or more selected case IDs were not found.', { code: 'case_not_found' });
    const rows = cases.rows.filter(row => row.enabled !== '否' && (!wanted || wanted.includes(row.id))), results = [];
    let authorizationFailed = false;
    for (const row of rows) {
      if (controller.signal.aborted) break;
      if (cases.errors.some(error => error.caseId === row.id)) { results.push({ id: row.id, name: row.name, status: 'invalid', errors: cases.errors.filter(error => error.caseId === row.id) }); continue; }
      try {
        const result = await call('run', { row });
        if (!isObject(result) || result.id !== row.id || !['passed', 'different', 'unverified', 'failed', 'invalid'].includes(result.status)) throw new CliError('The quotation receipt does not match the case.', { code: 'invalid_response' });
        results.push(result);
      } catch (error) {
        results.push({ id: row.id, name: row.name, status: 'failed', error: { code: error.code, message: error.message, httpStatus: error.httpStatus, serverCode: error.serverCode } });
        if ([401, 403].includes(error.httpStatus)) authorizationFailed = true;
        if (controller.signal.aborted || authorizationFailed) break;
      }
    }
    let out, reportError;
    if (args.has('out') && !controller.signal.aborted && !authorizationFailed) {
      try {
        const exported = await call('export', { rows, results });
        const bytes = Buffer.from(exported.contentBase64, 'base64');
        if (createHash('sha256').update(bytes).digest('hex') !== exported.digest) throw new CliError('Report digest mismatch.', { code: 'invalid_response' });
        await writeFile(args.value('out'), bytes, { flag: 'wx' }); out = args.value('out');
      } catch (error) { reportError = { code: error.code, message: error.message, httpStatus: error.httpStatus, serverCode: error.serverCode }; }
    }
    const summary = Object.fromEntries(['passed', 'different', 'unverified', 'failed', 'invalid'].map(status => [status, results.filter(row => row.status === status).length]));
    const passedAll = rows.length > 0 && results.length === rows.length && results.every(row => row.status === 'passed');
    reporter.print({ tenantId: target.identity.tenantId, userId: target.identity.userId, applicationId: target.appId,
      digest: cases.digest, selected: rows.length, completed: results.length, passedAll, summary, results, ...(out ? { out } : {}), ...(reportError ? { reportError } : {}) });
    return controller.signal.aborted ? 130 : passedAll && !reportError ? 0 : 1;
  } finally { process.removeListener('SIGINT', interrupt); }
}
