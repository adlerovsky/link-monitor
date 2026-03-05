import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import crypto from "crypto";
import { requireApiUser } from "@/lib/auth";
import { hasBacklinkAccess } from "@/lib/access";

type Priority = "CRITICAL" | "STANDARD" | "LOW";
type BacklinkStatus = "ACTIVE" | "ISSUE" | "LOST" | "DELETED";
type MetaKind = "HARD_FAIL" | "SOFT_FAIL" | null;

type IssueReason =
  | "FETCH_FAILED"
  | "BLOCKED_OR_CAPTCHA"
  | "HTTP_NOT_2XX"
  | "LINK_NOT_FOUND"
  | "ANCHOR_MISMATCH"
  | null;

type AlertType = "ACTIVE_TO_ISSUE" | "ISSUE_TO_LOST" | "TO_LOST";

function thresholdForPriority(p: Priority): number {
  if (p === "CRITICAL") return 2;
  if (p === "STANDARD") return 3;
  return 4;
}

function normalizeText(s: string) {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function computeAnchorOk(expected: string | null, detected: string | null) {
  if (!expected) return true;
  if (!detected) return false;
  return normalizeText(detected).includes(normalizeText(expected));
}

function is2xx(code: number) {
  return code >= 200 && code < 300;
}

function sha256(s: string) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

function normalizeUrlForMatch(u: string) {
  return u
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/$/, "");
}

function extractCanonical(html: string): string | null {
  const m =
    html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i) ||
    html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i);
  return m?.[1] ?? null;
}

function extractNoindex(html: string): boolean {
  const m = html.match(
    /<meta[^>]+name=["']robots["'][^>]+content=["']([^"']+)["'][^>]*>/i
  );
  if (!m?.[1]) return false;
  return m[1].toLowerCase().includes("noindex");
}

function classify(opts: {
  httpStatus: number | null;
  linkFound: boolean | null;
  anchorOk: boolean;
}) {
  const { httpStatus, linkFound, anchorOk } = opts;

  if (httpStatus == null) {
    return { kind: "SOFT_FAIL" as const, issueReason: "FETCH_FAILED" as const };
  }

  if (httpStatus === 403 || httpStatus === 429) {
    return {
      kind: "SOFT_FAIL" as const,
      issueReason: "BLOCKED_OR_CAPTCHA" as const,
    };
  }

  if (!is2xx(httpStatus)) {
    return { kind: "HARD_FAIL" as const, issueReason: "HTTP_NOT_2XX" as const };
  }

  if (linkFound === false) {
    return {
      kind: "HARD_FAIL" as const,
      issueReason: "LINK_NOT_FOUND" as const,
    };
  }

  if (!anchorOk) {
    return {
      kind: "HARD_FAIL" as const,
      issueReason: "ANCHOR_MISMATCH" as const,
    };
  }

  return { kind: null, issueReason: null };
}

/**
 * Lightweight anchor parser (no cheerio).
 * Finds <a ... href="...">TEXT</a> where href includes targetUrl (normalized).
 */
function extractLinkInfo(
  html: string,
  targetUrl: string
): {
  linkFound: boolean;
  anchorDetected: string | null;
  relDetected: string | null;
} {
  const targetNorm = normalizeUrlForMatch(targetUrl);
  const re = /<a\b([^>]*?)>([\s\S]*?)<\/a>/gi;

  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    const attrs = match[1] ?? "";
    const inner = match[2] ?? "";

    const hrefM =
      attrs.match(/\bhref=["']([^"']+)["']/i) ||
      attrs.match(/\bhref=([^ \t\r\n>]+)/i);
    const href = (hrefM?.[1] ?? "").trim();
    if (!href) continue;

    const hrefNorm = normalizeUrlForMatch(href);
    if (!hrefNorm.includes(targetNorm)) continue;

    const relM = attrs.match(/\brel=["']([^"']+)["']/i);
    const rel = relM?.[1] ?? null;

    const text = inner.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

    return {
      linkFound: true,
      anchorDetected: text || null,
      relDetected: rel,
    };
  }

  // fallback: target appears somewhere in html
  if (html.toLowerCase().includes(targetNorm)) {
    return { linkFound: true, anchorDetected: null, relDetected: null };
  }

  return { linkFound: false, anchorDetected: null, relDetected: null };
}

async function fetchHtml(
  url: string
): Promise<{ httpStatus: number | null; html: string | null }> {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      cache: "no-store",
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121 Safari/537.36",
        accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    return { httpStatus: res.status, html: await res.text() };
  } catch {
    return { httpStatus: null, html: null };
  }
}

export async function POST(req: Request) {
  try {
    const auth = await requireApiUser();
    if (auth.error) return auth.error;

    const body = await req.json().catch(() => ({}));
    const id = String(body?.id ?? "").trim();
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    const allowed = await hasBacklinkAccess(auth.user.organizationId, id);
    if (!allowed) {
      return NextResponse.json({ error: "Backlink not found" }, { status: 404 });
    }

    const backlink = await prisma.backlink.findUnique({
      where: { id },
      select: {
        id: true,
        projectId: true,
        sourceUrl: true,
        targetUrl: true,
        expectedAnchor: true,
        priority: true,
        status: true,
        lostAt: true,
        checkEveryHours: true,
      },
    });

    if (!backlink) {
      return NextResponse.json({ error: "Backlink not found" }, { status: 404 });
    }

    if (backlink.status === "DELETED") {
      return NextResponse.json(
        { error: "Backlink is deleted and cannot be checked" },
        { status: 409 }
      );
    }

    const backlinkId = backlink.id;

    const prevStatus = backlink.status as BacklinkStatus;
    const threshold = thresholdForPriority(backlink.priority as Priority);

    // 1) fetch HTML
    const { httpStatus, html } = await fetchHtml(backlink.sourceUrl);

    // 2) extract info
    const canonicalUrl = html ? extractCanonical(html) : null;
    const isNoindex = html ? extractNoindex(html) : false;

    const linkInfo = html
      ? extractLinkInfo(html, backlink.targetUrl)
      : { linkFound: false, anchorDetected: null, relDetected: null };

    const anchorOk = computeAnchorOk(
      backlink.expectedAnchor ?? null,
      linkInfo.anchorDetected
    );

    const cls = classify({
      httpStatus,
      linkFound: linkInfo.linkFound,
      anchorOk,
    });

    const rawHtmlHash = html ? sha256(html) : null;

    // 3) recent history for streak logic
    const recent = await prisma.check.findMany({
      where: { backlinkId },
      orderBy: { checkedAt: "desc" },
      take: 25,
      select: {
        checkedAt: true,
        httpStatus: true,
        linkFound: true,
        anchorDetected: true,
      },
    });

    let consecutiveHard = 0;
    for (const r of recent) {
      const rAnchorOk = computeAnchorOk(
        backlink.expectedAnchor ?? null,
        r.anchorDetected ?? null
      );
      const rCls = classify({
        httpStatus: r.httpStatus ?? null,
        linkFound: typeof r.linkFound === "boolean" ? r.linkFound : null,
        anchorOk: rAnchorOk,
      });

      if (rCls.kind === "HARD_FAIL") {
        consecutiveHard += 1;
        continue;
      }
      break;
    }

    const newStreak = cls.kind === "HARD_FAIL" ? consecutiveHard + 1 : 0;
    const streakCapped =
      cls.kind === "HARD_FAIL" ? Math.min(newStreak, threshold) : 0;

    // 4) decide new backlink status (state machine lite)
    let newStatus: BacklinkStatus;
    let lostAt: Date | null = backlink.lostAt ? new Date(backlink.lostAt as any) : null;

    if (cls.kind === null) {
      newStatus = "ACTIVE";
      lostAt = null; // auto-recover
    } else if (cls.kind === "SOFT_FAIL") {
      newStatus = prevStatus === "LOST" ? "LOST" : "ISSUE";
    } else {
      // HARD_FAIL
      if (newStreak >= threshold) {
        newStatus = "LOST";
        if (!lostAt) lostAt = new Date();
      } else {
        newStatus = prevStatus === "LOST" ? "LOST" : "ISSUE";
      }
    }

    const now = new Date();
    const nextCheckAt = new Date(
      now.getTime() + (Number(backlink.checkEveryHours) || 72) * 60 * 60 * 1000
    );

    // 5) write Check (only real schema fields)
    await prisma.check.create({
      data: {
        backlinkId,
        checkedAt: now,
        httpStatus,
        linkFound: linkInfo.linkFound,
        anchorDetected: linkInfo.anchorDetected,
        relDetected: linkInfo.relDetected,
        isNoindex,
        canonicalUrl,
        rawHtmlHash,
      },
    });

    // 6) Alerts MVP (create on transitions + dedupe + auto-resolve)
    async function createAlertOnce(type: AlertType) {
      const existing = await prisma.alert.findFirst({
        where: { backlinkId, type: type as any, resolvedAt: null },
        select: { id: true },
      });
      if (existing) return;

      await prisma.alert.create({
        data: { backlinkId, type: type as any },
      });
    }

    if (prevStatus === "ACTIVE" && newStatus === "ISSUE") {
      await createAlertOnce("ACTIVE_TO_ISSUE");
    }

    if (newStatus === "LOST" && prevStatus !== "LOST") {
      await createAlertOnce(prevStatus === "ISSUE" ? "ISSUE_TO_LOST" : "TO_LOST");
    }

    if (newStatus === "ACTIVE" && prevStatus !== "ACTIVE") {
      await prisma.alert.updateMany({
        where: { backlinkId, resolvedAt: null },
        data: { resolvedAt: now },
      });
    }

    // 7) update Backlink
    const updated = await prisma.backlink.update({
      where: { id: backlinkId },
      data: {
        status: newStatus as any,
        lostAt,
        lastCheckedAt: now,
        nextCheckAt,
      },
    });

    return NextResponse.json({
      backlink: updated,
      check: {
        checkedAt: now.toISOString(),
        httpStatus,
        linkFound: linkInfo.linkFound,
        status: newStatus,
        expectedAnchor: backlink.expectedAnchor ?? null,
        anchorDetected: linkInfo.anchorDetected,
        anchorOk,
        issueReason: cls.issueReason as IssueReason,
        relDetected: linkInfo.relDetected,
        isNoindex,
        canonicalUrl,
        rawHtmlHash,
      },
      meta: {
        kind: cls.kind as MetaKind,
        threshold,
        streak: newStreak,
        streakCapped,
        consecutiveHard,
      },
    });
  } catch (e: any) {
    console.error("POST /api/checks/run ERROR:", e);
    return NextResponse.json(
      { error: e?.message ?? String(e), name: e?.name, code: e?.code, meta: e?.meta },
      { status: 500 }
    );
  }
}