export class BindingIndex {
  constructor(storage) { this.storage = storage; this.entries = JSON.parse(storage.read()); }
  list() { return this.entries; }
  save(binding) {
    const next = [...this.entries.filter(row => row.id !== binding.id), binding];
    this.storage.write(JSON.stringify(next));
    this.entries.splice(0, this.entries.length, ...next);
    return binding;
  }
}

export function mergeHistory(current, page) {
  if (!current.length) return page;
  const before = Math.min(...current.map(row => row.seq));
  return [...page.filter(row => row.seq < before), ...current];
}

export class SubscriptionHub {
  constructor(authorize = async () => true) { this.authorize = authorize; }
  connect(user) { return { user, subscriptions: new Set() }; }
  async subscribe(client, channels) {
    if (channels.length > 2) throw new Error('batch_limit');
    if (new Set([...client.subscriptions, ...channels]).size > 2) throw new Error('subscription_limit');
    if (!await this.authorize(client.user, channels)) throw new Error('access_denied');
    for (const channel of channels) client.subscriptions.add(channel);
  }
}

export function createSessionView(channels, transport) {
  return {
    connected: false, messages: [],
    async open() {
      this.connected = true;
      try { await transport.subscribe(channels); }
      catch (error) { this.receive({ type: 'error', code: error.message }); }
    },
    receive(frame) { if (frame.type === 'events') this.messages.push(...frame.items); },
  };
}

export class PermissionStore {
  constructor(now = Date.now) { this.now = now; this.values = new Map(); this.activeScopes = new Map(); }
  enter(id, scope) { this.activeScopes.set(id, scope); this.refresh(); }
  leave(id) { this.activeScopes.delete(id); this.values.delete(id); }
  refresh() {
    for (const [id, scope] of this.activeScopes) this.values.set(id, { scope, expires: this.now() + 10 });
  }
  read(id) {
    const value = this.values.get(id);
    if (!value || value.expires <= this.now()) throw new Error('permission_cache_not_ready');
    return value.scope;
  }
}
