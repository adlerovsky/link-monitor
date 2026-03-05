import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/lib/auth";
import { hasProjectAccess } from "@/lib/access";

const ALLOWED_STATUS = new Set(["ACTIVE", "LOST", "ISSUE", "DELETED"] as const);
const ALLOWED_SORT = new Set([
  "nextCheckAt",
  "cost",
  "createdAt",
  "lastCheckedAt",
] as const);
const ALLOWED_ORDER = new Set(["asc", "desc"] as const);

type Currency = "EUR" | "USD" | "UAH";
const CURRENCIES: Currency[] = ["EUR", "USD", "UAH"];

function num(x: any) {
  if (x == null) return 0;
  // Prisma Decimal can be string/Decimal/number
  const n = typeof x === "number" ? x : Number(x);
  return Number.isFinite(n) ? n : 0;
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireApiUser();
    if (auth.error) return auth.error;

    const url = new URL(req.url);
    const { id } = await ctx.params;
    const projectId = String(id ?? "").trim();

    if (!projectId) {
      return NextResponse.json({ error: "projectId required" }, { status: 400 });
    }

    const allowed = await hasProjectAccess(auth.user.organizationId, projectId);
    if (!allowed) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // ---------- list filters (same style as /api/backlinks) ----------
    const status = url.searchParams.get("status"); // ACTIVE|LOST|ISSUE|ALL
    const overdue = url.searchParams.get("overdue"); // "1"
    const q = (url.searchParams.get("q") ?? "").trim();

    const sortRaw = url.searchParams.get("sort") ?? "nextCheckAt";
    const orderRaw = url.searchParams.get("order") ?? "asc";

    const sort = (ALLOWED_SORT.has(sortRaw as any) ? sortRaw : "nextCheckAt") as
      | "nextCheckAt"
      | "cost"
      | "createdAt"
      | "lastCheckedAt";

    const order = (ALLOWED_ORDER.has(orderRaw as any) ? orderRaw : "asc") as
      | "asc"
      | "desc";

    const now = new Date();

    const where: any = { projectId };

    if (status && status !== "ALL" && ALLOWED_STATUS.has(status as any)) {
      where.status = status;
    }

    if (overdue === "1") {
      where.nextCheckAt = { lt: now };
    }

    if (q) {
      where.OR = [
        { sourceUrl: { contains: q, mode: "insensitive" } },
        { targetUrl: { contains: q, mode: "insensitive" } },
        { expectedAnchor: { contains: q, mode: "insensitive" } },
        { vendorName: { contains: q, mode: "insensitive" } },
      ];
    }

    const orderBy: any[] = [{ [sort]: order }];
    if (sort !== "createdAt") orderBy.push({ createdAt: "desc" });

    // ---------- fetch backlinks list + last check ----------
    // IMPORTANT: assumes Backlink has relation `checks` to Check (most likely).
    // If your relation field name differs, tell me and I’ll adjust quickly.
    const rawBacklinks = await prisma.backlink.findMany({
      where,
      orderBy,
      include: {
        checks: {
          take: 1,
          orderBy: { checkedAt: "desc" },
          select: {
            checkedAt: true,
            httpStatus: true,
            linkFound: true,
            anchorDetected: true,
            relDetected: true,
            isNoindex: true,
            canonicalUrl: true,
            anchorOk: true,
            issueReason: true,
            rawHtmlHash: true,
          },
        },
      },
    });

    const backlinks = rawBacklinks.map((b: any) => ({
      id: b.id,
      projectId: b.projectId,
      sourceUrl: b.sourceUrl,
      targetUrl: b.targetUrl,
      expectedAnchor: b.expectedAnchor ?? null,
      vendorName: b.vendorName ?? null,
      assignedToUserId: b.assignedToUserId ?? null,

      priority: b.priority,
      checkEveryHours: b.checkEveryHours,
      cost: b.cost,
      currency: b.currency,

      placementDate: b.placementDate ?? null,

      status: b.status,
      lostAt: b.lostAt ?? null,
      lastCheckedAt: b.lastCheckedAt ?? null,
      nextCheckAt: b.nextCheckAt ?? null,
      createdAt: b.createdAt,

      lastCheck: b.checks?.[0]
        ? {
            checkedAt: b.checks[0].checkedAt,
            httpStatus: b.checks[0].httpStatus,
            linkFound: b.checks[0].linkFound,
            anchorDetected: b.checks[0].anchorDetected,
            relDetected: b.checks[0].relDetected,
            isNoindex: b.checks[0].isNoindex,
            canonicalUrl: b.checks[0].canonicalUrl,
            rawHtmlHash: b.checks[0].rawHtmlHash,
            anchorOk: b.checks[0].anchorOk,
            issueReason: b.checks[0].issueReason ?? null,
          }
        : null,
    }));

    // ---------- summary (overall project, NOT filtered by UI filters) ----------
    // counts by status
    const countByStatus = await prisma.backlink.groupBy({
      by: ["status"],
      where: { projectId },
      _count: { _all: true },
    });

    const counts: Record<"ACTIVE" | "ISSUE" | "LOST" | "DELETED", number> = {
      ACTIVE: 0,
      ISSUE: 0,
      LOST: 0,
      DELETED: 0,
    };

    for (const row of countByStatus as any[]) {
      const st = row.status as "ACTIVE" | "ISSUE" | "LOST" | "DELETED";
      if (st in counts) counts[st] = row._count?._all ?? 0;
    }

    // sums by currency overall (total/active/lost + lostThisMonth/lostLast30Days)
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const last30Start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const sumsByCurrency: Record<
      Currency,
      {
        total: number;
        active: number;
        lost: number;
        lostThisMonth: number;
        lostLast30Days: number;
      }
    > = {
      EUR: { total: 0, active: 0, lost: 0, lostThisMonth: 0, lostLast30Days: 0 },
      USD: { total: 0, active: 0, lost: 0, lostThisMonth: 0, lostLast30Days: 0 },
      UAH: { total: 0, active: 0, lost: 0, lostThisMonth: 0, lostLast30Days: 0 },
    };

    // One small, clear set of queries per currency (fast enough for MVP).
    // If later буде треба супер-оптимізація — зведемо в 1-2 groupBy.
    for (const cur of CURRENCIES) {
      const totalAgg = await prisma.backlink.aggregate({
        where: { projectId, currency: cur as any },
        _sum: { cost: true },
      });

      const lostAgg = await prisma.backlink.aggregate({
        where: { projectId, currency: cur as any, status: "LOST" as any },
        _sum: { cost: true },
      });

      const lostThisMonthAgg = await prisma.backlink.aggregate({
        where: {
          projectId,
          currency: cur as any,
          status: "LOST" as any,
          lostAt: { gte: monthStart },
        },
        _sum: { cost: true },
      });

      const lostLast30Agg = await prisma.backlink.aggregate({
        where: {
          projectId,
          currency: cur as any,
          status: "LOST" as any,
          lostAt: { gte: last30Start },
        },
        _sum: { cost: true },
      });

      const total = num((totalAgg as any)._sum?.cost);
      const lost = num((lostAgg as any)._sum?.cost);

      sumsByCurrency[cur] = {
        total,
        lost,
        active: total - lost,
        lostThisMonth: num((lostThisMonthAgg as any)._sum?.cost),
        lostLast30Days: num((lostLast30Agg as any)._sum?.cost),
      };
    }

    return NextResponse.json({
      projectId,
      generatedAt: now.toISOString(),
      summary: {
        counts,
        sumsByCurrency,
      },
      backlinks,
      // optional: helpful for debugging/UX
      appliedFilters: {
        status: status ?? "ALL",
        overdue: overdue === "1",
        q,
        sort,
        order,
      },
    });
  } catch (e: any) {
    console.error("DASHBOARD GET ERROR:", e);
    return NextResponse.json(
      { error: e?.message ?? String(e), name: e?.name, code: e?.code, meta: e?.meta },
      { status: 500 }
    );
  }
}