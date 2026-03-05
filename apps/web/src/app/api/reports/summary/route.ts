import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { hasProjectAccess } from "@/lib/access";
import { getReportsSummary, parseReportPeriod } from "@/lib/reports";

export async function GET(req: Request) {
  try {
    const auth = await requireApiUser();
    if (auth.error) return auth.error;

    const url = new URL(req.url);
    const projectId = (url.searchParams.get("projectId") ?? "").trim();

    if (projectId) {
      const allowed = await hasProjectAccess(auth.user.organizationId, projectId);
      if (!allowed) {
        return NextResponse.json({ error: "Project not found" }, { status: 404 });
      }
    }

    const period = parseReportPeriod({
      daysRaw: url.searchParams.get("days"),
      fromRaw: url.searchParams.get("from"),
      toRaw: url.searchParams.get("to"),
    });

    const summary = await getReportsSummary({
      organizationId: auth.user.organizationId,
      projectId: projectId || undefined,
      from: period.from,
      toExclusive: period.toExclusive,
    });

    return NextResponse.json({
      ...summary,
      scope: {
        organizationId: auth.user.organizationId,
        projectId: projectId || null,
        periodMode: period.mode,
      },
    });
  } catch (e: any) {
    console.error("GET /api/reports/summary ERROR:", e);
    return NextResponse.json(
      { error: e?.message ?? String(e), name: e?.name, code: e?.code },
      { status: 500 }
    );
  }
}
