export function createRepository() {
  const grants = new Map();
  const revisions = new Map();
  const records = new Map();
  const receipts = new Map();
  const key = scope => `${scope.tenantId}:${scope.actorId}`;
  const error = code => Object.assign(new Error(code), { code });
  const copy = value => structuredClone(value);
  let failAt = -1;
  let loseResponse = false;
  let beforeCommit;
  function authorize(scope, operation) {
    if (!grants.get(key(scope))?.[operation]) throw error('forbidden');
  }
  return {
    grant(scope, rights = { read: true, write: true }) { grants.set(key(scope), { ...rights }); },
    revoke(scope) { grants.delete(key(scope)); },
    authorize,
    revision(scope) { return revisions.get(scope.tenantId) ?? 1; },
    changeRevision(scope) { revisions.set(scope.tenantId, this.revision(scope) + 1); },
    failNextAt(index) { failAt = index; },
    loseNextResponse() { loseResponse = true; },
    waitBeforeCommit(callback) { beforeCommit = callback; },
    read(scope) { authorize(scope, 'read'); return copy([...records.get(scope.tenantId)?.values() ?? []]); },
    async commitAtomic(scope, plan, signal) {
      signal?.throwIfAborted();
      await beforeCommit?.();
      signal?.throwIfAborted();
      authorize(scope, 'write');
      const receiptKey = `${key(scope)}:${plan.id}`;
      if (receipts.has(receiptKey)) return copy(receipts.get(receiptKey));
      if (this.revision(scope) !== plan.revision) throw error('stale');
      const next = new Map(records.get(scope.tenantId));
      try {
        for (let index = 0; index < plan.rows.length; index++) {
          if (index === failAt) throw error('save_failed');
          const row = plan.rows[index];
          if (next.has(row.code)) throw error('conflict');
          next.set(row.code, copy(row));
        }
      } finally { failAt = -1; }
      const receipt = { id: receiptKey, created: plan.rows.length };
      records.set(scope.tenantId, next);
      receipts.set(receiptKey, receipt);
      if (loseResponse) { loseResponse = false; throw error('ack_lost'); }
      return copy(receipt);
    }
  };
}
