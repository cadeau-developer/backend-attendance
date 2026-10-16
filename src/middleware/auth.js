const prisma = require("../config/db");
const { verifyToken } = require("../utils/jwt");

async function authenticate(req, res, next) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ error: "Missing or invalid Authorization header" });
  }

  let payload;
  try {
    payload = verifyToken(token);
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    include: { school: true },
  });

  if (!user) {
    return res.status(401).json({ error: "User no longer exists" });
  }

  req.user = user;
  next();
}

// For HEADMASTER/TEACHER routes: blocks access until the user's school is approved.
function requireApprovedSchool(req, res, next) {
  if (req.user.role === "SUPER_ADMIN") return next();

  if (!req.user.school || req.user.school.status !== "APPROVED") {
    return res.status(403).json({
      error: "Your school has not been approved yet",
      code: "SCHOOL_PENDING",
      schoolStatus: req.user.school ? req.user.school.status : null,
    });
  }
  next();
}

module.exports = { authenticate, requireApprovedSchool };
