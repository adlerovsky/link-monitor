import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiRole, requireApiUser } from "@/lib/auth";
import { canCreateProject } from "@/lib/planLimits";
import { normalizeProjectBaseDomain } from "@/lib/domain";

export async function GET() {
  try {
    const auth = await requireApiUser();
    if (auth.error) return auth.error;

    const projects = await prisma.project.findMany({
      where: { organizationId: auth.user.organizationId },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ projects, organizationId: auth.user.organizationId });
  } catch (e: any) {
    console.error("GET /api/projects ERROR:", e);
    return NextResponse.json(
      { error: e?.message ?? String(e), name: e?.name, code: e?.code },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const auth = await requireApiUser();
    if (auth.error) return auth.error;

    const forbidden = requireApiRole(auth.user.role, ["OWNER", "MANAGER"] as const);
    if (forbidden) return forbidden;

    const body = await req.json();
    const name = String(body?.name ?? "").trim();
    const baseDomainInput = String(body?.baseDomain ?? "").trim();
    const baseDomain = normalizeProjectBaseDomain(baseDomainInput);

    if (!name) {
      return NextResponse.json({ error: "name required" }, { status: 400 });
    }

    if (!baseDomain) {
      return NextResponse.json(
        { error: "baseDomain required (without protocol, e.g. example.com)" },
        { status: 400 }
      );
    }

    const limitCheck = await canCreateProject(auth.user.organizationId);
    if (!limitCheck.ok) {
      return NextResponse.json(
        {
          error: "Project limit reached for current plan",
          code: limitCheck.code,
          plan: "plan" in limitCheck ? limitCheck.plan : undefined,
          limit: "limit" in limitCheck ? limitCheck.limit : undefined,
          current: "current" in limitCheck ? limitCheck.current : undefined,
        },
        { status: limitCheck.status }
      );
    }

    const project = await prisma.project.create({
      data: {
        name,
        baseDomain,
        organizationId: auth.user.organizationId,
      },
    });

    return NextResponse.json({ project, organizationId: auth.user.organizationId });
  } catch (e: any) {
    console.error("POST /api/projects ERROR:", e);

    const message = String(e?.message ?? "");
    if (message.includes("Unknown argument `baseDomain`")) {
      return NextResponse.json(
        {
          error:
            "Server Prisma client is outdated. Run prisma generate and restart the app.",
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { error: e?.message ?? String(e), name: e?.name, code: e?.code, meta: e?.meta },
      { status: 500 }
    );
  }
}