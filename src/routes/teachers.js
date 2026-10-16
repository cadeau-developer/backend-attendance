const express = require("express");
const prisma = require("../config/db");
const { hashPassword } = require("../utils/password");
const { authenticate, requireApprovedSchool } = require("../middleware/auth");
const { requireRole } = require("../middleware/role");
const { isRwPhone, PHONE_ERROR } = require("../utils/validate");

const router = express.Router();

router.use(authenticate, requireApprovedSchool, requireRole("HEADMASTER"));

router.post("/", async (req, res) => {
  const { name, email, password, phone, avatarUrl } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ error: "name, email and password are required" });
  }

  if (phone && !isRwPhone(phone)) {
    return res.status(400).json({ error: PHONE_ERROR });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return res.status(409).json({ error: "A user with this email already exists" });
  }

  const passwordHash = await hashPassword(password);
  const teacher = await prisma.user.create({
    data: {
      name,
      email,
      phone: phone || null,
      avatarUrl: avatarUrl || null,
      passwordHash,
      role: "TEACHER",
      schoolId: req.user.schoolId,
    },
  });

  res.status(201).json({
    teacher: {
      id: teacher.id,
      name: teacher.name,
      email: teacher.email,
      phone: teacher.phone,
      avatarUrl: teacher.avatarUrl,
      classTeacherOf: [],
    },
  });
});

router.get("/", async (req, res) => {
  const teachers = await prisma.user.findMany({
    where: { schoolId: req.user.schoolId, role: "TEACHER" },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      avatarUrl: true,
      classTeacherOf: { select: { id: true, name: true } },
    },
    orderBy: { name: "asc" },
  });
  res.json({ teachers });
});

module.exports = router;
