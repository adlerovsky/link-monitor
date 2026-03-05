import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/lib/auth";
import { hasProjectAccess } from "@/lib/access";

export async function POST(req: Request) {
  try {
    const auth = await requireApiUser();
    if (auth.error) return auth.error;

    const body = await req.json().catch(() => ({}));

    // mark all as read for project
    const projectId = body?.projectId ? String(body.projectId) : "";

    if (!projectId) {
      return NextResponse.json({ error: "projectId required" }, { status: 400 });
    }

    const allowed = await hasProjectAccess(auth.user.organizationId, projectId);
    if (!allowed) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const now = new Date();

    await prisma.alert.updateMany({
      where: {
        readAt: null,
        backlink: { projectId },
      },
      data: { readAt: now },
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("POST /api/alerts/read ERROR:", e);
    return NextResponse.json(
      { error: e?.message ?? String(e), name: e?.name, code: e?.code },
      { status: 500 }
    );
  }
}