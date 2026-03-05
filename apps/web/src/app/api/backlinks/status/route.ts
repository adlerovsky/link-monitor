import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasBacklinkAccess } from "@/lib/access";
import { requireApiRole, requireApiUser } from "@/lib/auth";

const ALLOWED_STATUSES = new Set(["ACTIVE", "ISSUE", "LOST", "DELETED"] as const);

export async function POST(req: Request) {
  try {
    const auth = await requireApiUser();
    if (auth.error) return auth.error;

    const forbidden = requireApiRole(auth.user.role, ["OWNER", "MANAGER"] as const);
    if (forbidden) return forbidden;

    const body = await req.json();
    const id = String(body?.id ?? "");
    const status = String(body?.status ?? "");

    if (!id || !status) {
      return NextResponse.json({ error: "id and status required" }, { status: 400 });
    }

    if (!ALLOWED_STATUSES.has(status as any)) {
      return NextResponse.json({ error: "invalid status" }, { status: 400 });
    }

    const allowed = await hasBacklinkAccess(auth.user.organizationId, id);
    if (!allowed) {
      return NextResponse.json({ error: "Backlink not found" }, { status: 404 });
    }

    const current = await prisma.backlink.findUnique({
      where: { id },
      select: { lostAt: true },
    });

    const backlink = await prisma.backlink.update({
      where: { id },
      data: {
        status: status as any,
        lostAt: status === "LOST" ? (current?.lostAt ?? new Date()) : null,
        deletedAt: status === "DELETED" ? new Date() : null,
      },
    });

    return NextResponse.json({ backlink });
  } catch (e: any) {
    console.error("STATUS UPDATE ERROR:", e);
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 });
  }
}