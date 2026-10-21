const express = require("express");
const prisma = require("../config/db");
const { authenticate, requireApprovedSchool } = require("../middleware/auth");
const { requireRole } = require("../middleware/role");
const { getCurrentTerm, getCurrentSchoolYear, todayUTC } = require("../utils/terms");

const router = express.Router();

router.use(authenticate, requireApprovedSchool);

function parseDate(value) {
  if (value === undefined || value === null || value === "") return todayUTC();
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) return null;
  return d;
}

function serialize(term) {
  if (!term) return null;
  return {
    id: term.id,
    number: term.number,
    name: term.name,
    starts: term.starts.toISOString().slice(0, 10),
    ends: term.ends ? term.ends.toISOString().slice(0, 10) : null,
    current: !term.ends,
  };
}

// Every term of the school (oldest first) plus the current one.
router.get("/", requireRole("TEACHER", "HEADMASTER"), async (req, res) => {
  const [terms, currentTerm] = await Promise.all([
    prisma.schoolTerm.findMany({
      where: { schoolId: req.user.schoolId },
      orderBy: { number: "asc" },
    }),
    getCurrentTerm(req.user.schoolId),
  ]);
  res.json({
    terms: terms.map(serialize),
    currentTerm: serialize(currentTerm),
    canStart: !currentTerm,
  });
});

// Headmaster opens a term. Requires the school year to be open.
router.post("/", requireRole("HEADMASTER"), async (req, res) => {
  const schoolYear = await getCurrentSchoolYear(req.user.schoolId);
  if (!schoolYear) {
    return res.status(400).json({ error: "Start the school year before starting a term" });
  }

  const existing = await prisma.schoolTerm.findFirst({
    where: { schoolId: req.user.schoolId },
    orderBy: { number: "desc" },
  });
  if (existing && !existing.ends) {
    return res.status(409).json({ error: `${existing.name} is already running` });
  }

  const starts = parseDate(req.body.starts);
  if (!starts) {
    return res.status(400).json({ error: "starts must be a valid YYYY-MM-DD date" });
  }
  if (starts.getTime() > todayUTC().getTime()) {
    return res.status(400).json({ error: "A term cannot start in the future" });
  }

  const number = existing ? existing.number + 1 : 1;
  const term = await prisma.schoolTerm.create({
    data: { schoolId: req.user.schoolId, number, name: `Term ${number}`, starts },
  });
  res.status(201).json({ currentTerm: serialize(term) });
});

// Headmaster ends the current term. The next term is started explicitly, and
// only while the school year is open.
router.post("/end", requireRole("HEADMASTER"), async (req, res) => {
  const current = await getCurrentTerm(req.user.schoolId);
  if (!current) {
    return res.status(400).json({ error: "No term is currently running" });
  }

  const today = todayUTC();
  if (current.starts.getTime() > today.getTime()) {
    return res.status(400).json({ error: "This term has not started yet" });
  }

  await prisma.schoolTerm.update({ where: { id: current.id }, data: { ends: today } });

  res.json({ ended: serialize({ ...current, ends: today }), currentTerm: null });
});

module.exports = router;
