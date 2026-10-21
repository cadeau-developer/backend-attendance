const express = require("express");
const prisma = require("../config/db");
const { authenticate, requireApprovedSchool } = require("../middleware/auth");
const { requireRole } = require("../middleware/role");
const { isRwPhone, PHONE_ERROR } = require("../utils/validate");
const { imageRef } = require("../utils/uploads");

const router = express.Router();

function checkPhone(value) {
  if (value && !isRwPhone(value)) {
    return PHONE_ERROR;
  }
  return null;
}

router.use(authenticate, requireApprovedSchool);

async function loadClassForAccess(req, res, next) {
  const classId = Number(req.params.classId);
  const klass = await prisma.class.findFirst({
    where: { id: classId, schoolId: req.user.schoolId },
  });

  if (!klass) {
    return res.status(404).json({ error: "Class not found" });
  }

  if (req.user.role === "TEACHER" && klass.teacherId !== req.user.id) {
    return res.status(403).json({ error: "You are not the class teacher for this class" });
  }

  req.klass = klass;
  next();
}

router.post(
  "/classes/:classId/students",
  requireRole("TEACHER"),
  loadClassForAccess,
  async (req, res) => {
    const {
      name,
      admissionNo,
      photoUrl,
      gender,
      birthDate,
      province,
      district,
      sector,
      cell,
      village,
      parentNames,
      parentPhone,
      fatherName,
      fatherPhone,
      motherName,
      motherPhone,
    } = req.body;
    if (!name) {
      return res.status(400).json({ error: "name is required" });
    }
    if (!gender) {
      return res.status(400).json({ error: "gender is required" });
    }
    for (const phone of [parentPhone, fatherPhone, motherPhone]) {
      const phoneError = checkPhone(phone);
      if (phoneError) return res.status(400).json({ error: phoneError });
    }

    const student = await prisma.student.create({
      data: {
        name,
        gender: gender || null,
        birthDate: birthDate ? new Date(birthDate) : null,
        admissionNo: admissionNo || null,
        photoUrl: await imageRef(photoUrl, req),
        province: province || null,
        district: district || null,
        sector: sector || null,
        cell: cell || null,
        village: village || null,
        parentNames: parentNames || null,
        parentPhone: parentPhone || null,
        fatherName: fatherName || null,
        fatherPhone: fatherPhone || null,
        motherName: motherName || null,
        motherPhone: motherPhone || null,
        classId: req.klass.id,
      },
    });

    await prisma.studentRecord.create({
      data: {
        studentId: student.id,
        classId: req.klass.id,
        schoolId: req.klass.schoolId,
        classSnapshot: req.klass.name,
        year: new Date().getFullYear(),
        status: "ACTIVE",
      },
    });

    res.status(201).json({ student });
  }
);

router.patch(
  "/classes/:classId/students/:id",
  requireRole("TEACHER"),
  loadClassForAccess,
  async (req, res) => {
    const studentId = Number(req.params.id);
    const {
      name,
      admissionNo,
      photoUrl,
      gender,
      birthDate,
      province,
      district,
      sector,
      cell,
      village,
      parentNames,
      parentPhone,
      fatherName,
      fatherPhone,
      motherName,
      motherPhone,
    } = req.body;

    if (!Number.isInteger(studentId)) {
      return res.status(400).json({ error: "Invalid student id" });
    }

    const student = await prisma.student.findFirst({
      where: { id: studentId, classId: req.klass.id },
    });

    if (!student) {
      return res.status(404).json({ error: "Student not found in this class" });
    }

    for (const phone of [parentPhone, fatherPhone, motherPhone]) {
      const phoneError = checkPhone(phone);
      if (phoneError) return res.status(400).json({ error: phoneError });
    }

    const data = {};
    if (typeof name === "string" && name.trim()) data.name = name.trim();
    if (typeof admissionNo === "string") data.admissionNo = admissionNo.trim() || null;
    if (typeof photoUrl === "string") data.photoUrl = await imageRef(photoUrl, req);
    if (typeof gender === "string") data.gender = gender.trim() || null;
    if (birthDate === null || typeof birthDate === "string") data.birthDate = birthDate ? new Date(birthDate) : null;
    if (typeof province === "string") data.province = province.trim() || null;
    if (typeof district === "string") data.district = district.trim() || null;
    if (typeof sector === "string") data.sector = sector.trim() || null;
    if (typeof cell === "string") data.cell = cell.trim() || null;
    if (typeof village === "string") data.village = village.trim() || null;
    if (typeof parentNames === "string") data.parentNames = parentNames.trim() || null;
    if (typeof parentPhone === "string") data.parentPhone = parentPhone.trim() || null;
    if (typeof fatherName === "string") data.fatherName = fatherName.trim() || null;
    if (typeof fatherPhone === "string") data.fatherPhone = fatherPhone.trim() || null;
    if (typeof motherName === "string") data.motherName = motherName.trim() || null;
    if (typeof motherPhone === "string") data.motherPhone = motherPhone.trim() || null;

    const updated = await prisma.student.update({ where: { id: studentId }, data });
    res.json({ student: updated });
  }
);

router.get(
  "/classes/:classId/students",
  requireRole("TEACHER", "HEADMASTER"),
  loadClassForAccess,
  async (req, res) => {
    const students = await prisma.student.findMany({
      where: { classId: req.klass.id },
      orderBy: { name: "asc" },
    });
    res.json({ students });
  }
);

router.post(
  "/classes/:classId/students/:id/photo",
  requireRole("TEACHER"),
  loadClassForAccess,
  async (req, res) => {
    const studentId = Number(req.params.id);
    const { photoUrl } = req.body;

    if (!photoUrl) {
      return res.status(400).json({ error: "photoUrl is required" });
    }

    const student = await prisma.student.findFirst({
      where: { id: studentId, classId: req.klass.id },
    });

    if (!student) {
      return res.status(404).json({ error: "Student not found in this class" });
    }

    const updated = await prisma.student.update({
      where: { id: studentId },
      data: { photoUrl: await imageRef(String(photoUrl), req) },
    });

    res.json({ student: updated });
  }
);

// Mark a student as having left the school. They leave the class and any
// undergraduate bucket, and are excluded from future rosters.
router.post(
  "/classes/:classId/students/:id/leave",
  requireRole("TEACHER", "HEADMASTER"),
  loadClassForAccess,
  async (req, res) => {
    const studentId = Number(req.params.id);
    if (!Number.isInteger(studentId)) {
      return res.status(400).json({ error: "Invalid student id" });
    }

    const student = await prisma.student.findFirst({
      where: { id: studentId, classId: req.klass.id },
    });
    if (!student) {
      return res.status(404).json({ error: "Student not found in this class" });
    }

    const now = new Date();
    await prisma.$transaction([
      prisma.student.update({
        where: { id: studentId },
        data: { leftSchool: true, leftAt: now, classId: null },
      }),
      prisma.studentRecord.updateMany({
        where: { studentId, schoolId: req.user.schoolId, status: { in: ["ACTIVE", "UNDERGRADUATE"] } },
        data: { status: "LEFT", endedAt: now },
      }),
      prisma.pendingTransfer.updateMany({
        where: { studentId, schoolId: req.user.schoolId, status: "PENDING" },
        data: { status: "CANCELLED" },
      }),
    ]);

    res.json({ ok: true });
  }
);

// Mark several students as having left the school at once (also used for
// "remove from class" — the student leaves the roster and is marked left).
router.post(
  "/classes/:classId/students/bulk-leave",
  requireRole("TEACHER", "HEADMASTER"),
  loadClassForAccess,
  async (req, res) => {
    const ids = Array.isArray(req.body.studentIds)
      ? req.body.studentIds.map(Number).filter(Number.isInteger)
      : [];
    if (ids.length === 0) {
      return res.status(400).json({ error: "Select at least one student" });
    }

    const students = await prisma.student.findMany({
      where: { id: { in: ids }, classId: req.klass.id },
      select: { id: true },
    });
    if (students.length === 0) {
      return res.status(404).json({ error: "No matching students in this class" });
    }
    const studentIds = students.map((s) => s.id);

    const now = new Date();
    await prisma.$transaction([
      prisma.student.updateMany({
        where: { id: { in: studentIds } },
        data: { leftSchool: true, leftAt: now, classId: null },
      }),
      prisma.studentRecord.updateMany({
        where: { studentId: { in: studentIds }, schoolId: req.user.schoolId, status: { in: ["ACTIVE", "UNDERGRADUATE"] } },
        data: { status: "LEFT", endedAt: now },
      }),
      prisma.pendingTransfer.updateMany({
        where: { studentId: { in: studentIds }, schoolId: req.user.schoolId, status: "PENDING" },
        data: { status: "CANCELLED" },
      }),
    ]);

    res.json({ ok: true, count: studentIds.length });
  }
);

// School-wide student search, used e.g. so a teacher can find a student in
// another class to file a discipline case against.
router.get("/students", requireRole("TEACHER", "HEADMASTER"), async (req, res) => {
  const { search } = req.query;

  const students = await prisma.student.findMany({
    where: {
      class: { schoolId: req.user.schoolId },
      ...(search ? { name: { contains: String(search), mode: "insensitive" } } : {}),
    },
    include: { class: { select: { id: true, name: true } } },
    orderBy: { name: "asc" },
    take: 50,
  });

  res.json({ students });
});

router.get("/students/:id/history", requireRole("HEADMASTER"), async (req, res) => {
  const studentId = Number(req.params.id);

  const student = await prisma.student.findFirst({
    where: { id: studentId, class: { schoolId: req.user.schoolId } },
    include: { class: { select: { id: true, name: true } } },
  });

  if (!student) {
    return res.status(404).json({ error: "Student not found" });
  }

  const [attendance, disciplineCases] = await Promise.all([
    prisma.attendance.findMany({
      where: { studentId },
      orderBy: { date: "desc" },
      select: { date: true, status: true, reason: true },
    }),
    prisma.disciplineCase.findMany({
      where: { studentId },
      orderBy: { date: "desc" },
      select: { id: true, description: true, date: true, reviewed: true },
    }),
  ]);

  const recorded = attendance.length;
  const unavailableCount = attendance.filter((a) => a.status === "UNAVAILABLE").length;
  const presentCount = recorded - unavailableCount;
  const unavailableDays = attendance
    .filter((a) => a.status === "UNAVAILABLE")
    .map((a) => ({ date: a.date, reason: a.reason }));

  res.json({
    student: { id: student.id, name: student.name, photoUrl: student.photoUrl, class: student.class },
    stats: {
      recordedDays: recorded,
      presentCount,
      unavailableCount,
      presenceRate: recorded ? Math.round((presentCount / recorded) * 100) : 0,
    },
    unavailableDays,
    disciplineCases: disciplineCases.map((c) => ({
      id: c.id,
      description: c.description,
      date: c.date,
      reviewed: c.reviewed,
    })),
  });
});

module.exports = router;
