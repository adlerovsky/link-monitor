import { NextResponse } from "next/server";
import { applySessionCookie } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { verifyTwoFactorCode } from "@/lib/twoFactor";
import { consumeRateLimit, getClientIp, pruneRateLimitBuckets } from "@/lib/rateLimit";

const MAX_2FA_ATTEMPTS = 5;

export async function POST(req: Request) {
  try {
    pruneRateLimitBuckets();
    const body = await req.json().catch(() => ({}));
    const challengeId = String(body?.challengeId ?? "").trim();
    const code = String(body?.code ?? "").trim();

    if (!challengeId || !/^\d{6}$/.test(code)) {
      return NextResponse.json({ error: "challengeId and 6-digit code required" }, { status: 400 });
    }

    const ip = getClientIp(req);
    const rate = await consumeRateLimit({
      key: `auth-2fa:${ip}:${challengeId}`,
      limit: 10,
      windowMs: 10 * 60 * 1000,
    });
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "too many verification attempts, request a new code" },
        { status: 429 }
      );
    }

    const challenge = await prisma.loginTwoFactorCode.findUnique({
      where: { id: challengeId },
      select: {
        id: true,
        userId: true,
        email: true,
        codeHash: true,
        attempts: true,
        expiresAt: true,
        consumedAt: true,
        user: {
          select: {
            id: true,
            email: true,
            organizationId: true,
            role: true,
          },
        },
      },
    });

    if (!challenge || !challenge.user) {
      return NextResponse.json({ error: "invalid or expired challenge" }, { status: 401 });
    }

    const now = new Date();
    if (challenge.consumedAt || challenge.expiresAt <= now) {
      return NextResponse.json({ error: "invalid or expired challenge" }, { status: 401 });
    }

    if (challenge.attempts >= MAX_2FA_ATTEMPTS) {
      return NextResponse.json({ error: "too many attempts, request a new code" }, { status: 429 });
    }

    const codeOk = verifyTwoFactorCode(code, challenge.codeHash);
    if (!codeOk) {
      await prisma.loginTwoFactorCode.update({
        where: { id: challenge.id },
        data: { attempts: { increment: 1 } },
      });
      return NextResponse.json({ error: "invalid verification code" }, { status: 401 });
    }

    await prisma.$transaction([
      prisma.loginTwoFactorCode.update({
        where: { id: challenge.id },
        data: { consumedAt: now, attempts: { increment: 1 } },
      }),
      prisma.loginTwoFactorCode.deleteMany({
        where: {
          userId: challenge.user.id,
          consumedAt: null,
          id: { not: challenge.id },
        },
      }),
    ]);

    const response = NextResponse.json({
      user: {
        id: challenge.user.id,
        email: challenge.user.email,
        organizationId: challenge.user.organizationId,
        role: challenge.user.role,
      },
    });

    applySessionCookie(response, challenge.user.id);
    return response;
  } catch (e: any) {
    console.error("POST /api/auth/login/verify-2fa ERROR:", e);
    return NextResponse.json(
      { error: e?.message ?? String(e), name: e?.name, code: e?.code },
      { status: 500 }
    );
  }
}
