const express = require("express");
const prisma = require("../config/db");
const { authenticate, requireApprovedSchool } = require("../middleware/auth");
const { requireRole } = require("../middleware/role");

const router = express.Router();

router.use(authenticate, requireApprovedSchool);

function parseYear(value) {
  const y = Number(value);
  return Number.isInteger(y) && y > 2000 && y < 2100 ? y : new Date().getFullYear();
}

function yearRange(year) {
  return { start: new Date(Date.UTC(year, 0, 1)), end: new Date(Date.UTC(year + 1, 0, 1)) };
}

// The school's discipline policy, created with sensible defaults the first time
// it is read.
async function getSettings(schoolId) {
  const existing = await prisma.disciplineSetting.findUnique({ where: { schoolId } });
  if (existing) return existing;
  return prisma.disciplineSetting.create({ data: { schoolId } });
}

function serializeSettings(settings) {
  return {
    defaultMarks: settings.defaultMarks,
    punishmentThreshold: settings.punishmentThreshold,
    minMarks: Math.max(0, settings.defaultMarks - settings.punishmentThreshold),
    updatedAt: settings.updatedAt,
  };
}

// Current discipline policy (teachers read it to see remaining marks).
router.get("/settings", requireRole("TEACHER", "HEADMASTER"), async (req, res) => {
  const settings = await getSettings(req.user.schoolId);
  res.json({ settings: serializeSettings(settings) });
});

// Headmaster sets the starting marks and the punishment threshold.
router.put("/settings", requireRole("HEADMASTER"), async (req, res) => {
  const defaultMarks = Number(req.body.defaultMarks);
  const punishmentThreshold = Number(req.body.punishmentThreshold);

  if (!Number.isInteger(defaultMarks) || defaultMarks < 1 || defaultMarks > 100) {
    return res.status(400).json({ error: "Starting marks must be a whole number between 1 and 100" });
  }
  if (!Number.isInteger(punishmentThreshold) || punishmentThreshold < 0 || punishmentThreshold > defaultMarks) {
    return res.status(400).json({ error: "Punishment threshold must be between 0 and the starting marks" });
  }

  const settings = await prisma.disciplineSetting.upsert({
    where: { schoolId: req.user.schoolId },
    create: { schoolId: req.user.schoolId, defaultMarks, punishmentThreshold, updatedByUserId: req.user.id },
    update: { defaultMarks, punishmentThreshold, updatedByUserId: req.user.id },
  });

  res.json({ settings: serializeSettings(settings) });
});

// A teacher reports a case and removes marks from the student.
router.post("/", requireRole("TEACHER"), async (req, res) => {
  const { studentId, description } = req.body;
  const marksDeducted = req.body.marksDeducted === undefined ? 0 : Number(req.body.marksDeducted);

  if (!studentId || !description) {
    return res.status(400).json({ error: "studentId and description are required" });
  }
  if (!Number.isInteger(marksDeducted) || marksDeducted < 0) {
    return res.status(400).json({ error: "Marks to remove must be a whole number of 0 or more" });
  }

  const student = await prisma.student.findFirst({
    where: { id: Number(studentId), class: { schoolId: req.user.schoolId } },
  });

  if (!student) {
    return res.status(404).json({ error: "Student not found in your school" });
  }

  const settings = await getSettings(req.user.schoolId);
  const deducted = Math.min(marksDeducted, settings.defaultMarks);

  const disciplineCase = await prisma.disciplineCase.create({
    data: {
      studentId: student.id,
      schoolId: req.user.schoolId,
      reportedByUserId: req.user.id,
      description,
      marksDeducted: deducted,
    },
  });

  res.status(201).json({ disciplineCase });
});

// Headmaster sees every discipline case in the school.
router.get("/", requireRole("HEADMASTER"), async (req, res) => {
  const cases = await prisma.disciplineCase.findMany({
    where: { schoolId: req.user.schoolId },
    include: {
      student: { select: { id: true, name: true, photoUrl: true, class: { select: { id: true, name: true } } } },
      reportedBy: { select: { id: true, name: true } },
    },
    orderBy: [{ reviewed: "asc" }, { date: "desc" }],
  });
  res.json({ disciplineCases: cases });
});

// Headmaster: every student's discipline marks for a term (year), flagged when
// they have lost enough marks to deserve a punishment.
router.get("/marks", requireRole("HEADMASTER"), async (req, res) => {
  const year = parseYear(req.query.year);
  const { start, end } = yearRange(year);
  const settings = await getSettings(req.user.schoolId);

  const students = await prisma.student.findMany({
    where: { class: { schoolId: req.user.schoolId } },
    select: { id: true, name: true, photoUrl: true, class: { select: { id: true, name: true } } },
    orderBy: { name: "asc" },
  });

  const grouped = await prisma.disciplineCase.groupBy({
    by: ["studentId"],
    where: { schoolId: req.user.schoolId, date: { gte: start, lt: end } },
    _sum: { marksDeducted: true },
    _count: { id: true },
  });
  const byStudent = new Map(grouped.map((g) => [g.studentId, g]));

  const rows = students
    .map((s) => {
      const g = byStudent.get(s.id);
      const deducted = g?._sum.marksDeducted || 0;
      return {
        student: s,
        deducted,
        remaining: Math.max(0, settings.defaultMarks - deducted),
        cases: g?._count.id || 0,
        punishable: deducted >= settings.punishmentThreshold,
      };
    })
    .sort((a, b) => a.remaining - b.remaining || a.student.name.localeCompare(b.student.name));

  res.json({ year, settings: serializeSettings(settings), students: rows });
});

// A single student's discipline marks and case history for a term (year).
router.get("/student/:studentId", requireRole("TEACHER", "HEADMASTER"), async (req, res) => {
  const year = parseYear(req.query.year);
  const { start, end } = yearRange(year);
  const studentId = Number(req.params.studentId);

  const student = await prisma.student.findFirst({
    where: { id: studentId, class: { schoolId: req.user.schoolId } },
    select: { id: true, name: true, photoUrl: true, class: { select: { id: true, name: true } } },
  });
  if (!student) {
    return res.status(404).json({ error: "Student not found" });
  }

  const settings = await getSettings(req.user.schoolId);
  const cases = await prisma.disciplineCase.findMany({
    where: { studentId, schoolId: req.user.schoolId, date: { gte: start, lt: end } },
    include: { reportedBy: { select: { id: true, name: true } } },
    orderBy: { date: "desc" },
  });

  const deducted = cases.reduce((sum, c) => sum + c.marksDeducted, 0);

  res.json({
    year,
    student,
    settings: serializeSettings(settings),
    deducted,
    remaining: Math.max(0, settings.defaultMarks - deducted),
    punishable: deducted >= settings.punishmentThreshold,
    cases,
  });
});

// Headmaster marks a discipline case as reviewed (or un-reviews it).
router.patch("/:id/review", requireRole("HEADMASTER"), async (req, res) => {
  const id = Number(req.params.id);

  const disciplineCase = await prisma.disciplineCase.findFirst({
    where: { id, schoolId: req.user.schoolId },
  });

  if (!disciplineCase) {
    return res.status(404).json({ error: "Discipline case not found" });
  }

  const reviewed = await prisma.disciplineCase.update({
    where: { id },
    data: { reviewed: !disciplineCase.reviewed },
  });

  res.json({ disciplineCase: reviewed });
});

module.exports = router;
