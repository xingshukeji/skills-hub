let item = { id: 'item-a', label: 'before', category: 'sample' };
export function saveLabel(value) {
  item = { ...item, label: value };
  return { ...item };
}
export function readItem() { return { ...item }; }
