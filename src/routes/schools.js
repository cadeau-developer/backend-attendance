const express = require("express");
const prisma = require("../config/db");
const { authenticate, requireApprovedSchool } = require("../middleware/auth");
const { requireRole } = require("../middleware/role");
const { isRwPhone, PHONE_ERROR } = require("../utils/validate");

const router = express.Router();

router.use(authenticate, requireApprovedSchool, requireRole("HEADMASTER"));

// Headmaster updates their school's public details (incl. logo upload).
router.patch("/me", async (req, res) => {
  const { name, schoolType, address, city, phone, email, logoUrl, province, district, sector, cell, village } = req.body;

  const data = {};
  if (typeof name === "string" && name.trim()) data.name = name.trim();
  if (typeof schoolType === "string") data.schoolType = schoolType.trim() || null;
  if (typeof address === "string") data.address = address.trim() || null;
  if (typeof city === "string") data.city = city.trim() || null;
  if (typeof phone === "string") {
    const cleanPhone = phone.trim() || null;
    if (cleanPhone && !isRwPhone(cleanPhone)) {
      return res.status(400).json({ error: PHONE_ERROR });
    }
    data.phone = cleanPhone;
  }
  if (typeof email === "string") data.email = email.trim() || null;
  if (typeof logoUrl === "string") data.logoUrl = logoUrl || null;
  if (typeof province === "string") data.province = province.trim() || null;
  if (typeof district === "string") data.district = district.trim() || null;
  if (typeof sector === "string") data.sector = sector.trim() || null;
  if (typeof cell === "string") data.cell = cell.trim() || null;
  if (typeof village === "string") data.village = village.trim() || null;

  const school = await prisma.school.update({
    where: { id: req.user.schoolId },
    data,
  });

  res.json({ school });
});

module.exports = router;