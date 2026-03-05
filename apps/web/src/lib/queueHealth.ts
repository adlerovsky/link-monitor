import { getQueueMetrics, parseMetricsConfig } from "@/lib/checkQueue";

type HealthLevel = "ok" | "degraded" | "critical";

type QueueHealthThresholds = {
  lagWarnMs: number;
  lagCriticalMs: number;
  failRateWarn: number;
  failRateCritical: number;
  staleWarn: number;
  staleCritical: number;
  depthWarn: number;
  depthCritical: number;
};

type HealthIssue = {
  key: string;
  level: Exclude<HealthLevel, "ok">;
  message: string;
  value: number;
  threshold: number;
};

type HealthAlertConfig = {
  enabled: boolean;
  cooldownMs: number;
  webhookUrl?: string;
  telegramBotToken?: string;
  telegramChatId?: string;
};

type HealthSnapshot = {
  level: HealthLevel;
  issues: HealthIssue[];
  checkedAt: Date;
};

const lastAlertAtByKey = new Map<string, number>();

function clampInt(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function clampFloat(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function parseNumber(raw: string | null, fallback: number) {
  if (raw === null || raw === "") {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseThresholds(url: URL): QueueHealthThresholds {
  return {
    lagWarnMs: clampInt(parseNumber(url.searchParams.get("lagWarnMs"), 120000), 1000, 3600000),
    lagCriticalMs: clampInt(
      parseNumber(url.searchParams.get("lagCriticalMs"), 600000),
      1000,
      7200000
    ),
    failRateWarn: clampFloat(parseNumber(url.searchParams.get("failRateWarn"), 0.1), 0, 1),
    failRateCritical: clampFloat(
      parseNumber(url.searchParams.get("failRateCritical"), 0.25),
      0,
      1
    ),
    staleWarn: clampInt(parseNumber(url.searchParams.get("staleWarn"), 1), 0, 10000),
    staleCritical: clampInt(parseNumber(url.searchParams.get("staleCritical"), 5), 0, 10000),
    depthWarn: clampInt(parseNumber(url.searchParams.get("depthWarn"), 500), 0, 1000000),
    depthCritical: clampInt(parseNumber(url.searchParams.get("depthCritical"), 2000), 0, 1000000),
  };
}

function parseAlertConfig(url: URL): HealthAlertConfig {
  const enabled = (url.searchParams.get("alert") ?? "1") !== "0";
  const cooldownSeconds = clampInt(
    parseNumber(
      url.searchParams.get("cooldownSeconds"),
      Number(process.env.HEALTH_ALERT_COOLDOWN_SECONDS ?? 600)
    ),
    10,
    86400
  );

  return {
    enabled,
    cooldownMs: cooldownSeconds * 1000,
    webhookUrl: process.env.HEALTH_ALERT_WEBHOOK_URL,
    telegramBotToken: process.env.HEALTH_ALERT_TELEGRAM_BOT_TOKEN,
    telegramChatId: process.env.HEALTH_ALERT_TELEGRAM_CHAT_ID,
  };
}

function evaluateHealth(
  metrics: Awaited<ReturnType<typeof getQueueMetrics>>,
  thresholds: QueueHealthThresholds
): HealthSnapshot {
  const issues: HealthIssue[] = [];

  if (metrics.lagMs >= thresholds.lagCriticalMs) {
    issues.push({
      key: "lagMs",
      level: "critical",
      message: "Queue lag exceeds critical threshold",
      value: metrics.lagMs,
      threshold: thresholds.lagCriticalMs,
    });
  } else if (metrics.lagMs >= thresholds.lagWarnMs) {
    issues.push({
      key: "lagMs",
      level: "degraded",
      message: "Queue lag exceeds warning threshold",
      value: metrics.lagMs,
      threshold: thresholds.lagWarnMs,
    });
  }

  if (metrics.processing.failRate >= thresholds.failRateCritical) {
    issues.push({
      key: "failRate",
      level: "critical",
      message: "Failure rate exceeds critical threshold",
      value: metrics.processing.failRate,
      threshold: thresholds.failRateCritical,
    });
  } else if (metrics.processing.failRate >= thresholds.failRateWarn) {
    issues.push({
      key: "failRate",
      level: "degraded",
      message: "Failure rate exceeds warning threshold",
      value: metrics.processing.failRate,
      threshold: thresholds.failRateWarn,
    });
  }

  if (metrics.staleLeases >= thresholds.staleCritical) {
    issues.push({
      key: "staleLeases",
      level: "critical",
      message: "Stale leases exceed critical threshold",
      value: metrics.staleLeases,
      threshold: thresholds.staleCritical,
    });
  } else if (metrics.staleLeases >= thresholds.staleWarn) {
    issues.push({
      key: "staleLeases",
      level: "degraded",
      message: "Stale leases exceed warning threshold",
      value: metrics.staleLeases,
      threshold: thresholds.staleWarn,
    });
  }

  if (metrics.queueDepth >= thresholds.depthCritical) {
    issues.push({
      key: "queueDepth",
      level: "critical",
      message: "Queue depth exceeds critical threshold",
      value: metrics.queueDepth,
      threshold: thresholds.depthCritical,
    });
  } else if (metrics.queueDepth >= thresholds.depthWarn) {
    issues.push({
      key: "queueDepth",
      level: "degraded",
      message: "Queue depth exceeds warning threshold",
      value: metrics.queueDepth,
      threshold: thresholds.depthWarn,
    });
  }

  const hasCritical = issues.some((item) => item.level === "critical");
  const hasDegraded = issues.some((item) => item.level === "degraded");

  return {
    level: hasCritical ? "critical" : hasDegraded ? "degraded" : "ok",
    issues,
    checkedAt: new Date(),
  };
}

function buildAlertText(snapshot: HealthSnapshot, metrics: Awaited<ReturnType<typeof getQueueMetrics>>) {
  const issueText = snapshot.issues
    .map(
      (item) =>
        `- ${item.level.toUpperCase()} ${item.key}: value=${item.value}, threshold=${item.threshold} (${item.message})`
    )
    .join("\n");

  return [
    `Link Monitor by Adler queue health is ${snapshot.level.toUpperCase()}`,
    `queueDepth=${metrics.queueDepth}, lagMs=${metrics.lagMs}, failRate=${metrics.processing.failRate}, staleLeases=${metrics.staleLeases}`,
    issueText,
  ]
    .filter(Boolean)
    .join("\n");
}

async function sendWebhook(url: string, text: string) {
  await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
}

async function sendTelegram(botToken: string, chatId: string, text: string) {
  const apiUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
  await fetch(apiUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    }),
  });
}

async function maybeNotifyCritical(
  snapshot: HealthSnapshot,
  metrics: Awaited<ReturnType<typeof getQueueMetrics>>,
  alertConfig: HealthAlertConfig
) {
  if (!alertConfig.enabled || snapshot.level !== "critical") {
    return { sent: false, reason: "not-critical-or-disabled" as const };
  }

  const issueFingerprint = snapshot.issues
    .filter((item) => item.level === "critical")
    .map((item) => item.key)
    .sort()
    .join(",");

  const lastSent = lastAlertAtByKey.get(issueFingerprint) ?? 0;
  const nowMs = Date.now();
  if (nowMs - lastSent < alertConfig.cooldownMs) {
    return { sent: false, reason: "cooldown" as const, fingerprint: issueFingerprint };
  }

  const text = buildAlertText(snapshot, metrics);
  const channels: string[] = [];

  if (alertConfig.webhookUrl) {
    await sendWebhook(alertConfig.webhookUrl, text);
    channels.push("webhook");
  }

  if (alertConfig.telegramBotToken && alertConfig.telegramChatId) {
    await sendTelegram(alertConfig.telegramBotToken, alertConfig.telegramChatId, text);
    channels.push("telegram");
  }

  lastAlertAtByKey.set(issueFingerprint, nowMs);

  return {
    sent: channels.length > 0,
    reason: channels.length > 0 ? ("sent" as const) : ("no-channel" as const),
    channels,
    fingerprint: issueFingerprint,
  };
}

export async function getQueueHealth(url: URL, organizationId?: string) {
  const metricsConfig = parseMetricsConfig(url);
  const thresholds = parseThresholds(url);
  const alertConfig = parseAlertConfig(url);
  const metrics = await getQueueMetrics({
    ...metricsConfig,
    organizationId,
  });
  const snapshot = evaluateHealth(metrics, thresholds);
  const alert = await maybeNotifyCritical(snapshot, metrics, alertConfig);

  return {
    level: snapshot.level,
    issues: snapshot.issues,
    checkedAt: snapshot.checkedAt,
    thresholds,
    metrics,
    alert,
  };
}
