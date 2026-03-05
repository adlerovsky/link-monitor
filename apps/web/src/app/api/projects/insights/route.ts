import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/lib/auth";
import { hasProjectAccess } from "@/lib/access";

const CURRENCIES = ["EUR", "USD", "UAH"] as const;
type Currency = (typeof CURRENCIES)[number];

const clampInt = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));

const parseDateInput = (s: string) => {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(`${s}T00:00:00.000Z`);
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
};

function resolvePeriod(url: URL) {
  const now = new Date();
  const daysRaw = url.searchParams.get("days");
  const fromRaw = url.searchParams.get("from");
  const toRaw = url.searchParams.get("to");

  const fromParsed = fromRaw ? parseDateInput(fromRaw) : null;
  const toParsed = toRaw ? parseDateInput(toRaw) : null;

  let mode: "days" | "range" = "days";
  let from: Date;
  let toExclusive: Date;

  if (fromParsed && toParsed) {
    mode = "range";
    from = fromParsed;
    if (toRaw && /^\d{4}-\d{2}-\d{2}$/.test(toRaw)) {
      toExclusive = new Date(toParsed.getTime() + 24 * 60 * 60 * 1000);
    } else {
      toExclusive = toParsed;
    }
  } else {
    const days = clampInt(Number(daysRaw ?? 30), 1, 365);
    mode = "days";
    toExclusive = now;
    from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  }

  return { mode, from, toExclusive, now };
}

export async function GET(req: Request) {
  try {
    const auth = await requireApiUser();
    if (auth.error) return auth.error;

    const url = new URL(req.url);
    const projectId = url.searchParams.get("projectId") ?? "";
    if (!projectId) {
      return NextResponse.json({ error: "projectId required" }, { status: 400 });
    }

    const allowed = await hasProjectAccess(auth.user.organizationId, projectId);
    if (!allowed) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const { mode, from, toExclusive, now } = resolvePeriod(url);

    // ---------------- Summary (as v3, but included here for convenience) ----------------
    const groupedStatus = await prisma.backlink.groupBy({
      by: ["status"],
      where: { projectId },
      _count: { _all: true },
    });

    const counts = { ACTIVE: 0, LOST: 0, ISSUE: 0 };
    for (const g of groupedStatus) {
      const k = String(g.status) as keyof typeof counts;
      if (k in counts) counts[k] = g._count._all;
    }

    const sumsByCurrency: Record<
      Currency,
      { total: number; active: number; lost: number; lostInPeriod: number }
    > = {
      EUR: { total: 0, active: 0, lost: 0, lostInPeriod: 0 },
      USD: { total: 0, active: 0, lost: 0, lostInPeriod: 0 },
      UAH: { total: 0, active: 0, lost: 0, lostInPeriod: 0 },
    };

    const totalGrouped = await prisma.backlink.groupBy({
      by: ["currency"],
      where: { projectId },
      _sum: { cost: true },
    });

    for (const row of totalGrouped) {
      const cur = row.currency as Currency;
      if (cur in sumsByCurrency) sumsByCurrency[cur].total = Number(row._sum.cost ?? 0);
    }

    const lostGrouped = await prisma.backlink.groupBy({
      by: ["currency"],
      where: { projectId, status: "LOST" },
      _sum: { cost: true },
    });
    for (const row of lostGrouped) {
      const cur = row.currency as Currency;
      if (cur in sumsByCurrency) sumsByCurrency[cur].lost = Number(row._sum.cost ?? 0);
    }

    const lostPeriodGrouped = await prisma.backlink.groupBy({
      by: ["currency"],
      where: {
        projectId,
        status: "LOST",
        lostAt: { gte: from, lt: toExclusive },
      },
      _sum: { cost: true },
    });
    for (const row of lostPeriodGrouped) {
      const cur = row.currency as Currency;
      if (cur in sumsByCurrency) sumsByCurrency[cur].lostInPeriod = Number(row._sum.cost ?? 0);
    }

    for (const cur of CURRENCIES) {
      sumsByCurrency[cur].active = sumsByCurrency[cur].total - sumsByCurrency[cur].lost;
    }

    // ---------------- V4 INSIGHTS ----------------

    // A) Top LOST in selected period
    const topLost = await prisma.backlink.findMany({
      where: {
        projectId,
        status: "LOST",
        lostAt: { gte: from, lt: toExclusive },
      },
      orderBy: [{ cost: "desc" }, { lostAt: "desc" }],
      take: 10,
      select: {
        id: true,
        sourceUrl: true,
        targetUrl: true,
        vendorName: true,
        priority: true,
        cost: true,
        currency: true,
        lostAt: true,
      },
    });

    // B) Latest check per backlink (to aggregate ISSUE reasons)
    // NOTE: this needs Check.issueReason + Check.anchorOk from step 1-2
    const latestChecks = await prisma.check.findMany({
      where: {
        backlink: { projectId },
      },
      orderBy: { checkedAt: "desc" },
      distinct: ["backlinkId"],
      select: {
        backlinkId: true,
        checkedAt: true,
        httpStatus: true,
        linkFound: true,
        issueReason: true,
        anchorOk: true,
        backlink: {
          select: {
            status: true,
            cost: true,
            currency: true,
            sourceUrl: true,
            targetUrl: true,
            priority: true,
            vendorName: true,
          },
        },
      },
    });

    // C) Issues by reason (+ $ at risk by currency)
    const issuesByReasonMap = new Map<
      string,
      { count: number; sumsByCurrency: Record<Currency, number> }
    >();

    const topIssuesRaw: Array<{
      backlinkId: string;
      reason: string;
      cost: number;
      currency: Currency;
      sourceUrl: string;
      targetUrl: string;
      priority: string;
      vendorName: string | null;
      checkedAt: string;
      httpStatus: number | null;
    }> = [];

    for (const c of latestChecks) {
      if (c.backlink.status !== "ISSUE") continue;

      const reason = String(c.issueReason ?? "UNKNOWN");
      const cur = c.backlink.currency as Currency;
      const cost = Number(c.backlink.cost ?? 0);

      if (!issuesByReasonMap.has(reason)) {
        issuesByReasonMap.set(reason, {
          count: 0,
          sumsByCurrency: { EUR: 0, USD: 0, UAH: 0 },
        });
      }

      const row = issuesByReasonMap.get(reason)!;
      row.count += 1;
      if (cur in row.sumsByCurrency) row.sumsByCurrency[cur] += cost;

      topIssuesRaw.push({
        backlinkId: c.backlinkId,
        reason,
        cost,
        currency: cur,
        sourceUrl: c.backlink.sourceUrl,
        targetUrl: c.backlink.targetUrl,
        priority: c.backlink.priority,
        vendorName: c.backlink.vendorName,
        checkedAt: c.checkedAt.toISOString(),
        httpStatus: c.httpStatus,
      });
    }

    const issuesByReason = Array.from(issuesByReasonMap.entries())
      .map(([reason, data]) => ({ reason, ...data }))
      .sort((a, b) => b.count - a.count);

    const topIssues = topIssuesRaw
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 10);

    return NextResponse.json({
      projectId,

      period: {
        mode,
        from: from.toISOString(),
        toExclusive: toExclusive.toISOString(),
      },

      summary: {
        counts,
        sumsByCurrency,
      },

      insights: {
        topLost,
        issuesByReason,
        topIssues,
      },

      generatedAt: now.toISOString(),
    });
  } catch (e: any) {
    console.error("PROJECT INSIGHTS V4 ERROR:", e);
    return NextResponse.json(
      { error: e?.message ?? String(e), name: e?.name, code: e?.code },
      { status: 500 }
    );
  }
}