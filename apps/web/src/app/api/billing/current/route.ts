import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { getBillingSnapshot } from "@/lib/billing";

export async function GET() {
  try {
    const auth = await requireApiUser();
    if (auth.error) return auth.error;

    const snapshot = await getBillingSnapshot(auth.user.organizationId);
    if (!snapshot) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    return NextResponse.json(snapshot);
  } catch (e: any) {
    console.error("GET /api/billing/current ERROR:", e);
    return NextResponse.json(
      { error: e?.message ?? String(e), name: e?.name, code: e?.code },
      { status: 500 }
    );
  }
}
