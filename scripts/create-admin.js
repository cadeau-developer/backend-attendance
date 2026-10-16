// Creates / resets the super-admin account from your .env (SUPER_ADMIN_*).
// This guarantees the credentials in .env always work, no matter what state
// the database is in.
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

async function main() {
  const name = process.env.SUPER_ADMIN_NAME || "Super Admin";
  const email = process.env.SUPER_ADMIN_EMAIL;
  const password = process.env.SUPER_ADMIN_PASSWORD;

  if (!email || !password) {
    throw new Error("SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD must be set in .env");
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: { name, passwordHash, role: "SUPER_ADMIN" },
    });
    console.log(`Reset super admin ${email} (password updated).`);
  } else {
    await prisma.user.create({
      data: { name, email, passwordHash, role: "SUPER_ADMIN" },
    });
    console.log(`Created super admin ${email}.`);
  }

  console.log("\nLogin with:");
  console.log(`  email:    ${email}`);
  console.log(`  password: ${password}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());