import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/lib/auth";
import { hasBacklinkAccess } from "@/lib/access";

const clampInt = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));

function normalizeText(s: string) {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function computeAnchorOk(expected: string | null, detected: string | null) {
  if (!expected) return true;
  if (!detected) return false;
  return normalizeText(detected).includes(normalizeText(expected));
}

function computeRowStatus(opts: {
  httpStatus: number | null;
  linkFound: boolean;
  anchorOk: boolean;
}): "ACTIVE" | "ISSUE" | "LOST" {
  const { httpStatus, linkFound, anchorOk } = opts;

  if (httpStatus == null) return "ISSUE";
  if (httpStatus < 200 || httpStatus >= 300) return "ISSUE";

  // 2xx
  if (!linkFound) return "LOST";
  return anchorOk ? "ACTIVE" : "ISSUE";
}

function computeIssueReason(opts: {
  status: "ACTIVE" | "ISSUE" | "LOST";
  httpStatus: number | null;
  linkFound: boolean;
  anchorOk: boolean;
}) {
  const { status, httpStatus, linkFound, anchorOk } = opts;
  if (status !== "ISSUE") return null;

  if (httpStatus == null) return "FETCH_FAILED";
  if (httpStatus === 403 || httpStatus === 429) return "BLOCKED_OR_CAPTCHA";
  if (httpStatus < 200 || httpStatus >= 300) return "HTTP_NOT_2XX";
  if (!linkFound) return "LINK_NOT_FOUND";
  if (!anchorOk) return "ANCHOR_MISMATCH";
  return "UNKNOWN";
}

export async function GET(req: Request) {
  try {
    const auth = await requireApiUser();
    if (auth.error) return auth.error;

    const url = new URL(req.url);
    const backlinkId = (url.searchParams.get("backlinkId") ?? "").trim();
    if (!backlinkId) {
      return NextResponse.json({ error: "backlinkId required" }, { status: 400 });
    }

    const allowed = await hasBacklinkAccess(auth.user.organizationId, backlinkId);
    if (!allowed) {
      return NextResponse.json({ error: "Backlink not found" }, { status: 404 });
    }

    const takeRaw = Number(url.searchParams.get("take") ?? 10);
    const take = clampInt(Number.isFinite(takeRaw) ? takeRaw : 10, 1, 100);

    // 1) Need expectedAnchor (for anchorOk)
    const backlink = await prisma.backlink.findUnique({
      where: { id: backlinkId },
      select: {
        id: true,
        expectedAnchor: true,
      },
    });

    if (!backlink) {
      return NextResponse.json({ error: "Backlink not found" }, { status: 404 });
    }

    // 2) Read checks: ONLY real DB fields
    const rows = await prisma.check.findMany({
      where: { backlinkId },
      orderBy: { checkedAt: "desc" },
      take,
      select: {
        checkedAt: true,
        httpStatus: true,
        linkFound: true,
        anchorDetected: true,
        relDetected: true,
        isNoindex: true,
        canonicalUrl: true,
        rawHtmlHash: true,
      },
    });

    const checks = rows.map((r) => {
      const anchorOk = computeAnchorOk(backlink.expectedAnchor ?? null, r.anchorDetected ?? null);

      const status = computeRowStatus({
        httpStatus: r.httpStatus ?? null,
        linkFound: Boolean(r.linkFound),
        anchorOk,
      });

      const issueReason = computeIssueReason({
        status,
        httpStatus: r.httpStatus ?? null,
        linkFound: Boolean(r.linkFound),
        anchorOk,
      });

      return {
        checkedAt: r.checkedAt,
        httpStatus: r.httpStatus,
        linkFound: r.linkFound,
        anchorDetected: r.anchorDetected,
        relDetected: r.relDetected,
        isNoindex: r.isNoindex,
        canonicalUrl: r.canonicalUrl,
        rawHtmlHash: r.rawHtmlHash,

        // computed, not DB
        expectedAnchor: backlink.expectedAnchor ?? null,
        anchorOk,
        issueReason,
        status,
      };
    });

    return NextResponse.json({ checks });
  } catch (e: any) {
    console.error("CHECKS BY BACKLINK ERROR:", e);
    return NextResponse.json(
      { error: e?.message ?? String(e), name: e?.name, code: e?.code },
      { status: 500 }
    );
  }
}