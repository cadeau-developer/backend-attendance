const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
require("express-async-errors"); // makes rejected promises in route handlers reach the error middleware instead of crashing the process

const authRoutes = require("./routes/auth");
const adminRoutes = require("./routes/admin");
const teacherRoutes = require("./routes/teachers");
const classRoutes = require("./routes/classes");
const studentRoutes = require("./routes/students");
const schoolRoutes = require("./routes/schools");
const attendanceRoutes = require("./routes/attendance");
const disciplineRoutes = require("./routes/discipline");
const dashboardRoutes = require("./routes/dashboard");
const offDayRoutes = require("./routes/offdays");
const termRoutes = require("./routes/terms");
const yearRoutes = require("./routes/years");
const recordRoutes = require("./routes/records");
const settingRoutes = require("./routes/settings");

function createApp({ jsonParser, rateLimitStore, apiRateLimiter } = {}) {
  const app = express();

  // Render (and most PaaS hosts) terminate TLS at a proxy. Trusting the proxy
  // makes req.ip / rate limiting see the real client address.
  app.set("trust proxy", 1);

  // Security headers. crossOriginResourcePolicy is relaxed so browser clients
  // served from another origin can still read API responses.
  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));

  // --- CORS ---
  // Browser clients (Expo web / admin dashboards) must be explicitly listed in
  // CORS_ORIGINS. Native mobile apps (iOS/Android) do NOT send an Origin header,
  // so those requests are always allowed. This is the "mobile client type" path:
  // without it, a strict allowlist would silently break the mobile app.
  const configuredOrigins = (process.env.CORS_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  const defaultDevOrigins = [
    "http://localhost:8081",
    "http://127.0.0.1:8081",
    "http://localhost:19006",
    "http://127.0.0.1:19006",
  ];

  const allowedOrigins = configuredOrigins.length
    ? configuredOrigins
    : defaultDevOrigins;

  // Local development origins: the Expo web dev server picks whatever free port
  // it finds (8081, 8082, ...), so any loopback or private-LAN origin is allowed.
  // This is safe in production too: a remote browser can never forge an Origin of
  // localhost or a private IP.
  function isLocalOrigin(origin) {
    try {
      const { hostname } = new URL(origin);
      return (
        hostname === "localhost" ||
        hostname === "127.0.0.1" ||
        hostname === "::1" ||
        hostname.endsWith(".local") ||
        /^10\./.test(hostname) ||
        /^192\.168\./.test(hostname) ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
      );
    } catch {
      return false;
    }
  }

  const corsOptions = {
    origin(origin, callback) {
      // No Origin header => native mobile app or server-to-server call.
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin) || allowedOrigins.includes("*")) {
        return callback(null, true);
      }
      if (isLocalOrigin(origin)) return callback(null, true);
      // Disallowed browser origin: respond without CORS headers (browser blocks).
      return callback(null, false);
    },
    allowedHeaders: ["Content-Type", "Authorization", "X-Client-Type"],
    exposedHeaders: ["Content-Length"],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  };

  app.use(cors(corsOptions));
  if (apiRateLimiter) app.use(apiRateLimiter);
  app.use(jsonParser || express.json({ limit: "10mb" }));

  app.get("/health", (req, res) => res.json({ ok: true }));

  // Throttle credential endpoints to slow down brute-force attempts.
  const authLimiter = rateLimit({
    windowMs: Number(process.env.AUTH_RATE_WINDOW_MS) || 15 * 60 * 1000,
    max: Number(process.env.AUTH_RATE_MAX) || 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many attempts. Please try again later." },
    store: rateLimitStore,
  });

  app.use("/auth", authLimiter, authRoutes);
  app.use("/admin", adminRoutes);
  app.use("/settings", settingRoutes); // readable by any signed-in user, so mount before the root student router's approval gate
  app.use("/teachers", teacherRoutes);
  app.use("/classes", classRoutes);
  app.use("/", studentRoutes); // exposes /classes/:classId/students and /students...
  app.use("/schools", schoolRoutes);
  app.use("/attendance", attendanceRoutes);
  app.use("/discipline-cases", disciplineRoutes);
  app.use("/dashboard", dashboardRoutes);
  app.use("/off-days", offDayRoutes);
  app.use("/terms", termRoutes);
  app.use("/years", yearRoutes);
  app.use("/records", recordRoutes);

  app.use((req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}

module.exports = createApp;
