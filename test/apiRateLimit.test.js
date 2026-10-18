const assert = require("node:assert/strict");
const test = require("node:test");
const createApiRateLimiter = require("../src/middleware/apiRateLimit");

function runRequest(limiter, ip) {
  const response = {
    headers: {},
    set(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  let continued = false;

  limiter({ ip }, response, () => {
    continued = true;
  });

  return { response, continued };
}

test("allows the configured burst, then rejects until requests leak out", () => {
  let timestamp = 1_000;
  const limiter = createApiRateLimiter({ now: () => timestamp });

  for (let request = 0; request < 50; request += 1) {
    assert.equal(runRequest(limiter, "192.0.2.1").continued, true);
  }

  const limited = runRequest(limiter, "192.0.2.1");
  assert.equal(limited.response.statusCode, 429);
  assert.equal(limited.response.headers["Retry-After"], "1");

  timestamp += 50;
  assert.equal(runRequest(limiter, "192.0.2.1").continued, true);
});

test("tracks each client IP separately", () => {
  let timestamp = 2_000;
  const limiter = createApiRateLimiter({ now: () => timestamp });

  for (let request = 0; request < 50; request += 1) {
    runRequest(limiter, "192.0.2.1");
  }

  assert.equal(runRequest(limiter, "192.0.2.2").continued, true);
  assert.equal(runRequest(limiter, "192.0.2.1").response.statusCode, 429);

  timestamp += 2_500;
  assert.equal(runRequest(limiter, "192.0.2.1").continued, true);
});

test("rejects invalid limiter configuration", () => {
  assert.throws(() => createApiRateLimiter({ requestsPerSecond: 0 }), TypeError);
  assert.throws(() => createApiRateLimiter({ burst: 0 }), TypeError);
  assert.throws(() => createApiRateLimiter({ maxClients: 0 }), TypeError);
});

test("bounds retained client state and evicts the least recently used IP", () => {
  const limiter = createApiRateLimiter({ maxClients: 1, now: () => 3_000 });

  for (let request = 0; request < 50; request += 1) {
    runRequest(limiter, "192.0.2.1");
  }
  runRequest(limiter, "192.0.2.2");

  assert.equal(runRequest(limiter, "192.0.2.1").continued, true);
});
