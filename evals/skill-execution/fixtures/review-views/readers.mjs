import { assertRecord, canReadField } from './policy.mjs';
export function readList(actor, view, records) {
  if (view.condition && !canReadField(actor, view.condition.field)) throw new Error('condition denied');
  return records.filter(row => row.owner === actor.id)
    .filter(row => !view.condition || row.values[view.condition.field] === view.condition.value)
    .map(row => ({ id: row.id, values: Object.fromEntries(view.columns.filter(key => canReadField(actor, key)).map(key => [key, row.values[key]])) }));
}
export function readDetail(actor, id, records) {
  const record = records.find(row => row.id === id);
  assertRecord(actor, record);
  return structuredClone(record);
}
