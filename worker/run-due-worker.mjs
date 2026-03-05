#!/usr/bin/env node

const apiBase = process.env.LM_API_BASE_URL || "http://localhost:3000";
const intervalMs = Number(process.env.LM_WORKER_INTERVAL_MS || 15000);
const enqueueLimit = Number(process.env.LM_WORKER_ENQUEUE_LIMIT || 50);
const claimLimit = Number(process.env.LM_WORKER_CLAIM_LIMIT || 20);
const concurrency = Number(process.env.LM_WORKER_CONCURRENCY || 4);
const leaseSeconds = Number(process.env.LM_WORKER_LEASE_SECONDS || 120);
const maxAttempts = Number(process.env.LM_WORKER_MAX_ATTEMPTS || 3);
const maxRetries = Number(process.env.LM_WORKER_MAX_RETRIES || 1);
const baseBackoffMs = Number(process.env.LM_WORKER_BASE_BACKOFF_MS || 3000);
const retentionDays = Number(process.env.LM_WORKER_RETENTION_DAYS || 7);
const workerToken =
  (process.env.LM_WORKER_TOKEN || process.env.WORKER_RUN_DUE_TOKEN || "").trim();
const runOnce = process.argv.includes("--once");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function tick() {
  const url = new URL("/api/checks/run-due", apiBase);
  const requestId = `wrk-${process.pid}-${Date.now()}-${Math.random()
    .toString(16)
    .slice(2, 8)}`;
  url.searchParams.set("enqueueLimit", String(enqueueLimit));
  url.searchParams.set("claimLimit", String(claimLimit));
  url.searchParams.set("concurrency", String(concurrency));
  url.searchParams.set("leaseSeconds", String(leaseSeconds));
  url.searchParams.set("maxAttempts", String(maxAttempts));
  url.searchParams.set("maxRetries", String(maxRetries));
  url.searchParams.set("baseBackoffMs", String(baseBackoffMs));
  url.searchParams.set("retentionDays", String(retentionDays));

  const startedAt = Date.now();

  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        ...(workerToken ? { "x-worker-token": workerToken } : {}),
        "x-request-id": requestId,
      },
    });
    const body = await response.json().catch(() => ({}));

    const log = {
      scope: "worker.run-due",
      requestId,
      ok: response.ok,
      status: response.status,
      durationMs: Date.now() - startedAt,
      processed: body?.processed ?? 0,
      okCount: body?.okCount ?? 0,
      failedCount: body?.failedCount ?? 0,
      config:
        body?.config ??
        {
          enqueueLimit,
          claimLimit,
          concurrency,
          leaseSeconds,
          maxAttempts,
          maxRetries,
          baseBackoffMs,
          retentionDays,
        },
      apiRequestId: body?.requestId ?? null,
    };

    console.log(JSON.stringify(log));

    if (!response.ok) {
      console.error(JSON.stringify({ scope: "worker.run-due.error", body }));
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : typeof error === "string" ? error : "Unknown error";

    console.error(
      JSON.stringify({
        scope: "worker.run-due.exception",
        durationMs: Date.now() - startedAt,
        error: message,
      })
    );
  }
}

async function main() {
  console.log(
    JSON.stringify({
      scope: "worker.run-due.start",
      apiBase,
      intervalMs,
      enqueueLimit,
      claimLimit,
      concurrency,
      leaseSeconds,
      maxAttempts,
      maxRetries,
      baseBackoffMs,
      retentionDays,
      runOnce,
      hasWorkerToken: Boolean(workerToken),
    })
  );

  if (runOnce) {
    await tick();
    return;
  }

  while (true) {
    await tick();
    await sleep(intervalMs);
  }
}

main().catch((error) => {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "Unknown error";
  console.error(JSON.stringify({ scope: "worker.run-due.fatal", error: message }));
  process.exit(1);
});
