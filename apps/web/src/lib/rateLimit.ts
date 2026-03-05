import "server-only";

type Bucket = {
  points: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();
const upstashUrl = process.env.UPSTASH_REDIS_REST_URL?.trim();
const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();

function hasUpstashConfig() {
  return Boolean(upstashUrl && upstashToken);
}

function getUpstashEndpoint(path: string) {
  if (!upstashUrl) throw new Error("UPSTASH_REDIS_REST_URL is not configured");
  return `${upstashUrl.replace(/\/+$/, "")}${path}`;
}

async function upstashPipeline(commands: Array<Array<string | number>>) {
  const response = await fetch(getUpstashEndpoint("/pipeline"), {
    method: "POST",
    headers: {
      authorization: `Bearer ${upstashToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(commands),
  });

  if (!response.ok) {
    throw new Error(`Upstash pipeline failed with status ${response.status}`);
  }

  const json = (await response.json()) as Array<{ result?: unknown; error?: string }>;

  for (const item of json) {
    if (item?.error) throw new Error(item.error);
  }

  return json;
}

export function getClientIp(req: Request) {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = req.headers.get("x-real-ip")?.trim();
  return forwarded || realIp || "unknown";
}

function consumeRateLimitMemory(input: {
  key: string;
  limit: number;
  windowMs: number;
}) {
  const now = Date.now();
  const existing = buckets.get(input.key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(input.key, {
      points: 1,
      resetAt: now + input.windowMs,
    });
    return { allowed: true, remaining: input.limit - 1, resetAt: now + input.windowMs };
  }

  if (existing.points >= input.limit) {
    return { allowed: false, remaining: 0, resetAt: existing.resetAt };
  }

  existing.points += 1;
  buckets.set(input.key, existing);
  return { allowed: true, remaining: input.limit - existing.points, resetAt: existing.resetAt };
}

async function consumeRateLimitUpstash(input: {
  key: string;
  limit: number;
  windowMs: number;
}) {
  const key = `rl:${input.key}`;
  const results = await upstashPipeline([
    ["INCR", key],
    ["PEXPIRE", key, input.windowMs, "NX"],
    ["PTTL", key],
  ]);

  const pointsRaw = Number(results[0]?.result ?? 0);
  const ttlRaw = Number(results[2]?.result ?? input.windowMs);
  const points = Number.isFinite(pointsRaw) ? pointsRaw : 0;
  const ttlMs = Number.isFinite(ttlRaw) && ttlRaw > 0 ? ttlRaw : input.windowMs;
  const resetAt = Date.now() + ttlMs;
  const allowed = points <= input.limit;
  const remaining = Math.max(0, input.limit - points);

  return { allowed, remaining, resetAt };
}

export async function consumeRateLimit(input: {
  key: string;
  limit: number;
  windowMs: number;
}) {
  if (!hasUpstashConfig()) {
    return consumeRateLimitMemory(input);
  }

  try {
    return await consumeRateLimitUpstash(input);
  } catch {
    return consumeRateLimitMemory(input);
  }
}

export function pruneRateLimitBuckets() {
  if (hasUpstashConfig()) {
    return;
  }

  const now = Date.now();
  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }
}
