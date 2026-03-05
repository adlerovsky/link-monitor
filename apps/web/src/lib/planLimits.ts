import "server-only";
import { Plan } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type PlanLimit = {
  maxProjects: number;
  maxBacklinks: number;
};

const PLAN_LIMITS: Record<Plan, PlanLimit> = {
  FREE: {
    maxProjects: 1,
    maxBacklinks: 10,
  },
  STARTER: {
    maxProjects: 2,
    maxBacklinks: 100,
  },
  PRO: {
    maxProjects: 5,
    maxBacklinks: 1_000,
  },
  AGENCY: {
    maxProjects: 10,
    maxBacklinks: 10_000,
  },
};

export function getLimitsForPlan(plan: Plan) {
  return PLAN_LIMITS[plan] ?? PLAN_LIMITS.FREE;
}

async function getOrganizationPlan(organizationId: string) {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, plan: true },
  });

  return organization;
}

export async function getPlanUsage(organizationId: string) {
  const organization = await getOrganizationPlan(organizationId);
  if (!organization) return null;

  const [projectsCount, backlinksCount] = await Promise.all([
    prisma.project.count({
      where: { organizationId },
    }),
    prisma.backlink.count({
      where: {
        project: {
          organizationId,
        },
      },
    }),
  ]);

  const limits = getLimitsForPlan(organization.plan);

  return {
    plan: organization.plan,
    limits,
    usage: {
      projects: projectsCount,
      backlinks: backlinksCount,
    },
  };
}

export async function canCreateProject(organizationId: string) {
  const info = await getPlanUsage(organizationId);
  if (!info) {
    return {
      ok: false,
      reason: "organization_not_found",
      code: "ORG_NOT_FOUND",
      status: 404,
    } as const;
  }

  if (info.usage.projects >= info.limits.maxProjects) {
    return {
      ok: false,
      reason: "project_limit_reached",
      code: "PLAN_PROJECT_LIMIT_REACHED",
      status: 403,
      plan: info.plan,
      limit: info.limits.maxProjects,
      current: info.usage.projects,
    } as const;
  }

  return {
    ok: true,
    plan: info.plan,
    limits: info.limits,
    usage: info.usage,
  } as const;
}

export async function canCreateBacklink(organizationId: string) {
  const info = await getPlanUsage(organizationId);
  if (!info) {
    return {
      ok: false,
      reason: "organization_not_found",
      code: "ORG_NOT_FOUND",
      status: 404,
    } as const;
  }

  if (info.usage.backlinks >= info.limits.maxBacklinks) {
    return {
      ok: false,
      reason: "backlink_limit_reached",
      code: "PLAN_BACKLINK_LIMIT_REACHED",
      status: 403,
      plan: info.plan,
      limit: info.limits.maxBacklinks,
      current: info.usage.backlinks,
    } as const;
  }

  return {
    ok: true,
    plan: info.plan,
    limits: info.limits,
    usage: info.usage,
  } as const;
}
