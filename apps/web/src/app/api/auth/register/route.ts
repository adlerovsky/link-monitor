import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { applySessionCookie, hashPassword } from "@/lib/auth";

function normalizeOrgName(raw: string, email: string) {
  const normalized = raw.trim();
  if (normalized.length >= 2) return normalized;

  const emailPrefix = email.split("@")[0]?.trim();
  if (emailPrefix && emailPrefix.length >= 2) {
    return `${emailPrefix} Org`;
  }

  return "My Organization";
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const email = String(body?.email ?? "").trim().toLowerCase();
    const password = String(body?.password ?? "");
    const organizationName = String(body?.organizationName ?? "");

    if (!email || !password) {
      return NextResponse.json({ error: "email and password required" }, { status: 400 });
    }

    if (password.length < 8) {
      return NextResponse.json({ error: "password must be at least 8 characters" }, { status: 400 });
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return NextResponse.json({ error: "email already in use" }, { status: 409 });
    }

    const passwordHash = await hashPassword(password);

    const result = await prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: { name: normalizeOrgName(organizationName, email) },
      });

      const user = await tx.user.create({
        data: {
          email,
          passwordHash,
          organizationId: org.id,
          role: "OWNER",
        },
        select: {
          id: true,
          email: true,
          organizationId: true,
          role: true,
        },
      });

      return { org, user };
    });

    const response = NextResponse.json({ user: result.user, organizationId: result.org.id }, { status: 201 });
    applySessionCookie(response, result.user.id);
    return response;
  } catch (e: any) {
    console.error("POST /api/auth/register ERROR:", e);
    return NextResponse.json(
      { error: e?.message ?? String(e), name: e?.name, code: e?.code },
      { status: 500 }
    );
  }
}
