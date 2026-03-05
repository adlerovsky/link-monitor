import { NextResponse } from "next/server";
import {
  listDeadLetterJobsByOrg,
  parseDeadLetterConfig,
  requeueDeadLetterJob,
} from "@/lib/checkQueue";
import { requireApiRole, requireApiUser } from "@/lib/auth";

export async function GET(req: Request) {
  try {
    const auth = await requireApiUser();
    if (auth.error) return auth.error;

    const forbidden = requireApiRole(auth.user.role, ["OWNER", "MANAGER"] as const);
    if (forbidden) return forbidden;

    const url = new URL(req.url);
    const config = parseDeadLetterConfig(url);
    const jobs = await listDeadLetterJobsByOrg({
      take: config.take,
      organizationId: auth.user.organizationId,
    });

    return NextResponse.json({
      total: jobs.length,
      jobs,
      config,
    });
  } catch (e: unknown) {
    console.error("GET /api/checks/dead-letter ERROR:", e);
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
    const config = parseDeadLetterConfig(url);
    const body = (await req.json()) as { jobId?: string };

    if (!body?.jobId) {
      return NextResponse.json({ error: "jobId is required" }, { status: 400 });
    }

    const result = await requeueDeadLetterJob({
      jobId: body.jobId,
      maxAttempts: config.maxAttempts,
      organizationId: auth.user.organizationId,
    });

    return NextResponse.json(result, { status: result.requeued ? 200 : 404 });
  } catch (e: unknown) {
    console.error("POST /api/checks/dead-letter ERROR:", e);
    return NextResponse.json(
      {
        error:
          e instanceof Error ? e.message : typeof e === "string" ? e : "Unknown error",
      },
      { status: 500 }
    );
  }
}
