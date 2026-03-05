import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/lib/auth";
import { hasProjectAccess } from "@/lib/access";

const ALLOWED_TYPES = new Set(["ACTIVE_TO_ISSUE", "ISSUE_TO_LOST", "TO_LOST"] as const);

export async function GET(req: Request) {
  try {
    const auth = await requireApiUser();
    if (auth.error) return auth.error;

    const url = new URL(req.url);

    const projectId = url.searchParams.get("projectId") ?? "";
    if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

    const allowed = await hasProjectAccess(auth.user.organizationId, projectId);
    if (!allowed) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const takeRaw = Number(url.searchParams.get("take") ?? 20);
    const take = Math.max(1, Math.min(100, Number.isFinite(takeRaw) ? takeRaw : 20));

    const type = url.searchParams.get("type"); // optional
    const resolved = url.searchParams.get("resolved"); // "1" | "0" | undefined
    const unread = url.searchParams.get("unread"); // "1" | "0" | undefined

    const where: any = {
      backlink: { projectId },
    };

    if (type && ALLOWED_TYPES.has(type as any)) where.type = type;

    if (resolved === "1") where.resolvedAt = { not: null };
    if (resolved === "0") where.resolvedAt = null;

    if (unread === "1") where.readAt = null;
    if (unread === "0") where.readAt = { not: null };

    const alerts = await prisma.alert.findMany({
      where,
      orderBy: { triggeredAt: "desc" },
      take,
      select: {
        id: true,
        backlinkId: true,
        type: true,
        triggeredAt: true,
        resolvedAt: true,
        readAt: true,
        lastNotifiedAt: true,
        backlink: {
          select: {
            id: true,
            projectId: true,
            sourceUrl: true,
            targetUrl: true,
            expectedAnchor: true,
            priority: true,
            cost: true,
            currency: true,
            status: true,
            lastCheckedAt: true,
            nextCheckAt: true,
            lostAt: true,
          },
        },
      },
    });

    const unreadCount = await prisma.alert.count({
      where: {
        backlink: { projectId },
        readAt: null,
      },
    });

    return NextResponse.json({ alerts, unreadCount });
  } catch (e: any) {
    console.error("GET /api/alerts ERROR:", e);
    return NextResponse.json(
      { error: e?.message ?? String(e), name: e?.name, code: e?.code },
      { status: 500 }
    );
  }
}