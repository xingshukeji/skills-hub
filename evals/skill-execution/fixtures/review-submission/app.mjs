export class Submission {
  constructor(remote) { this.remote = remote; this.requestId = null; this.state = 'idle'; }
  async start(requestId, body) {
    this.requestId = requestId;
    try { const result = await this.remote.submit(requestId, body); this.state = result.status; return result; }
    catch { this.state = 'unknown'; return { status: 'unknown' }; }
  }
  async cancel() {
    const result = await this.remote.lookup(this.requestId);
    if (result.status === 'completed') { this.state = 'completed'; return result; }
    this.requestId = null;
    this.state = 'cancelled';
    return { status: this.state };
  }
}
