import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { hasProjectAccess } from "@/lib/access";
import { getCustomerKpis } from "@/lib/kpi";

export async function GET(req: Request) {
  try {
    const auth = await requireApiUser();
    if (auth.error) return auth.error;

    const url = new URL(req.url);
    const projectId = (url.searchParams.get("projectId") ?? "").trim();
    const daysRaw = Number(url.searchParams.get("days") ?? 30);
    const days = Math.max(1, Math.min(365, Number.isFinite(daysRaw) ? daysRaw : 30));

    if (projectId) {
      const allowed = await hasProjectAccess(auth.user.organizationId, projectId);
      if (!allowed) {
        return NextResponse.json({ error: "Project not found" }, { status: 404 });
      }
    }

    const kpis = await getCustomerKpis({
      organizationId: auth.user.organizationId,
      projectId: projectId || undefined,
      days,
    });

    return NextResponse.json({
      ...kpis,
      scope: {
        organizationId: auth.user.organizationId,
        projectId: projectId || null,
      },
    });
  } catch (e: any) {
    console.error("GET /api/reports/kpi ERROR:", e);
    return NextResponse.json(
      { error: e?.message ?? String(e), name: e?.name, code: e?.code },
      { status: 500 }
    );
  }
}
