// Shared year-end helpers: archiving a class's students into undergraduates
// and restoring them when the year end is reverted.

// Archives every student of a class into undergraduates for `year` and frees
// the roster. `students` must already be fetched by the caller.
async function endYearForClass(tx, klass, year, students) {
  for (const s of students) {
    await tx.studentRecord.upsert({
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
      update: { status: "UNDERGRADUATE", termCompleted: true, endedAt: new Date() },
    });
    await tx.student.update({ where: { id: s.id }, data: { classId: null } });
  }
  return students.length;
}

// Puts archived undergraduates back into the class they came from. Students who
// were already placed elsewhere after the end-year (repeat, promotion,
// transfer) keep their new class.
async function revertYearRecords(tx, records) {
  let reverted = 0;
  for (const r of records) {
    await tx.studentRecord.update({
      where: { id: r.id },
      data: { status: "ACTIVE", termCompleted: false, endedAt: null, movedToClassId: null },
    });
    await tx.student.updateMany({
      where: { id: r.studentId, classId: null },
      data: { classId: r.classId },
    });
    reverted += 1;
  }
  return reverted;
}

module.exports = { endYearForClass, revertYearRecords };
