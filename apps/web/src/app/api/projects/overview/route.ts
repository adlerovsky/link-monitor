import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/lib/auth";
import { hasProjectAccess } from "@/lib/access";

const CURRENCIES = ["EUR", "USD", "UAH"] as const;
type Currency = (typeof CURRENCIES)[number];

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

    const status = url.searchParams.get("status");
    const q = url.searchParams.get("q");
    const overdue = url.searchParams.get("overdue");
    const sort = url.searchParams.get("sort") ?? "nextCheckAt";
    const order = url.searchParams.get("order") === "desc" ? "desc" : "asc";

    const now = new Date();

    // ---------------- FILTERS ----------------
    const where: any = { projectId };

    if (status && status !== "ALL") {
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
      ];
    }

    // ---------------- BACKLINK LIST ----------------
    const backlinks = await prisma.backlink.findMany({
      where,
      orderBy: { [sort]: order },
      include: {
        checks: {
          orderBy: { checkedAt: "desc" },
          take: 1,
        },
      },
    });

    const formattedBacklinks = backlinks.map((b) => ({
      ...b,
      lastCheck: b.checks[0] ?? null,
      checks: undefined,
    }));

    // ---------------- SUMMARY ----------------

    const groupedStatus = await prisma.backlink.groupBy({
      by: ["status"],
      where: { projectId },
      _count: { _all: true },
    });

    const counts = { ACTIVE: 0, ISSUE: 0, LOST: 0, DELETED: 0 };

    for (const row of groupedStatus) {
      const key = row.status as keyof typeof counts;
      if (key in counts) counts[key] = row._count._all;
    }

    const sumsByCurrency: Record<
      Currency,
      { total: number; active: number; lost: number }
    > = {
      EUR: { total: 0, active: 0, lost: 0 },
      USD: { total: 0, active: 0, lost: 0 },
      UAH: { total: 0, active: 0, lost: 0 },
    };

    const totalGrouped = await prisma.backlink.groupBy({
      by: ["currency"],
      where: { projectId },
      _sum: { cost: true },
    });

    for (const row of totalGrouped) {
      const cur = row.currency as Currency;
      sumsByCurrency[cur].total = Number(row._sum.cost ?? 0);
    }

    const lostGrouped = await prisma.backlink.groupBy({
      by: ["currency"],
      where: { projectId, status: "LOST" },
      _sum: { cost: true },
    });

    for (const row of lostGrouped) {
      const cur = row.currency as Currency;
      sumsByCurrency[cur].lost = Number(row._sum.cost ?? 0);
    }

    for (const cur of CURRENCIES) {
      sumsByCurrency[cur].active =
        sumsByCurrency[cur].total - sumsByCurrency[cur].lost;
    }

    return NextResponse.json({
      projectId,
      generatedAt: now.toISOString(),

      summary: {
        counts,
        sumsByCurrency,
      },

      backlinks: formattedBacklinks,
    });
  } catch (e: any) {
    console.error("PROJECT OVERVIEW ERROR:", e);
    return NextResponse.json(
      { error: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}