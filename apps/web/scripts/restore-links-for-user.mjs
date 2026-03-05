import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const email = "alex.bratkovsky@gmail.com";

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, organizationId: true, email: true },
  });

  if (!user) {
    throw new Error(`User not found: ${email}`);
  }

  const beforeProjects = await prisma.project.count({
    where: { organizationId: user.organizationId },
  });

  const beforeBacklinks = await prisma.backlink.count({
    where: { project: { organizationId: user.organizationId } },
  });

  const moved = await prisma.project.updateMany({
    where: {
      organizationId: { not: user.organizationId },
    },
    data: {
      organizationId: user.organizationId,
    },
  });

  const afterProjects = await prisma.project.count({
    where: { organizationId: user.organizationId },
  });

  const afterBacklinks = await prisma.backlink.count({
    where: { project: { organizationId: user.organizationId } },
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        userEmail: user.email,
        organizationId: user.organizationId,
        movedProjects: moved.count,
        before: {
          projects: beforeProjects,
          backlinks: beforeBacklinks,
        },
        after: {
          projects: afterProjects,
          backlinks: afterBacklinks,
        },
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
