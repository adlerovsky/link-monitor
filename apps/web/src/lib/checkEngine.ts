import { prisma } from "@/lib/prisma";
import crypto from "crypto";
import { IssueReason } from "@prisma/client";

export async function runBacklinkCheck(id: string) {
  const backlink = await prisma.backlink.findUnique({ where: { id } });
  if (!backlink) throw new Error("Backlink not found");

  if (backlink.status === "DELETED") {
    return {
      backlink,
      check: null,
      skipped: true,
    };
  }

  const now = new Date();
  const nextCheckAt = new Date(
    now.getTime() + Number(backlink.checkEveryHours ?? 72) * 60 * 60 * 1000
  );

  const normalizeUrl = (u: string) => {
    try {
      const url = new URL(u);
      const pathname = url.pathname.replace(/\/+$/, "");
      return `${url.protocol}//${url.host}${pathname}`;
    } catch {
      return u.trim().replace(/\/+$/, "");
    }
  };

  const resolveAgainstSource = (maybeRelative: string, source: string) => {
    try {
      return new URL(maybeRelative, source).toString();
    } catch {
      return maybeRelative;
    }
  };

  const extractCanonical = (html: string) => {
    const m = html.match(
      /<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["'][^>]*>/i
    );
    return m?.[1] ?? null;
  };

  const detectNoindex = (html: string) => {
    const m = html.match(
      /<meta[^>]*name=["']robots["'][^>]*content=["']([^"']+)["'][^>]*>/i
    );
    if (!m?.[1]) return false;
    return m[1].toLowerCase().includes("noindex");
  };

  const findLinkToTarget = (html: string, sourceUrl: string, targetUrl: string) => {
    const targetNorm = normalizeUrl(targetUrl);
    const targetNoProto = targetNorm.replace(/^https?:\/\//i, "");

    const aTagRegex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

    let match: RegExpExecArray | null;
    while ((match = aTagRegex.exec(html)) !== null) {
      const hrefRaw = match[1] ?? "";
      const innerHtml = match[2] ?? "";

      const hrefAbs = resolveAgainstSource(hrefRaw, sourceUrl);
      const hrefNorm = normalizeUrl(hrefAbs);
      const hrefNoProto = hrefNorm.replace(/^https?:\/\//i, "");

      const looksSame =
        hrefNorm === targetNorm ||
        hrefNoProto === targetNoProto ||
        hrefNoProto.startsWith(targetNoProto + "/");

      if (!looksSame) continue;

      const aTagFull = match[0];
      const relMatch = aTagFull.match(/rel=["']([^"']+)["']/i);
      const relDetected = relMatch?.[1] ?? null;

      const anchorDetected = innerHtml
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 512);

      return { linkFound: true, relDetected, anchorDetected: anchorDetected || null };
    }

    return { linkFound: false, relDetected: null as string | null, anchorDetected: null as string | null };
  };

  const normalizeText = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

  const expectedAnchorOk = (expected: string | null, detected: string | null) => {
    if (!expected) return true;
    if (!detected) return false;
    return normalizeText(detected).includes(normalizeText(expected));
  };

  const hashHtml = (html: string) =>
    crypto.createHash("sha256").update(html, "utf8").digest("hex");

  // fetch
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  let httpStatus: number | null = null;
  let rawHtml = "";

  try {
    const res = await fetch(backlink.sourceUrl, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; LinkMonitorBot/0.1)",
        accept: "text/html,application/xhtml+xml",
      },
    });

    httpStatus = res.status;
    rawHtml = await res.text();
  } catch {
    httpStatus = null;
    rawHtml = "";
  } finally {
    clearTimeout(timeout);
  }

  const canonicalUrl = rawHtml ? extractCanonical(rawHtml) : null;
  const isNoindex = rawHtml ? detectNoindex(rawHtml) : false;

  const linkCheck = rawHtml
    ? findLinkToTarget(rawHtml, backlink.sourceUrl, backlink.targetUrl)
    : { linkFound: false, relDetected: null, anchorDetected: null };

  const rawHtmlHash = rawHtml ? hashHtml(rawHtml) : null;

  const looksBlocked =
    !!rawHtml &&
    (rawHtml.length < 200 ||
      /captcha|cloudflare|access denied|verify you are human/i.test(rawHtml));

  const anchorOk = expectedAnchorOk(backlink.expectedAnchor ?? null, linkCheck.anchorDetected);

  const canonicalResolved = canonicalUrl
    ? resolveAgainstSource(canonicalUrl, backlink.sourceUrl)
    : null;
  const canonicalMismatch = canonicalResolved
    ? normalizeUrl(canonicalResolved) !== normalizeUrl(backlink.sourceUrl)
    : false;

  const issueReason: IssueReason | null = looksBlocked
    ? IssueReason.BLOCKED_OR_CAPTCHA
    : httpStatus == null
    ? IssueReason.OTHER
    : httpStatus < 200 || httpStatus >= 300
    ? IssueReason.HTTP_NOT_2XX
    : isNoindex
    ? IssueReason.NOINDEX
    : canonicalMismatch
    ? IssueReason.CANONICAL_MISMATCH
    : !linkCheck.linkFound
    ? IssueReason.LINK_NOT_FOUND
    : !anchorOk
    ? IssueReason.ANCHOR_MISMATCH
    : null;

  const status =
    httpStatus && httpStatus >= 200 && httpStatus < 300 && !looksBlocked
      ? isNoindex || canonicalMismatch
        ? "ISSUE"
        : linkCheck.linkFound
        ? anchorOk
          ? "ACTIVE"
          : "ISSUE"
        : "LOST"
      : "ISSUE";

  await prisma.check.create({
    data: {
      backlinkId: backlink.id,
      checkedAt: now,
      httpStatus,
      linkFound: linkCheck.linkFound,
      anchorDetected: linkCheck.anchorDetected,
      relDetected: linkCheck.relDetected,
      isNoindex,
      canonicalUrl,
      rawHtmlHash,
      anchorOk,
      issueReason,
    },
  });

  const updateData: any = { lastCheckedAt: now, nextCheckAt, status };
  if (status === "LOST") updateData.lostAt = backlink.lostAt ?? now;

  const updated = await prisma.backlink.update({
    where: { id: backlink.id },
    data: updateData,
  });

  return {
    backlink: updated,
    check: {
      checkedAt: now,
      httpStatus,
      linkFound: linkCheck.linkFound,
      status,
      anchorOk,
      expectedAnchor: backlink.expectedAnchor ?? null,
      relDetected: linkCheck.relDetected,
      anchorDetected: linkCheck.anchorDetected,
      isNoindex,
      canonicalUrl,
    },
  };
}