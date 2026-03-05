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

    const now = new Date();

    // -------- period (v3) --------
    // mode A) days=7|30|90 (default 30)
    // mode B) from=YYYY-MM-DD&to=YYYY-MM-DD (or ISO)
    const daysRaw = url.searchParams.get("days");
    const fromRaw = url.searchParams.get("from");
    const toRaw = url.searchParams.get("to");

    let periodMode: "days" | "range" = "days";
    let periodFrom: Date;
    let periodToExclusive: Date;

    const fromParsed = fromRaw ? parseDateInput(fromRaw) : null;
    const toParsed = toRaw ? parseDateInput(toRaw) : null;

    if (fromParsed && toParsed) {
      periodMode = "range";
      periodFrom = fromParsed;

      if (toRaw && /^\d{4}-\d{2}-\d{2}$/.test(toRaw)) {
        periodToExclusive = new Date(toParsed.getTime() + 24 * 60 * 60 * 1000);
      } else {
        periodToExclusive = toParsed;
      }
    } else {
      const days = clampInt(Number(daysRaw ?? 30), 1, 365);
      periodMode = "days";
      periodToExclusive = now;
      periodFrom = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    }

    // legacy helpers
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startLast30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // 1) Counts by status
    const groupedStatus = await prisma.backlink.groupBy({
      by: ["status"],
      where: { projectId },
      _count: { _all: true },
    });

    const counts = { ACTIVE: 0, LOST: 0, ISSUE: 0, DELETED: 0 };
    for (const g of groupedStatus) {
      const key = String(g.status) as keyof typeof counts;
      if (key in counts) counts[key] = g._count._all;
    }

    // 2) sums by currency
    const sumsByCurrency: Record<
      Currency,
      {
        total: number;
        active: number;
        lost: number;

        // legacy:
        lostThisMonth: number;
        lostLast30Days: number;

        // v3:
        lostInPeriod: number;
      }
    > = {
      EUR: { total: 0, active: 0, lost: 0, lostThisMonth: 0, lostLast30Days: 0, lostInPeriod: 0 },
      USD: { total: 0, active: 0, lost: 0, lostThisMonth: 0, lostLast30Days: 0, lostInPeriod: 0 },
      UAH: { total: 0, active: 0, lost: 0, lostThisMonth: 0, lostLast30Days: 0, lostInPeriod: 0 },
    };

    // total per currency
    const totalGrouped = await prisma.backlink.groupBy({
      by: ["currency"],
      where: { projectId },
      _sum: { cost: true },
    });
    for (const row of totalGrouped) {
      const cur = row.currency as Currency;
      if (cur in sumsByCurrency) sumsByCurrency[cur].total = Number(row._sum.cost ?? 0);
    }

    // lost per currency
    const lostGrouped = await prisma.backlink.groupBy({
      by: ["currency"],
      where: { projectId, status: "LOST" },
      _sum: { cost: true },
    });
    for (const row of lostGrouped) {
      const cur = row.currency as Currency;
      if (cur in sumsByCurrency) sumsByCurrency[cur].lost = Number(row._sum.cost ?? 0);
    }

    // legacy: lost this month
    const lostMonthGrouped = await prisma.backlink.groupBy({
      by: ["currency"],
      where: { projectId, status: "LOST", lostAt: { gte: startOfMonth } },
      _sum: { cost: true },
    });
    for (const row of lostMonthGrouped) {
      const cur = row.currency as Currency;
      if (cur in sumsByCurrency) sumsByCurrency[cur].lostThisMonth = Number(row._sum.cost ?? 0);
    }

    // legacy: lost last 30
    const lost30Grouped = await prisma.backlink.groupBy({
      by: ["currency"],
      where: { projectId, status: "LOST", lostAt: { gte: startLast30 } },
      _sum: { cost: true },
    });
    for (const row of lost30Grouped) {
      const cur = row.currency as Currency;
      if (cur in sumsByCurrency) sumsByCurrency[cur].lostLast30Days = Number(row._sum.cost ?? 0);
    }

    // v3: lost in selected period
    const lostPeriodGrouped = await prisma.backlink.groupBy({
      by: ["currency"],
      where: {
        projectId,
        status: "LOST",
        lostAt: { gte: periodFrom, lt: periodToExclusive },
      },
      _sum: { cost: true },
    });
    for (const row of lostPeriodGrouped) {
      const cur = row.currency as Currency;
      if (cur in sumsByCurrency) sumsByCurrency[cur].lostInPeriod = Number(row._sum.cost ?? 0);
    }

    // active = total - lost
    for (const cur of CURRENCIES) {
      sumsByCurrency[cur].active = sumsByCurrency[cur].total - sumsByCurrency[cur].lost;
    }

    return NextResponse.json({
      projectId,
      counts,
      sumsByCurrency,
      period: {
        mode: periodMode,
        from: periodFrom.toISOString(),
        toExclusive: periodToExclusive.toISOString(),
      },
      generatedAt: now.toISOString(),
    });
  } catch (e: any) {
    console.error("PROJECT SUMMARY V3 ERROR:", e);
    return NextResponse.json(
      { error: e?.message ?? String(e), name: e?.name, code: e?.code },
      { status: 500 }
    );
  }
}