require("dotenv/config");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {
  const org = await prisma.organization.upsert({
    where: { name: "AdlerTeam" },
    update: {},
    create: {
      name: "AdlerTeam",
      plan: "FREE",
    },
  });

  const user = await prisma.user.upsert({
    where: { email: "adler@local.dev" },
    update: {},
    create: {
      email: "adler@local.dev",
      passwordHash: "temporary",
      role: "OWNER",
      organizationId: org.id,
    },
  });

  console.log("✅ Org:", org.name);
  console.log("✅ User:", user.email);
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });