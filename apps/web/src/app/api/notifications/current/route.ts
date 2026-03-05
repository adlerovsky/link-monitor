import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { getNotificationSnapshot } from "@/lib/notifications";

export async function GET() {
  try {
    const auth = await requireApiUser();
    if (auth.error) return auth.error;

    const snapshot = await getNotificationSnapshot(auth.user.organizationId);
    if (!snapshot) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    return NextResponse.json(snapshot);
  } catch (e: any) {
    console.error("GET /api/notifications/current ERROR:", e);
    return NextResponse.json(
      { error: e?.message ?? String(e), name: e?.name, code: e?.code },
      { status: 500 }
    );
  }
}
