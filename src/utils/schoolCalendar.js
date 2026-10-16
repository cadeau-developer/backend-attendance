const prisma = require("../config/db");

function isWeekend(date) {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

async function findScheduledOffDay(schoolId, date) {
  const explicit = await prisma.offDay.findFirst({
    where: { date, OR: [{ schoolId: null }, { schoolId }] },
  });
  if (explicit) return { label: explicit.label, auto: false, weekend: false };

  if (isWeekend(date)) {
    const weekendAttendance = await prisma.weekendAttendanceDay.findUnique({
      where: { date_schoolId: { date, schoolId } },
    });
    if (!weekendAttendance) {
      const dayName = date.getUTCDay() === 6 ? "Saturday" : "Sunday";
      return { label: `${dayName} weekend`, auto: false, weekend: true };
    }
  }

  return null;
}

module.exports = { findScheduledOffDay, isWeekend };
