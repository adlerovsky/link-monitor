import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { hasProjectAccess } from "@/lib/access";
import { exportBacklinksCsv } from "@/lib/reports";

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

    const exportData = await exportBacklinksCsv({
      organizationId: auth.user.organizationId,
      projectId: projectId || undefined,
    });

    return new NextResponse(exportData.csv, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename=\"${exportData.filename}\"`,
        "x-export-count": String(exportData.count),
      },
    });
  } catch (e: any) {
    console.error("GET /api/reports/export ERROR:", e);
    return NextResponse.json(
      { error: e?.message ?? String(e), name: e?.name, code: e?.code },
      { status: 500 }
    );
  }
}
