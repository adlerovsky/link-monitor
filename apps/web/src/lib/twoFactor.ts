import "server-only";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { sendTwoFactorEmail } from "@/lib/authEmail";

const CODE_TTL_MINUTES = 10;
const MIN_SESSION_SECRET_LENGTH = 32;

function get2faSecret() {
  const sessionSecret = process.env.SESSION_SECRET;
  if (sessionSecret && sessionSecret.length >= MIN_SESSION_SECRET_LENGTH) {
    return `${sessionSecret}:2fa`;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      `SESSION_SECRET must be set and at least ${MIN_SESSION_SECRET_LENGTH} characters in production`
    );
  }

  return "dev-only-insecure-session-secret-change-me:2fa";
}

function generateCode() {
  const codeNumber = crypto.randomInt(0, 1_000_000);
  return String(codeNumber).padStart(6, "0");
}

function hashCode(code: string) {
  return crypto.createHash("sha256").update(`${get2faSecret()}:${code}`).digest("hex");
}

export function verifyTwoFactorCode(inputCode: string, storedCodeHash: string) {
  const computedHash = hashCode(inputCode);
  const left = Buffer.from(storedCodeHash, "hex");
  const right = Buffer.from(computedHash, "hex");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export async function issueLoginTwoFactorCode(input: { userId: string; email: string }) {
  const code = generateCode();
  const codeHash = hashCode(code);
  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000);

  await prisma.loginTwoFactorCode.deleteMany({
    where: {
      OR: [{ expiresAt: { lt: new Date() } }, { userId: input.userId, consumedAt: null }],
    },
  });

  const challenge = await prisma.loginTwoFactorCode.create({
    data: {
      userId: input.userId,
      email: input.email,
      codeHash,
      expiresAt,
    },
    select: {
      id: true,
      expiresAt: true,
    },
  });

  const delivery = await sendTwoFactorEmail({
    to: input.email,
    code,
  });

  return {
    challengeId: challenge.id,
    expiresAt: challenge.expiresAt.toISOString(),
    deliveredVia: delivery.provider,
    devCode: delivery.provider === "console" ? code : undefined,
  };
}
