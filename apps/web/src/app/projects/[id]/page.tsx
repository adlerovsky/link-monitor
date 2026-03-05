"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import styles from "./page.module.css";

type Currency = "EUR" | "USD" | "UAH";

type Backlink = {
  id: string;
  sourceUrl: string;
  targetUrl: string;
  expectedAnchor: string | null;
  vendorName: string | null;
  priority: "CRITICAL" | "STANDARD" | "LOW";
  cost: string;
  currency: Currency;
  status: "ACTIVE" | "ISSUE" | "LOST" | "DELETED";
  lostAt: string | null;
  deletedAt?: string | null;
  createdAt: string;
  lastCheckedAt: string | null;
  nextCheckAt: string | null;

  lastCheck?: null | {
    checkedAt: string;
    httpStatus: number | null;
    linkFound: boolean;
    anchorDetected: string | null;
    relDetected: string | null;
    isNoindex: boolean;
    canonicalUrl: string | null;
    rawHtmlHash: string | null;

    expectedAnchor?: string | null;
    anchorOk?: boolean;
    issueReason?: string | null;
    status?: "ACTIVE" | "ISSUE" | "LOST" | "DELETED";
  };

  // from /api/backlinks (A-lite)
  meta?: null | {
    threshold: number;
    streak: number;
    streakCapped: number;
    kind: "HARD_FAIL" | "SOFT_FAIL" | null;
  };
};

type CheckRow = {
  checkedAt: string;
  httpStatus: number | null;
  linkFound: boolean;
  anchorDetected: string | null;
  relDetected: string | null;
  isNoindex: boolean;
  canonicalUrl: string | null;
  rawHtmlHash: string | null;

  expectedAnchor?: string | null;
  anchorOk?: boolean;
  issueReason?: string | null;
  status?: "ACTIVE" | "ISSUE" | "LOST" | "DELETED";
};

type SummaryCurrencyRow = {
  total: number;
  active: number;
  lost: number;
  lostThisMonth: number;
  lostLast30Days: number;
  lostInPeriod: number;
};

type ProjectSummaryV3 = {
  projectId: string;
  counts: { ACTIVE: number; LOST: number; ISSUE: number; DELETED: number };
  sumsByCurrency: Record<Currency, SummaryCurrencyRow>;
  period: { mode: "days" | "range"; from: string; toExclusive: string };
  generatedAt: string;
};

type AlertType = "ACTIVE_TO_ISSUE" | "ISSUE_TO_LOST" | "TO_LOST";

type AlertRow = {
  id: string;
  type: AlertType;
  triggeredAt: string;
  resolvedAt: string | null;
  readAt: string | null;
  lastNotifiedAt: string | null;
  backlink: {
    id: string;
    sourceUrl: string;
    targetUrl: string;
    priority: "CRITICAL" | "STANDARD" | "LOW";
    cost: string;
    currency: Currency;
    status: "ACTIVE" | "ISSUE" | "LOST";
    deletedAt?: string | null;
  };
};

function readStoredOption<T extends string>(
  key: string,
  allowedValues: readonly T[],
  fallback: T
): T {
  if (typeof window === "undefined") return fallback;

  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return allowedValues.includes(raw as T) ? (raw as T) : fallback;
  } catch {
    return fallback;
  }
}

export default function ProjectPage() {
  const params = useParams();
  const projectId = Array.isArray(params?.id) ? params.id[0] : (params?.id as string | undefined);
  const [projectName, setProjectName] = useState<string>("");
  const [projectBaseDomain, setProjectBaseDomain] = useState<string>("");

  const [backlinks, setBacklinks] = useState<Backlink[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [summary, setSummary] = useState<ProjectSummaryV3 | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  // alerts
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [alertsError, setAlertsError] = useState<string | null>(null);
  const [alertsUnread, setAlertsUnread] = useState(0);

  // period UI
  const [periodMode, setPeriodMode] = useState<"days" | "range">("days");
  const [periodDays, setPeriodDays] = useState<7 | 30 | 90>(30);
  const [fromYmd, setFromYmd] = useState("");
  const [toYmd, setToYmd] = useState("");

  const STATUS_FILTER_STORAGE_KEY = "link-monitor:project-page:status-filter";
  const SORT_BY_STORAGE_KEY = "link-monitor:project-page:sort-by";
  const SORT_ORDER_STORAGE_KEY = "link-monitor:project-page:sort-order";

  const [statusFilter, setStatusFilter] = useState<"ALL" | "ACTIVE" | "LOST" | "ISSUE" | "DELETED">(() =>
    readStoredOption(
      STATUS_FILTER_STORAGE_KEY,
      ["ALL", "ACTIVE", "LOST", "ISSUE", "DELETED"] as const,
      "ALL"
    )
  );
  const [overdueOnly, setOverdueOnly] = useState(false);

  const [searchQ, setSearchQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");

  const [sortBy, setSortBy] = useState<"nextCheckAt" | "cost" | "createdAt" | "lastCheckedAt">(() =>
    readStoredOption(
      SORT_BY_STORAGE_KEY,
      ["nextCheckAt", "cost", "createdAt", "lastCheckedAt"] as const,
      "nextCheckAt"
    )
  );
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">(() =>
    readStoredOption(SORT_ORDER_STORAGE_KEY, ["asc", "desc"] as const, "asc")
  );

  // create form
  const [sourceUrl, setSourceUrl] = useState("");
  const [targetUrl, setTargetUrl] = useState("");
  const [expectedAnchor, setExpectedAnchor] = useState("");
  const [vendorName, setVendorName] = useState("");
  const [priority, setPriority] = useState<Backlink["priority"]>("STANDARD");
  const [currency, setCurrency] = useState<Currency>("EUR");
  const [cost, setCost] = useState("0");

  const [checkingId, setCheckingId] = useState<string | null>(null);

  // history UI
  const [historyOpenId, setHistoryOpenId] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyChecks, setHistoryChecks] = useState<Record<string, CheckRow[]>>({});

  const clip = (s: string | null | undefined, n = 80) => {
    const t = (s ?? "").trim();
    if (!t) return null;
    return t.length > n ? t.slice(0, n) + "…" : t;
  };

  const fmt = (n: number) => Number(n || 0).toFixed(2);

  const streakBadgeText = (m: Backlink["meta"]) => {
    if (!m) return null;
    const capped = Math.max(0, Number(m.streakCapped ?? 0));
    const thr = Math.max(1, Number(m.threshold ?? 1));
    const real = Math.max(0, Number(m.streak ?? 0));
    const plus = real > thr ? "+" : "";
    return `${capped}/${thr}${plus}`;
  };

  const alertTypeLabel = (t: AlertType) => {
    if (t === "ACTIVE_TO_ISSUE") return "ACTIVE → ISSUE";
    if (t === "ISSUE_TO_LOST") return "ISSUE → LOST";
    return "→ LOST";
  };

  const alertTypeClass = (type: AlertType) => {
    if (type === "ISSUE_TO_LOST" || type === "TO_LOST") {
      return `${styles.badge} ${styles.badgeDanger}`;
    }
    return `${styles.badge} ${styles.badgeInfo}`;
  };

  const statusBadgeClass = (status: Backlink["status"]) => {
    if (status === "ACTIVE") return `${styles.badge} ${styles.badgeSuccess}`;
    if (status === "ISSUE") return `${styles.badge} ${styles.badgeWarning}`;
    if (status === "DELETED") return `${styles.badge} ${styles.badgeMuted}`;
    return `${styles.badge} ${styles.badgeDanger}`;
  };

  // debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(searchQ.trim()), 400);
    return () => clearTimeout(t);
  }, [searchQ]);

  async function loadBacklinks() {
    if (!projectId) return;

    setLoadingList(true);
    setListError(null);
    try {
      const qp = new URLSearchParams();
      qp.set("projectId", projectId);

      if (statusFilter !== "ALL") qp.set("status", statusFilter);
      if (overdueOnly) qp.set("overdue", "1");
      if (debouncedQ) qp.set("q", debouncedQ);

      qp.set("sort", sortBy);
      qp.set("order", sortOrder);

      const res = await fetch(`/api/backlinks?${qp.toString()}`, { cache: "no-store" });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        setListError(text || "Failed to load backlinks");
        return;
      }

      const data = await res.json();
      setBacklinks(data.backlinks ?? []);
    } catch (e) {
      console.error("LOAD ERROR:", e);
      setListError("Failed to load backlinks");
    } finally {
      setLoadingList(false);
    }
  }

  async function loadSummary() {
    if (!projectId) return;

    setSummaryLoading(true);
    setSummaryError(null);
    try {
      const qp = new URLSearchParams();
      qp.set("projectId", projectId);

      if (periodMode === "days") {
        qp.set("days", String(periodDays));
      } else {
        if (fromYmd) qp.set("from", fromYmd);
        if (toYmd) qp.set("to", toYmd);
      }

      const res = await fetch(`/api/projects/summary?${qp.toString()}`, { cache: "no-store" });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        setSummaryError(text || "Failed to load summary");
        return;
      }

      setSummary((await res.json()) as ProjectSummaryV3);
    } catch (e) {
      console.error("SUMMARY LOAD ERROR:", e);
      setSummaryError("Failed to load summary");
    } finally {
      setSummaryLoading(false);
    }
  }

  async function loadAlerts() {
    if (!projectId) return;

    setAlertsLoading(true);
    setAlertsError(null);
    try {
      const qp = new URLSearchParams();
      qp.set("projectId", projectId);
      qp.set("take", "20");

      const res = await fetch(`/api/alerts?${qp.toString()}`, { cache: "no-store" });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        setAlertsError(text || "Failed to load alerts");
        return;
      }

      const data = await res.json();
      setAlerts((data.alerts ?? []) as AlertRow[]);
      setAlertsUnread(Number(data.unreadCount ?? 0));
    } catch (e) {
      console.error("ALERTS LOAD ERROR:", e);
      setAlertsError("Failed to load alerts");
    } finally {
      setAlertsLoading(false);
    }
  }

  async function loadProjectMeta() {
    if (!projectId) return;

    try {
      const res = await fetch(`/api/projects/${projectId}`, { cache: "no-store" });
      if (!res.ok) {
        setProjectName("");
        return;
      }

      const data = (await res.json().catch(() => ({}))) as {
        project?: { name?: string | null; baseDomain?: string | null };
      };

      setProjectName(String(data?.project?.name ?? "").trim());
      setProjectBaseDomain(String(data?.project?.baseDomain ?? "").trim());
    } catch {
      setProjectName("");
      setProjectBaseDomain("");
    }
  }

  async function markAllAlertsRead() {
    if (!projectId) return;

    const res = await fetch("/api/alerts/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId }),
    });

    if (!res.ok) {
      console.error("MARK READ FAILED:", await res.text());
      return;
    }

    await loadAlerts();
  }

  useEffect(() => {
    loadBacklinks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, statusFilter, overdueOnly, debouncedQ, sortBy, sortOrder]);

  useEffect(() => {
    loadSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, periodMode, periodDays, fromYmd, toYmd]);

  useEffect(() => {
    loadAlerts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    loadProjectMeta();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STATUS_FILTER_STORAGE_KEY, statusFilter);
    } catch {
      // ignore storage errors
    }
  }, [statusFilter]);

  useEffect(() => {
    try {
      window.localStorage.setItem(SORT_BY_STORAGE_KEY, sortBy);
    } catch {
      // ignore storage errors
    }
  }, [sortBy]);

  useEffect(() => {
    try {
      window.localStorage.setItem(SORT_ORDER_STORAGE_KEY, sortOrder);
    } catch {
      // ignore storage errors
    }
  }, [sortOrder]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!projectId) return;

    const s = sourceUrl.trim();
    const t = targetUrl.trim();
    if (!s || !t) return;

    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/backlinks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          sourceUrl: s,
          targetUrl: t,
          expectedAnchor: expectedAnchor.trim() || null,
          vendorName: vendorName.trim() || null,
          priority,
          currency,
          cost: Number(cost || 0),
        }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        const msg = data?.error ?? "Failed to add backlink";
        setCreateError(msg);
        console.error("CREATE FAILED:", msg);
        return;
      }

      await res.json();

      setSourceUrl("");
      setTargetUrl("");
      setExpectedAnchor("");
      setVendorName("");
      setPriority("STANDARD");
      setCurrency("EUR");
      setCost("0");

      await loadBacklinks();
      await loadSummary();
      await loadAlerts();
    } finally {
      setCreating(false);
    }
  }

  async function markLost(id: string) {
    const res = await fetch("/api/backlinks/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: "LOST" }),
    });

    if (!res.ok) {
      alert(`Error ${res.status}: ${await res.text()}`);
      return;
    }

    await loadBacklinks();
    await loadSummary();
    await loadAlerts();
  }

  async function markDeleted(id: string) {
    const res = await fetch("/api/backlinks/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: "DELETED" }),
    });

    if (!res.ok) {
      alert(`Error ${res.status}: ${await res.text()}`);
      return;
    }

    await loadBacklinks();
    await loadSummary();
    await loadAlerts();
  }

  async function checkNow(id: string) {
    if (checkingId) return;
    setCheckingId(id);

    try {
      const res = await fetch("/api/checks/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });

      if (!res.ok) {
        console.error("CHECK FAILED:", await res.text());
        return;
      }

      // refresh history cache if open
      if (historyOpenId === id) {
        setHistoryChecks((prev) => ({ ...prev, [id]: [] }));
      }

      await loadBacklinks();
      await loadSummary();
      await loadAlerts();
    } finally {
      setCheckingId(null);
    }
  }

  async function toggleHistory(id: string) {
    if (historyOpenId === id) {
      setHistoryOpenId(null);
      return;
    }

    setHistoryOpenId(id);

    if (historyChecks[id]?.length) return;

    setHistoryLoading(true);
    try {
      const res = await fetch(`/api/checks/by-backlink?backlinkId=${id}&take=10`, {
        cache: "no-store",
      });

      if (!res.ok) {
        console.error("HISTORY LOAD FAILED:", await res.text());
        return;
      }

      const data = await res.json();
      setHistoryChecks((prev) => ({ ...prev, [id]: data.checks ?? [] }));
    } finally {
      setHistoryLoading(false);
    }
  }

  const counts = summary?.counts ?? { ACTIVE: 0, ISSUE: 0, LOST: 0, DELETED: 0 };

  const sumsByCurrency =
    summary?.sumsByCurrency ??
    ({
      EUR: { total: 0, active: 0, lost: 0, lostThisMonth: 0, lostLast30Days: 0, lostInPeriod: 0 },
      USD: { total: 0, active: 0, lost: 0, lostThisMonth: 0, lostLast30Days: 0, lostInPeriod: 0 },
      UAH: { total: 0, active: 0, lost: 0, lostThisMonth: 0, lostLast30Days: 0, lostInPeriod: 0 },
    } as Record<Currency, SummaryCurrencyRow>);

  const periodLabel = periodMode === "days" ? `Lost in last ${periodDays} days` : "Lost in selected range";

  const periodInfo = useMemo(() => {
    if (!summary?.period) return null;
    const from = new Date(summary.period.from);
    const toEx = new Date(summary.period.toExclusive);
    const to = new Date(toEx.getTime() - 1);
    return { from, to };
  }, [summary?.period]);

  return (
    <main className={styles.page}>
      <div className={styles.hero}>
        <div>
          <h1 className={styles.heroTitle}>
            <span>Project dashboard</span>
            <span className={styles.heroTitleDot} aria-hidden="true">
              ·
            </span>
            <span className={styles.heroTitleProject}>{projectName || "Current project"}</span>
            {projectBaseDomain ? (
              <span className={styles.heroTitleDomain}>{projectBaseDomain}</span>
            ) : null}
          </h1>
          <div className={styles.heroStats}>
            <span className={`${styles.badge} ${styles.badgeHero}`}>ACTIVE {counts.ACTIVE}</span>
            <span className={`${styles.badge} ${styles.badgeHero}`}>ISSUE {counts.ISSUE}</span>
            <span className={`${styles.badge} ${styles.badgeHero}`}>LOST {counts.LOST}</span>
            <span className={`${styles.badge} ${styles.badgeHero}`}>DELETED {counts.DELETED}</span>
            {summaryLoading ? <span className={styles.summaryLoading}>summary loading…</span> : null}
          </div>
        </div>

        <Link href="/dashboard" className={styles.heroBackLink}>
          ← Projects
        </Link>
      </div>

      {/* Alerts */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <div className={styles.sectionTitle}>Recent alerts</div>

          <div className={styles.sectionMeta}>
            <div className={styles.sectionStatusText}>
              {alertsLoading ? "loading…" : `${alerts.length} shown · unread ${alertsUnread}`}
            </div>

            <button
              type="button"
              onClick={markAllAlertsRead}
              disabled={alertsUnread === 0}
              className={styles.markReadBtn}
            >
              Mark all read
            </button>
          </div>
        </div>

        {alertsError ? (
          <div className={styles.inlineFeedbackRow}>
            <div className={styles.sectionStatusText}>{alertsError}</div>
            <button type="button" onClick={loadAlerts} className={styles.inlineGhostBtn}>
              Retry
            </button>
          </div>
        ) : null}

        {alerts.length === 0 ? (
          <div className={styles.noAlertsText}>No alerts yet.</div>
        ) : (
          <div className={styles.alertsList}>
            {alerts.map((a) => {
              const open = !a.resolvedAt;
              const isUnread = !a.readAt;

              return (
                <div
                  key={a.id}
                  className={styles.alertItem}
                  data-open={open ? "true" : "false"}
                >
                  <div className={styles.alertMeta}>
                    {new Date(a.triggeredAt).toLocaleString()}
                    <div className={styles.alertState}>
                      {open ? "OPEN" : `resolved ${new Date(a.resolvedAt!).toLocaleString()}`}
                      {isUnread ? <span className={`${styles.badge} ${styles.badgeInfo}`}>unread</span> : null}
                    </div>
                  </div>

                  <div className={styles.alertTypeRow}>
                    <span className={alertTypeClass(a.type)}>{alertTypeLabel(a.type)}</span>
                    <span className={styles.alertCurrent}>
                      current: <b>{a.backlink.status}</b>
                    </span>
                  </div>

                  <div className={styles.alertLinkCol}>
                    <div className={styles.alertMainLine}>
                      <a
                        href={a.backlink.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.alertSourceLink}
                      >
                        {a.backlink.sourceUrl}
                      </a>
                      <span className={styles.alertArrow}> → </span>
                      <a
                        href={a.backlink.targetUrl.startsWith("http") ? a.backlink.targetUrl : `https://${a.backlink.targetUrl}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.alertTargetLink}
                      >
                        {a.backlink.targetUrl}
                      </a>
                    </div>

                    <div className={styles.alertSubline}>
                      {a.backlink.priority} · {Number(a.backlink.cost).toFixed(2)} {a.backlink.currency}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Summary */}
      <div className={styles.summaryWrap}>
        <div className={styles.section}>
          <div className={styles.summaryTitle}>Summary period</div>

          {summaryError ? (
            <div className={styles.inlineFeedbackRow}>
              <div className={styles.sectionStatusText}>{summaryError}</div>
              <button type="button" onClick={loadSummary} className={styles.inlineGhostBtn}>
                Retry
              </button>
            </div>
          ) : null}

          <div className={styles.summaryControls}>
            <div className={styles.rowWrap}>
              <button
                type="button"
                onClick={() => setPeriodMode("days")}
                className={`${styles.periodModeBtn} ${
                  periodMode === "days" ? styles.periodModeBtnActive : ""
                }`}
              >
                Last N days
              </button>

              <button
                type="button"
                onClick={() => setPeriodMode("range")}
                className={`${styles.periodModeBtn} ${
                  periodMode === "range" ? styles.periodModeBtnActive : ""
                }`}
              >
                Date range
              </button>
            </div>

            {periodMode === "days" ? (
              <div className={styles.rowWrap}>
                {[7, 30, 90].map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setPeriodDays(d as 7 | 30 | 90)}
                    className={`${styles.dayPresetBtn} ${
                      periodDays === d ? styles.dayPresetBtnActive : ""
                    }`}
                  >
                    {d}d
                  </button>
                ))}
              </div>
            ) : (
              <div className={styles.rowWrap}>
                <input
                  type="date"
                  value={fromYmd}
                  onChange={(e) => setFromYmd(e.target.value)}
                  className={styles.filterControl}
                />
                <span className={styles.rangeArrow}>→</span>
                <input
                  type="date"
                  value={toYmd}
                  onChange={(e) => setToYmd(e.target.value)}
                  className={styles.filterControl}
                />
                <span className={styles.rangeHint}>(tip: set both dates)</span>
              </div>
            )}

            {periodInfo ? (
              <div className={styles.periodInfo}>
                period: {periodInfo.from.toLocaleDateString()} — {periodInfo.to.toLocaleDateString()}
              </div>
            ) : null}
          </div>

        </div>

        <div className={styles.summaryGrid}>
          {(["EUR", "USD", "UAH"] as Currency[]).map((cur) => {
            const row = sumsByCurrency[cur];
            const isAllZero =
              (row?.total ?? 0) === 0 &&
              (row?.lost ?? 0) === 0 &&
              (row?.active ?? 0) === 0 &&
              (row?.lostInPeriod ?? 0) === 0;

            return (
              <div key={cur} className={styles.summaryCard}>
                <div className={styles.currencyHead}>
                  <div className={styles.currencyCode}>{cur}</div>
                  {isAllZero ? <div className={styles.currencyEmpty}>—</div> : null}
                </div>

                <div className={styles.currencyStats}>
                  <div>
                    Total invested: <b>{fmt(row?.total ?? 0)}</b>
                  </div>
                  <div>
                    Active value: <b>{fmt(row?.active ?? 0)}</b>
                  </div>
                  <div className={styles.currencyLost}>
                    Lost value: <b>{fmt(row?.lost ?? 0)}</b>
                  </div>

                  <div className={styles.currencyPeriod}>
                    {periodLabel}: <b>{fmt(row?.lostInPeriod ?? 0)}</b>
                  </div>
                </div>

                <div className={styles.legacyHint}>
                  (legacy) month: {fmt(row?.lostThisMonth ?? 0)} · 30d: {fmt(row?.lostLast30Days ?? 0)}
                </div>
              </div>
            );
          })}
        </div>

        <div className={styles.fxHint}>*Currencies are not converted yet (we’ll add FX later).</div>
      </div>

      <div className={styles.managementGrid}>
        <form onSubmit={create} className={`${styles.form} ${styles.managementCard}`}>
          <div className={styles.addBacklinkTitle}>Add backlink</div>
          {createError ? <div className={styles.sectionStatusText}>{createError}</div> : null}

          <div className={styles.formGridTwo}>
            <input
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="Source URL (donor page)"
              className={styles.control}
            />
            <input
              value={targetUrl}
              onChange={(e) => setTargetUrl(e.target.value)}
              placeholder="Target URL (your page)"
              className={styles.control}
            />
          </div>

          <div className={styles.formGridTwo}>
            <input
              value={expectedAnchor}
              onChange={(e) => setExpectedAnchor(e.target.value)}
              placeholder="Expected anchor (optional)"
              className={styles.control}
            />
            <input
              value={vendorName}
              onChange={(e) => setVendorName(e.target.value)}
              placeholder="Vendor / seller (optional)"
              className={styles.control}
            />
          </div>

          <div className={styles.formGridThree}>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as any)}
              className={styles.control}
            >
              <option value="CRITICAL">CRITICAL (daily)</option>
              <option value="STANDARD">STANDARD (3 days)</option>
              <option value="LOW">LOW (weekly)</option>
            </select>

            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value as any)}
              className={styles.control}
            >
              <option value="EUR">EUR</option>
              <option value="USD">USD</option>
              <option value="UAH">UAH</option>
            </select>

            <input
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              placeholder="Cost (e.g. 50)"
              className={styles.control}
            />
          </div>

          <button disabled={creating} className={styles.createBtn}>
            {creating ? "Adding..." : "Add backlink"}
          </button>
        </form>

        <section className={`${styles.filters} ${styles.managementCard}`}>
          <div className={styles.filtersHeader}>
            <div className={styles.filtersTitle}>Browse backlinks</div>
            {loadingList ? <span className={styles.listLoading}>Loading…</span> : null}
          </div>

          <div className={styles.filtersGrid}>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className={styles.filterControl}
            >
              <option value="ALL">ALL</option>
              <option value="ACTIVE">ACTIVE</option>
              <option value="ISSUE">ISSUE</option>
              <option value="LOST">LOST</option>
              <option value="DELETED">DELETED</option>
            </select>

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className={styles.filterControl}
            >
              <option value="nextCheckAt">nextCheckAt</option>
              <option value="lastCheckedAt">lastCheckedAt</option>
              <option value="createdAt">createdAt</option>
              <option value="cost">cost</option>
            </select>

            <select
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value as any)}
              className={styles.filterControl}
            >
              <option value="asc">asc</option>
              <option value="desc">desc</option>
            </select>

            <label className={styles.overdueLabel}>
              <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} />
              Overdue only
            </label>

            <input
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              placeholder="Search (URL / anchor)"
              className={`${styles.searchControl} ${styles.searchControlWide}`}
            />
          </div>
        </section>
      </div>

      {/* Backlinks list */}
      <div className={styles.backlinksSection}>
        {listError ? (
          <div className={styles.inlineFeedbackRow}>
            <p className={styles.listEmpty}>{listError}</p>
            <button type="button" onClick={loadBacklinks} className={styles.inlineGhostBtn}>
              Retry
            </button>
          </div>
        ) : null}

        {backlinks.length === 0 ? (
          <p className={styles.listEmpty}>
            {searchQ || statusFilter !== "ALL" || overdueOnly
              ? "No backlinks match current filters."
              : "No backlinks yet."}
          </p>
        ) : (
          <div className={styles.backlinksList}>
            {backlinks.map((b) => {
              const daysAlive = Math.floor((Date.now() - new Date(b.createdAt).getTime()) / (1000 * 60 * 60 * 24));

              const daysSinceCheck = b.lastCheckedAt
                ? Math.floor((Date.now() - new Date(b.lastCheckedAt).getTime()) / (1000 * 60 * 60 * 24))
                : null;

              const isOverdue = b.nextCheckAt && new Date(b.nextCheckAt).getTime() < Date.now();

              const checksForThis = historyChecks[b.id] ?? [];
              const streakText = streakBadgeText(b.meta ?? null);

              return (
                <div
                  key={b.id}
                  className={styles.backlinkCard}
                >
                  <div className={styles.backlinkBody}>
                    <div className={styles.linkCol}>
                      <a
                        href={b.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.sourceLink}
                      >
                        {b.sourceUrl}
                      </a>

                      <a
                        href={b.targetUrl.startsWith("http") ? b.targetUrl : `https://${b.targetUrl}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.targetLink}
                      >
                        {b.targetUrl}
                      </a>
                    </div>

                    <div className={styles.metaLine}>
                      <span className={`${styles.badge} ${styles.badgeInfo}`}>{b.priority}</span>
                      <span className={`${styles.badge} ${styles.badgeMuted}`}>
                        {Number(b.cost).toFixed(2)} {b.currency}
                      </span>
                      <span className={`${styles.badge} ${styles.badgeMuted}`}>alive {daysAlive}d</span>
                      <span className={`${styles.badge} ${isOverdue ? styles.badgeDanger : styles.badgeMuted}`}>
                        {b.nextCheckAt ? new Date(b.nextCheckAt).toLocaleDateString() : "no schedule"}
                        {isOverdue ? " ⚠️" : ""}
                      </span>
                      <span className={statusBadgeClass(b.status)}>{b.status}</span>
                      {streakText && b.status !== "ACTIVE" ? (
                        <span
                          className={`${styles.badge} ${
                            b.status === "LOST" ? styles.badgeDanger : styles.badgeWarning
                          }`}
                        >
                          {streakText}
                        </span>
                      ) : null}
                    </div>

                    <div className={styles.subInfo}>
                      <span>last check: {b.lastCheckedAt ? `${daysSinceCheck}d ago` : "never"}</span>
                      {(b.status === "ISSUE" || b.status === "LOST") && b.lastCheck?.issueReason ? (
                        <span>
                          reason: <b>{b.lastCheck.issueReason}</b>
                          {b.lastCheck.httpStatus != null ? ` (${b.lastCheck.httpStatus})` : ""}
                        </span>
                      ) : null}
                      {b.status === "DELETED" && b.deletedAt ? (
                        <span>deleted: {new Date(b.deletedAt).toLocaleString()}</span>
                      ) : null}
                    </div>

                    {b.lastCheck?.issueReason === "ANCHOR_MISMATCH" ? (
                      <div className={styles.anchorMismatch}>
                        <div>
                          <span className={styles.anchorLabel}>expected:</span> <b>{clip(b.expectedAnchor, 120) ?? "—"}</b>
                        </div>
                        <div>
                          <span className={styles.anchorLabel}>detected:</span> {clip(b.lastCheck?.anchorDetected, 120) ?? "—"}
                        </div>
                      </div>
                    ) : null}

                    <div className={styles.actions}>
                      <button
                        onClick={() => checkNow(b.id)}
                        disabled={checkingId === b.id}
                        className={styles.btnPrimarySoft}
                      >
                        {checkingId === b.id ? "Checking..." : "Check now"}
                      </button>

                      <button
                        onClick={() => toggleHistory(b.id)}
                        className={styles.btnGhost}
                      >
                        {historyOpenId === b.id ? "Hide history" : "History"}
                      </button>

                      {b.status !== "LOST" && b.status !== "DELETED" ? (
                        <button
                          onClick={() => markLost(b.id)}
                          className={styles.btnDangerSoft}
                        >
                          Mark LOST
                        </button>
                      ) : (
                        <span className={`${styles.badge} ${styles.badgeDisabled} ${styles.alreadyLost}`}>
                          {b.status === "DELETED" ? "already DELETED" : "already LOST"}
                        </span>
                      )}

                      {b.status !== "DELETED" ? (
                        <button
                          onClick={() => markDeleted(b.id)}
                          className={styles.btnGhost}
                        >
                          Delete
                        </button>
                      ) : null}
                    </div>
                  </div>

                  {historyOpenId === b.id ? (
                    <div className={styles.historyWrap}>
                      <div className={styles.historyHeader}>
                        <div className={styles.historyTitle}>
                          Last 10 checks{historyLoading && !checksForThis.length ? " (loading...)" : ""}
                        </div>
                        <div className={styles.historyHint}>newest → oldest</div>
                      </div>

                      {checksForThis.length === 0 ? (
                        <div className={styles.historyEmpty}>No checks yet.</div>
                      ) : (
                        <div className={styles.historyList}>
                          {checksForThis.map((c, idx) => (
                            <div
                              key={`${c.checkedAt}-${idx}`}
                              className={styles.historyItem}
                            >
                              <div className={styles.historyTime}>{new Date(c.checkedAt).toLocaleString()}</div>

                              <div className={styles.historyMetric}>
                                <span className={styles.historyMetricLabel}>HTTP</span>
                                <b>{c.httpStatus ?? "—"}</b>
                              </div>

                              <div>
                                <span
                                  className={`${styles.historyLinkFound} ${
                                    c.linkFound ? styles.historyLinkFoundOk : styles.historyLinkFoundBad
                                  }`}
                                >
                                  {c.linkFound ? "link found" : "link missing"}
                                </span>
                              </div>

                              <div>
                                <div title={c.anchorDetected ?? ""} className={styles.historyAnchor}>
                                  <span className={styles.historyAnchorLabel}>anchor</span>
                                  {clip(c.anchorDetected, 140) ?? "—"}
                                </div>

                                {c.issueReason ? (
                                  <div className={styles.historyIssue}>issue: {c.issueReason}</div>
                                ) : null}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}