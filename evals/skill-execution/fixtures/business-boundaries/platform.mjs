const clone = value => structuredClone(value);
const rejected = code => Object.assign(new Error(code), { code });

export function makeRows(count = 40000, departments = 4) {
  if (!Number.isSafeInteger(count) || count < 1 || !Number.isSafeInteger(departments) || departments < 1) {
    throw rejected('invalid_fixture_input');
  }
  return Array.from({ length: count }, (_, index) => ({
    id: String(index + 1),
    department: `department-${index % departments + 1}`,
    description: 'inspection material '.repeat(8),
  }));
}

export function createFilePlatform() {
  const calls = [];
  const limits = { maximumSourceRows: 500, maximumParsedBytes: 32768 };
  const batches = new Map([['accepted-original', { batchId: 'accepted-original', state: 'Succeeded', completedRows: 100 }]]);
  let sequence = 0;
  return {
    calls,
    capabilities() {
      calls.push({ operation: 'capabilities' });
      return { ...limits, protocols: ['coordinated-v1'], userSteps: ['upload', 'confirm'] };
    },
    template() {
      calls.push({ operation: 'template' });
      return { columns: ['id', 'department', 'description'] };
    },
    preview(rows) {
      const parsedBytes = Buffer.byteLength(JSON.stringify(rows));
      calls.push({ operation: 'preview', rowCount: rows.length, parsedBytes });
      if (!rows.length || rows.length > limits.maximumSourceRows) throw rejected('source_row_limit');
      if (parsedBytes > limits.maximumParsedBytes) throw rejected('parsed_payload_limit');
      const batch = { batchId: `preview-${++sequence}`, state: 'ready', rowCount: rows.length };
      batches.set(batch.batchId, batch);
      return clone(batch);
    },
    getBatch(batchId) {
      calls.push({ operation: 'getBatch', batchId });
      if (!batches.has(batchId)) throw rejected('batch_not_found');
      return clone(batches.get(batchId));
    },
    execute(batchId) {
      calls.push({ operation: 'execute', batchId });
      throw rejected('import_not_authorized');
    },
  };
}

export function createQueryPlatform() {
  const calls = [];
  const context = { actor: 'fixture-member', scope: 'own' };
  return {
    calls,
    async workOrders(status) {
      calls.push({ operation: 'workOrders', arguments: { status }, ...context });
      if (status !== 'open') throw rejected('unsupported_status');
      return { records: [], totalCount: 0, hasMore: false, ...context };
    },
    async parts(equipmentId) {
      calls.push({ operation: 'parts', arguments: { equipmentId }, ...context });
      if (!equipmentId) throw rejected('equipment_required');
      if (equipmentId !== 'equipment-a') throw rejected('equipment_not_visible');
      return { records: [], totalCount: 0, hasMore: false, ...context };
    },
  };
}
