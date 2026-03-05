const base = process.env.LM_API_BASE_URL || "http://127.0.0.1:3000";
const email = process.env.LM_TEST_EMAIL || "alex.bratkovsky@gmail.com";
const password = process.env.LM_TEST_PASSWORD || "admin";

function parseSetCookieHeader(setCookieHeader) {
  if (!setCookieHeader) return "";
  return setCookieHeader.split(",").map((chunk) => chunk.split(";")[0]).join("; ");
}

async function main() {
  const login = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  const loginData = await login.json().catch(() => ({}));
  if (!login.ok) throw new Error(`Login failed (${login.status}): ${JSON.stringify(loginData)}`);

  const code = loginData?.devCode;
  if (!code) throw new Error("No devCode returned from /api/auth/login");

  if (!loginData?.requiresTwoFactor) {
    throw new Error("Login did not return requiresTwoFactor=true");
  }

  const challengeId = loginData?.challengeId;
  if (!challengeId) throw new Error("challengeId missing in login response");

  const verify = await fetch(`${base}/api/auth/login/verify-2fa`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ challengeId, code }),
  });

  const verifyData = await verify.json().catch(() => ({}));
  if (!verify.ok) throw new Error(`2FA verify failed (${verify.status}): ${JSON.stringify(verifyData)}`);

  const cookie = parseSetCookieHeader(verify.headers.get("set-cookie"));
  if (!cookie.includes("lm_session=")) {
    throw new Error("Session cookie missing after verify-2fa");
  }

  let projectId = null;
  const suffix = Date.now().toString().slice(-6);
  const createProject = await fetch(`${base}/api/projects`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      cookie,
    },
    body: JSON.stringify({
      name: `Smoke ${suffix}`,
      baseDomain: "freeslotshub.com",
    }),
  });

  const projectData = await createProject.json().catch(() => ({}));
  if (createProject.ok) {
    projectId = projectData?.project?.id ?? null;
  } else if (
    createProject.status === 403 &&
    String(projectData?.code ?? "") === "PLAN_PROJECT_LIMIT_REACHED"
  ) {
    const listRes = await fetch(`${base}/api/projects`, {
      headers: { cookie },
    });
    const listData = await listRes.json().catch(() => ({}));
    if (!listRes.ok) {
      throw new Error(`Projects list failed (${listRes.status}): ${JSON.stringify(listData)}`);
    }

    const existing = Array.isArray(listData?.projects) ? listData.projects : [];
    const sameDomain = existing.find((p) => p?.baseDomain === "freeslotshub.com");
    if (!sameDomain?.id) {
      throw new Error(
        "Project limit reached and no existing project with baseDomain=freeslotshub.com"
      );
    }

    projectId = sameDomain.id;
  } else {
    throw new Error(`Create project failed (${createProject.status}): ${JSON.stringify(projectData)}`);
  }

  if (!projectId) throw new Error("Project id unavailable for smoke test");

  const badBacklink = await fetch(`${base}/api/backlinks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      cookie,
    },
    body: JSON.stringify({
      projectId,
      sourceUrl: "https://donor.example/post-1",
      targetUrl: "https://google.com/page",
      priority: "STANDARD",
      currency: "EUR",
      cost: 10,
    }),
  });

  const badData = await badBacklink.json().catch(() => ({}));

  const goodBacklink = await fetch(`${base}/api/backlinks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      cookie,
    },
    body: JSON.stringify({
      projectId,
      sourceUrl: "https://donor.example/post-2",
      targetUrl: "https://blog.freeslotshub.com/offer",
      priority: "STANDARD",
      currency: "EUR",
      cost: 11,
    }),
  });

  const goodData = await goodBacklink.json().catch(() => ({}));

  console.log(
    JSON.stringify(
      {
        ok: true,
        base,
        projectCreated: Boolean(projectId),
        badBacklinkStatus: badBacklink.status,
        badBacklinkError: badData?.error ?? null,
        goodBacklinkStatus: goodBacklink.status,
        goodBacklinkCreated: Boolean(goodData?.backlink?.id),
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error?.message ?? String(error));
  process.exit(1);
});
