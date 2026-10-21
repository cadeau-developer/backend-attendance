const express = require("express");
const prisma = require("../config/db");
const { authenticate, requireApprovedSchool } = require("../middleware/auth");
const { requireRole } = require("../middleware/role");
const { getCurrentTerm } = require("../utils/terms");

const router = express.Router();

router.use(authenticate, requireApprovedSchool);

router.post("/", requireRole("HEADMASTER"), async (req, res) => {
  const { name, teacherId } = req.body;

  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: "name is required" });
  }

  const className = String(name).trim();

  const duplicate = await prisma.class.findFirst({
    where: {
      schoolId: req.user.schoolId,
      name: { equals: className, mode: "insensitive" },
    },
  });
  if (duplicate) {
    return res.status(400).json({ error: `A class named "${className}" already exists in this school` });
  }

  if (teacherId) {
    const teacher = await prisma.user.findFirst({
      where: { id: Number(teacherId), schoolId: req.user.schoolId, role: "TEACHER" },
    });
    if (!teacher) {
      return res.status(400).json({ error: "teacherId does not refer to a teacher in your school" });
    }
  }

  try {
    const klass = await prisma.class.create({
      data: {
        name: className,
        schoolId: req.user.schoolId,
        teacherId: teacherId ? Number(teacherId) : null,
      },
      include: { teacher: { select: { id: true, name: true, email: true, avatarUrl: true } } },
    });
    res.status(201).json({ class: klass });
  } catch (err) {
    throw err;
  }
});

router.patch("/:id", requireRole("HEADMASTER"), async (req, res) => {
  const classId = Number(req.params.id);
  const { teacherId } = req.body;

  const klass = await prisma.class.findFirst({
    where: { id: classId, schoolId: req.user.schoolId },
  });
  if (!klass) {
    return res.status(404).json({ error: "Class not found" });
  }

  const data = {};
  if (teacherId !== undefined) {
    if (teacherId === null || teacherId === "") {
      data.teacherId = null;
    } else {
      const teacher = await prisma.user.findFirst({
        where: { id: Number(teacherId), schoolId: req.user.schoolId, role: "TEACHER" },
      });
      if (!teacher) {
        return res.status(400).json({ error: "teacherId does not refer to a teacher in your school" });
      }
      data.teacherId = Number(teacherId);
    }
  }

  try {
    const updated = await prisma.class.update({
      where: { id: classId },
      data,
      include: { teacher: { select: { id: true, name: true, email: true, avatarUrl: true } } },
    });
    res.json({ class: updated });
  } catch (err) {
    throw err;
  }
});

router.delete("/:id", requireRole("HEADMASTER"), async (req, res) => {
  const classId = Number(req.params.id);
  if (!classId) {
    return res.status(400).json({ error: "Invalid class id" });
  }

  const klass = await prisma.class.findFirst({
    where: { id: classId, schoolId: req.user.schoolId },
  });
  if (!klass) {
    return res.status(404).json({ error: "Class not found" });
  }

  const students = await prisma.student.count({
    where: { classId, leftSchool: false },
  });
  if (students > 0) {
    return res.status(400).json({
      error: `${students} student${students === 1 ? " is" : "s are"} still in this class. Move them to another class first.`,
    });
  }

  const [attendances, records, terms, transfers] = await Promise.all([
    prisma.attendance.count({ where: { classId } }),
    prisma.studentRecord.count({ where: { classId } }),
    prisma.term.count({ where: { classId } }),
    prisma.pendingTransfer.count({ where: { toClassId: classId, status: "PENDING" } }),
  ]);
  if (attendances || records || terms || transfers) {
    return res.status(400).json({
      error: `${klass.name} already has records (attendance or terms) attached to it and can't be deleted. Only classes that were never used can be removed.`,
    });
  }

  await prisma.class.delete({ where: { id: classId } });
  res.json({ ok: true, deleted: { id: classId, name: klass.name } });
});

router.get("/", requireRole("HEADMASTER"), async (req, res) => {
  const classes = await prisma.class.findMany({
    where: { schoolId: req.user.schoolId },
    include: {
      teacher: { select: { id: true, name: true, email: true, avatarUrl: true } },
      _count: { select: { students: true } },
    },
    orderBy: { name: "asc" },
  });
  res.json({ classes });
});

router.get("/mine", requireRole("TEACHER"), async (req, res) => {
  const classes = await prisma.class.findMany({
    where: { teacherId: req.user.id },
    include: { students: { orderBy: { name: "asc" } } },
  });

  if (classes.length === 0) {
    return res.status(404).json({ error: "You are not assigned as a class teacher yet" });
  }

  res.json({ classes });
});

router.get("/mine/dashboard", requireRole("TEACHER"), async (req, res) => {
  const klass = await prisma.class.findFirst({
    where: { teacherId: req.user.id },
    include: { students: { orderBy: { name: "asc" } } },
  });

  if (!klass) {
    return res.status(404).json({ error: "No class assigned" });
  }

  const studentIds = klass.students.map((s) => s.id);

  const attendanceCounts = await prisma.attendance.groupBy({
    by: ["studentId", "status"],
    where: { studentId: { in: studentIds } },
    _count: { status: true },
  });

  const absentMap = {};
  const totalMap = {};
  for (const row of attendanceCounts) {
    totalMap[row.studentId] = (totalMap[row.studentId] || 0) + row._count.status;
    if (row.status === "UNAVAILABLE") {
      absentMap[row.studentId] = (absentMap[row.studentId] || 0) + row._count.status;
    }
  }

  // Discipline marks for the class, scoped to the running term (or the year
  // when the school has no term tracking yet).
  const currentTerm = await getCurrentTerm(req.user.schoolId);
  const now = new Date();
  const discStart = currentTerm ? currentTerm.starts : new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const discEnd = currentTerm ? currentTerm.ends || now : new Date(Date.UTC(now.getUTCFullYear() + 1, 0, 1));

  const [disciplineGroups, disciplineSetting] = await Promise.all([
    prisma.disciplineCase.groupBy({
      by: ["studentId"],
      where: { schoolId: req.user.schoolId, studentId: { in: studentIds }, date: { gte: discStart, lt: discEnd } },
      _sum: { marksDeducted: true },
      _count: { id: true },
    }),
    prisma.disciplineSetting.findUnique({ where: { schoolId: req.user.schoolId } }),
  ]);
  const defaultMarks = disciplineSetting?.defaultMarks ?? 40;
  const punishmentThreshold = disciplineSetting?.punishmentThreshold ?? 10;
  const deductedMap = new Map(disciplineGroups.map((g) => [g.studentId, g]));
  const marksNameMap = new Map(disciplineGroups.map((g) => [g.studentId, g._count.id]));

  const studentsWithStats = klass.students.map((s) => {
    const g = deductedMap.get(s.id);
    const deducted = g?._sum.marksDeducted || 0;
    return {
      ...s,
      totalDays: totalMap[s.id] || 0,
      absentDays: absentMap[s.id] || 0,
      absenceRate: totalMap[s.id] ? Math.round(((absentMap[s.id] || 0) / totalMap[s.id]) * 100) : 0,
      disciplineDeducted: deducted,
      disciplineRemaining: Math.max(0, defaultMarks - deducted),
      disciplineCases: marksNameMap.get(s.id) || 0,
      punishable: deducted >= punishmentThreshold,
    };
  });

  const genderCounts = {};
  for (const s of klass.students) {
    const g = s.gender || "Unknown";
    genderCounts[g] = (genderCounts[g] || 0) + 1;
  }

  const highAbsence = studentsWithStats
    .filter((s) => s.absentDays > 0)
    .sort((a, b) => b.absenceRate - a.absenceRate)
    .slice(0, 5);

  const lowDiscipline = studentsWithStats
    .filter((s) => s.punishable)
    .sort((a, b) => b.disciplineDeducted - a.disciplineDeducted)
    .slice(0, 10);

  res.json({
    class: { id: klass.id, name: klass.name },
    totalStudents: klass.students.length,
    genderCounts,
    highAbsence,
    lowDiscipline,
    disciplineSetting: { defaultMarks, punishmentThreshold },
    term: currentTerm
      ? { name: currentTerm.name, starts: currentTerm.starts.toISOString().slice(0, 10) }
      : null,
    students: studentsWithStats,
  });
});

module.exports = router;
