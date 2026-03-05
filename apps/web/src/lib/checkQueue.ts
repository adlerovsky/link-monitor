import { prisma } from "@/lib/prisma";
import { runBacklinkCheck } from "@/lib/checkEngine";
import { CheckJobStatus, Prisma } from "@prisma/client";

type ClaimParams = {
  claimLimit: number;
  leaseSeconds: number;
  workerId: string;
  organizationId?: string;
};

type EnqueueParams = {
  enqueueLimit: number;
  maxAttempts: number;
  organizationId?: string;
};

type CleanupParams = {
  retentionDays: number;
  organizationId?: string;
};

type MetricsParams = {
  windowMinutes: number;
  sampleLimit: number;
  organizationId?: string;
};

type ProcessParams = {
  concurrency: number;
  maxRetries: number;
  baseBackoffMs: number;
  lockBackoffMs?: number;
};

type JobRunResult = {
  jobId: string;
  backlinkId: string;
  ok: boolean;
  skipped?: boolean;
  status?: string;
  attempts: number;
  durationMs: number;
  error?: string;
};

type WorkerWindowSummary = {
  done: number;
  failed: number;
  durations: number[];
};

const ACTIVE_QUEUE_STATUSES: CheckJobStatus[] = [
  CheckJobStatus.PENDING,
  CheckJobStatus.RUNNING,
];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function clampInt(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function summarizeDurations(durations: number[]) {
  if (durations.length === 0) {
    return {
      avgDurationMs: 0,
      p95DurationMs: 0,
    };
  }

  const sorted = [...durations].sort((left, right) => left - right);
  const total = sorted.reduce((sum, duration) => sum + duration, 0);
  const p95Index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);

  return {
    avgDurationMs: Math.round(total / sorted.length),
    p95DurationMs: sorted[p95Index],
  };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const worker = async () => {
    while (true) {
      const current = nextIndex;
      nextIndex += 1;
      if (current >= items.length) return;
      results[current] = await mapper(items[current], current);
    }
  };

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () =>
    worker()
  );

  await Promise.all(workers);
  return results;
}

async function acquireBacklinkExecutionLock(backlinkId: string) {
  const result = await prisma.$queryRaw<Array<{ locked: boolean }>>`
    SELECT pg_try_advisory_lock(hashtextextended(${backlinkId}, 0)) AS locked
  `;

  return result[0]?.locked ?? false;
}

async function releaseBacklinkExecutionLock(backlinkId: string) {
  await prisma.$queryRaw`
    SELECT pg_advisory_unlock(hashtextextended(${backlinkId}, 0))
  `;
}

export async function enqueueDueChecks(params: EnqueueParams) {
  const now = new Date();

  const due = await prisma.backlink.findMany({
    where: {
      nextCheckAt: { lte: now },
      status: { not: "DELETED" },
      ...(params.organizationId
        ? { project: { organizationId: params.organizationId } }
        : {}),
    },
    orderBy: { nextCheckAt: "asc" },
    take: params.enqueueLimit,
    select: { id: true },
  });

  if (due.length === 0) {
    return { dueCount: 0, enqueuedCount: 0 };
  }

  const dueIds = due.map((item) => item.id);

  const existing = await prisma.checkJob.findMany({
    where: {
      backlinkId: { in: dueIds },
      status: { in: ACTIVE_QUEUE_STATUSES },
    },
    select: { backlinkId: true },
  });

  const existingIds = new Set(existing.map((item) => item.backlinkId));
  const toCreate = dueIds.filter((id) => !existingIds.has(id));

  if (toCreate.length > 0) {
    await prisma.checkJob.createMany({
      data: toCreate.map((backlinkId) => ({
        backlinkId,
        status: CheckJobStatus.PENDING,
        attempts: 0,
        maxAttempts: params.maxAttempts,
        notBefore: now,
      })),
    });
  }

  return { dueCount: due.length, enqueuedCount: toCreate.length };
}

export async function claimCheckJobs(params: ClaimParams) {
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + params.leaseSeconds * 1000);

  await prisma.checkJob.updateMany({
    where: {
      status: CheckJobStatus.RUNNING,
      leaseUntil: { lt: now },
      ...(params.organizationId
        ? { backlink: { project: { organizationId: params.organizationId } } }
        : {}),
    },
    data: {
      status: CheckJobStatus.PENDING,
      workerId: null,
      leaseUntil: null,
      notBefore: now,
    },
  });

  const claimed = await prisma.$queryRaw<
    Array<{
      id: string;
      backlinkId: string;
      attempts: number;
      maxAttempts: number;
      createdAt: Date;
    }>
  >(Prisma.sql`
    WITH picked AS (
      SELECT cj.id
      FROM "CheckJob" cj
      JOIN "Backlink" b ON b.id = cj."backlinkId"
      JOIN "Project" p ON p.id = b."projectId"
      WHERE cj.status = ${CheckJobStatus.PENDING}::"CheckJobStatus"
        AND cj."notBefore" <= ${now}
        ${params.organizationId
          ? Prisma.sql`AND p."organizationId" = ${params.organizationId}`
          : Prisma.empty}
      ORDER BY cj."createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${params.claimLimit}
    ),
    updated AS (
      UPDATE "CheckJob" cj
      SET
        status = ${CheckJobStatus.RUNNING}::"CheckJobStatus",
        "workerId" = ${params.workerId},
        "leaseUntil" = ${leaseUntil},
        "startedAt" = ${now}
      FROM picked
      WHERE cj.id = picked.id
      RETURNING
        cj.id,
        cj."backlinkId" AS "backlinkId",
        cj.attempts,
        cj."maxAttempts" AS "maxAttempts",
        cj."createdAt" AS "createdAt"
    )
    SELECT id, "backlinkId", attempts, "maxAttempts", "createdAt"
    FROM updated
    ORDER BY "createdAt" ASC
  `);

  return claimed.map((job) => ({
    id: job.id,
    backlinkId: job.backlinkId,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
  }));
}

async function completeJob(jobId: string) {
  await prisma.checkJob.update({
    where: { id: jobId },
    data: {
      status: CheckJobStatus.DONE,
      finishedAt: new Date(),
      leaseUntil: null,
      workerId: null,
      lastError: null,
    },
  });
}

async function failJob(
  job: { id: string; attempts: number; maxAttempts: number },
  errorMessage: string,
  baseBackoffMs: number
) {
  const nextAttempts = job.attempts + 1;
  const now = new Date();
  const shouldFail = nextAttempts >= job.maxAttempts;

  await prisma.checkJob.update({
    where: { id: job.id },
    data: shouldFail
      ? {
          status: CheckJobStatus.FAILED,
          attempts: nextAttempts,
          finishedAt: now,
          leaseUntil: null,
          workerId: null,
          lastError: errorMessage,
        }
      : {
          status: CheckJobStatus.PENDING,
          attempts: nextAttempts,
          leaseUntil: null,
          workerId: null,
          notBefore: new Date(now.getTime() + baseBackoffMs * nextAttempts),
          lastError: errorMessage,
        },
  });

  return { attempts: nextAttempts, failedPermanently: shouldFail };
}

async function rescheduleJobWithoutPenalty(jobId: string, backoffMs: number, reason: string) {
  const now = new Date();

  await prisma.checkJob.update({
    where: { id: jobId },
    data: {
      status: CheckJobStatus.PENDING,
      leaseUntil: null,
      workerId: null,
      notBefore: new Date(now.getTime() + backoffMs),
      lastError: reason,
    },
  });
}

export async function processClaimedJobs(
  jobs: Array<{ id: string; backlinkId: string; attempts: number; maxAttempts: number }>,
  params: ProcessParams
) {
  if (jobs.length === 0) {
    return {
      processed: 0,
      okCount: 0,
      failedCount: 0,
      results: [] as JobRunResult[],
    };
  }

  const results = await mapWithConcurrency(
    jobs,
    clampInt(params.concurrency, 1, 20),
    async (job): Promise<JobRunResult> => {
      const startedAt = Date.now();

      let attempt = 0;
      let lastError: unknown = null;
      const lockBackoffMs = clampInt(params.lockBackoffMs ?? 5000, 500, 60000);

      const lockAcquired = await acquireBacklinkExecutionLock(job.backlinkId);
      if (!lockAcquired) {
        await rescheduleJobWithoutPenalty(
          job.id,
          lockBackoffMs,
          "Execution lock busy for backlink"
        );

        return {
          jobId: job.id,
          backlinkId: job.backlinkId,
          ok: false,
          skipped: true,
          attempts: job.attempts,
          durationMs: Date.now() - startedAt,
          error: "Skipped: concurrent execution prevented by idempotency lock",
        };
      }

      try {
        while (attempt <= params.maxRetries) {
          try {
            const outcome = await runBacklinkCheck(job.backlinkId);
            await completeJob(job.id);

            return {
              jobId: job.id,
              backlinkId: job.backlinkId,
              ok: true,
              status: outcome.backlink.status,
              attempts: job.attempts + 1,
              durationMs: Date.now() - startedAt,
            };
          } catch (error) {
            lastError = error;
            attempt += 1;
            if (attempt <= params.maxRetries) {
              await sleep(200 * attempt);
            }
          }
        }

        const errorMessage =
          lastError instanceof Error
            ? lastError.message
            : typeof lastError === "string"
            ? lastError
            : "Unknown error";

        const failResult = await failJob(job, errorMessage, params.baseBackoffMs);

        return {
          jobId: job.id,
          backlinkId: job.backlinkId,
          ok: false,
          attempts: failResult.attempts,
          durationMs: Date.now() - startedAt,
          error: errorMessage,
        };
      } finally {
        await releaseBacklinkExecutionLock(job.backlinkId);
      }
    }
  );

  const okCount = results.filter((item) => item.ok).length;
  const failedCount = results.length - okCount;

  return {
    processed: results.length,
    okCount,
    failedCount,
    results,
  };
}

export function parseRunDueConfig(url: URL) {
  const enqueueLimitRaw = Number(url.searchParams.get("enqueueLimit") ?? 50);
  const claimLimitRaw = Number(url.searchParams.get("claimLimit") ?? 20);
  const concurrencyRaw = Number(url.searchParams.get("concurrency") ?? 4);
  const leaseSecondsRaw = Number(url.searchParams.get("leaseSeconds") ?? 120);
  const maxAttemptsRaw = Number(url.searchParams.get("maxAttempts") ?? 3);
  const maxRetriesRaw = Number(url.searchParams.get("maxRetries") ?? 1);
  const baseBackoffMsRaw = Number(url.searchParams.get("baseBackoffMs") ?? 3000);

  return {
    enqueueLimit: clampInt(Number.isFinite(enqueueLimitRaw) ? enqueueLimitRaw : 50, 1, 500),
    claimLimit: clampInt(Number.isFinite(claimLimitRaw) ? claimLimitRaw : 20, 1, 200),
    concurrency: clampInt(Number.isFinite(concurrencyRaw) ? concurrencyRaw : 4, 1, 20),
    leaseSeconds: clampInt(Number.isFinite(leaseSecondsRaw) ? leaseSecondsRaw : 120, 30, 900),
    maxAttempts: clampInt(Number.isFinite(maxAttemptsRaw) ? maxAttemptsRaw : 3, 1, 10),
    maxRetries: clampInt(Number.isFinite(maxRetriesRaw) ? maxRetriesRaw : 1, 0, 5),
    baseBackoffMs: clampInt(
      Number.isFinite(baseBackoffMsRaw) ? baseBackoffMsRaw : 3000,
      500,
      60000
    ),
  };
}

export function parseCleanupConfig(url: URL) {
  const retentionDaysRaw = Number(url.searchParams.get("retentionDays") ?? 7);

  return {
    retentionDays: clampInt(
      Number.isFinite(retentionDaysRaw) ? retentionDaysRaw : 7,
      1,
      90
    ),
  };
}

export function parseDeadLetterConfig(url: URL) {
  const takeRaw = Number(url.searchParams.get("take") ?? 50);
  const maxAttemptsRaw = Number(url.searchParams.get("maxAttempts") ?? 3);

  return {
    take: clampInt(Number.isFinite(takeRaw) ? takeRaw : 50, 1, 200),
    maxAttempts: clampInt(Number.isFinite(maxAttemptsRaw) ? maxAttemptsRaw : 3, 1, 10),
  };
}

export function parseMetricsConfig(url: URL): MetricsParams {
  const windowMinutesRaw = Number(url.searchParams.get("windowMinutes") ?? 60);
  const sampleLimitRaw = Number(url.searchParams.get("sampleLimit") ?? 2000);

  return {
    windowMinutes: clampInt(
      Number.isFinite(windowMinutesRaw) ? windowMinutesRaw : 60,
      1,
      24 * 60
    ),
    sampleLimit: clampInt(
      Number.isFinite(sampleLimitRaw) ? sampleLimitRaw : 2000,
      50,
      10000
    ),
  };
}

export async function cleanupFinishedJobs(params: CleanupParams) {
  const cutoff = new Date(Date.now() - params.retentionDays * 24 * 60 * 60 * 1000);

  const result = await prisma.checkJob.deleteMany({
    where: {
      status: { in: [CheckJobStatus.DONE, CheckJobStatus.FAILED] },
      finishedAt: { lt: cutoff },
      ...(params.organizationId
        ? { backlink: { project: { organizationId: params.organizationId } } }
        : {}),
    },
  });

  return {
    deletedCount: result.count,
    retentionDays: params.retentionDays,
    cutoff,
  };
}

export async function getQueueMetrics(params?: Partial<MetricsParams>) {
  const now = new Date();
  const windowMinutes = clampInt(params?.windowMinutes ?? 60, 1, 24 * 60);
  const sampleLimit = clampInt(params?.sampleLimit ?? 2000, 50, 10000);
  const windowStart = new Date(now.getTime() - windowMinutes * 60 * 1000);

  const [pending, running, done, failed, staleLeases] = await Promise.all([
    prisma.checkJob.count({
      where: {
        status: CheckJobStatus.PENDING,
        ...(params?.organizationId
          ? { backlink: { project: { organizationId: params.organizationId } } }
          : {}),
      },
    }),
    prisma.checkJob.count({
      where: {
        status: CheckJobStatus.RUNNING,
        ...(params?.organizationId
          ? { backlink: { project: { organizationId: params.organizationId } } }
          : {}),
      },
    }),
    prisma.checkJob.count({
      where: {
        status: CheckJobStatus.DONE,
        ...(params?.organizationId
          ? { backlink: { project: { organizationId: params.organizationId } } }
          : {}),
      },
    }),
    prisma.checkJob.count({
      where: {
        status: CheckJobStatus.FAILED,
        ...(params?.organizationId
          ? { backlink: { project: { organizationId: params.organizationId } } }
          : {}),
      },
    }),
    prisma.checkJob.count({
      where: {
        status: CheckJobStatus.RUNNING,
        leaseUntil: { lt: now },
        ...(params?.organizationId
          ? { backlink: { project: { organizationId: params.organizationId } } }
          : {}),
      },
    }),
  ]);

  const nextPending = await prisma.checkJob.findFirst({
    where: {
      status: CheckJobStatus.PENDING,
      ...(params?.organizationId
        ? { backlink: { project: { organizationId: params.organizationId } } }
        : {}),
    },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true, notBefore: true },
  });

  const [runningByWorker, finishedWindowJobs] = await Promise.all([
    prisma.checkJob.groupBy({
      by: ["workerId"],
      where: {
        status: CheckJobStatus.RUNNING,
        workerId: { not: null },
        ...(params?.organizationId
          ? { backlink: { project: { organizationId: params.organizationId } } }
          : {}),
      },
      _count: { _all: true },
    }),
    prisma.checkJob.findMany({
      where: {
        status: { in: [CheckJobStatus.DONE, CheckJobStatus.FAILED] },
        finishedAt: { gte: windowStart },
        workerId: { not: null },
        startedAt: { not: null },
        ...(params?.organizationId
          ? { backlink: { project: { organizationId: params.organizationId } } }
          : {}),
      },
      orderBy: { finishedAt: "desc" },
      take: sampleLimit,
      select: {
        status: true,
        workerId: true,
        startedAt: true,
        finishedAt: true,
      },
    }),
  ]);

  const finishedDurations = finishedWindowJobs
    .map((job) => {
      if (!job.startedAt || !job.finishedAt) return null;
      return Math.max(0, job.finishedAt.getTime() - job.startedAt.getTime());
    })
    .filter((duration): duration is number => duration !== null);

  const finishedDone = finishedWindowJobs.filter(
    (job) => job.status === CheckJobStatus.DONE
  ).length;
  const finishedFailed = finishedWindowJobs.length - finishedDone;
  const failRate =
    finishedWindowJobs.length > 0
      ? Number((finishedFailed / finishedWindowJobs.length).toFixed(4))
      : 0;
  const throughputPerMinute = Number(
    (finishedWindowJobs.length / windowMinutes).toFixed(4)
  );

  const byWorkerWindow = new Map<string, WorkerWindowSummary>();
  for (const job of finishedWindowJobs) {
    if (!job.workerId || !job.startedAt || !job.finishedAt) continue;

    const durationMs = Math.max(0, job.finishedAt.getTime() - job.startedAt.getTime());
    const current =
      byWorkerWindow.get(job.workerId) ?? { done: 0, failed: 0, durations: [] };

    if (job.status === CheckJobStatus.DONE) {
      current.done += 1;
    } else {
      current.failed += 1;
    }
    current.durations.push(durationMs);

    byWorkerWindow.set(job.workerId, current);
  }

  const workerIds = new Set<string>();
  for (const item of runningByWorker) {
    if (item.workerId) workerIds.add(item.workerId);
  }
  for (const workerId of byWorkerWindow.keys()) {
    workerIds.add(workerId);
  }

  const workers = Array.from(workerIds)
    .map((workerId) => {
      const runningInfo = runningByWorker.find((item) => item.workerId === workerId);
      const windowInfo = byWorkerWindow.get(workerId) ?? {
        done: 0,
        failed: 0,
        durations: [],
      };
      const durationSummary = summarizeDurations(windowInfo.durations);

      return {
        workerId,
        running: runningInfo?._count._all ?? 0,
        done: windowInfo.done,
        failed: windowInfo.failed,
        totalFinished: windowInfo.done + windowInfo.failed,
        failRate:
          windowInfo.done + windowInfo.failed > 0
            ? Number(
                (windowInfo.failed / (windowInfo.done + windowInfo.failed)).toFixed(4)
              )
            : 0,
        avgDurationMs: durationSummary.avgDurationMs,
        p95DurationMs: durationSummary.p95DurationMs,
      };
    })
    .sort((left, right) => right.totalFinished - left.totalFinished);

  const lagMs = nextPending
    ? Math.max(0, now.getTime() - Math.max(nextPending.createdAt.getTime(), nextPending.notBefore.getTime()))
    : 0;

  const durationSummary = summarizeDurations(finishedDurations);

  return {
    queueDepth: pending + running,
    pending,
    running,
    done,
    failed,
    staleLeases,
    lagMs,
    window: {
      minutes: windowMinutes,
      from: windowStart,
      to: now,
      sampleSize: finishedWindowJobs.length,
      sampleLimit,
    },
    processing: {
      done: finishedDone,
      failed: finishedFailed,
      failRate,
      throughputPerMinute,
      avgDurationMs: durationSummary.avgDurationMs,
      p95DurationMs: durationSummary.p95DurationMs,
    },
    workers,
    timestamp: now,
  };
}

export async function listDeadLetterJobs(take: number) {
  return prisma.checkJob.findMany({
    where: { status: CheckJobStatus.FAILED },
    orderBy: { finishedAt: "desc" },
    take: clampInt(take, 1, 200),
    select: {
      id: true,
      backlinkId: true,
      attempts: true,
      maxAttempts: true,
      lastError: true,
      createdAt: true,
      updatedAt: true,
      finishedAt: true,
    },
  });
}

export async function listDeadLetterJobsByOrg(params: {
  take: number;
  organizationId: string;
}) {
  return prisma.checkJob.findMany({
    where: {
      status: CheckJobStatus.FAILED,
      backlink: { project: { organizationId: params.organizationId } },
    },
    orderBy: { finishedAt: "desc" },
    take: clampInt(params.take, 1, 200),
    select: {
      id: true,
      backlinkId: true,
      attempts: true,
      maxAttempts: true,
      lastError: true,
      createdAt: true,
      updatedAt: true,
      finishedAt: true,
    },
  });
}

export async function requeueDeadLetterJob(params: {
  jobId: string;
  maxAttempts: number;
  organizationId?: string;
}) {
  const now = new Date();

  const updated = await prisma.checkJob.updateMany({
    where: {
      id: params.jobId,
      status: CheckJobStatus.FAILED,
      ...(params.organizationId
        ? { backlink: { project: { organizationId: params.organizationId } } }
        : {}),
    },
    data: {
      status: CheckJobStatus.PENDING,
      attempts: 0,
      maxAttempts: params.maxAttempts,
      notBefore: now,
      workerId: null,
      leaseUntil: null,
      lastError: null,
      startedAt: null,
      finishedAt: null,
    },
  });

  return {
    requeued: updated.count > 0,
    jobId: params.jobId,
  };
}
