export class ContactsPage {
  constructor(api) { this.api = api; this.record = null; this.draftPhone = ''; this.dirty = false; this.error = null; }
  async open(id) { this.record = await this.api.get(id); this.draftPhone = this.record.phone; this.dirty = false; this.error = null; }
  editPhone(value) { this.draftPhone = value; this.dirty = value !== this.record.phone; }
  async save() { throw new Error('not implemented'); }
}
