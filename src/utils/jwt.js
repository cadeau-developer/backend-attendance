const jwt = require("jsonwebtoken");

const ALGORITHM = "HS256";
const ISSUER = process.env.JWT_ISSUER || "cahier-app";
const AUDIENCE = process.env.JWT_AUDIENCE || "cahier-app-clients";
// Access tokens are short-lived (minimum 7 days) and are renewed with the
// long-lived refresh token stored by the client.
const EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "JWT_SECRET is missing or too short (min 32 chars). Set a strong JWT_SECRET in the backend .env."
    );
  }
  return secret;
}

function signToken(user) {
  return jwt.sign(
    { userId: user.id, role: user.role, schoolId: user.schoolId },
    getSecret(),
    {
      algorithm: ALGORITHM,
      expiresIn: EXPIRES_IN,
      issuer: ISSUER,
      audience: AUDIENCE,
    }
  );
}

function verifyToken(token) {
  return jwt.verify(token, getSecret(), {
    algorithms: [ALGORITHM],
    issuer: ISSUER,
    audience: AUDIENCE,
  });
}

module.exports = { signToken, verifyToken };
