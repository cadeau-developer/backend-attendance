const express = require("express");
const prisma = require("../config/db");
const { hashPassword, comparePassword } = require("../utils/password");
const { signToken } = require("../utils/jwt");
const { isRwPhone, PHONE_ERROR } = require("../utils/validate");
const { authenticate } = require("../middleware/auth");
const { imageRef } = require("../utils/uploads");
const {
  createRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
} = require("../utils/refreshTokens");

const router = express.Router();

async function sessionPayload(user) {
  const refreshToken = await createRefreshToken(user.id);
  return { token: signToken(user), refreshToken, user: publicUser(user) };
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    avatarUrl: user.avatarUrl,
    role: user.role,
    schoolId: user.schoolId,
    school: user.school
      ? {
          id: user.school.id,
          name: user.school.name,
          schoolType: user.school.schoolType,
          address: user.school.address,
          city: user.school.city,
          phone: user.school.phone,
          email: user.school.email,
          status: user.school.status,
          logoUrl: user.school.logoUrl,
          province: user.school.province,
          district: user.school.district,
          sector: user.school.sector,
          cell: user.school.cell,
          village: user.school.village,
          headmasterName: user.school.headmasterName,
          headmasterPhone: user.school.headmasterPhone,
        }
      : null,
  };
}

router.post("/register-headmaster", async (req, res) => {
  const {
    schoolName,
    schoolType,
    address,
    city,
    schoolPhone,
    schoolEmail,
    name,
    phone,
    email,
    password,
    province,
    district,
    sector,
    cell,
    village,
  } = req.body;

  if (!schoolName || !name || !email || !password) {
    return res.status(400).json({ error: "schoolName, name, email and password are required" });
  }

  if ((schoolPhone && !isRwPhone(schoolPhone)) || (phone && !isRwPhone(phone))) {
    return res.status(400).json({ error: PHONE_ERROR });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return res.status(409).json({ error: "A user with this email already exists" });
  }

  const passwordHash = await hashPassword(password);

  const result = await prisma.$transaction(async (tx) => {
    const school = await tx.school.create({
      data: {
        name: schoolName,
        schoolType: schoolType || null,
        address: address || null,
        city: city || null,
        phone: schoolPhone || null,
        email: schoolEmail || null,
        province: province || null,
        district: district || null,
        sector: sector || null,
        cell: cell || null,
        village: village || null,
        headmasterName: name || null,
        headmasterPhone: phone || null,
        status: "PENDING",
      },
    });

    const user = await tx.user.create({
      data: {
        name,
        email,
        phone: phone || null,
        passwordHash,
        role: "HEADMASTER",
        schoolId: school.id,
      },
      include: { school: true },
    });

    return user;
  });

  res.status(201).json(await sessionPayload(result));
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "email and password are required" });
  }

  const user = await prisma.user.findUnique({ where: { email }, include: { school: true } });
  if (!user) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  const ok = await comparePassword(password, user.passwordHash);
  if (!ok) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  res.json(await sessionPayload(user));
});

// Exchanges a valid refresh token for a new access token (and a rotated
// refresh token). Refresh tokens are single-use to limit replay damage.
router.post("/refresh", async (req, res) => {
  try {
    const result = await rotateRefreshToken(req.body?.refreshToken);
    if (!result) {
      return res.status(401).json({ error: "Invalid or expired refresh token", code: "REFRESH_INVALID" });
    }
    res.json({
      token: signToken(result.user),
      refreshToken: result.refreshToken,
      user: publicUser(result.user),
    });
  } catch (err) {
    console.error("POST /auth/refresh failed", err);
    res.status(500).json({ error: "Could not refresh the session" });
  }
});

router.post("/logout", async (req, res) => {
  await revokeRefreshToken(req.body?.refreshToken);
  res.json({ ok: true });
});

router.get("/me", authenticate, async (req, res) => {
  res.json({ user: publicUser(req.user) });
});

router.patch("/me", authenticate, async (req, res) => {
  const { name, phone, avatarUrl, password } = req.body;

  const data = {};
  if (typeof name === "string" && name.trim()) data.name = name.trim();
  if (typeof phone === "string") {
    const cleanPhone = phone.trim() || null;
    if (cleanPhone && !isRwPhone(cleanPhone)) {
      return res.status(400).json({ error: PHONE_ERROR });
    }
    data.phone = cleanPhone;
  }
  if (typeof avatarUrl === "string") data.avatarUrl = await imageRef(avatarUrl, req);
  if (password) data.passwordHash = await hashPassword(password);

  const user = await prisma.user.update({
    where: { id: req.user.id },
    data,
    include: { school: true },
  });

  res.json({ user: publicUser(user) });
});

module.exports = router;
