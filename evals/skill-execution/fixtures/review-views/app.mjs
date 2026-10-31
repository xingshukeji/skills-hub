export { readList as list, readDetail as detail } from './readers.mjs';
export function saveView(view, title) { return { ...structuredClone(view), title }; }
export const records = [{ id: 'row-1', owner: 'member-a', values: { title: 'sample', amount: 10, contact: 'person-1', confidential: 'restricted sample' } }];
export function member(fields = ['title', 'contact'], objects = ['people']) { return { id: 'member-a', fields: new Set(fields), objects: new Set(objects) }; }
