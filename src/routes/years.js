const express = require("express");
const prisma = require("../config/db");
const { authenticate, requireApprovedSchool } = require("../middleware/auth");
const { requireRole } = require("../middleware/role");
const { getCurrentSchoolYear, getCurrentTerm, todayUTC } = require("../utils/terms");
const { endYearForClass, revertYearRecords } = require("../utils/yearEnd");

const router = express.Router();

router.use(authenticate, requireApprovedSchool);

function parseYear(value) {
  const y = Number(value);
  return Number.isInteger(y) && y > 2000 && y < 2100 ? y : new Date().getFullYear();
}

function parseDate(value) {
  if (value === undefined || value === null || value === "") return todayUTC();
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) return null;
  return d;
}

function serialize(year) {
  if (!year) return null;
  return {
    id: year.id,
    year: year.year,
    starts: year.starts.toISOString().slice(0, 10),
    ends: year.ends ? year.ends.toISOString().slice(0, 10) : null,
    current: !year.ends,
  };
}

// School years of the school (oldest first) plus the open one.
router.get("/", requireRole("TEACHER", "HEADMASTER"), async (req, res) => {
  const [years, currentYear] = await Promise.all([
    prisma.schoolYear.findMany({
      where: { schoolId: req.user.schoolId },
      orderBy: { year: "asc" },
    }),
    getCurrentSchoolYear(req.user.schoolId),
  ]);
  res.json({
    years: years.map(serialize),
    currentYear: serialize(currentYear),
    canStart: !currentYear,
  });
});

// Headmaster opens the school year. Terms can only start while a year is open.
router.post("/", requireRole("HEADMASTER"), async (req, res) => {
  const open = await getCurrentSchoolYear(req.user.schoolId);
  if (open) {
    return res.status(409).json({ error: `School year ${open.year} is already open` });
  }

  const now = new Date();
  const year = req.body.year === undefined ? now.getUTCFullYear() : parseYear(req.body.year);
  if (year > now.getUTCFullYear()) {
    return res.status(400).json({ error: "A school year cannot start in the future" });
  }

  const starts = parseDate(req.body.starts);
  if (!starts) {
    return res.status(400).json({ error: "starts must be a valid YYYY-MM-DD date" });
  }

  const existing = await prisma.schoolYear.findUnique({
    where: { schoolId_year: { schoolId: req.user.schoolId, year } },
  });
  const schoolYear = existing
    ? await prisma.schoolYear.update({ where: { id: existing.id }, data: { ends: null, starts } })
    : await prisma.schoolYear.create({ data: { schoolId: req.user.schoolId, year, starts } });

  res.status(201).json({ currentYear: serialize(schoolYear) });
});

// Headmaster ends the school year: archives every student, closes any running
// term and closes the year.
router.post("/end", requireRole("HEADMASTER"), async (req, res) => {
  const open = await getCurrentSchoolYear(req.user.schoolId);
  if (!open) {
    return res.status(400).json({ error: "No school year is open. Start the year first." });
  }

  const today = todayUTC();
  const classes = await prisma.class.findMany({ where: { schoolId: req.user.schoolId } });

  let archived = 0;
  await prisma.$transaction(async (tx) => {
    for (const klass of classes) {
      const students = await tx.student.findMany({ where: { classId: klass.id } });
      if (students.length === 0) continue;
      archived += await endYearForClass(tx, klass, open.year, students);
    }

    const currentTerm = await tx.schoolTerm.findFirst({
      where: { schoolId: req.user.schoolId, ends: null },
    });
    if (currentTerm) {
      await tx.schoolTerm.update({ where: { id: currentTerm.id }, data: { ends: today } });
    }

    await tx.schoolYear.update({ where: { id: open.id }, data: { ends: today } });
  });

  res.json({ year: open.year, archived });
});

// Headmaster reopens a closed year and restores its undergraduates.
router.post("/revert", requireRole("HEADMASTER"), async (req, res) => {
  const year = parseYear(req.body.year);
  const closed = await prisma.schoolYear.findUnique({
    where: { schoolId_year: { schoolId: req.user.schoolId, year } },
  });
  if (!closed || !closed.ends) {
    return res.status(400).json({ error: `School year ${year} is not closed` });
  }
  const otherOpen = await getCurrentSchoolYear(req.user.schoolId);
  if (otherOpen) {
    return res.status(409).json({ error: `Close school year ${otherOpen.year} first` });
  }

  const records = await prisma.studentRecord.findMany({
    where: { schoolId: req.user.schoolId, year, status: "UNDERGRADUATE" },
  });

  const reverted = await prisma.$transaction(async (tx) => {
    const n = await revertYearRecords(tx, records);
    await tx.schoolYear.update({ where: { id: closed.id }, data: { ends: null } });
    return n;
  });

  res.json({ year, reverted });
});

module.exports = router;
