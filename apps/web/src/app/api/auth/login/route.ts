import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/auth";
import { issueLoginTwoFactorCode } from "@/lib/twoFactor";
import { consumeRateLimit, getClientIp, pruneRateLimitBuckets } from "@/lib/rateLimit";

export async function POST(req: Request) {
  try {
    pruneRateLimitBuckets();
    const body = await req.json().catch(() => ({}));
    const email = String(body?.email ?? "").trim().toLowerCase();
    const password = String(body?.password ?? "");

    if (!email || !password) {
      return NextResponse.json({ error: "email and password required" }, { status: 400 });
    }

    const ip = getClientIp(req);
    const rate = await consumeRateLimit({
      key: `auth-login:${ip}:${email}`,
      limit: 10,
      windowMs: 10 * 60 * 1000,
    });
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "too many login attempts, try again in a few minutes" },
        { status: 429 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        organizationId: true,
        role: true,
      },
    });

    if (!user) {
      return NextResponse.json({ error: "invalid credentials" }, { status: 401 });
    }

    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) {
      return NextResponse.json({ error: "invalid credentials" }, { status: 401 });
    }

    const challenge = await issueLoginTwoFactorCode({
      userId: user.id,
      email: user.email,
    });

    return NextResponse.json({
      requiresTwoFactor: true,
      challengeId: challenge.challengeId,
      expiresAt: challenge.expiresAt,
      delivery: challenge.deliveredVia,
      devCode: challenge.devCode,
    });
  } catch (e: any) {
    console.error("POST /api/auth/login ERROR:", e);
    return NextResponse.json(
      { error: e?.message ?? String(e), name: e?.name, code: e?.code },
      { status: 500 }
    );
  }
}
