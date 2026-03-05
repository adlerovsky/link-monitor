#!/usr/bin/env node

const base = process.env.QA_BASE_URL || "http://127.0.0.1:3000";
const email = `qa+${Date.now()}@example.com`;
const password = "LaunchQA2026!";
const organizationName = `Launch QA Org ${Date.now()}`;
const cookieJar = new Map();

function cookieHeader() {
  return Array.from(cookieJar.entries())
    .map(([key, value]) => `${key}=${value}`)
    .join("; ");
}

function storeSetCookie(response) {
  const raw = response.headers.get("set-cookie");
  if (!raw) return;

  const firstPair = raw.split(", ")[0]?.split(";")[0];
  if (!firstPair) return;

  const eqIdx = firstPair.indexOf("=");
  if (eqIdx < 1) return;

  const name = firstPair.slice(0, eqIdx);
  const value = firstPair.slice(eqIdx + 1);
  cookieJar.set(name, value);
}

async function request(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (!headers["content-type"] && options.body != null) {
    headers["content-type"] = "application/json";
  }

  const cookie = cookieHeader();
  if (cookie) {
    headers.cookie = cookie;
  }

  const response = await fetch(`${base}${path}`, {
    ...options,
    headers,
  });

  storeSetCookie(response);

  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  return { response, text, json };
}

const results = [];

function addResult(step, ok, details = "") {
  results.push({ step, ok, details });
}

function assertOk(step, condition, detailsWhenFail, detailsWhenPass = "") {
  addResult(step, Boolean(condition), condition ? detailsWhenPass : detailsWhenFail);
}

(async () => {
  let projectId = null;
  let backlinkId = null;

  let result = await request("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password, organizationName }),
  });
  assertOk(
    "Register user",
    result.response.status === 201,
    `${result.response.status} ${result.text}`,
    email
  );

  await request("/api/auth/logout", { method: "POST" });

  result = await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });

  const challengeId = result.json?.challengeId ?? null;
  const devCode = result.json?.devCode ?? null;

  assertOk(
    "Login step 1 (2FA challenge)",
    result.response.ok && result.json?.requiresTwoFactor === true && Boolean(challengeId),
    `${result.response.status} ${result.text}`,
    challengeId ? `${String(challengeId).slice(0, 8)}...` : "challenge issued"
  );

  if (challengeId && devCode) {
    result = await request("/api/auth/login/verify-2fa", {
      method: "POST",
      body: JSON.stringify({ challengeId, code: devCode }),
    });

    assertOk(
      "Login step 2 (verify 2FA)",
      result.response.ok && result.json?.user?.email === email,
      `${result.response.status} ${result.text}`,
      "session established"
    );
  } else {
    addResult(
      "Login step 2 (verify 2FA)",
      false,
      "devCode unavailable (set RESEND_API_KEY or use mailbox code)"
    );
  }

  result = await request("/api/auth/session", { method: "GET" });
  assertOk(
    "Session active",
    result.response.ok && result.json?.user?.email === email,
    `${result.response.status} ${result.text}`,
    result.json?.user?.role ?? "ok"
  );

  result = await request("/api/projects", {
    method: "POST",
    body: JSON.stringify({
      name: `QA Project ${Date.now()}`,
      baseDomain: "example.com",
    }),
  });
  projectId = result.json?.project?.id ?? null;
  assertOk(
    "Create project",
    result.response.ok && Boolean(projectId),
    `${result.response.status} ${result.text}`,
    projectId ?? "created"
  );

  if (projectId) {
    result = await request("/api/backlinks", {
      method: "POST",
      body: JSON.stringify({
        projectId,
        sourceUrl: "https://example.com",
        targetUrl: "https://example.com/target-page",
        expectedAnchor: "Definitely missing anchor",
        priority: "CRITICAL",
        currency: "USD",
        cost: 10,
      }),
    });

    backlinkId = result.json?.backlink?.id ?? null;
    assertOk(
      "Add backlink",
      result.response.ok && Boolean(backlinkId),
      `${result.response.status} ${result.text}`,
      backlinkId ?? "created"
    );
  }

  if (backlinkId) {
    result = await request("/api/checks/run", {
      method: "POST",
      body: JSON.stringify({ id: backlinkId }),
    });

    assertOk(
      "Run check",
      result.response.ok && Boolean(result.json?.check),
      `${result.response.status} ${result.text}`,
      `status ${result.json?.check?.status ?? "?"}, reason ${result.json?.check?.issueReason ?? "?"}`
    );
  }

  if (projectId) {
    result = await request(`/api/alerts?projectId=${encodeURIComponent(projectId)}&take=20`, {
      method: "GET",
    });

    const unreadCount = Number(result.json?.unreadCount ?? 0);
    assertOk(
      "Alerts generated",
      result.response.ok && unreadCount >= 1,
      `${result.response.status} unread=${unreadCount} ${result.text}`,
      `unread ${unreadCount}`
    );

    result = await request("/api/alerts/read", {
      method: "POST",
      body: JSON.stringify({ projectId }),
    });

    if (result.response.ok) {
      const verify = await request(`/api/alerts?projectId=${encodeURIComponent(projectId)}&take=20`, {
        method: "GET",
      });
      const unreadAfter = Number(verify.json?.unreadCount ?? -1);
      assertOk(
        "Mark alerts read",
        verify.response.ok && unreadAfter === 0,
        `${verify.response.status} unreadAfter=${unreadAfter}`,
        "unread 0"
      );
    } else {
      addResult("Mark alerts read", false, `${result.response.status} ${result.text}`);
    }
  }

  result = await request("/api/billing/current", { method: "GET" });
  assertOk(
    "Billing current",
    result.response.ok && Boolean(result.json?.plan),
    `${result.response.status} ${result.text}`,
    `plan ${result.json?.plan}`
  );

  result = await request("/api/billing/checkout", {
    method: "POST",
    body: JSON.stringify({ targetPlan: "STARTER" }),
  });
  assertOk(
    "Billing checkout (manual upgrade)",
    result.response.ok && result.json?.ok === true,
    `${result.response.status} ${result.text}`,
    `plan ${result.json?.organization?.plan ?? "?"}`
  );

  console.log("\nQA RESULTS");
  for (const item of results) {
    console.log(`${item.ok ? "✅" : "❌"} ${item.step}${item.details ? ` — ${item.details}` : ""}`);
  }

  const failed = results.filter((item) => !item.ok);
  if (failed.length > 0) {
    console.error(`\nFAILED: ${failed.length} step(s)`);
    process.exit(1);
  }

  console.log("\nAll QA steps passed.");
})();
