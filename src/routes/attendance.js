const express = require("express");
const prisma = require("../config/db");
const { authenticate, requireApprovedSchool } = require("../middleware/auth");
const { requireRole } = require("../middleware/role");
const { findScheduledOffDay, isWeekend } = require("../utils/schoolCalendar");
const { getCurrentTerm } = require("../utils/terms");

const router = express.Router();

router.use(authenticate, requireApprovedSchool);

function toDateOnly(value) {
  const d = value ? new Date(value) : new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

// Is the given day effectively an off day for this school?
// An explicit off day (global or school) always counts. Otherwise, if the date is
// in the past and no class of the school submitted any attendance that day, the
// day is automatically treated as an off day (auto). Today is never auto-marked
// because teachers may still submit.
async function resolveEffectiveOffDay(schoolId, day) {
  const scheduled = await findScheduledOffDay(schoolId, day);
  if (scheduled) return scheduled;

  const today = toDateOnly();
  if (day.getTime() >= today.getTime()) return null;
  if (isWeekend(day)) return null;

  const [classCount, submissionCount] = await Promise.all([
    prisma.class.count({ where: { schoolId } }),
    prisma.attendance.count({ where: { date: day, class: { schoolId } } }),
  ]);
  if (classCount === 0 || submissionCount > 0) return null;

  return { label: "No class submitted attendance", auto: true };
}

// Teacher submits/updates a full day's attendance for their class.
// Body: { classId, date?, unavailable: [{ studentId, reason }] }
// Every other student in the class is recorded as PRESENT.
router.post("/", requireRole("TEACHER"), async (req, res) => {
  const { classId, date, unavailable = [] } = req.body;

  if (!classId) {
    return res.status(400).json({ error: "classId is required" });
  }

  const klass = await prisma.class.findFirst({
    where: { id: Number(classId), schoolId: req.user.schoolId, teacherId: req.user.id },
    include: { students: true },
  });

  if (!klass) {
    return res.status(403).json({ error: "You are not the class teacher for this class" });
  }

  const day = toDateOnly(date);

  const explicitOffDay = await findScheduledOffDay(req.user.schoolId, day);
  if (explicitOffDay) {
    return res
      .status(400)
      .json({
        error: `This date is an off day${explicitOffDay.label ? ` (${explicitOffDay.label})` : ""} — attendance cannot be taken.`,
      });
  }

  // Dates before the running term belong to a finished term: history, not editable.
  const currentTerm = await getCurrentTerm(req.user.schoolId);
  if (currentTerm && day.getTime() < currentTerm.starts.getTime()) {
    return res.status(400).json({
      error: `${currentTerm.name} started on ${currentTerm.starts.toISOString().slice(0, 10)} — attendance for earlier dates is history.`,
    });
  }

  const unavailableMap = new Map(unavailable.map((u) => [Number(u.studentId), u.reason || null]));

  const existingDay = await prisma.attendanceDay.findUnique({
    where: { classId_date: { classId: klass.id, date: day } },
  });
  if (existingDay) {
    return res
      .status(400)
      .json({ error: "Attendance for this day has already been submitted and cannot be updated." });
  }

  const results = await prisma.$transaction(
    klass.students.map((student) => {
      const isUnavailable = unavailableMap.has(student.id);
      return prisma.attendance.create({
        data: {
          studentId: student.id,
          classId: klass.id,
          date: day,
          status: isUnavailable ? "UNAVAILABLE" : "PRESENT",
          reason: isUnavailable ? unavailableMap.get(student.id) : null,
          recordedByUserId: req.user.id,
        },
      });
    })
  );

  await prisma.attendanceDay.create({ data: { classId: klass.id, date: day, editCount: 0 } });

  res.status(201).json({ date: day, attendance: results, editCount: 0, canEdit: false });
});

// Teacher views a given day's attendance for their class.
router.get("/", requireRole("TEACHER"), async (req, res) => {
  const { classId, date } = req.query;
  if (!classId) {
    return res.status(400).json({ error: "classId is required" });
  }

  const klass = await prisma.class.findFirst({
    where: { id: Number(classId), schoolId: req.user.schoolId, teacherId: req.user.id },
  });
  if (!klass) {
    return res.status(403).json({ error: "You are not the class teacher for this class" });
  }

  const day = toDateOnly(date);
  const [attendance, dayRow, offDay, currentTerm] = await Promise.all([
    prisma.attendance.findMany({
      where: { classId: klass.id, date: day },
      include: { student: { select: { id: true, name: true, photoUrl: true } } },
    }),
    prisma.attendanceDay.findUnique({ where: { classId_date: { classId: klass.id, date: day } } }),
    findScheduledOffDay(req.user.schoolId, day),
    getCurrentTerm(req.user.schoolId),
  ]);

  const historyDay = !!(currentTerm && day.getTime() < currentTerm.starts.getTime());

  res.json({
    date: day,
    attendance,
    submitted: !!dayRow,
    editCount: dayRow?.editCount ?? 0,
    canEdit: !historyDay && !dayRow,
    history: historyDay,
    term: currentTerm
      ? { name: currentTerm.name, starts: currentTerm.starts.toISOString().slice(0, 10) }
      : null,
    offDay: offDay ? { label: offDay.label, weekend: offDay.weekend } : null,
  });
});

// Headmaster: school-wide report of unavailable students for a date (optionally one class).
router.get("/report", requireRole("HEADMASTER"), async (req, res) => {
  const { date, classId } = req.query;
  const day = toDateOnly(date);

  const offDay = await resolveEffectiveOffDay(req.user.schoolId, day);

  const [attendance, classes, submissions] = await Promise.all([
    prisma.attendance.findMany({
      where: {
        status: "UNAVAILABLE",
        date: day,
        class: { schoolId: req.user.schoolId, ...(classId ? { id: Number(classId) } : {}) },
      },
      include: {
        student: { select: { id: true, name: true, photoUrl: true } },
        class: { select: { id: true, name: true } },
      },
      orderBy: { class: { name: "asc" } },
    }),
    prisma.class.findMany({
      where: { schoolId: req.user.schoolId },
      include: { teacher: { select: { id: true, name: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.attendance.findMany({
      where: { date: day, class: { schoolId: req.user.schoolId } },
      select: { classId: true },
      distinct: ["classId"],
    }),
  ]);

  const submitted = new Set(submissions.map((s) => s.classId));
  const pendingClasses = classes
    .filter((c) => (classId ? c.id === Number(classId) : true) && !submitted.has(c.id))
    .map((c) => ({ id: c.id, name: c.name, teacher: c.teacher ? c.teacher.name : null }));

  res.json({
    date: day,
    unavailable: attendance,
    pendingClasses: offDay ? [] : pendingClasses,
    offDay: offDay
      ? { label: offDay.label, auto: offDay.auto, weekend: offDay.weekend }
      : null,
  });
});

module.exports = router;
