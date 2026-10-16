const express = require("express");
const prisma = require("../config/db");
const { authenticate } = require("../middleware/auth");
const { requireRole } = require("../middleware/role");

const router = express.Router();

router.use(authenticate);

const YEAR_ERROR = "School year must look like 2026/2027";

// Accepts "2026/2027" (or "2026-2027") and returns a normalised label, or an
// { error } object when the value is not a valid consecutive school year.
function normalizeSchoolYear(value) {
  if (value === null || value === undefined || String(value).trim() === "") {
    return { value: null };
  }
  const raw = String(value).trim().replace(/[\s-]/g, "/");
  const match = raw.match(/^(\d{4})\/(\d{4})$/);
  if (!match) return { error: YEAR_ERROR };
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (end !== start + 1) {
    return { error: "The two years must be consecutive (e.g. 2026/2027)" };
  }
  return { value: `${start}/${end}` };
}

// The platform settings row is a singleton (id = 1); create it on first read.
async function getSettings() {
  const existing = await prisma.platformSetting.findUnique({ where: { id: 1 } });
  if (existing) return existing;
  return prisma.platformSetting.create({ data: { id: 1 } });
}

function serialize(settings) {
  return { schoolYear: settings.schoolYear, updatedAt: settings.updatedAt };
}

// Every signed-in user can read the school year so it can be shown as a label.
router.get("/", requireRole("SUPER_ADMIN", "HEADMASTER", "TEACHER"), async (req, res) => {
  const settings = await getSettings();
  res.json({ settings: serialize(settings) });
});

// Only the super admin sets the platform-wide school year.
router.put("/", requireRole("SUPER_ADMIN"), async (req, res) => {
  const result = normalizeSchoolYear(req.body.schoolYear);
  if (result.error) {
    return res.status(400).json({ error: result.error });
  }

  const settings = await prisma.platformSetting.upsert({
    where: { id: 1 },
    create: { id: 1, schoolYear: result.value, updatedByUserId: req.user.id },
    update: { schoolYear: result.value, updatedByUserId: req.user.id },
  });

  res.json({ settings: serialize(settings) });
});

module.exports = router;
