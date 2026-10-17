const { PrismaClient } = require("@prisma/client");
const { PrismaNeon } = require("@prisma/adapter-neon");
const { Pool } = require("@neondatabase/serverless");

const connectionString = process.env.DATABASE_URL;

let prisma;
if (connectionString) {
  // Use Neon serverless driver adapter for edge/Workers environments
  const pool = new Pool({ connectionString });
  const adapter = new PrismaNeon(pool);
  prisma = new PrismaClient({ adapter });
} else {
  prisma = new PrismaClient();
}

module.exports = prisma;
