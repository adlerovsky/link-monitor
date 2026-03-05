import crypto from "crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

async function main() {
  const email = "alex.bratkovsky@gmail.com";
  const password = "admin";
  const organizationName = "Alex Bratkovsky Org";

  let organization = await prisma.organization.findFirst({
    where: { name: organizationName },
    select: { id: true, name: true },
  });

  if (organization == null) {
    organization = await prisma.organization.create({
      data: { name: organizationName },
      select: { id: true, name: true },
    });
  }

  const passwordHash = hashPassword(password);

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      passwordHash,
      organizationId: organization.id,
      role: "OWNER",
    },
    create: {
      email,
      passwordHash,
      organizationId: organization.id,
      role: "OWNER",
    },
    select: {
      id: true,
      email: true,
      organizationId: true,
      role: true,
    },
  });

  console.log(JSON.stringify({ ok: true, user, organization }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
