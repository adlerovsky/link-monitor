import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { issueLoginTwoFactorCode } from "@/lib/twoFactor";
import { consumeRateLimit, getClientIp, pruneRateLimitBuckets } from "@/lib/rateLimit";

export async function POST(req: Request) {
  try {
    pruneRateLimitBuckets();
    const body = await req.json().catch(() => ({}));
    const challengeId = String(body?.challengeId ?? "").trim();

    if (!challengeId) {
      return NextResponse.json({ error: "challengeId required" }, { status: 400 });
    }

    const ip = getClientIp(req);
    const rate = await consumeRateLimit({
      key: `auth-2fa-resend:${ip}:${challengeId}`,
      limit: 5,
      windowMs: 10 * 60 * 1000,
    });

    if (!rate.allowed) {
      return NextResponse.json(
        { error: "too many resend attempts, try again in a few minutes" },
        { status: 429 }
      );
    }

    const challenge = await prisma.loginTwoFactorCode.findUnique({
      where: { id: challengeId },
      select: {
        id: true,
        userId: true,
        email: true,
        consumedAt: true,
      },
    });

    if (!challenge || challenge.consumedAt) {
      return NextResponse.json({ error: "invalid or expired challenge" }, { status: 401 });
    }

    const nextChallenge = await issueLoginTwoFactorCode({
      userId: challenge.userId,
      email: challenge.email,
    });

    return NextResponse.json({
      challengeId: nextChallenge.challengeId,
      expiresAt: nextChallenge.expiresAt,
      delivery: nextChallenge.deliveredVia,
      devCode: nextChallenge.devCode,
    });
  } catch (e: any) {
    console.error("POST /api/auth/login/resend-2fa ERROR:", e);
    return NextResponse.json(
      { error: e?.message ?? String(e), name: e?.name, code: e?.code },
      { status: 500 }
    );
  }
}
