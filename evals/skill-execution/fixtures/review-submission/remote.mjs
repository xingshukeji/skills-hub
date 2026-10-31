export class Remote {
  constructor({ immediate = false } = {}) { this.immediate = immediate; this.pending = new Map(); this.results = new Map(); this.withdrawn = new Set(); this.installed = []; }
  async submit(requestId, body) {
    if (this.withdrawn.has(requestId)) return { status: 'withdrawn' };
    if (this.results.has(requestId)) return this.results.get(requestId);
    this.pending.set(requestId, structuredClone(body));
    if (this.immediate) { this.deliver(); return this.results.get(requestId); }
    throw new Error('response timeout');
  }
  async lookup(requestId) { return this.results.get(requestId) ?? { status: 'not-found' }; }
  async withdraw(requestId) {
    if (this.results.has(requestId)) return this.results.get(requestId);
    this.withdrawn.add(requestId);
    this.pending.delete(requestId);
    return { status: 'withdrawn' };
  }
  deliver() {
    for (const [id, body] of this.pending) {
      if (!this.withdrawn.has(id)) { this.installed.push(body); this.results.set(id, { status: 'completed', id }); }
      this.pending.delete(id);
    }
  }
}
