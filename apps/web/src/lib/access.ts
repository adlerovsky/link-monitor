import "server-only";
import { prisma } from "@/lib/prisma";

export async function hasProjectAccess(organizationId: string, projectId: string) {
  if (!organizationId || !projectId) return false;

  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      organizationId,
    },
    select: { id: true },
  });

  return Boolean(project);
}

export async function hasBacklinkAccess(organizationId: string, backlinkId: string) {
  if (!organizationId || !backlinkId) return false;

  const backlink = await prisma.backlink.findFirst({
    where: {
      id: backlinkId,
      project: {
        organizationId,
      },
    },
    select: { id: true },
  });

  return Boolean(backlink);
}
