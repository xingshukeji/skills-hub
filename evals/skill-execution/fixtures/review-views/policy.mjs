export const schema = {
  title: { kind: 'text' },
  amount: { kind: 'number' },
  contact: { kind: 'relation', target: 'people' },
  confidential: { kind: 'text' }
};
export function canReadField(actor, key) {
  const field = schema[key];
  if (!field || !['text', 'number'].includes(field.kind)) return false;
  if (!actor.fields.has(key)) return false;
  return !field.target || actor.objects.has(field.target);
}
export function assertRecord(actor, record) {
  if (!record || record.owner !== actor.id) throw new Error('record denied');
}
