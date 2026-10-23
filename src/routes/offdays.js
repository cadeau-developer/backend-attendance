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
// School users also get `autoOffDays`: recent past weekdays with no attendance
// taken by any class — automatically treated as off days.
router.get("/", requireRole("SUPER_ADMIN", "HEADMASTER", "TEACHER"), async (req, res) => {
  const where = scopeFilter(req, false);
  const offDays = await prisma.offDay.findMany({ where, orderBy: { date: "desc" } });

  // Saturdays and Sundays are off days by default. List every default weekend
  // day for the current year, minus explicit off days and minus weekend dates a
  // headmaster opened for attendance.
  const now = new Date();
  const year = now.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const yearEnd = new Date(Date.UTC(year, 11, 31));

  const explicitDates = new Set(offDays.map((o) => o.date.toISOString().slice(0, 10)));
  let openedWeekendDates = new Set();
  if (req.user.role !== "SUPER_ADMIN" && req.user.schoolId) {
    const opened = await prisma.weekendAttendanceDay.findMany({
      where: { schoolId: req.user.schoolId, date: { gte: yearStart, lte: yearEnd } },
      select: { date: true },
    });
    openedWeekendDates = new Set(opened.map((o) => o.date.toISOString().slice(0, 10)));
  }

  const weekendOffDays = [];
  for (let t = yearStart.getTime(); t <= yearEnd.getTime(); t += 24 * 60 * 60 * 1000) {
    const d = new Date(t);
    if (!isWeekend(d)) continue;
    const iso = d.toISOString().slice(0, 10);
    if (explicitDates.has(iso) || openedWeekendDates.has(iso)) continue;
    const dayName = d.getUTCDay() === 6 ? "Saturday" : "Sunday";
    weekendOffDays.push({ date: iso, label: `${dayName} (weekend)`, weekend: true });
  }

  let autoOffDays = [];
  if (req.user.role !== "SUPER_ADMIN" && req.user.schoolId) {
    const today = todayStart();
    const from = new Date(today.getTime() - 60 * 24 * 60 * 60 * 1000);

    const [attended, scheduled] = await Promise.all([
      prisma.attendance.findMany({
        where: { class: { schoolId: req.user.schoolId }, date: { gte: from, lt: today } },
        select: { date: true },
        distinct: ["date"],
      }),
      prisma.offDay.findMany({
        where: { date: { gte: from, lt: today }, OR: [{ schoolId: null }, { schoolId: req.user.schoolId }] },
        select: { date: true },
      }),
    ]);
    const attendedDates = new Set(attended.map((a) => a.date.toISOString().slice(0, 10)));
    const scheduledDates = new Set(scheduled.map((o) => o.date.toISOString().slice(0, 10)));

    for (let t = from.getTime(); t < today.getTime(); t += 24 * 60 * 60 * 1000) {
      const d = new Date(t);
      const iso = d.toISOString().slice(0, 10);
      if (isWeekend(d) || scheduledDates.has(iso) || attendedDates.has(iso)) continue;
      autoOffDays.push({ date: iso, label: "No attendance was taken school-wide" });
    }
    autoOffDays = autoOffDays.reverse();
  }

  res.json({ offDays, autoOffDays, weekendOffDays });
});

// Server-side source of truth: is a date an off day for the caller's school?
// Weekends (Sat/Sun) are off days unless a headmaster opened that date via
// /weekend-attendance. A past day with NO attendance taken by any class in the
// school is also an off day (it is not counted in attendance statistics).
// Clients should use this instead of duplicating the logic.
router.get(
  "/status",
  requireRole("SUPER_ADMIN", "HEADMASTER", "TEACHER"),
  async (req, res) => {
    const { date } = req.query;
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: "date is required in YYYY-MM-DD format" });
    }
    const day = new Date(`${date}T00:00:00.000Z`);
    if (Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== date) {
      return res.status(400).json({ error: "date must be a valid calendar date" });
    }

    // Super admin has no school: only global off days apply to them.
    const schoolId = req.user.role === "SUPER_ADMIN" ? null : req.user.schoolId;
    const offDay = schoolId
      ? await findScheduledOffDay(schoolId, day)
      : await prisma.offDay.findFirst({ where: { date: day, schoolId: null } });

    // Past day with zero attendance school-wide counts as an off day.
    let autoOff = false;
    if (!offDay && schoolId && day.getTime() < todayStart().getTime()) {
      const anyAttendance = await prisma.attendance.findFirst({
        where: { class: { schoolId }, date: day },
        select: { id: true },
      });
      autoOff = !anyAttendance;
    }

    res.json({
      date,
      isOffDay: !!offDay || autoOff,
      autoOff,
      offDay: offDay
        ? { label: offDay.label, weekend: offDay.weekend }
        : autoOff
          ? { label: "No attendance was taken school-wide", weekend: false }
          : null,
    });
  }
);

function todayStart() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

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