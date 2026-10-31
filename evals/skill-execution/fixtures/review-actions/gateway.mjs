export class Gateway {
  constructor() { this.sources = new Set(['source-a']); this.destinations = new Set(['source-a', 'starter', 'lead']); this.messages = []; }
  assertSource(item) { if (!this.sources.has(item.source)) throw new Error('source unavailable'); }
  post(destination, body) {
    if (!this.destinations.has(destination)) throw new Error('cannot post');
    const message = { destination, body };
    this.messages.push(message);
    return message;
  }
}
