import "server-only";
import { Plan } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getLimitsForPlan, getPlanUsage } from "@/lib/planLimits";

export type PlanPrice = {
  monthlyUsd: number;
};

const PLAN_ORDER: Plan[] = ["FREE", "STARTER", "PRO", "AGENCY"];

const PLAN_PRICES: Record<Plan, PlanPrice> = {
  FREE: { monthlyUsd: 0 },
  STARTER: { monthlyUsd: 39 },
  PRO: { monthlyUsd: 129 },
  AGENCY: { monthlyUsd: 349 },
};

export function getPlanOrder(plan: Plan) {
  return PLAN_ORDER.indexOf(plan);
}

export function canUpgradePlan(from: Plan, to: Plan) {
  return getPlanOrder(to) > getPlanOrder(from);
}

export function getBillingCatalog() {
  return PLAN_ORDER.map((plan) => ({
    plan,
    monthlyUsd: PLAN_PRICES[plan].monthlyUsd,
    limits: getLimitsForPlan(plan),
  }));
}

export async function getBillingSnapshot(organizationId: string) {
  const usage = await getPlanUsage(organizationId);
  if (!usage) return null;

  const recentEvents = await prisma.billingEvent.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      fromPlan: true,
      toPlan: true,
      mode: true,
      metadata: true,
      createdAt: true,
      actorUser: {
        select: {
          id: true,
          email: true,
        },
      },
    },
  });

  return {
    plan: usage.plan,
    limits: usage.limits,
    usage: usage.usage,
    catalog: getBillingCatalog(),
    recentEvents,
  };
}

export async function upgradeOrganizationPlan(input: {
  organizationId: string;
  targetPlan: Plan;
  actorUserId?: string;
  mode?: string;
}) {
  const mode = (input.mode ?? "manual").trim() || "manual";

  const current = await prisma.organization.findUnique({
    where: { id: input.organizationId },
    select: { id: true, plan: true },
  });

  if (!current) {
    return {
      ok: false,
      status: 404,
      code: "ORG_NOT_FOUND",
      error: "Organization not found",
    } as const;
  }

  if (current.plan === input.targetPlan) {
    return {
      ok: false,
      status: 400,
      code: "PLAN_UNCHANGED",
      error: "Plan is already active",
    } as const;
  }

  const isDowngrade = getPlanOrder(input.targetPlan) < getPlanOrder(current.plan);

  if (isDowngrade) {
    const usage = await getPlanUsage(input.organizationId);
    if (!usage) {
      return {
        ok: false,
        status: 404,
        code: "ORG_NOT_FOUND",
        error: "Organization not found",
      } as const;
    }

    const targetLimits = getLimitsForPlan(input.targetPlan);
    const exceedsProjectLimit = usage.usage.projects > targetLimits.maxProjects;
    const exceedsBacklinkLimit = usage.usage.backlinks > targetLimits.maxBacklinks;

    if (exceedsProjectLimit || exceedsBacklinkLimit) {
      return {
        ok: false,
        status: 400,
        code: "PLAN_DOWNGRADE_LIMIT_EXCEEDED",
        error: "Cannot downgrade while current usage exceeds target plan limits",
      } as const;
    }
  }

  if (getPlanOrder(input.targetPlan) === -1) {
    return {
      ok: false,
      status: 400,
      code: "PLAN_INVALID",
      error: "Invalid target plan",
    } as const;
  }

  const updated = await prisma.$transaction(async (tx) => {
    const organization = await tx.organization.update({
      where: { id: input.organizationId },
      data: { plan: input.targetPlan },
      select: { id: true, plan: true },
    });

    const event = await tx.billingEvent.create({
      data: {
        organizationId: organization.id,
        actorUserId: input.actorUserId,
        fromPlan: current.plan,
        toPlan: input.targetPlan,
        mode,
        metadata: {
          source: "api.billing.checkout",
        },
      },
      select: {
        id: true,
        fromPlan: true,
        toPlan: true,
        mode: true,
        createdAt: true,
      },
    });

    return {
      organization,
      event,
    };
  });

  return {
    ok: true,
    status: 200,
    organization: updated.organization,
    event: updated.event,
  } as const;
}

export function parsePlan(value: unknown): Plan | null {
  if (typeof value !== "string") return null;
  if (value === "FREE" || value === "STARTER" || value === "PRO" || value === "AGENCY") {
    return value;
  }
  return null;
}
