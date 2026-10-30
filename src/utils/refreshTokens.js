const crypto = require("crypto");
const prisma = require("../config/db");

const REFRESH_TTL_DAYS = Math.max(1, Number(process.env.REFRESH_TOKEN_TTL_DAYS) || 60);

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function generateToken() {
  return crypto.randomBytes(48).toString("hex");
}

async function createRefreshToken(userId) {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);
  await prisma.refreshToken.create({
    data: { tokenHash: hashToken(token), userId, expiresAt },
  });
  return token;
}

// Validates a refresh token, revokes it and issues a fresh one (rotation).
// Returns null when the token is unknown, expired or already revoked.
async function rotateRefreshToken(rawToken) {
  if (!rawToken) return null;
  const tokenHash = hashToken(rawToken);
  const stored = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: { user: { include: { school: true } } },
  });
  if (!stored || stored.revokedAt || stored.expiresAt.getTime() <= Date.now()) {
    return null;
  }

  const nextToken = generateToken();
  const nextExpiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);

  await prisma.$transaction([
    prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    }),
    prisma.refreshToken.create({
      data: { tokenHash: hashToken(nextToken), userId: stored.userId, expiresAt: nextExpiresAt },
    }),
  ]);

  return { user: stored.user, refreshToken: nextToken };
}

async function revokeRefreshToken(rawToken) {
  if (!rawToken) return;
  await prisma.refreshToken
    .updateMany({
      where: { tokenHash: hashToken(rawToken), revokedAt: null },
      data: { revokedAt: new Date() },
    })
    .catch(() => {});
}

module.exports = {
  REFRESH_TTL_DAYS,
  createRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
};
