import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasProjectAccess } from "@/lib/access";
import { requireApiRole, requireApiUser } from "@/lib/auth";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const auth = await requireApiUser();
  if (auth.error) return auth.error;

  const { id } = await ctx.params;

  const project = await prisma.project.findFirst({
    where: {
      id,
      organizationId: auth.user.organizationId,
    },
    select: {
      id: true,
      name: true,
      baseDomain: true,
    },
  });

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, projectId: project.id, project });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const auth = await requireApiUser();
    if (auth.error) return auth.error;

    const forbidden = requireApiRole(auth.user.role, ["OWNER", "MANAGER"] as const);
    if (forbidden) return forbidden;

    const { id } = await ctx.params;
    const projectId = String(id ?? "").trim();

    if (!projectId) {
      return NextResponse.json({ error: "projectId required" }, { status: 400 });
    }

    const allowed = await hasProjectAccess(auth.user.organizationId, projectId);
    if (!allowed) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // ВАЖЛИВО: якщо в базі є залежні записи (backlinks/checks),
    // delete може впасти. Для dev-режиму можна зробити "каскад":
    await prisma.check.deleteMany({
      where: { backlink: { projectId } },
    });

    await prisma.backlink.deleteMany({
      where: { projectId },
    });

    const deleted = await prisma.project.delete({
      where: { id: projectId },
    });

    return NextResponse.json({ ok: true, deleted });
  } catch (e: any) {
    console.error("DELETE /api/projects/[id] ERROR:", e);
    return NextResponse.json(
      { error: e?.message ?? String(e), name: e?.name, code: e?.code },
      { status: 500 }
    );
  }
}