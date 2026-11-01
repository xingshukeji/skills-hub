import { createHash } from 'node:crypto';

const fail = code => { throw Object.assign(new Error(code), { code }); };
const cloneJson = value => JSON.parse(JSON.stringify(value));

function checkValues(value, limit) {
  if (typeof value === 'string' && !value.isWellFormed()) fail('invalid');
  if (typeof value === 'string' && value.length > limit) fail('too_large');
  if (value && typeof value === 'object') for (const item of Object.values(value)) checkValues(item, limit);
}

export function createImporter(repository) {
  const plans = new Map();
  let sequence = 0;
  return {
    prepare(rows, scope, { maxValueBytes = 1024 } = {}) {
      repository.authorize(scope, 'read');
      if (!Array.isArray(rows) || rows.length === 0) fail('empty');
      const snapshot = rows;
      const codes = new Set();
      for (const row of snapshot) {
        if (!row || typeof row.code !== 'string' || !row.code || !row.values || typeof row.values !== 'object' || Array.isArray(row.values)) fail('invalid');
        if (codes.has(row.code)) fail('duplicate');
        codes.add(row.code);
        checkValues(row.values, maxValueBytes);
      }
      const digest = createHash('sha256').update(JSON.stringify(snapshot), 'utf8').digest('hex');
      const id = `plan-${++sequence}`;
      plans.set(id, { id, rows: snapshot, digest, scope: { ...scope }, revision: repository.revision(scope) });
      return { id, digest, rows: snapshot.length };
    },
    async commit(token, scope, { signal } = {}) {
      const plan = plans.get(token.id);
      if (!plan || plan.digest !== token.digest) fail('missing_plan');

      return repository.commitAtomic(scope, plan, signal);
    }
  };
}
