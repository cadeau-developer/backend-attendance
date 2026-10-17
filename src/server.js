require("dotenv").config();
const createApp = require("./app");
const app = createApp();

const isProduction = process.env.NODE_ENV === "production";

// Fail fast on a misconfigured deployment instead of booting a broken API.
const requiredEnv = ["DATABASE_URL", "JWT_SECRET"];
const missingEnv = requiredEnv.filter((key) => !process.env[key]);
if (missingEnv.length) {
  console.error(`Missing required environment variables: ${missingEnv.join(", ")}`);
  process.exit(1);
}

if (process.env.JWT_SECRET.length < 32) {
  console.error("JWT_SECRET must be at least 32 characters");
  process.exit(1);
}

const port = process.env.PORT || 4000;

const server = app.listen(port, () => {
  console.log(
    `Attendance API listening on port ${port}${isProduction ? " (production)" : ""}`
  );
});

// Render sends SIGTERM on deploy/restart. Stop accepting new connections, let
// in-flight requests finish, then exit so the platform can roll a new release.
function shutdown(signal) {
  console.log(`${signal} received, shutting down gracefully`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
}

["SIGTERM", "SIGINT"].forEach((signal) => {
  process.on(signal, () => shutdown(signal));
});
