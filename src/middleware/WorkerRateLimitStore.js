class WorkerRateLimitStore {
  constructor() {
    this.localKeys = true;
    this.windowMs = 0;
    this.nextCleanupAt = 0;
    this.clients = new Map();
  }

  init(options) {
    this.windowMs = options.windowMs;
  }

  get(key) {
    const client = this.clients.get(key);
    if (!client || client.resetTime.getTime() <= Date.now()) return undefined;
    return client;
  }

  increment(key) {
    const now = Date.now();
    if (now >= this.nextCleanupAt) {
      for (const [clientKey, client] of this.clients) {
        if (client.resetTime.getTime() <= now) this.clients.delete(clientKey);
      }
      this.nextCleanupAt = now + Math.min(this.windowMs, 60_000);
    }

    let client = this.clients.get(key);
    if (!client || client.resetTime.getTime() <= now) {
      client = { totalHits: 0, resetTime: new Date(now + this.windowMs) };
    }

    client.totalHits += 1;
    this.clients.set(key, client);
    return client;
  }

  decrement(key) {
    const client = this.clients.get(key);
    if (client && client.totalHits > 0) client.totalHits -= 1;
  }

  resetKey(key) {
    this.clients.delete(key);
  }

  resetAll() {
    this.clients.clear();
  }
}

module.exports = WorkerRateLimitStore;