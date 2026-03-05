import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function normalizeOptionalText(value: unknown, max = 120) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  return text.slice(0, max);
}

function isProfileSchemaDriftError(error: unknown) {
  const message = String((error as any)?.message ?? "");
  return message.includes("Unknown field `firstName`") || message.includes("Unknown arg `firstName`");
}

export async function GET() {
  const auth = await requireApiUser();
  if (auth.error) return auth.error;

  try {
    const user = await prisma.user.findUnique({
      where: { id: auth.user.id },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        organization: {
          select: {
            plan: true,
          },
        },
      },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({
      profile: {
        firstName: user.firstName,
        lastName: user.lastName,
        phone: user.phone,
        email: user.email,
        plan: user.organization.plan,
      },
    });
  } catch (e: any) {
    console.error("GET /api/auth/profile ERROR:", e);

    if (isProfileSchemaDriftError(e)) {
      const user = await prisma.user.findUnique({
        where: { id: auth.user.id },
        select: {
          email: true,
          organization: {
            select: {
              plan: true,
            },
          },
        },
      });

      if (!user) {
        return NextResponse.json({ error: "User not found" }, { status: 404 });
      }

      return NextResponse.json({
        profile: {
          firstName: null,
          lastName: null,
          phone: null,
          email: user.email,
          plan: user.organization.plan,
        },
        warning: "profile fields are not available yet; restart dev server after prisma generate",
      });
    }

    return NextResponse.json(
      { error: "Failed to load profile" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const auth = await requireApiUser();
  if (auth.error) return auth.error;

  try {
    const body = await req.json().catch(() => ({}));

    const firstName = normalizeOptionalText(body?.firstName, 80);
    const lastName = normalizeOptionalText(body?.lastName, 80);
    const phone = normalizeOptionalText(body?.phone, 40);

    const user = await prisma.user.update({
      where: { id: auth.user.id },
      data: {
        firstName,
        lastName,
        phone,
      },
      select: {
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        organization: {
          select: {
            plan: true,
          },
        },
      },
    });

    return NextResponse.json({
      profile: {
        firstName: user.firstName,
        lastName: user.lastName,
        phone: user.phone,
        email: user.email,
        plan: user.organization.plan,
      },
    });
  } catch (e: any) {
    console.error("POST /api/auth/profile ERROR:", e);

    if (isProfileSchemaDriftError(e)) {
      return NextResponse.json(
        { error: "Profile fields are not ready. Restart dev server and regenerate Prisma client." },
        { status: 503 }
      );
    }

    return NextResponse.json(
      { error: "Failed to save profile" },
      { status: 500 }
    );
  }
}
