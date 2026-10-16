const express = require("express");
const prisma = require("../config/db");
const { authenticate, requireApprovedSchool } = require("../middleware/auth");
const { requireRole } = require("../middleware/role");

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

  const studentsWithStats = klass.students.map((s) => ({
    ...s,
    totalDays: totalMap[s.id] || 0,
    absentDays: absentMap[s.id] || 0,
    absenceRate: totalMap[s.id] ? Math.round(((absentMap[s.id] || 0) / totalMap[s.id]) * 100) : 0,
  }));

  const genderCounts = {};
  for (const s of klass.students) {
    const g = s.gender || "Unknown";
    genderCounts[g] = (genderCounts[g] || 0) + 1;
  }

  const highAbsence = studentsWithStats
    .filter((s) => s.absentDays > 0)
    .sort((a, b) => b.absenceRate - a.absenceRate)
    .slice(0, 5);

  res.json({
    class: { id: klass.id, name: klass.name },
    totalStudents: klass.students.length,
    genderCounts,
    highAbsence,
    students: studentsWithStats,
  });
});

module.exports = router;
