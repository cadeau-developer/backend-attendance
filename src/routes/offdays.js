const express = require("express");
const prisma = require("../config/db");
const { authenticate } = require("../middleware/auth");
const { requireRole } = require("../middleware/role");
const { isWeekend } = require("../utils/schoolCalendar");

const router = express.Router();

router.use(authenticate);

// Scope an off day to what a user may touch/see.
// null schoolId = global (super admin); a value = one specific school.
function scopeFilter(req, forWrite) {
  if (req.user.role === "SUPER_ADMIN") {
    return forWrite ? null : undefined;
  }
  const own = req.user.schoolId ?? null;
  if (forWrite) return own;
  return own ? { OR: [{ schoolId: null }, { schoolId: own }] } : { schoolId: null };
}

// HEADMASTER (own school) or SUPER_ADMIN (global): mark a date as an off day.
// Any date is allowed - including past dates (a headmaster may mark a previous day off).
router.post("/", requireRole("SUPER_ADMIN", "HEADMASTER"), async (req, res) => {
  const { date, label } = req.body;

  if (!date) {
    return res.status(400).json({ error: "date is required (YYYY-MM-DD)" });
  }

  const day = new Date(date + "T00:00:00.000Z");
  if (Number.isNaN(day.getTime())) {
    return res.status(400).json({ error: "date must be a valid YYYY-MM-DD value" });
  }

  const schoolId = scopeFilter(req, true);
  if (req.user.role === "HEADMASTER" && !schoolId) {
    return res.status(400).json({ error: "Your account is not linked to a school" });
  }

  const cleanLabel = typeof label === "string" && label.trim() ? label.trim() : null;

  const offDay = await prisma.$transaction(async (tx) => {
    const existing = await tx.offDay.findFirst({ where: { date: day, schoolId } });
    const saved = existing
      ? await tx.offDay.update({ where: { id: existing.id }, data: { label: cleanLabel } })
      : await tx.offDay.create({ data: { date: day, label: cleanLabel, schoolId } });

    if (req.user.role === "HEADMASTER") {
      await tx.weekendAttendanceDay.deleteMany({ where: { date: day, schoolId } });
    }
    return saved;
  });

  res.status(201).json({ offDay });
});

// List off days. Super admin: all. Headmaster/teacher: global + own school only.
router.get("/", requireRole("SUPER_ADMIN", "HEADMASTER", "TEACHER"), async (req, res) => {
  const where = scopeFilter(req, false);
  const offDays = await prisma.offDay.findMany({ where, orderBy: { date: "desc" } });
  res.json({ offDays });
});

router.get(
  "/weekend-attendance",
  requireRole("HEADMASTER", "TEACHER"),
  async (req, res) => {
    if (!req.user.schoolId) {
      return res.status(400).json({ error: "Your account is not linked to a school" });
    }

    const weekendAttendanceDays = await prisma.weekendAttendanceDay.findMany({
      where: { schoolId: req.user.schoolId },
      orderBy: { date: "asc" },
    });
    res.json({ weekendAttendanceDays });
  }
);

router.post(
  "/weekend-attendance",
  requireRole("HEADMASTER"),
  async (req, res) => {
    const { date } = req.body;
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: "date is required in YYYY-MM-DD format" });
    }

    const day = new Date(`${date}T00:00:00.000Z`);
    if (Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== date) {
      return res.status(400).json({ error: "date must be a valid calendar date" });
    }
    if (!isWeekend(day)) {
      return res.status(400).json({ error: "Choose a Saturday or Sunday to allow weekend attendance" });
    }
    if (!req.user.schoolId) {
      return res.status(400).json({ error: "Your account is not linked to a school" });
    }

    const closedDay = await prisma.offDay.findFirst({
      where: { date: day, OR: [{ schoolId: null }, { schoolId: req.user.schoolId }] },
    });
    if (closedDay) {
      return res.status(409).json({
        error: closedDay.schoolId === null
          ? "A global off day overrides weekend attendance. Ask the super admin to remove it first."
          : `This date is already marked as an off day${closedDay.label ? ` (${closedDay.label})` : ""}. Remove that off day first.`,
      });
    }

    const weekendAttendanceDay = await prisma.weekendAttendanceDay.upsert({
      where: { date_schoolId: { date: day, schoolId: req.user.schoolId } },
      create: { date: day, schoolId: req.user.schoolId },
      update: {},
    });
    res.status(201).json({ weekendAttendanceDay });
  }
);

router.delete(
  "/weekend-attendance/:date",
  requireRole("HEADMASTER"),
  async (req, res) => {
    const { date } = req.params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: "date must be in YYYY-MM-DD format" });
    }

    const day = new Date(`${date}T00:00:00.000Z`);
    if (Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== date) {
      return res.status(400).json({ error: "date must be a valid calendar date" });
    }

    const result = await prisma.weekendAttendanceDay.deleteMany({
      where: { date: day, schoolId: req.user.schoolId },
    });
    if (!result.count) {
      return res.status(404).json({ error: "Weekend attendance is not enabled for this date" });
    }
    res.json({ ok: true });
  }
);

// Remove an off day. Super admin: any. Headmaster: own school only.
router.delete("/:id", requireRole("SUPER_ADMIN", "HEADMASTER"), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "Invalid id" });
  }

  const offDay = await prisma.offDay.findUnique({ where: { id } });
  if (!offDay) {
    return res.status(404).json({ error: "Off day not found" });
  }

  if (req.user.role === "HEADMASTER" && offDay.schoolId !== req.user.schoolId) {
    return res.status(403).json({ error: "You can only remove off days for your own school" });
  }

  await prisma.offDay.delete({ where: { id } });
  res.json({ ok: true });
});

module.exports = router;