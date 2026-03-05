const base = process.env.LM_API_BASE_URL || "http://127.0.0.1:3000";
const email = process.env.LM_TEST_EMAIL || "alex.bratkovsky@gmail.com";
const password = process.env.LM_TEST_PASSWORD || "admin";

function parseSetCookieHeader(setCookieHeader) {
  if (!setCookieHeader) return "";
  return setCookieHeader.split(",").map((chunk) => chunk.split(";")[0]).join("; ");
}

async function main() {
  const loginRes = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  const loginBody = await loginRes.json().catch(() => ({}));
  if (!loginRes.ok) {
    throw new Error(`login failed (${loginRes.status}): ${JSON.stringify(loginBody)}`);
  }

  const verifyRes = await fetch(`${base}/api/auth/login/verify-2fa`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ challengeId: loginBody.challengeId, code: loginBody.devCode }),
  });

  const verifyBody = await verifyRes.json().catch(() => ({}));
  if (!verifyRes.ok) {
    throw new Error(`verify failed (${verifyRes.status}): ${JSON.stringify(verifyBody)}`);
  }

  const cookie = parseSetCookieHeader(verifyRes.headers.get("set-cookie"));

  const sendRes = await fetch(`${base}/api/reports/send-telegram`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie,
    },
    body: JSON.stringify({ days: 30 }),
  });

  const sendBody = await sendRes.json().catch(() => ({}));

  console.log(
    JSON.stringify(
      {
        ok: sendRes.ok,
        status: sendRes.status,
        body: sendBody,
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
