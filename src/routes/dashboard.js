const express = require("express");
const prisma = require("../config/db");
const { authenticate, requireApprovedSchool } = require("../middleware/auth");
const { requireRole } = require("../middleware/role");
const { findScheduledOffDay } = require("../utils/schoolCalendar");

const router = express.Router();

router.use(authenticate, requireApprovedSchool, requireRole("HEADMASTER"));

function toDateOnly(value) {
  const d = value ? new Date(value) : new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function shiftDate(date, days) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

router.get("/", async (req, res) => {
  const schoolId = req.user.schoolId;
  const today = toDateOnly();
  const weekStart = shiftDate(today, -6);

  const [totalTeachers, totalClasses, totalStudents, todayUnavailable, disciplineCases, weeklyGroups, scheduledOffDay, allStudents, todayUnavailableDetails] =
    await Promise.all([
      prisma.user.count({ where: { schoolId, role: "TEACHER" } }),
      prisma.class.count({ where: { schoolId } }),
      prisma.student.count({ where: { class: { schoolId } } }),
      prisma.attendance.count({
        where: { status: "UNAVAILABLE", date: today, class: { schoolId } },
      }),
      prisma.disciplineCase.count({ where: { schoolId } }),
      prisma.attendance.groupBy({
        by: ["date"],
        where: { status: "UNAVAILABLE", class: { schoolId }, date: { gte: weekStart, lte: today } },
        _count: { _all: true },
      }),
      findScheduledOffDay(schoolId, today),
      prisma.student.findMany({
        where: { class: { schoolId } },
        select: { id: true, gender: true },
      }),
      prisma.attendance.findMany({
        where: { status: "UNAVAILABLE", date: today, class: { schoolId } },
        select: {
          student: { select: { id: true, name: true, gender: true } },
          class: { select: { id: true, name: true } },
          reason: true,
        },
      }),
    ]);

  const genderCounts = {};
  for (const s of allStudents) {
    const g = s.gender || "Unknown";
    genderCounts[g] = (genderCounts[g] || 0) + 1;
  }

  const absentGenderCounts = {};
  for (const u of todayUnavailableDetails) {
    const g = u.student.gender || "Unknown";
    absentGenderCounts[g] = (absentGenderCounts[g] || 0) + 1;
  }

  const latestDiscipline = await prisma.disciplineCase.findMany({
    where: { schoolId },
    orderBy: { date: "desc" },
    take: 3,
    include: {
      student: { select: { id: true, name: true, class: { select: { name: true } } } },
      reportedBy: { select: { name: true } },
    },
  });

  // Students who lost enough discipline marks this year to deserve a punishment.
  const settingRow = await prisma.disciplineSetting.findUnique({ where: { schoolId } });
  const defaultMarks = settingRow?.defaultMarks ?? 40;
  const punishmentThreshold = settingRow?.punishmentThreshold ?? 10;
  const yearStart = new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1));

  const deductionGroups = await prisma.disciplineCase.groupBy({
    by: ["studentId"],
    where: { schoolId, date: { gte: yearStart } },
    _sum: { marksDeducted: true },
  });
  const deductedByStudent = new Map(deductionGroups.map((g) => [g.studentId, g._sum.marksDeducted || 0]));
  const punishableIds = deductionGroups
    .filter((g) => (g._sum.marksDeducted || 0) >= punishmentThreshold)
    .map((g) => g.studentId);

  const punishableRows = punishableIds.length
    ? await prisma.student.findMany({
        where: { id: { in: punishableIds } },
        select: { id: true, name: true, photoUrl: true, class: { select: { id: true, name: true } } },
      })
    : [];

  const punishableStudents = punishableRows
    .map((s) => {
      const deducted = deductedByStudent.get(s.id) || 0;
      return { ...s, deducted, remaining: Math.max(0, defaultMarks - deducted) };
    })
    .sort((a, b) => b.deducted - a.deducted);

  const classesWithAttendance = scheduledOffDay
    ? []
    : await prisma.attendance.findMany({
        where: { date: today, class: { schoolId } },
        select: { classId: true },
        distinct: ["classId"],
      });
  const submittedClassIds = classesWithAttendance.map((a) => a.classId);
  const pendingAttendance = scheduledOffDay
    ? []
    : await prisma.class.findMany({
        where: { schoolId, id: { notIn: submittedClassIds } },
        include: {
          teacher: { select: { id: true, name: true } },
          _count: { select: { students: true } },
        },
        orderBy: { name: "asc" },
      });

  const groupMap = new Map(weeklyGroups.map((g) => [g.date.toISOString(), g._count._all]));
  const weekly = [];
  for (let i = 6; i >= 0; i--) {
    const day = shiftDate(today, -i);
    const iso = day.toISOString();
    const dayOff = scheduledOffDay && day.getTime() === today.getTime();
    weekly.push({ date: iso.slice(0, 10), count: dayOff ? 0 : groupMap.get(iso) || 0 });
  }

  res.json({
    stats: {
      totalTeachers,
      totalClasses,
      totalStudents,
      todayUnavailable: scheduledOffDay ? 0 : todayUnavailable,
      disciplineCases,
    },
    genderCounts,
    absentGenderCounts,
    todayUnavailableDetails,
    weekly,
    latestDiscipline,
    pendingAttendance,
    offDay: scheduledOffDay ? { label: scheduledOffDay.label } : null,
    disciplineSetting: { defaultMarks, punishmentThreshold },
    punishableStudents,
  });
});

module.exports = router;