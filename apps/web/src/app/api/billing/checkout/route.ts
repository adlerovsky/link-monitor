import { NextResponse } from "next/server";
import { requireApiRole, requireApiUser } from "@/lib/auth";
import { getBillingSnapshot, parsePlan, upgradeOrganizationPlan } from "@/lib/billing";

export async function POST(req: Request) {
  try {
    const auth = await requireApiUser();
    if (auth.error) return auth.error;

    const forbidden = requireApiRole(auth.user.role, ["OWNER", "MANAGER"] as const);
    if (forbidden) return forbidden;

    const body = await req.json().catch(() => ({}));
    const targetPlan = parsePlan(body?.targetPlan);

    if (!targetPlan) {
      return NextResponse.json({ error: "targetPlan required" }, { status: 400 });
    }

    const result = await upgradeOrganizationPlan({
      organizationId: auth.user.organizationId,
      targetPlan,
      actorUserId: auth.user.id,
      mode: "manual",
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

    const snapshot = await getBillingSnapshot(auth.user.organizationId);

    return NextResponse.json({
      ok: true,
      mode: "manual",
      organization: result.organization,
      event: result.event,
      billing: snapshot,
    });
  } catch (e: any) {
    console.error("POST /api/billing/checkout ERROR:", e);
    return NextResponse.json(
      { error: e?.message ?? String(e), name: e?.name, code: e?.code },
      { status: 500 }
    );
  }
}
