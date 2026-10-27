export class CustomerEditor {
  constructor(repository) { this.repository = repository; this.current = null; this.dirty = false; this.route = 'list'; }
  open(customer) { this.current = { ...customer }; this.dirty = false; this.route = 'edit'; }
  editPhone(phone) { this.current.phone = phone; this.dirty = true; }
  async save() {
    const saved = await this.repository.save({ ...this.current });
    this.current = saved;
    this.dirty = false;
    this.route = 'detail';
  }
  confirmLeaveAndOpen(customer) { this.open(customer); }
}
