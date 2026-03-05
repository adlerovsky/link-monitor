import "server-only";

type SendTwoFactorEmailInput = {
  to: string;
  code: string;
};

type SendTwoFactorEmailResult = {
  delivered: boolean;
  provider: "resend" | "console";
};

function sanitizeText(raw: string) {
  return raw.replace(/\s+/g, " ").trim().slice(0, 500);
}

export async function sendTwoFactorEmail(
  input: SendTwoFactorEmailInput
): Promise<SendTwoFactorEmailResult> {
  const { to, code } = input;

  const resendApiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.AUTH_EMAIL_FROM;

  if (resendApiKey && fromEmail) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${resendApiKey}`,
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [to],
        subject: "Your Link Monitor by Adler login code",
        text: `Your verification code is ${code}. It expires in 10 minutes.`,
      }),
    });

    if (!response.ok) {
      const errorText = sanitizeText(await response.text().catch(() => "resend error"));
      throw new Error(`Failed to send verification email (${response.status}): ${errorText}`);
    }

    return { delivered: true, provider: "resend" };
  }

  if (process.env.NODE_ENV !== "production") {
    console.info(`[2FA DEV] Login code for ${to}: ${code}`);
    return { delivered: false, provider: "console" };
  }

  throw new Error("Email provider is not configured (set RESEND_API_KEY and AUTH_EMAIL_FROM)");
}
