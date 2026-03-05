import { NextResponse } from "next/server";
import { requireApiRole, requireApiUser } from "@/lib/auth";
import { getNotificationSnapshot, updateTelegramChatId } from "@/lib/notifications";

export async function POST(req: Request) {
  try {
    const auth = await requireApiUser();
    if (auth.error) return auth.error;

    const forbidden = requireApiRole(auth.user.role, ["OWNER", "MANAGER"] as const);
    if (forbidden) return forbidden;

    const body = await req.json().catch(() => ({}));

    const update = await updateTelegramChatId(auth.user.organizationId, body?.telegramChatId);
    if (!update.ok) {
      return NextResponse.json(
        {
          error: update.error,
          code: update.code,
        },
        { status: update.status }
      );
    }

    const snapshot = await getNotificationSnapshot(auth.user.organizationId);

    return NextResponse.json({
      ok: true,
      notifications: snapshot,
    });
  } catch (e: any) {
    console.error("POST /api/notifications/settings ERROR:", e);
    return NextResponse.json(
      { error: e?.message ?? String(e), name: e?.name, code: e?.code },
      { status: 500 }
    );
  }
}
