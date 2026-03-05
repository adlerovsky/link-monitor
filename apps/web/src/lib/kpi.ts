import "server-only";
import { prisma } from "@/lib/prisma";

type KpiParams = {
  organizationId: string;
  projectId?: string;
  days: number;
};

function num(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function getCustomerKpis(params: KpiParams) {
  const days = Math.max(1, Math.min(365, params.days));
  const now = new Date();
  const periodStart = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  const backlinkWhere: any = {
    project: {
      organizationId: params.organizationId,
    },
  };

  if (params.projectId) backlinkWhere.projectId = params.projectId;

  const activeWhere: any = { ...backlinkWhere, status: "ACTIVE" };
  const issueWhere: any = { ...backlinkWhere, status: "ISSUE" };
  const lostWhere: any = { ...backlinkWhere, status: "LOST" };
  const deletedWhere: any = { ...backlinkWhere, status: "DELETED" };
  const monitoredWhere: any = {
    ...backlinkWhere,
    status: { in: ["ACTIVE", "ISSUE", "LOST"] },
  };

  const [
    totalBacklinks,
    activeBacklinks,
    issueBacklinks,
    lostBacklinks,
    deletedBacklinks,
    overdueBacklinks,
    checkedInPeriod,
    unreadAlerts,
    openAlerts,
    totalValueAgg,
    atRiskValueAgg,
    lostValueInPeriodAgg,
  ] = await Promise.all([
    prisma.backlink.count({ where: backlinkWhere }),
    prisma.backlink.count({ where: activeWhere }),
    prisma.backlink.count({ where: issueWhere }),
    prisma.backlink.count({ where: lostWhere }),
    prisma.backlink.count({ where: deletedWhere }),
    prisma.backlink.count({
      where: {
        ...monitoredWhere,
        nextCheckAt: { lt: now },
      },
    }),
    prisma.backlink.count({
      where: {
        ...monitoredWhere,
        lastCheckedAt: { gte: periodStart },
      },
    }),
    prisma.alert.count({
      where: {
        readAt: null,
        backlink: backlinkWhere,
      },
    }),
    prisma.alert.count({
      where: {
        resolvedAt: null,
        backlink: backlinkWhere,
      },
    }),
    prisma.backlink.aggregate({
      where: backlinkWhere,
      _sum: { cost: true },
    }),
    prisma.backlink.aggregate({
      where: { ...backlinkWhere, status: "ISSUE" },
      _sum: { cost: true },
    }),
    prisma.backlink.aggregate({
      where: {
        ...backlinkWhere,
        status: "LOST",
        lostAt: { gte: periodStart, lt: now },
      },
      _sum: { cost: true },
    }),
  ]);

  const monitoredBacklinks = activeBacklinks + issueBacklinks + lostBacklinks;

  const healthRate = monitoredBacklinks > 0 ? (activeBacklinks / monitoredBacklinks) * 100 : 0;
  const issueRate = monitoredBacklinks > 0 ? (issueBacklinks / monitoredBacklinks) * 100 : 0;
  const lossRate = monitoredBacklinks > 0 ? (lostBacklinks / monitoredBacklinks) * 100 : 0;
  const checkCoverageRate = monitoredBacklinks > 0 ? (checkedInPeriod / monitoredBacklinks) * 100 : 0;

  return {
    period: {
      days,
      from: periodStart.toISOString(),
      toExclusive: now.toISOString(),
    },
    counts: {
      totalBacklinks,
      activeBacklinks,
      issueBacklinks,
      lostBacklinks,
      deletedBacklinks,
      monitoredBacklinks,
      overdueBacklinks,
      checkedInPeriod,
      unreadAlerts,
      openAlerts,
    },
    rates: {
      healthRate,
      issueRate,
      lossRate,
      checkCoverageRate,
    },
    values: {
      total: num(totalValueAgg._sum.cost),
      atRisk: num(atRiskValueAgg._sum.cost),
      lostInPeriod: num(lostValueInPeriodAgg._sum.cost),
    },
    generatedAt: new Date().toISOString(),
  };
}
