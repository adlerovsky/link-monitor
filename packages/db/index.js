const { PrismaClient } = require("@prisma/client");

const g = globalThis;

const prisma =
  g.__db_prisma ||
  new PrismaClient({
    log: ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  g.__db_prisma = prisma;
}

module.exports = { prisma };