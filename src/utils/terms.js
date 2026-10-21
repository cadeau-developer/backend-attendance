const prisma = require("../config/db");

// The school's current (open) term, or null when the school has not started
// term tracking yet. A current term is the one whose ends is still NULL.
async function getCurrentTerm(schoolId) {
  if (!schoolId) return null;
  return prisma.schoolTerm.findFirst({
    where: { schoolId, ends: null },
    orderBy: { number: "desc" },
  });
}

// The school's open year, or null when no year has been started. Terms can
// only be started while a year is open.
async function getCurrentSchoolYear(schoolId) {
  if (!schoolId) return null;
  return prisma.schoolYear.findFirst({
    where: { schoolId, ends: null },
    orderBy: { year: "desc" },
  });
}

// Date-only UTC helper.
function todayUTC() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

module.exports = { getCurrentTerm, getCurrentSchoolYear, todayUTC };
