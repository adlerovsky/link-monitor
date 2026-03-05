import { NextResponse } from "next/server";
import { requireApiRole, requireApiUser } from "@/lib/auth";
import { hasProjectAccess } from "@/lib/access";
import { parseReportPeriod, sendReportToTelegram } from "@/lib/reports";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  try {
    const auth = await requireApiUser();
    if (auth.error) return auth.error;

    const forbidden = requireApiRole(auth.user.role, ["OWNER", "MANAGER"] as const);
    if (forbidden) return forbidden;

    const body = await req.json().catch(() => ({}));
    const projectId = String(body?.projectId ?? "").trim();

    if (projectId) {
      const allowed = await hasProjectAccess(auth.user.organizationId, projectId);
      if (!allowed) {
        return NextResponse.json({ error: "Project not found" }, { status: 404 });
      }
    }

    const period = parseReportPeriod({
      daysRaw: body?.days ? String(body.days) : null,
      fromRaw: body?.from ? String(body.from) : null,
      toRaw: body?.to ? String(body.to) : null,
    });

    const organization = await prisma.organization.findUnique({
      where: { id: auth.user.organizationId },
      select: { telegramChatId: true },
    });

    if (!organization?.telegramChatId) {
      return NextResponse.json(
        {
          error: "Telegram chat id is not configured",
          code: "TELEGRAM_CHAT_ID_MISSING",
        },
        { status: 400 }
      );
    }

    const result = await sendReportToTelegram({
      organizationId: auth.user.organizationId,
      telegramChatId: organization.telegramChatId,
      projectId: projectId || undefined,
      from: period.from,
      toExclusive: period.toExclusive,
    });

    if (!result.ok) {
      return NextResponse.json(
        {
          error: result.error,
          code: result.code,
        },
        { status: result.status }
      );
    }

    return NextResponse.json({
      ok: true,
      sent: true,
      period: result.summary.period,
      generatedAt: result.summary.generatedAt,
    });
  } catch (e: any) {
    console.error("POST /api/reports/send-telegram ERROR:", e);
    return NextResponse.json(
      { error: e?.message ?? String(e), name: e?.name, code: e?.code },
      { status: 500 }
    );
  }
}
