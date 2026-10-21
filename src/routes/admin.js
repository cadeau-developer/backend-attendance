const express = require("express");
const prisma = require("../config/db");
const { authenticate } = require("../middleware/auth");
const { requireRole } = require("../middleware/role");
const { hashPassword } = require("../utils/password");
const { isRwPhone, PHONE_ERROR } = require("../utils/validate");
const { imageRef } = require("../utils/uploads");

const router = express.Router();

router.use(authenticate, requireRole("SUPER_ADMIN"));

// ---------------------------------------------------------------------------
// Super-admin's own profile
// ---------------------------------------------------------------------------

router.get("/profile", async (req, res) => {
  res.json({
    user: {
      id: req.user.id,
      name: req.user.name,
      email: req.user.email,
      phone: req.user.phone,
      avatarUrl: req.user.avatarUrl,
      role: req.user.role,
    },
  });
});

router.patch("/profile", async (req, res) => {
  const { name, email, phone, avatarUrl, password } = req.body;
  const data = {};

  if (name !== undefined) data.name = String(name);
  if (phone !== undefined) {
    const cleanPhone = phone ? String(phone) : null;
    if (cleanPhone && !isRwPhone(cleanPhone)) {
      return res.status(400).json({ error: PHONE_ERROR });
    }
    data.phone = cleanPhone;
  }
  if (avatarUrl !== undefined) data.avatarUrl = await imageRef(avatarUrl ? String(avatarUrl) : null, req);
  if (password !== undefined) {
    if (String(password).length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }
    data.passwordHash = await hashPassword(String(password));
  }

  if (email !== undefined) {
    const emailValue = String(email).trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(emailValue)) {
      return res.status(400).json({ error: "Please enter a valid email address" });
    }
    const existing = await prisma.user.findUnique({ where: { email: emailValue } });
    if (existing && existing.id !== req.user.id) {
      return res.status(409).json({ error: "A user with this email already exists" });
    }
    data.email = emailValue;
  }

  if (name === undefined && Object.keys(data).length === 0) {
    return res.status(400).json({ error: "Nothing to update" });
  }

  const updated = await prisma.user.update({ where: { id: req.user.id }, data });
  res.json({
    user: {
      id: updated.id,
      name: updated.name,
      email: updated.email,
      phone: updated.phone,
      avatarUrl: updated.avatarUrl,
      role: updated.role,
    },
  });
});

// ---------------------------------------------------------------------------
// School management
// ---------------------------------------------------------------------------

// Register a brand-new school. Accepts optional logoUrl and optional headmaster
// login credentials. If headmasterEmail + headmasterPassword are provided, a
// HEADMASTER user is created so the school can sign in right away.
router.post("/schools", async (req, res) => {
  const {
    name,
    schoolType,
    address,
    city,
    phone,
    email,
    logoUrl,
    status,
    headmasterName,
    headmasterPhone,
    headmasterEmail,
    headmasterPassword,
    province,
    district,
    sector,
    cell,
    village,
  } = req.body;

  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: "School name is required" });
  }
  if (!phone || !String(phone).trim()) {
    return res.status(400).json({ error: "School phone is required" });
  }
  const cleanPhone = String(phone).trim();
  if (!isRwPhone(cleanPhone)) {
    return res.status(400).json({ error: PHONE_ERROR });
  }
  if (headmasterPhone && !isRwPhone(headmasterPhone)) {
    return res.status(400).json({ error: PHONE_ERROR });
  }

  const createHeadmaster = headmasterEmail !== undefined || headmasterPassword !== undefined;
  const emailValue = headmasterEmail ? String(headmasterEmail).trim().toLowerCase() : null;
  if (createHeadmaster) {
    if (!headmasterName || !String(headmasterName).trim()) {
      return res.status(400).json({ error: "Headmaster full name is required" });
    }
    if (!emailValue || !/^\S+@\S+\.\S+$/.test(emailValue)) {
      return res.status(400).json({ error: "Please enter a valid headmaster email" });
    }
    if (!headmasterPassword || String(headmasterPassword).length < 6) {
      return res.status(400).json({ error: "Headmaster password must be at least 6 characters" });
    }
    const existing = await prisma.user.findUnique({ where: { email: emailValue } });
    if (existing) {
      return res.status(409).json({ error: "The headmaster email is already used by another account" });
    }
  }

  if (status !== undefined && !["PENDING", "APPROVED", "REJECTED"].includes(status)) {
    return res.status(400).json({ error: "Invalid school status" });
  }

  const school = await prisma.school.create({
    data: {
      name: String(name).trim(),
      schoolType: schoolType ? String(schoolType) : null,
      address: address ? String(address) : null,
      city: city ? String(city) : null,
      phone: cleanPhone,
      email: email ? String(email).trim() || null : null,
      logoUrl: await imageRef(logoUrl ? String(logoUrl) : null, req),
      province: province ? String(province) : null,
      district: district ? String(district) : null,
      sector: sector ? String(sector) : null,
      cell: cell ? String(cell) : null,
      village: village ? String(village) : null,
      status: status || "PENDING",
    },
  });

  let headmaster = null;
  if (createHeadmaster) {
    headmaster = await prisma.user.create({
      data: {
        name: headmasterName ? String(headmasterName).trim() : "Headmaster",
        email: emailValue,
        phone: headmasterPhone ? String(headmasterPhone) : null,
        passwordHash: await hashPassword(String(headmasterPassword)),
        role: "HEADMASTER",
        schoolId: school.id,
      },
    });
  }

  res.status(201).json({
    school: {
      id: school.id,
      name: school.name,
      schoolType: school.schoolType,
      address: school.address,
      city: school.city,
      phone: school.phone,
      email: school.email,
      status: school.status,
      logoUrl: school.logoUrl,
      province: school.province,
      district: school.district,
      sector: school.sector,
      cell: school.cell,
      village: school.village,
    },
    headmaster: headmaster
      ? { id: headmaster.id, name: headmaster.name, email: headmaster.email, phone: headmaster.phone }
      : undefined,
  });
});

router.patch("/schools/:id", async (req, res) => {
  const schoolId = Number(req.params.id);
  const {
    name,
    schoolType,
    address,
    city,
    phone,
    email,
    headmasterName,
    headmasterPhone,
    headmasterEmail,
    headmasterPassword,
    status,
  } = req.body;

  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    include: { users: { where: { role: "HEADMASTER" } } },
  });
  if (!school) {
    return res.status(404).json({ error: "School not found" });
  }

  if ((phone && !isRwPhone(phone)) || (headmasterPhone && !isRwPhone(headmasterPhone))) {
    return res.status(400).json({ error: PHONE_ERROR });
  }

  const schoolData = {};
  if (name !== undefined) schoolData.name = String(name);
  if (schoolType !== undefined) schoolData.schoolType = schoolType ? String(schoolType) : null;
  if (address !== undefined) schoolData.address = address ? String(address) : null;
  if (city !== undefined) schoolData.city = city ? String(city) : null;
  if (phone !== undefined) schoolData.phone = phone ? String(phone) : null;
  if (email !== undefined) schoolData.email = email ? String(email) : null;
  if (province !== undefined) schoolData.province = province ? String(province) : null;
  if (district !== undefined) schoolData.district = district ? String(district) : null;
  if (sector !== undefined) schoolData.sector = sector ? String(sector) : null;
  if (cell !== undefined) schoolData.cell = cell ? String(cell) : null;
  if (village !== undefined) schoolData.village = village ? String(village) : null;
  if (status !== undefined) {
    if (!["PENDING", "APPROVED", "REJECTED"].includes(status)) {
      return res.status(400).json({ error: "Invalid school status" });
    }
    schoolData.status = status;
  }

  const headmaster = school.users[0] || null;

  if (headmasterPassword !== undefined && String(headmasterPassword).length < 6) {
    return res.status(400).json({ error: "Headmaster password must be at least 6 characters" });
  }

  const creatingHeadmaster = !headmaster && (headmasterName !== undefined || headmasterEmail !== undefined);
  if (creatingHeadmaster) {
    if (headmasterEmail === undefined || !String(headmasterEmail).trim()) {
      return res.status(400).json({ error: "A headmaster email is required to create a headmaster account" });
    }
    const emailValue = String(headmasterEmail).trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(emailValue)) {
      return res.status(400).json({ error: "Please enter a valid headmaster email" });
    }
    if (headmasterPassword === undefined || String(headmasterPassword).length < 6) {
      return res.status(400).json({ error: "Set a headmaster password of at least 6 characters" });
    }
    const existing = await prisma.user.findUnique({ where: { email: emailValue } });
    if (existing) {
      return res.status(409).json({ error: "The headmaster email is already used by another account" });
    }
  }

  if (headmasterEmail !== undefined && headmaster) {
    const emailValue = String(headmasterEmail).trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(emailValue)) {
      return res.status(400).json({ error: "Please enter a valid headmaster email" });
    }
    const existing = await prisma.user.findUnique({ where: { email: emailValue } });
    if (existing && existing.id !== headmaster.id) {
      return res.status(409).json({ error: "The new headmaster email is already used by another account" });
    }
  }

  const [updatedSchool, updatedUser] = await prisma.$transaction(async (tx) => {
    const schoolResult = await tx.school.update({ where: { id: schoolId }, data: schoolData });
    let userResult = null;
    if (headmaster) {
      const userData = {};
      if (headmasterName !== undefined) userData.name = String(headmasterName);
      if (headmasterPhone !== undefined) userData.phone = headmasterPhone ? String(headmasterPhone) : null;
      if (headmasterEmail !== undefined) {
        userData.email = String(headmasterEmail).trim().toLowerCase();
      }
      if (headmasterPassword !== undefined) {
        userData.passwordHash = await hashPassword(String(headmasterPassword));
      }
      if (Object.keys(userData).length > 0) {
        userResult = await tx.user.update({ where: { id: headmaster.id }, data: userData });
      }
    } else if (creatingHeadmaster) {
      userResult = await tx.user.create({
        data: {
          name: headmasterName ? String(headmasterName).trim() : "Headmaster",
          email: String(headmasterEmail).trim().toLowerCase(),
          phone: headmasterPhone ? String(headmasterPhone) : null,
          passwordHash: await hashPassword(String(headmasterPassword)),
          role: "HEADMASTER",
          schoolId,
        },
      });
    }
    return [schoolResult, userResult];
  });

  res.json({
    school: {
      id: updatedSchool.id,
      name: updatedSchool.name,
      schoolType: updatedSchool.schoolType,
      address: updatedSchool.address,
      city: updatedSchool.city,
      phone: updatedSchool.phone,
      email: updatedSchool.email,
      status: updatedSchool.status,
      logoUrl: updatedSchool.logoUrl,
      province: updatedSchool.province,
      district: updatedSchool.district,
      sector: updatedSchool.sector,
      cell: updatedSchool.cell,
      village: updatedSchool.village,
    },
    headmaster: updatedUser
      ? { id: updatedUser.id, name: updatedUser.name, email: updatedUser.email, phone: updatedUser.phone }
      : undefined,
  });
});

router.delete("/schools/:id", async (req, res) => {
  const schoolId = Number(req.params.id);

  const school = await prisma.school.findUnique({ where: { id: schoolId } });
  if (!school) {
    return res.status(404).json({ error: "School not found" });
  }

  await prisma.$transaction([
    prisma.disciplineCase.deleteMany({ where: { schoolId } }),
    prisma.attendance.deleteMany({ where: { class: { schoolId } } }),
    prisma.student.deleteMany({ where: { class: { schoolId } } }),
    prisma.class.deleteMany({ where: { schoolId } }),
    prisma.user.deleteMany({ where: { schoolId } }),
    prisma.school.delete({ where: { id: schoolId } }),
  ]);

  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// School listing
// ---------------------------------------------------------------------------

router.get("/schools", async (req, res) => {
  const { status } = req.query;
  const schools = await prisma.school.findMany({
    where: status ? { status } : undefined,
    include: {
      users: { where: { role: "HEADMASTER" }, select: { id: true, name: true, email: true, phone: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  res.json({ schools });
});

router.post("/schools/:id/approve", async (req, res) => {
  const school = await prisma.school.update({
    where: { id: Number(req.params.id) },
    data: { status: "APPROVED" },
  });
  res.json({ school });
});

router.post("/schools/:id/reject", async (req, res) => {
  const school = await prisma.school.update({
    where: { id: Number(req.params.id) },
    data: { status: "REJECTED" },
  });
  res.json({ school });
});

// ---------------------------------------------------------------------------
// School year — super admin can open the year for every approved school at
// once. Headmasters can still start/end their own school's year afterwards.
// ---------------------------------------------------------------------------

function parseYear(value) {
  const y = Number(value);
  return Number.isInteger(y) && y > 2000 && y < 2100 ? y : new Date().getFullYear();
}

// How many approved schools currently have the year open.
router.get("/year-status", async (req, res) => {
  const year = parseYear(req.query.year);
  const [approvedSchools, openYears] = await Promise.all([
    prisma.school.count({ where: { status: "APPROVED" } }),
    prisma.schoolYear.count({ where: { year, ends: null } }),
  ]);
  res.json({ year, approvedSchools, openSchools: openYears });
});

// Open the school year for every approved school that does not have one open
// yet. Existing open years are left untouched.
router.post("/start-year-all", async (req, res) => {
  const now = new Date();
  const year = req.body.year === undefined ? now.getUTCFullYear() : parseYear(req.body.year);
  if (year > now.getUTCFullYear()) {
    return res.status(400).json({ error: "A school year cannot start in the future" });
  }

  const schools = await prisma.school.findMany({
    where: { status: "APPROVED" },
    select: { id: true },
  });

  let opened = 0;
  await prisma.$transaction(async (tx) => {
    for (const school of schools) {
      const open = await tx.schoolYear.findFirst({
        where: { schoolId: school.id, ends: null },
      });
      if (open) continue;
      const existing = await tx.schoolYear.findUnique({
        where: { schoolId_year: { schoolId: school.id, year } },
      });
      if (existing) {
        await tx.schoolYear.update({ where: { id: existing.id }, data: { ends: null } });
      } else {
        await tx.schoolYear.create({
          data: { schoolId: school.id, year, starts: todayDateOnly() },
        });
      }
      opened += 1;
    }
  });

  res.json({ year, approvedSchools: schools.length, opened, skipped: schools.length - opened });
});

function todayDateOnly() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

module.exports = router;