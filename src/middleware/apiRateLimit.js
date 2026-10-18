const REQUESTS_PER_SECOND = 20;
const BURST = 50;
// Bounds retained IP state to about 10 MB at roughly 320 bytes per entry.
const MAX_CLIENTS = 32_768;
const CLEANUP_INTERVAL_MS = 1_000;

function createApiRateLimiter({
  requestsPerSecond = REQUESTS_PER_SECOND,
  burst = BURST,
  maxClients = MAX_CLIENTS,
  now = Date.now,
} = {}) {
  if (
    !Number.isFinite(requestsPerSecond) ||
    requestsPerSecond <= 0 ||
    !Number.isFinite(burst) ||
    burst <= 0 ||
    !Number.isInteger(maxClients) ||
    maxClients <= 0 ||
    typeof now !== "function"
  ) {
    throw new TypeError("Invalid API rate limiter configuration");
  }

  const clients = new Map();
  const burstWindowMs = (burst / requestsPerSecond) * 1_000;
  let nextCleanupAt = 0;

  function storeClient(key, client) {
    clients.delete(key);
    if (!clients.has(key) && clients.size >= maxClients) {
      const oldestKey = clients.keys().next().value;
      if (oldestKey !== undefined) clients.delete(oldestKey);
    }
    clients.set(key, client);
  }

  return function apiRateLimiter(req, res, next) {
    const timestamp = now();

    if (timestamp >= nextCleanupAt) {
      for (const [key, client] of clients) {
        if (timestamp - client.lastRequestAt >= burstWindowMs) {
          clients.delete(key);
        }
      }
      nextCleanupAt = timestamp + CLEANUP_INTERVAL_MS;
    }

    const key = req.ip;
    const previous = clients.get(key);
    const leaked = previous
      ? Math.max(
          0,
          previous.excess -
            (Math.max(0, timestamp - previous.lastRequestAt) *
              requestsPerSecond) /
              1_000
        )
      : 0;

    if (leaked >= burst) {
      storeClient(key, { excess: leaked, lastRequestAt: timestamp });
      res.set("Retry-After", "1");
      return res.status(429).json({ error: "Too many requests. Please try again later." });
    }

    storeClient(key, { excess: leaked + 1, lastRequestAt: timestamp });
    return next();
  };
}

module.exports = createApiRateLimiter;
