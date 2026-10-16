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

// Loads a class in the caller's school and, for teachers, verifies ownership.
async function loadClassForAccess(req, res, classId) {
  const klass = await prisma.class.findFirst({
    where: { id: Number(classId), schoolId: req.user.schoolId },
  });
  if (!klass) {
    res.status(404).json({ error: "Class not found" });
    return null;
  }
  if (req.user.role === "TEACHER" && klass.teacherId !== req.user.id) {
    res.status(403).json({ error: "You are not the class teacher for this class" });
    return null;
  }
  return klass;
}

// Classes available as a transfer destination (school-wide for headmasters,
// every class for teachers so they can hand a student to another teacher).
router.get("/classes", requireRole("TEACHER", "HEADMASTER"), async (req, res) => {
  const classes = await prisma.class.findMany({
    where: { schoolId: req.user.schoolId },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  res.json({ classes });
});

// Undergraduates (students archived at the end of a year) for the caller's scope.
router.get("/undergraduates", requireRole("TEACHER", "HEADMASTER"), async (req, res) => {
  const year = parseYear(req.query.year);
  const where = { schoolId: req.user.schoolId, year, status: "UNDERGRADUATE" };
  if (req.user.role === "TEACHER") where.class = { teacherId: req.user.id };

  const records = await prisma.studentRecord.findMany({
    where,
    include: { student: { select: { id: true, name: true, photoUrl: true, gender: true } } },
    orderBy: [{ classSnapshot: "asc" }, { student: { name: "asc" } }],
  });
  res.json({ year, records });
});

// End the year for a class: archive every student into undergraduates and free
// the class roster. Used at the end of primary 6 / senior 3 / senior 6 and for
// every class being rolled over.
router.post("/end-year", requireRole("TEACHER", "HEADMASTER"), async (req, res) => {
  const year = parseYear(req.body.year);
  const klass = await loadClassForAccess(req, res, req.body.classId);
  if (!klass) return;

  const students = await prisma.student.findMany({ where: { classId: klass.id } });
  if (students.length === 0) {
    return res.status(400).json({ error: "This class has no students to transfer" });
  }

  const archived = await prisma.$transaction(async (tx) => {
    const out = [];
    for (const s of students) {
      const record = await tx.studentRecord.upsert({
        where: { studentId_classId_year: { studentId: s.id, classId: klass.id, year } },
        create: {
          studentId: s.id,
          classId: klass.id,
          schoolId: klass.schoolId,
          classSnapshot: klass.name,
          year,
          status: "UNDERGRADUATE",
          termCompleted: true,
        },
        update: { status: "UNDERGRADUATE", termCompleted: true },
      });
      await tx.student.update({ where: { id: s.id }, data: { classId: null } });
      out.push(record);
    }
    return out;
  });

  res.json({ year, class: { id: klass.id, name: klass.name }, archived: archived.length });
});

// Repeat: send an undergraduate back into the class they were in.
router.post("/repeat", requireRole("TEACHER", "HEADMASTER"), async (req, res) => {
  const record = await prisma.studentRecord.findFirst({
    where: { id: Number(req.body.recordId), schoolId: req.user.schoolId, status: "UNDERGRADUATE" },
    include: { class: true },
  });
  if (!record) {
    return res.status(404).json({ error: "Undergraduate record not found" });
  }
  if (req.user.role === "TEACHER" && record.class.teacherId !== req.user.id) {
    return res.status(403).json({ error: "You are not the class teacher for this class" });
  }

  const year = parseYear(req.body.year || record.year + 1);

  await prisma.$transaction([
    prisma.student.update({ where: { id: record.studentId }, data: { classId: record.classId } }),
    prisma.studentRecord.update({
      where: { id: record.id },
      data: { status: "REPEATED", movedToClassId: record.classId, endedAt: new Date() },
    }),
    prisma.studentRecord.upsert({
      where: { studentId_classId_year: { studentId: record.studentId, classId: record.classId, year } },
      create: {
        studentId: record.studentId,
        classId: record.classId,
        schoolId: record.schoolId,
        classSnapshot: record.classSnapshot,
        year,
        status: "ACTIVE",
      },
      update: { status: "ACTIVE", endedAt: null },
    }),
  ]);

  res.json({ ok: true, studentId: record.studentId, classId: record.classId });
});

// Send one or many students to a target class. The move is staged as pending
// transfers; the receiving class teacher (or a headmaster) must accept them.
router.post("/transfer", requireRole("TEACHER", "HEADMASTER"), async (req, res) => {
  const year = parseYear(req.body.year);
  const ids = Array.isArray(req.body.studentIds) ? req.body.studentIds.map(Number).filter(Number.isInteger) : [];
  if (ids.length === 0) {
    return res.status(400).json({ error: "Select at least one student" });
  }

  const target = await prisma.class.findFirst({
    where: { id: Number(req.body.toClassId), schoolId: req.user.schoolId },
  });
  if (!target) return res.status(404).json({ error: "Target class not found" });

  const [students, undergrads] = await Promise.all([
    prisma.student.findMany({ where: { id: { in: ids } } }),
    prisma.studentRecord.findMany({
      where: { studentId: { in: ids }, schoolId: req.user.schoolId, status: "UNDERGRADUATE" },
      orderBy: { year: "desc" },
    }),
  ]);
  const undergradByStudent = new Map();
  for (const r of undergrads) if (!undergradByStudent.has(r.studentId)) undergradByStudent.set(r.studentId, r);

  if (req.user.role === "TEACHER") {
    const owned = await prisma.class.findMany({
      where: { schoolId: req.user.schoolId, teacherId: req.user.id },
      select: { id: true },
    });
    const ownedIds = new Set(owned.map((c) => c.id));
    for (const s of students) {
      const sourceClassId = s.classId ?? undergradByStudent.get(s.id)?.classId;
      if (!ownedIds.has(sourceClassId)) {
        return res.status(403).json({ error: "You can only transfer students from your own class" });
      }
    }
  }

  const classIds = [...new Set(students.map((s) => s.classId).filter(Boolean))];
  const sourceClasses = await prisma.class.findMany({ where: { id: { in: classIds } } });
  const sourceName = new Map(sourceClasses.map((c) => [c.id, c.name]));

  await prisma.$transaction(async (tx) => {
    await tx.pendingTransfer.updateMany({
      where: { studentId: { in: ids }, toClassId: target.id, year, status: "PENDING" },
      data: { status: "CANCELLED" },
    });

    for (const s of students) {
      const under = undergradByStudent.get(s.id);
      const fromClassId = s.classId ?? under?.classId ?? null;
      const fromClassName = s.classId
        ? sourceName.get(s.classId) || ""
        : under?.classSnapshot || "Undergraduates";

      await tx.pendingTransfer.create({
        data: {
          studentId: s.id,
          schoolId: req.user.schoolId,
          fromClassId,
          fromClassName,
          toClassId: target.id,
          year,
          createdByUserId: req.user.id,
          status: "PENDING",
        },
      });

      // Remove the student from their current class right away; they only join
      // the destination once the receiving teacher accepts them.
      if (s.classId) {
        await tx.studentRecord.updateMany({
          where: { studentId: s.id, schoolId: req.user.schoolId, status: "ACTIVE", classId: s.classId },
          data: { status: "PENDING_TRANSFER", movedToClassId: target.id },
        });
        await tx.student.update({ where: { id: s.id }, data: { classId: null } });
      }
    }
  });

  res.json({ requested: students.length, toClassId: target.id, toClassName: target.name });
});

// Students waiting to be received into a class the caller teaches (or any class
// for a headmaster).
router.get("/incoming", requireRole("TEACHER", "HEADMASTER"), async (req, res) => {
  const year = parseYear(req.query.year);
  const where = { schoolId: req.user.schoolId, year, status: "PENDING" };

  if (req.user.role === "TEACHER") {
    const owned = await prisma.class.findMany({
      where: { schoolId: req.user.schoolId, teacherId: req.user.id },
      select: { id: true },
    });
    where.toClassId = { in: owned.map((c) => c.id) };
  }

  const transfers = await prisma.pendingTransfer.findMany({
    where,
    include: { student: { select: { id: true, name: true, photoUrl: true, gender: true } } },
    orderBy: [{ fromClassName: "asc" }, { student: { name: "asc" } }],
  });

  const classIds = [...new Set(transfers.map((t) => t.toClassId))];
  const classes = await prisma.class.findMany({ where: { id: { in: classIds } }, select: { id: true, name: true } });
  const classMap = Object.fromEntries(classes.map((c) => [c.id, c.name]));

  res.json({
    year,
    transfers: transfers.map((t) => ({ ...t, toClassName: classMap[t.toClassId] || "" })),
  });
});

// Accept pending transfers, moving the students into their target class.
router.post("/receive", requireRole("TEACHER", "HEADMASTER"), async (req, res) => {
  const ids = Array.isArray(req.body.transferIds) ? req.body.transferIds.map(Number).filter(Number.isInteger) : [];
  if (ids.length === 0) {
    return res.status(400).json({ error: "Select at least one student to receive" });
  }

  const transfers = await prisma.pendingTransfer.findMany({
    where: { id: { in: ids }, schoolId: req.user.schoolId, status: "PENDING" },
  });
  if (transfers.length === 0) {
    return res.status(404).json({ error: "No pending transfers found" });
  }

  if (req.user.role === "TEACHER") {
    const owned = await prisma.class.findMany({
      where: { schoolId: req.user.schoolId, teacherId: req.user.id },
      select: { id: true },
    });
    const ownedIds = new Set(owned.map((c) => c.id));
    for (const t of transfers) {
      if (!ownedIds.has(t.toClassId)) {
        return res.status(403).json({ error: "You can only receive students into your own class" });
      }
    }
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    for (const t of transfers) {
      const target = await tx.class.findUnique({ where: { id: t.toClassId } });

      const under = await tx.studentRecord.findFirst({
        where: { studentId: t.studentId, schoolId: req.user.schoolId, status: "UNDERGRADUATE" },
        orderBy: { year: "desc" },
      });
      if (under) {
        await tx.studentRecord.update({
          where: { id: under.id },
          data: { status: "PROMOTED", movedToClassId: t.toClassId, endedAt: now },
        });
      }

      const stale = await tx.studentRecord.findMany({
        where: { studentId: t.studentId, status: { in: ["ACTIVE", "PENDING_TRANSFER"] }, classId: { not: t.toClassId } },
      });
      for (const r of stale) {
        await tx.studentRecord.update({
          where: { id: r.id },
          data: { status: "TRANSFERRED", movedToClassId: t.toClassId, endedAt: now },
        });
      }

      await tx.student.update({ where: { id: t.studentId }, data: { classId: t.toClassId } });
      await tx.studentRecord.upsert({
        where: { studentId_classId_year: { studentId: t.studentId, classId: t.toClassId, year: t.year } },
        create: {
          studentId: t.studentId,
          classId: t.toClassId,
          schoolId: req.user.schoolId,
          classSnapshot: target?.name || "",
          year: t.year,
          status: "ACTIVE",
        },
        update: { status: "ACTIVE", endedAt: null },
      });
      await tx.pendingTransfer.update({
        where: { id: t.id },
        data: { status: "RECEIVED", receivedAt: now },
      });
    }
  });

  res.json({ received: transfers.length });
});

// Decline a pending transfer (keeps the student where they are).
router.post("/cancel-transfer", requireRole("TEACHER", "HEADMASTER"), async (req, res) => {
  const ids = Array.isArray(req.body.transferIds) ? req.body.transferIds.map(Number).filter(Number.isInteger) : [];
  if (ids.length === 0) {
    return res.status(400).json({ error: "Select at least one student" });
  }
  const transfers = await prisma.pendingTransfer.findMany({
    where: { id: { in: ids }, schoolId: req.user.schoolId, status: "PENDING" },
  });

  // Put each student back into the class they came from.
  await prisma.$transaction(async (tx) => {
    for (const t of transfers) {
      await tx.pendingTransfer.update({ where: { id: t.id }, data: { status: "CANCELLED" } });
      if (t.fromClassId) {
        await tx.student.updateMany({ where: { id: t.studentId }, data: { classId: t.fromClassId } });
        await tx.studentRecord.updateMany({
          where: {
            studentId: t.studentId,
            schoolId: req.user.schoolId,
            status: "PENDING_TRANSFER",
            classId: t.fromClassId,
          },
          data: { status: "ACTIVE", movedToClassId: null },
        });
      }
    }
  });

  res.json({ cancelled: transfers.length });
});

// Every class a student has been in for at least a completed term.
router.get("/student/:studentId/classes", requireRole("TEACHER", "HEADMASTER"), async (req, res) => {
  const studentId = Number(req.params.studentId);
  const student = await prisma.student.findFirst({
    where: { id: studentId, records: { some: { schoolId: req.user.schoolId } } },
    select: { id: true, name: true, photoUrl: true },
  });
  if (!student) {
    return res.status(404).json({ error: "Student not found" });
  }

  const records = await prisma.studentRecord.findMany({
    where: { studentId, schoolId: req.user.schoolId, termCompleted: true },
    orderBy: [{ year: "desc" }, { classSnapshot: "asc" }],
  });

  res.json({
    student,
    classes: records.map((r) => ({
      id: r.id,
      classId: r.classId,
      name: r.classSnapshot,
      year: r.year,
      status: r.status,
    })),
  });
});

module.exports = router;
