#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const REQUIRED_ENV = ["DATABASE_URL", "SESSION_SECRET", "NEXT_PUBLIC_APP_URL", "AUTH_EMAIL_FROM"];
const RECOMMENDED_ENV = ["RESEND_API_KEY", "TELEGRAM_BOT_TOKEN"];

const args = new Set(process.argv.slice(2));
const withWorker = args.has("--with-worker");
const webRoot = fileURLToPath(new URL("..", import.meta.url));

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const raw = readFileSync(filePath, "utf8");
  const out = {};

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx < 1) continue;

    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    out[key] = value;
  }

  return out;
}

const fileEnv = {
  ...parseEnvFile(`${webRoot}/.env`),
  ...parseEnvFile(`${webRoot}/.env.local`),
};
const runtimeEnv = { ...fileEnv, ...process.env };

function isValidHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function printCheck(ok, label, details = "") {
  const prefix = ok ? "✅" : "❌";
  const suffix = details ? ` — ${details}` : "";
  console.log(`${prefix} ${label}${suffix}`);
}

console.log("\nLink Monitor preflight\n");

let failed = false;

const missingRequired = REQUIRED_ENV.filter((name) => !(runtimeEnv[name] || "").trim());
const missingRecommended = RECOMMENDED_ENV.filter((name) => !(runtimeEnv[name] || "").trim());

if (missingRequired.length > 0) {
  failed = true;
  printCheck(false, "Required environment", `missing: ${missingRequired.join(", ")}`);
} else {
  printCheck(true, "Required environment");
}

if (missingRecommended.length > 0) {
  printCheck(true, "Recommended environment", `not set: ${missingRecommended.join(", ")}`);
} else {
  printCheck(true, "Recommended environment");
}

const sessionSecret = runtimeEnv.SESSION_SECRET || "";
if (sessionSecret.length < 32) {
  failed = true;
  printCheck(false, "SESSION_SECRET strength", "must be at least 32 characters");
} else {
  printCheck(true, "SESSION_SECRET strength");
}

if (withWorker) {
  const workerToken = (runtimeEnv.WORKER_RUN_DUE_TOKEN || runtimeEnv.LM_WORKER_TOKEN || "").trim();
  if (workerToken.length < 16) {
    failed = true;
    printCheck(
      false,
      "Worker token",
      "set WORKER_RUN_DUE_TOKEN (or LM_WORKER_TOKEN) with at least 16 characters"
    );
  } else {
    printCheck(true, "Worker token");
  }
}

const appUrl = runtimeEnv.NEXT_PUBLIC_APP_URL || "";
if (!isValidHttpUrl(appUrl)) {
  failed = true;
  printCheck(false, "NEXT_PUBLIC_APP_URL", "must be a valid http/https URL");
} else {
  printCheck(true, "NEXT_PUBLIC_APP_URL");
}

const prismaCheck = spawnSync(process.execPath, ["-e", "require.resolve('@prisma/client')"], {
  stdio: "ignore",
  env: runtimeEnv,
});
if (prismaCheck.status !== 0) {
  failed = true;
  printCheck(false, "Prisma client", "@prisma/client is not resolvable");
} else {
  printCheck(true, "Prisma client");
}

if (withWorker) {
  const workerCheck = spawnSync(process.execPath, ["../../worker/run-due-worker.mjs", "--once"], {
    stdio: "inherit",
    env: runtimeEnv,
    cwd: webRoot,
  });

  if (workerCheck.status !== 0) {
    failed = true;
    printCheck(false, "Worker one-shot", "worker exited with non-zero code");
  } else {
    printCheck(true, "Worker one-shot");
  }
}

console.log("");
if (failed) {
  console.error("Preflight failed. Fix the checks above before launch.\n");
  process.exit(1);
}

console.log("Preflight passed.\n");
