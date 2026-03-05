import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasProjectAccess } from "@/lib/access";
import { requireApiRole, requireApiUser } from "@/lib/auth";
import { canCreateBacklink } from "@/lib/planLimits";
import { hostMatchesBaseDomain, normalizeUrlHostname } from "@/lib/domain";

const ALLOWED_STATUS = new Set(["ACTIVE", "LOST", "ISSUE", "DELETED"] as const);
const ALLOWED_SORT = new Set([
  "nextCheckAt",
  "cost",
  "createdAt",
  "lastCheckedAt",
] as const);
const ALLOWED_ORDER = new Set(["asc", "desc"] as const);

type Priority = "CRITICAL" | "STANDARD" | "LOW";
type BacklinkStatus = "ACTIVE" | "ISSUE" | "LOST" | "DELETED";
type MetaKind = "HARD_FAIL" | "SOFT_FAIL" | null;

function normalizeText(s: string) {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function computeAnchorOk(expected: string | null, detected: string | null) {
  if (!expected) return true; // no expectation => ok
  if (!detected) return false;
  return normalizeText(detected).includes(normalizeText(expected));
}

function is2xx(code: number) {
  return code >= 200 && code < 300;
}

/**
 * SOFT fail = не можемо довіряти результату (fetch fail / блок / капча)
 * HARD fail = результат “твердий” і може вести до LOST після N підряд (це робитиме checks/run у кроці #2)
 *
 * Тут — A-lite: тільки meta/streak для UI, без зміни статусів у БД.
 */
function classifyCheck(opts: {
  httpStatus: number | null;
  linkFound: boolean | null;
  anchorOk: boolean;
}) {
  const { httpStatus, linkFound, anchorOk } = opts;

  // не змогли отримати HTTP — SOFT
  if (httpStatus == null) {
    return { kind: "SOFT_FAIL" as const, issueReason: "FETCH_FAILED" as const };
  }

  // часті кейси блоків/капчі — теж SOFT
  if (httpStatus === 403 || httpStatus === 429) {
    return {
      kind: "SOFT_FAIL" as const,
      issueReason: "BLOCKED_OR_CAPTCHA" as const,
    };
  }

  // не 2xx — HARD
  if (!is2xx(httpStatus)) {
    return { kind: "HARD_FAIL" as const, issueReason: "HTTP_NOT_2XX" as const };
  }

  // 2xx але лінка нема — HARD
  if (linkFound === false) {
    return { kind: "HARD_FAIL" as const, issueReason: "LINK_NOT_FOUND" as const };
  }

  // 2xx + лінк є, але анкор не той — HARD
  if (!anchorOk) {
    return {
      kind: "HARD_FAIL" as const,
      issueReason: "ANCHOR_MISMATCH" as const,
    };
  }

  return { kind: null, issueReason: null };
}

function thresholdForPriority(p: Priority): number {
  // узгоджено з твоїми прикладами: CRITICAL=2, STANDARD=3
  // LOW — м’якше (можна змінити потім), поки 4
  if (p === "CRITICAL") return 2;
  if (p === "STANDARD") return 3;
  return 4;
}

export async function GET(req: Request) {
  try {
    const auth = await requireApiUser();
    if (auth.error) return auth.error;

    const url = new URL(req.url);

    const projectId = url.searchParams.get("projectId") ?? "";
    if (!projectId) {
      return NextResponse.json({ error: "projectId required" }, { status: 400 });
    }

    const allowed = await hasProjectAccess(auth.user.organizationId, projectId);
    if (!allowed) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const status = url.searchParams.get("status"); // ACTIVE|LOST|ISSUE|DELETED
    const overdue = url.searchParams.get("overdue"); // "1"
    const q = (url.searchParams.get("q") ?? "").trim();

    const sortRaw = url.searchParams.get("sort") ?? "nextCheckAt";
    const orderRaw = url.searchParams.get("order") ?? "asc";

    const sort = (ALLOWED_SORT.has(sortRaw as any) ? sortRaw : "nextCheckAt") as
      | "nextCheckAt"
      | "cost"
      | "createdAt"
      | "lastCheckedAt";

    const order = (ALLOWED_ORDER.has(orderRaw as any) ? orderRaw : "asc") as
      | "asc"
      | "desc";

    const now = new Date();
    const where: any = { projectId };

    if (status && ALLOWED_STATUS.has(status as any)) {
      where.status = status;
    }

    if (overdue === "1") {
      where.nextCheckAt = { lt: now };
    }

    if (q) {
      where.OR = [
        { sourceUrl: { contains: q, mode: "insensitive" } },
        { targetUrl: { contains: q, mode: "insensitive" } },
        { expectedAnchor: { contains: q, mode: "insensitive" } },
        { vendorName: { contains: q, mode: "insensitive" } },
      ];
    }

    const orderBy: any[] = [{ [sort]: order }];
    if (sort !== "createdAt") orderBy.push({ createdAt: "desc" });

    // 1) Тягнемо backlinks
    const backlinksRaw = await prisma.backlink.findMany({
      where,
      orderBy,
      select: {
        id: true,
        projectId: true,
        sourceUrl: true,
        targetUrl: true,
        expectedAnchor: true,
        vendorName: true,
        assignedToUserId: true,
        priority: true,
        checkEveryHours: true,
        cost: true,
        currency: true,
        placementDate: true,
        status: true,
        lostAt: true,
        deletedAt: true,
        lastCheckedAt: true,
        nextCheckAt: true,
        createdAt: true,
      },
    });

    const ids = backlinksRaw.map((b) => b.id);
    if (ids.length === 0) return NextResponse.json({ backlinks: [] });

    // 2) Тягнемо історію чеків для streak/meta (обмежимося останніми 90 днями)
    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    const checks = await prisma.check.findMany({
      where: {
        backlinkId: { in: ids },
        checkedAt: { gte: since },
      },
      orderBy: { checkedAt: "desc" },
      select: {
        backlinkId: true,
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

    // групуємо по backlinkId (checks уже відсортовані desc)
    const byId = new Map<string, typeof checks>();
    for (const c of checks) {
      const arr = byId.get(c.backlinkId) ?? [];
      arr.push(c);
      byId.set(c.backlinkId, arr);
    }

    const backlinks = backlinksRaw.map((b: any) => {
      const history = byId.get(b.id) ?? [];
      const last = history[0] ?? null;

      // класифікація останнього чека (для kind + issueReason)
      const anchorOkLast = computeAnchorOk(
        b.expectedAnchor ?? null,
        last?.anchorDetected ?? null
      );

      const clsLast = classifyCheck({
        httpStatus: last?.httpStatus ?? null,
        linkFound: typeof last?.linkFound === "boolean" ? last.linkFound : null,
        anchorOk: anchorOkLast,
      });

      const threshold = thresholdForPriority(b.priority as Priority);

      // streak = consecutive HARD_FAIL from latest backwards
      let streak = 0;

      if (history.length > 0) {
        for (const row of history) {
          const rowAnchorOk = computeAnchorOk(
            b.expectedAnchor ?? null,
            row.anchorDetected ?? null
          );

          const rowCls = classifyCheck({
            httpStatus: row.httpStatus ?? null,
            linkFound: typeof row.linkFound === "boolean" ? row.linkFound : null,
            anchorOk: rowAnchorOk,
          });

          if (rowCls.kind === "HARD_FAIL") {
            streak += 1;
            continue;
          }

          // перший не-HARD (GOOD або SOFT) розриває “hard streak”
          break;
        }
      }

      const kind: MetaKind = clsLast.kind;

      // streakCapped: для UI “3/3+”
      // показуємо прогрес тільки якщо last kind = HARD_FAIL (якщо SOFT/GOOD — 0)
      const streakCapped = kind === "HARD_FAIL" ? Math.min(streak, threshold) : 0;

      // status — ТІЛЬКИ з БД. Тут ми нічого не “перемикаємо”.
      const dbStatus = b.status as BacklinkStatus;

      return {
        ...b,
        lastCheck: last
          ? {
              checkedAt: last.checkedAt,
              httpStatus: last.httpStatus,
              linkFound: last.linkFound,
              anchorDetected: last.anchorDetected,
              relDetected: last.relDetected,
              isNoindex: last.isNoindex,
              canonicalUrl: last.canonicalUrl,
              rawHtmlHash: last.rawHtmlHash,
              expectedAnchor: b.expectedAnchor ?? null,
              anchorOk: anchorOkLast,
              issueReason:
                dbStatus === "ACTIVE" || dbStatus === "DELETED" ? null : clsLast.issueReason,
              status: dbStatus,
            }
          : null,
        meta: {
          threshold,
          streak,
          streakCapped,
          kind,
        },
      };
    });

    return NextResponse.json({ backlinks });
  } catch (e: any) {
    console.error("BACKLINKS GET ERROR:", e);
    return NextResponse.json(
      { error: e?.message ?? String(e), name: e?.name, code: e?.code },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const auth = await requireApiUser();
    if (auth.error) return auth.error;

    const forbidden = requireApiRole(auth.user.role, ["OWNER", "MANAGER"] as const);
    if (forbidden) return forbidden;

    const body = await req.json();

    const projectId = String(body?.projectId ?? "");
    const sourceUrl = String(body?.sourceUrl ?? "").trim();
    const targetUrl = String(body?.targetUrl ?? "").trim();
    const expectedAnchor = body?.expectedAnchor ? String(body.expectedAnchor) : null;
    const vendorName = body?.vendorName ? String(body.vendorName) : null;

    const priority = String(body?.priority ?? "STANDARD");
    const currency = String(body?.currency ?? "EUR");
    const cost = Number(body?.cost ?? 0);

    if (!projectId || !sourceUrl || !targetUrl) {
      return NextResponse.json(
        { error: "projectId, sourceUrl, targetUrl required" },
        { status: 400 }
      );
    }

    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        organizationId: auth.user.organizationId,
      },
      select: {
        id: true,
        baseDomain: true,
      },
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    if (!project.baseDomain) {
      return NextResponse.json(
        { error: "Project base domain is not configured" },
        { status: 400 }
      );
    }

    const targetHostname = normalizeUrlHostname(targetUrl);
    if (!targetHostname) {
      return NextResponse.json({ error: "targetUrl must be a valid URL" }, { status: 400 });
    }

    if (!hostMatchesBaseDomain(targetHostname, project.baseDomain)) {
      return NextResponse.json(
        {
          error: `targetUrl domain must match project base domain (${project.baseDomain})`,
        },
        { status: 400 }
      );
    }

    const limitCheck = await canCreateBacklink(auth.user.organizationId);
    if (!limitCheck.ok) {
      return NextResponse.json(
        {
          error: "Backlink limit reached for current plan",
          code: limitCheck.code,
          plan: "plan" in limitCheck ? limitCheck.plan : undefined,
          limit: "limit" in limitCheck ? limitCheck.limit : undefined,
          current: "current" in limitCheck ? limitCheck.current : undefined,
        },
        { status: limitCheck.status }
      );
    }

    const backlink = await prisma.backlink.create({
      data: {
        projectId,
        sourceUrl,
        targetUrl,
        expectedAnchor,
        vendorName,
        priority: priority as any,
        currency: currency as any,
        cost: cost as any,
      },
    });

    return NextResponse.json({ backlink });
  } catch (e: any) {
    console.error("POST /api/backlinks ERROR:", e);
    return NextResponse.json(
      { error: e?.message ?? String(e), name: e?.name, code: e?.code, meta: e?.meta },
      { status: 500 }
    );
  }
}