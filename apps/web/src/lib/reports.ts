import "server-only";
import { prisma } from "@/lib/prisma";

type Currency = "EUR" | "USD" | "UAH";

type ReportParams = {
  organizationId: string;
  projectId?: string;
};

type ReportPeriod = {
  from: Date;
  toExclusive: Date;
};

const CURRENCIES: Currency[] = ["EUR", "USD", "UAH"];
const CURRENCY_SYMBOL: Record<Currency, string> = {
  EUR: "€",
  USD: "$",
  UAH: "₴",
};

const DAY_MS = 24 * 60 * 60 * 1000;

const scheduledReportState = new Map<
  string,
  {
    lastSentDateKey?: string;
    lastAttemptDateKey?: string;
    lastAttemptAtMs?: number;
  }
>();

function n(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function csvCell(value: unknown) {
  const raw = String(value ?? "");
  if (raw.includes(",") || raw.includes("\n") || raw.includes("\"")) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

export function parseReportPeriod(input: {
  daysRaw?: string | null;
  fromRaw?: string | null;
  toRaw?: string | null;
}) {
  const now = new Date();

  const parseDate = (raw?: string | null) => {
    if (!raw) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return new Date(`${raw}T00:00:00.000Z`);
    const parsed = new Date(raw);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  };

  const fromParsed = parseDate(input.fromRaw);
  const toParsed = parseDate(input.toRaw);

  if (fromParsed && toParsed) {
    const toExclusive =
      input.toRaw && /^\d{4}-\d{2}-\d{2}$/.test(input.toRaw)
        ? new Date(toParsed.getTime() + 24 * 60 * 60 * 1000)
        : toParsed;

    return {
      mode: "range" as const,
      from: fromParsed,
      toExclusive,
    };
  }

  const daysRaw = Number(input.daysRaw ?? 30);
  const days = Math.max(1, Math.min(365, Number.isFinite(daysRaw) ? daysRaw : 30));
  return {
    mode: "days" as const,
    from: new Date(now.getTime() - days * 24 * 60 * 60 * 1000),
    toExclusive: now,
  };
}

export async function getReportsSummary(params: ReportParams & ReportPeriod) {
  const baseWhere: any = {
    project: {
      organizationId: params.organizationId,
    },
  };

  if (params.projectId) {
    baseWhere.projectId = params.projectId;
  }

  const countsGrouped = await prisma.backlink.groupBy({
    by: ["status"],
    where: baseWhere,
    _count: { _all: true },
  });

  const counts = { ACTIVE: 0, ISSUE: 0, LOST: 0, DELETED: 0 };
  for (const row of countsGrouped) {
    const key = String(row.status) as keyof typeof counts;
    if (key in counts) counts[key] = row._count._all;
  }

  const sumByCurrency: Record<
    Currency,
    {
      total: number;
      active: number;
      issue: number;
      lost: number;
      deleted: number;
      lostInPeriod: number;
      atRisk: number;
    }
  > = {
    EUR: { total: 0, active: 0, issue: 0, lost: 0, deleted: 0, lostInPeriod: 0, atRisk: 0 },
    USD: { total: 0, active: 0, issue: 0, lost: 0, deleted: 0, lostInPeriod: 0, atRisk: 0 },
    UAH: { total: 0, active: 0, issue: 0, lost: 0, deleted: 0, lostInPeriod: 0, atRisk: 0 },
  };

  const [totalGrouped, activeGrouped, issueGrouped, lostGrouped, deletedGrouped, lostInPeriodGrouped] =
    await Promise.all([
      prisma.backlink.groupBy({
        by: ["currency"],
        where: baseWhere,
        _sum: { cost: true },
      }),
      prisma.backlink.groupBy({
        by: ["currency"],
        where: { ...baseWhere, status: "ACTIVE" },
        _sum: { cost: true },
      }),
      prisma.backlink.groupBy({
        by: ["currency"],
        where: { ...baseWhere, status: "ISSUE" },
        _sum: { cost: true },
      }),
      prisma.backlink.groupBy({
        by: ["currency"],
        where: { ...baseWhere, status: "LOST" },
        _sum: { cost: true },
      }),
      prisma.backlink.groupBy({
        by: ["currency"],
        where: { ...baseWhere, status: "DELETED" },
        _sum: { cost: true },
      }),
      prisma.backlink.groupBy({
        by: ["currency"],
        where: {
          ...baseWhere,
          status: "LOST",
          lostAt: {
            gte: params.from,
            lt: params.toExclusive,
          },
        },
        _sum: { cost: true },
      }),
    ]);

  for (const row of totalGrouped) {
    const cur = row.currency as Currency;
    if (cur in sumByCurrency) sumByCurrency[cur].total = n(row._sum.cost);
  }
  for (const row of activeGrouped) {
    const cur = row.currency as Currency;
    if (cur in sumByCurrency) sumByCurrency[cur].active = n(row._sum.cost);
  }
  for (const row of issueGrouped) {
    const cur = row.currency as Currency;
    if (cur in sumByCurrency) {
      const value = n(row._sum.cost);
      sumByCurrency[cur].issue = value;
      sumByCurrency[cur].atRisk = value;
    }
  }
  for (const row of lostGrouped) {
    const cur = row.currency as Currency;
    if (cur in sumByCurrency) sumByCurrency[cur].lost = n(row._sum.cost);
  }
  for (const row of deletedGrouped) {
    const cur = row.currency as Currency;
    if (cur in sumByCurrency) sumByCurrency[cur].deleted = n(row._sum.cost);
  }
  for (const row of lostInPeriodGrouped) {
    const cur = row.currency as Currency;
    if (cur in sumByCurrency) sumByCurrency[cur].lostInPeriod = n(row._sum.cost);
  }

  const topLost = await prisma.backlink.findMany({
    where: {
      ...baseWhere,
      status: "LOST",
      lostAt: {
        gte: params.from,
        lt: params.toExclusive,
      },
    },
    orderBy: [{ cost: "desc" }, { lostAt: "desc" }],
    take: 10,
    select: {
      id: true,
      sourceUrl: true,
      targetUrl: true,
      vendorName: true,
      cost: true,
      currency: true,
      lostAt: true,
      project: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  const backlinksTotal = counts.ACTIVE + counts.ISSUE + counts.LOST + counts.DELETED;

  return {
    counts,
    backlinksTotal,
    sumsByCurrency: sumByCurrency,
    topLost,
    period: {
      from: params.from.toISOString(),
      toExclusive: params.toExclusive.toISOString(),
    },
    generatedAt: new Date().toISOString(),
  };
}

export async function exportBacklinksCsv(params: ReportParams) {
  const where: any = {
    project: {
      organizationId: params.organizationId,
    },
  };

  if (params.projectId) {
    where.projectId = params.projectId;
  }

  const rows = await prisma.backlink.findMany({
    where,
    orderBy: [{ createdAt: "desc" }],
    include: {
      project: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  const headers = [
    "projectId",
    "projectName",
    "backlinkId",
    "status",
    "priority",
    "sourceUrl",
    "targetUrl",
    "expectedAnchor",
    "vendorName",
    "cost",
    "currency",
    "createdAt",
    "lastCheckedAt",
    "nextCheckAt",
    "lostAt",
    "deletedAt",
  ];

  const csvLines = [headers.join(",")];

  for (const row of rows) {
    const values = [
      row.project.id,
      row.project.name,
      row.id,
      row.status,
      row.priority,
      row.sourceUrl,
      row.targetUrl,
      row.expectedAnchor ?? "",
      row.vendorName ?? "",
      n(row.cost).toFixed(2),
      row.currency,
      row.createdAt.toISOString(),
      row.lastCheckedAt ? row.lastCheckedAt.toISOString() : "",
      row.nextCheckAt ? row.nextCheckAt.toISOString() : "",
      row.lostAt ? row.lostAt.toISOString() : "",
      row.deletedAt ? row.deletedAt.toISOString() : "",
    ].map(csvCell);

    csvLines.push(values.join(","));
  }

  return {
    filename: `backlinks-export-${Date.now()}.csv`,
    csv: csvLines.join("\n"),
    count: rows.length,
    currencies: CURRENCIES,
  };
}

function formatTelegramReportText(input: {
  summary: Awaited<ReturnType<typeof getReportsSummary>>;
  projectId?: string;
}) {
  const { summary, projectId } = input;

  const lines: string[] = [];
  lines.push("📊 Link Monitor by Adler — Daily Report");
  lines.push(projectId ? `🧭 Scope: project ${projectId}` : "🧭 Scope: organization");

  const fromIso = new Date(summary.period.from).toISOString().slice(0, 19).replace("T", " ");
  const toIso = new Date(summary.period.toExclusive)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");

  lines.push(`🗓 Period (UTC): ${fromIso} → ${toIso}`);
  lines.push("");
  lines.push("📌 Backlink status");
  lines.push(`• ACTIVE: ${summary.counts.ACTIVE}`);
  lines.push(`• ISSUE: ${summary.counts.ISSUE}`);
  lines.push(`• LOST: ${summary.counts.LOST}`);
  lines.push(`• DELETED: ${summary.counts.DELETED}`);
  lines.push("");
  lines.push("💰 Value by currency");

  for (const currency of CURRENCIES) {
    const row = summary.sumsByCurrency[currency];
    lines.push(
      `• ${currency}: total ${CURRENCY_SYMBOL[currency]}${row.total.toFixed(2)} | at-risk ${CURRENCY_SYMBOL[
        currency
      ]}${row.atRisk.toFixed(2)} | lost(period) ${CURRENCY_SYMBOL[currency]}${row.lostInPeriod.toFixed(
        2
      )} | deleted ${CURRENCY_SYMBOL[currency]}${row.deleted.toFixed(2)}`
    );
  }

  if (summary.topLost.length > 0) {
    lines.push("");
    lines.push("🚨 Top lost (by value)");
    for (const [index, row] of summary.topLost.slice(0, 3).entries()) {
      lines.push(`${index + 1}) ${row.project.name}: ${n(row.cost).toFixed(2)} ${row.currency}`);
      lines.push(`   ${row.sourceUrl}`);
    }
  }

  lines.push("");
  lines.push(`⏱ Generated (UTC): ${new Date(summary.generatedAt)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ")}`);
  return lines.join("\n");
}

function clampInt(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function parseIntEnv(name: string, fallback: number, min: number, max: number) {
  const raw = process.env[name];
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return clampInt(parsed, min, max);
}

function dateKeyAtOffset(now: Date, offsetMinutes: number) {
  const shifted = new Date(now.getTime() + offsetMinutes * 60 * 1000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const d = String(shifted.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function hourMinuteAtOffset(now: Date, offsetMinutes: number) {
  const shifted = new Date(now.getTime() + offsetMinutes * 60 * 1000);
  return {
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

export async function runScheduledTelegramReports(input?: {
  now?: Date;
  organizationId?: string;
}) {
  const enabled = (process.env.REPORTS_SCHEDULE_ENABLED ?? "1") !== "0";
  const timezoneOffsetMinutes = parseIntEnv(
    "REPORTS_SCHEDULE_TZ_OFFSET_MINUTES",
    120,
    -720,
    840
  );
  const dailyHour = parseIntEnv("REPORTS_SCHEDULE_HOUR_LOCAL", 9, 0, 23);
  const dailyMinute = parseIntEnv("REPORTS_SCHEDULE_MINUTE_LOCAL", 0, 0, 59);
  const periodDays = parseIntEnv("REPORTS_SCHEDULE_PERIOD_DAYS", 30, 1, 365);
  const retryCooldownMinutes = parseIntEnv(
    "REPORTS_SCHEDULE_RETRY_COOLDOWN_MINUTES",
    60,
    1,
    1440
  );

  const now = input?.now ?? new Date();
  const localDateKey = dateKeyAtOffset(now, timezoneOffsetMinutes);
  const localTime = hourMinuteAtOffset(now, timezoneOffsetMinutes);

  if (!enabled) {
    return {
      enabled,
      localDateKey,
      localTime,
      due: false,
      sentCount: 0,
      failedCount: 0,
      skippedCount: 0,
      reason: "schedule-disabled",
      details: [] as Array<Record<string, unknown>>,
    };
  }

  const isDueNow =
    localTime.hour > dailyHour ||
    (localTime.hour === dailyHour && localTime.minute >= dailyMinute);

  if (!isDueNow) {
    return {
      enabled,
      localDateKey,
      localTime,
      due: false,
      sentCount: 0,
      failedCount: 0,
      skippedCount: 0,
      reason: "not-due-yet",
      details: [] as Array<Record<string, unknown>>,
    };
  }

  const organizations = await prisma.organization.findMany({
    where: {
      telegramChatId: { not: null },
      ...(input?.organizationId ? { id: input.organizationId } : {}),
    },
    select: {
      id: true,
      telegramChatId: true,
    },
  });

  if (organizations.length === 0) {
    return {
      enabled,
      localDateKey,
      localTime,
      due: true,
      sentCount: 0,
      failedCount: 0,
      skippedCount: 0,
      reason: "no-organizations-with-telegram-chat",
      details: [] as Array<Record<string, unknown>>,
    };
  }

  const details: Array<Record<string, unknown>> = [];
  let sentCount = 0;
  let failedCount = 0;
  let skippedCount = 0;

  for (const organization of organizations) {
    const chatId = organization.telegramChatId?.trim();
    if (!chatId) {
      skippedCount += 1;
      details.push({ organizationId: organization.id, outcome: "skipped", reason: "empty-chat-id" });
      continue;
    }

    const state = scheduledReportState.get(organization.id) ?? {};
    if (state.lastSentDateKey === localDateKey) {
      skippedCount += 1;
      details.push({ organizationId: organization.id, outcome: "skipped", reason: "already-sent-today" });
      continue;
    }

    const retryCooldownMs = retryCooldownMinutes * 60 * 1000;
    if (
      state.lastAttemptDateKey === localDateKey &&
      state.lastAttemptAtMs &&
      now.getTime() - state.lastAttemptAtMs < retryCooldownMs
    ) {
      skippedCount += 1;
      details.push({
        organizationId: organization.id,
        outcome: "skipped",
        reason: "retry-cooldown",
      });
      continue;
    }

    state.lastAttemptAtMs = now.getTime();
    state.lastAttemptDateKey = localDateKey;
    scheduledReportState.set(organization.id, state);

    const from = new Date(now.getTime() - periodDays * DAY_MS);
    const toExclusive = now;

    const result = await sendReportToTelegram({
      organizationId: organization.id,
      telegramChatId: chatId,
      from,
      toExclusive,
    });

    if (result.ok) {
      state.lastSentDateKey = localDateKey;
      scheduledReportState.set(organization.id, state);
      sentCount += 1;
      details.push({ organizationId: organization.id, outcome: "sent" });
    } else {
      failedCount += 1;
      details.push({
        organizationId: organization.id,
        outcome: "failed",
        code: result.code,
        status: result.status,
      });
    }
  }

  return {
    enabled,
    localDateKey,
    localTime,
    due: true,
    sentCount,
    failedCount,
    skippedCount,
    reason: "executed",
    details,
    settings: {
      timezoneOffsetMinutes,
      dailyHour,
      dailyMinute,
      periodDays,
      retryCooldownMinutes,
    },
  };
}

function sanitizeTelegramError(raw: string) {
  const tokenPattern = /\b\d{8,}:[A-Za-z0-9_-]{20,}\b/g;
  return raw.replace(tokenPattern, "[REDACTED_TOKEN]").slice(0, 500);
}

function resolveTelegramBotToken() {
  const candidates = [
    process.env.TELEGRAM_BOT_TOKEN,
    process.env.HEALTH_ALERT_TELEGRAM_BOT_TOKEN,
  ];

  for (const candidate of candidates) {
    const token = candidate?.trim();
    if (!token) continue;
    if (token === "6666") continue;
    return token;
  }

  return null;
}

export async function sendReportToTelegram(params: {
  organizationId: string;
  telegramChatId: string;
  projectId?: string;
  from: Date;
  toExclusive: Date;
}) {
  const token = resolveTelegramBotToken();
  if (!token) {
    return {
      ok: false,
      status: 400,
      code: "TELEGRAM_TOKEN_MISSING",
      error: "Telegram bot token is not configured (set TELEGRAM_BOT_TOKEN or HEALTH_ALERT_TELEGRAM_BOT_TOKEN env)",
    } as const;
  }

  const summary = await getReportsSummary({
    organizationId: params.organizationId,
    projectId: params.projectId,
    from: params.from,
    toExclusive: params.toExclusive,
  });

  const text = formatTelegramReportText({
    summary,
    projectId: params.projectId,
  });

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: params.telegramChatId,
      text,
      disable_web_page_preview: true,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return {
      ok: false,
      status: 502,
      code: "TELEGRAM_SEND_FAILED",
      error: body ? sanitizeTelegramError(body) : "Failed to send Telegram message",
    } as const;
  }

  return {
    ok: true,
    status: 200,
    summary,
  } as const;
}
