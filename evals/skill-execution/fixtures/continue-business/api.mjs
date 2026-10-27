export function createApi({ writable = true } = {}) {
  const rows = new Map([['customer-a', { id: 'customer-a', name: '示例客户', company: '示例公司', phone: '100' }]]);
  return {
    async get(id) { const row = rows.get(id); if (!row) throw new Error('not found'); return { ...row }; },
    async update(id, patch) {
      if (!writable) throw new Error('forbidden');
      if (Object.keys(patch).some(key => key !== 'phone')) throw new Error('unexpected field');
      const row = rows.get(id); if (!row) throw new Error('not found');
      rows.set(id, { ...row, phone: patch.phone.trim() }); return { id };
    }
  };
}
