import { NextResponse } from "next/server";
import {
  cleanupFinishedJobs,
  getQueueMetrics,
  parseCleanupConfig,
  parseMetricsConfig,
} from "@/lib/checkQueue";
import { requireApiRole, requireApiUser } from "@/lib/auth";

export async function GET(req: Request) {
  try {
    const auth = await requireApiUser();
    if (auth.error) return auth.error;

    const forbidden = requireApiRole(auth.user.role, ["OWNER", "MANAGER"] as const);
    if (forbidden) return forbidden;

    const url = new URL(req.url);
    const metricsConfig = parseMetricsConfig(url);
    const metrics = await getQueueMetrics({
      ...metricsConfig,
      organizationId: auth.user.organizationId,
    });

    return NextResponse.json({ metrics });
  } catch (e: unknown) {
    console.error("GET /api/checks/queue ERROR:", e);
    return NextResponse.json(
      {
        error:
          e instanceof Error ? e.message : typeof e === "string" ? e : "Unknown error",
      },
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

    const url = new URL(req.url);
    const cleanupConfig = parseCleanupConfig(url);
    const metricsConfig = parseMetricsConfig(url);

    const cleanup = await cleanupFinishedJobs({
      retentionDays: cleanupConfig.retentionDays,
      organizationId: auth.user.organizationId,
    });

    const metrics = await getQueueMetrics({
      ...metricsConfig,
      organizationId: auth.user.organizationId,
    });

    return NextResponse.json({ cleanup, metrics });
  } catch (e: unknown) {
    console.error("POST /api/checks/queue ERROR:", e);
    return NextResponse.json(
      {
        error:
          e instanceof Error ? e.message : typeof e === "string" ? e : "Unknown error",
      },
      { status: 500 }
    );
  }
}
