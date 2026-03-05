import { NextResponse } from "next/server";
import crypto from "node:crypto";
import {
  claimCheckJobs,
  cleanupFinishedJobs,
  enqueueDueChecks,
  parseCleanupConfig,
  parseRunDueConfig,
  processClaimedJobs,
} from "@/lib/checkQueue";
import { requireApiRole, requireApiUser } from "@/lib/auth";
import { runScheduledTelegramReports } from "@/lib/reports";

type RunDueAuth =
  | { mode: "user"; organizationId: string }
  | { mode: "worker-token"; organizationId?: string };

function resolveWorkerTokenAuth(req: Request): RunDueAuth | null {
  const configuredToken = process.env.WORKER_RUN_DUE_TOKEN?.trim();
  if (!configuredToken) return null;

  const headerToken = req.headers.get("x-worker-token")?.trim();
  if (!headerToken || headerToken !== configuredToken) return null;

  return {
    mode: "worker-token",
    organizationId: undefined,
  };
}

async function authorizeRunDue(req: Request): Promise<RunDueAuth | NextResponse> {
  const workerAuth = resolveWorkerTokenAuth(req);
  if (workerAuth) return workerAuth;

  const auth = await requireApiUser();
  if (auth.error) return auth.error;

  const forbidden = requireApiRole(auth.user.role, ["OWNER", "MANAGER"] as const);
  if (forbidden) return forbidden;

  return {
    mode: "user",
    organizationId: auth.user.organizationId,
  };
}

async function runDueWithQueue(
  req: Request,
  method: "GET" | "POST",
  auth: RunDueAuth,
  requestId: string
) {
  const url = new URL(req.url);
  const config = parseRunDueConfig(url);
  const cleanupConfig = parseCleanupConfig(url);
  const cleanupEnabled = (url.searchParams.get("cleanup") ?? "1") !== "0";
  const reportsEnabled = (url.searchParams.get("reports") ?? "1") !== "0";
  const workerId = `api-${process.pid}-${Date.now()}`;

  const startedAt = Date.now();

  const enqueueSummary = await enqueueDueChecks({
    enqueueLimit: config.enqueueLimit,
    maxAttempts: config.maxAttempts,
    organizationId: auth.organizationId,
  });

  const claimedJobs = await claimCheckJobs({
    claimLimit: config.claimLimit,
    leaseSeconds: config.leaseSeconds,
    workerId,
    organizationId: auth.organizationId,
  });

  const processingSummary = await processClaimedJobs(claimedJobs, {
    concurrency: config.concurrency,
    maxRetries: config.maxRetries,
    baseBackoffMs: config.baseBackoffMs,
  });

  const skippedCount = processingSummary.results.filter((result) => result.skipped).length;

  const cleanupSummary = cleanupEnabled
    ? await cleanupFinishedJobs({
        retentionDays: cleanupConfig.retentionDays,
        organizationId: auth.organizationId,
      })
    : null;

  const reportsSummary = reportsEnabled
    ? await runScheduledTelegramReports({
        organizationId: auth.organizationId,
      })
    : {
        enabled: false,
        due: false,
        reason: "disabled-by-query",
        sentCount: 0,
        failedCount: 0,
        skippedCount: 0,
      };

  const durationMs = Date.now() - startedAt;

  console.log(
    JSON.stringify({
      scope: "checks.run-due",
      requestId,
      method,
      authMode: auth.mode,
      durationMs,
      workerId,
      dueCount: enqueueSummary.dueCount,
      enqueuedCount: enqueueSummary.enqueuedCount,
      claimedCount: claimedJobs.length,
      processed: processingSummary.processed,
      okCount: processingSummary.okCount,
      failedCount: processingSummary.failedCount,
      skippedCount,
      config,
      cleanup: cleanupSummary,
      reports: reportsSummary,
    })
  );

  return NextResponse.json({
    durationMs,
    requestId,
    authMode: auth.mode,
    workerId,
    dueCount: enqueueSummary.dueCount,
    enqueuedCount: enqueueSummary.enqueuedCount,
    claimedCount: claimedJobs.length,
    processed: processingSummary.processed,
    okCount: processingSummary.okCount,
    failedCount: processingSummary.failedCount,
    skippedCount,
    config,
    cleanup: cleanupSummary,
    reports: reportsSummary,
    results: processingSummary.results,
  });
}

export async function POST(req: Request) {
  const requestId = req.headers.get("x-request-id")?.trim() || crypto.randomUUID();
  try {
    const auth = await authorizeRunDue(req);
    if (auth instanceof NextResponse) return auth;

    return runDueWithQueue(req, "POST", auth, requestId);
  } catch (e: unknown) {
    console.error("RUN DUE ERROR:", { requestId, error: e });
    return NextResponse.json(
      {
        requestId,
        error:
          e instanceof Error ? e.message : typeof e === "string" ? e : "Unknown error",
      },
      { status: 500 }
    );
  }
}

export async function GET(req: Request) {
  const requestId = req.headers.get("x-request-id")?.trim() || crypto.randomUUID();
  try {
    const auth = await authorizeRunDue(req);
    if (auth instanceof NextResponse) return auth;

    return runDueWithQueue(req, "GET", auth, requestId);
  } catch (e: unknown) {
    console.error("RUN DUE ERROR:", { requestId, error: e });
    return NextResponse.json(
      {
        requestId,
        error:
          e instanceof Error ? e.message : typeof e === "string" ? e : "Unknown error",
      },
      { status: 500 }
    );
  }
}