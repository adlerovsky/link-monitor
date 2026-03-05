#!/usr/bin/env node

const baseUrl = process.env.LM_API_BASE_URL || "http://localhost:3000";
const email = (process.env.LM_TEST_EMAIL || "").trim().toLowerCase();
const password = process.env.LM_TEST_PASSWORD || "";
const override2faCode = (process.env.LM_TEST_2FA_CODE || "").trim();
const requeueJobId = (process.env.LM_TEST_REQUEUE_JOB_ID || "").trim();

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function parseSetCookieHeader(setCookieHeader) {
  if (!setCookieHeader) return "";
  return setCookieHeader.split(",").map((chunk) => chunk.split(";")[0]).join("; ");
}

async function main() {
  if (!email || !password) {
    throw new Error("LM_TEST_EMAIL and LM_TEST_PASSWORD are required");
  }

  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  const loginBody = await loginRes.json().catch(() => ({}));
  assert(loginRes.ok, `login failed: ${JSON.stringify(loginBody)}`);
  assert(loginBody.requiresTwoFactor, "login did not return requiresTwoFactor=true");
  assert(loginBody.challengeId, "missing challengeId in login response");

  const code = override2faCode || loginBody.devCode;
  assert(code && /^\d{6}$/.test(code), "2FA code unavailable (set LM_TEST_2FA_CODE)");

  const verifyRes = await fetch(`${baseUrl}/api/auth/login/verify-2fa`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ challengeId: loginBody.challengeId, code }),
  });

  const verifyBody = await verifyRes.json().catch(() => ({}));
  assert(verifyRes.ok, `verify-2fa failed: ${JSON.stringify(verifyBody)}`);

  const cookie = parseSetCookieHeader(verifyRes.headers.get("set-cookie"));
  assert(cookie.includes("lm_session="), "missing session cookie after verify-2fa");

  const deadLetterRes = await fetch(`${baseUrl}/api/checks/dead-letter?take=5`, {
    headers: { cookie },
  });
  const deadLetterBody = await deadLetterRes.json().catch(() => ({}));
  assert(deadLetterRes.ok, `dead-letter GET failed: ${JSON.stringify(deadLetterBody)}`);

  if (requeueJobId) {
    const requeueRes = await fetch(`${baseUrl}/api/checks/dead-letter?maxAttempts=3`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
      },
      body: JSON.stringify({ jobId: requeueJobId }),
    });

    const requeueBody = await requeueRes.json().catch(() => ({}));
    assert(requeueRes.ok, `dead-letter requeue failed: ${JSON.stringify(requeueBody)}`);
  }

  console.log(
    JSON.stringify({
      ok: true,
      scope: "integration.auth-queue",
      baseUrl,
      tested: {
        login: true,
        verify2fa: true,
        deadLetterGet: true,
        deadLetterRequeue: Boolean(requeueJobId),
      },
    })
  );
}

main().catch((error) => {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "Unknown error";
  console.error(JSON.stringify({ ok: false, scope: "integration.auth-queue", error: message }));
  process.exit(1);
});
