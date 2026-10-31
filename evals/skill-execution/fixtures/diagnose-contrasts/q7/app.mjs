let item = { id: 'item-a', label: 'before', category: 'sample' };
export function saveLabel(value) {
  item = { ...item, label: value.trim() };
  return { ...item };
}
export function readItem() { return { ...item }; }
