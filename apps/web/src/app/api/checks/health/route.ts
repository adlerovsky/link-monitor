import { NextResponse } from "next/server";
import { getQueueHealth } from "@/lib/queueHealth";
import { requireApiRole, requireApiUser } from "@/lib/auth";

export async function GET(req: Request) {
  try {
    const auth = await requireApiUser();
    if (auth.error) return auth.error;

    const forbidden = requireApiRole(auth.user.role, ["OWNER", "MANAGER"] as const);
    if (forbidden) return forbidden;

    const url = new URL(req.url);
    const health = await getQueueHealth(url, auth.user.organizationId);

    const statusCode =
      health.level === "critical" ? 503 : health.level === "degraded" ? 200 : 200;

    return NextResponse.json(health, { status: statusCode });
  } catch (e: unknown) {
    console.error("GET /api/checks/health ERROR:", e);
    return NextResponse.json(
      {
        error:
          e instanceof Error ? e.message : typeof e === "string" ? e : "Unknown error",
      },
      { status: 500 }
    );
  }
}
