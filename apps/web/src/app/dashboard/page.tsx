"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import styles from "./page.module.css";

type Project = {
  id: string;
  name: string;
  baseDomain: string | null;
  createdAt: string;
};

type NotificationState = {
  channels: {
    telegram: {
      enabled: boolean;
      chatId: string | null;
    };
  };
  stats: {
    unreadAlerts: number;
    openAlerts: number;
  };
  recentAlerts: Array<{
    id: string;
    type: "ACTIVE_TO_ISSUE" | "ISSUE_TO_LOST" | "TO_LOST";
    triggeredAt: string;
    resolvedAt: string | null;
    readAt: string | null;
    backlink: {
      sourceUrl: string;
      targetUrl: string;
      status: "ACTIVE" | "ISSUE" | "LOST";
    };
  }>;
};

type ReportState = {
  counts: { ACTIVE: number; ISSUE: number; LOST: number; DELETED: number };
  backlinksTotal: number;
  sumsByCurrency: Record<
    "EUR" | "USD" | "UAH",
    {
      total: number;
      active: number;
      issue: number;
      lost: number;
      deleted: number;
      lostInPeriod: number;
      atRisk: number;
    }
  >;
  period: { from: string; toExclusive: string };
  generatedAt: string;
};

type KpiState = {
  period: { days: number; from: string; toExclusive: string };
  counts: {
    totalBacklinks: number;
    activeBacklinks: number;
    issueBacklinks: number;
    lostBacklinks: number;
    deletedBacklinks: number;
    monitoredBacklinks: number;
    overdueBacklinks: number;
    checkedInPeriod: number;
    unreadAlerts: number;
    openAlerts: number;
  };
  rates: {
    healthRate: number;
    issueRate: number;
    lossRate: number;
    checkCoverageRate: number;
  };
  values: {
    total: number;
    atRisk: number;
    lostInPeriod: number;
  };
  generatedAt: string;
};

export default function DashboardPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [projectsManageMode, setProjectsManageMode] = useState(false);
  const [projectDeletingId, setProjectDeletingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [baseDomain, setBaseDomain] = useState("");
  const [loading, setLoading] = useState(false);
  const [projectCreateError, setProjectCreateError] = useState<string | null>(null);

  const [notifications, setNotifications] = useState<NotificationState | null>(null);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationsSaving, setNotificationsSaving] = useState(false);
  const [notificationsError, setNotificationsError] = useState<string | null>(null);
  const [telegramChatIdInput, setTelegramChatIdInput] = useState("");

  const [reports, setReports] = useState<ReportState | null>(null);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [reportsError, setReportsError] = useState<string | null>(null);
  const [reportsSending, setReportsSending] = useState(false);
  const [reportsSendMessage, setReportsSendMessage] = useState<string | null>(null);

  const [kpis, setKpis] = useState<KpiState | null>(null);
  const [kpisLoading, setKpisLoading] = useState(false);
  const [kpisError, setKpisError] = useState<string | null>(null);

  async function loadProjects() {
    setProjectsLoading(true);
    setProjectsError(null);

    try {
      const res = await fetch("/api/projects", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setProjectsError(data?.error ?? "Failed to load projects");
        return;
      }

      setProjects(data.projects ?? []);
    } finally {
      setProjectsLoading(false);
    }
  }

  async function loadNotifications() {
    setNotificationsLoading(true);
    setNotificationsError(null);

    try {
      const res = await fetch("/api/notifications/current", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setNotificationsError(data?.error ?? "Failed to load notifications");
        return;
      }

      setNotifications(data as NotificationState);
      setTelegramChatIdInput((data as NotificationState)?.channels?.telegram?.chatId ?? "");
    } finally {
      setNotificationsLoading(false);
    }
  }

  async function loadReports() {
    setReportsLoading(true);
    setReportsError(null);

    try {
      const res = await fetch("/api/reports/summary?days=30", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setReportsError(data?.error ?? "Failed to load reports");
        return;
      }

      setReports(data as ReportState);
    } finally {
      setReportsLoading(false);
    }
  }

  async function loadKpis() {
    setKpisLoading(true);
    setKpisError(null);

    try {
      const res = await fetch("/api/reports/kpi?days=30", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setKpisError(data?.error ?? "Failed to load KPI");
        return;
      }

      setKpis(data as KpiState);
    } finally {
      setKpisLoading(false);
    }
  }

  useEffect(() => {
    loadProjects();
    loadNotifications();
    loadReports();
    loadKpis();
  }, []);

  async function createProject(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    const trimmedBaseDomain = baseDomain.trim();
    if (!trimmed || !trimmedBaseDomain) return;

    setProjectCreateError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmed,
          baseDomain: trimmedBaseDomain,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (res.ok) {
        setName("");
        setBaseDomain("");
        await loadProjects();
        return;
      }

      setProjectCreateError(data?.error ?? "Failed to create project");
    } finally {
      setLoading(false);
    }
  }

  async function deleteProject(projectId: string, projectName: string) {
    const ok = window.confirm(`Delete project "${projectName}"? This action cannot be undone.`);
    if (!ok) return;

    setProjectDeletingId(projectId);
    setProjectsError(null);

    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "DELETE",
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setProjectsError(data?.error ?? "Failed to delete project");
        return;
      }

      await loadProjects();
      await loadReports();
      await loadKpis();
      await loadNotifications();
    } finally {
      setProjectDeletingId(null);
    }
  }

  async function saveNotifications(e: React.FormEvent) {
    e.preventDefault();
    setNotificationsSaving(true);
    setNotificationsError(null);

    try {
      const res = await fetch("/api/notifications/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telegramChatId: telegramChatIdInput }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotificationsError(data?.error ?? "Failed to save notifications");
        return;
      }

      setNotifications((data?.notifications ?? null) as NotificationState | null);
      setTelegramChatIdInput(
        (data?.notifications?.channels?.telegram?.chatId as string | null | undefined) ?? ""
      );
    } finally {
      setNotificationsSaving(false);
    }
  }

  function exportCsv() {
    window.location.href = "/api/reports/export";
  }

  async function sendReportToTelegram() {
    setReportsSending(true);
    setReportsSendMessage(null);

    try {
      const res = await fetch("/api/reports/send-telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days: 30 }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setReportsSendMessage(data?.error ?? "Failed to send Telegram report");
        return;
      }

      setReportsSendMessage("Report sent to Telegram");
    } finally {
      setReportsSending(false);
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <h2>Projects</h2>
          <div className={styles.projectsHeaderMeta}>
            <span>
              {projectsLoading
                ? "Loading"
                : projects.length === 0
                  ? "No data"
                  : "Updated now"}
            </span>
            <button
              type="button"
              className={styles.manageBtn}
              onClick={() => setProjectsManageMode((v) => !v)}
              data-active={projectsManageMode ? "true" : "false"}
            >
              {projectsManageMode ? "Done" : "Manage"}
            </button>
          </div>
        </div>

        {projectsError ? (
          <div className={styles.inlineFeedbackRow}>
            <p className={styles.empty}>{projectsError}</p>
            <button type="button" onClick={loadProjects} className={styles.inlineGhostBtn}>
              Retry
            </button>
          </div>
        ) : null}

        {projectsLoading ? <p className={styles.empty}>Loading projects…</p> : null}

        {!projectsLoading && projects.length === 0 ? (
          <p className={styles.empty}>No projects yet. Create your first project to get started.</p>
        ) : (
          <div className={styles.grid}>
            {projects.map((project) => (
              <div key={project.id} className={styles.projectCard}>
                <div className={styles.projectCardRow}>
                  <div>
                    <div className={styles.projectTitleRow}>
                      <Link href={`/projects/${project.id}`} className={styles.projectTitleLink}>
                        <h3>{project.name}</h3>
                      </Link>
                      {project.baseDomain ? (
                        <span className={styles.projectDomain}>{project.baseDomain}</span>
                      ) : null}
                    </div>
                    <p>{new Date(project.createdAt).toLocaleString()}</p>
                  </div>

                  <div className={styles.projectActionsRow}>
                    <Link href={`/projects/${project.id}`} className={styles.projectOpenLink}>
                      Open →
                    </Link>

                    {projectsManageMode ? (
                      <button
                        type="button"
                        className={styles.deleteBtnInline}
                        onClick={() => deleteProject(project.id, project.name)}
                        disabled={projectDeletingId === project.id}
                      >
                        {projectDeletingId === project.id ? "Deleting..." : "Delete"}
                      </button>
                    ) : null}
                  </div>
                </div>

              </div>
            ))}
          </div>
        )}

        {projectsManageMode ? (
          <div className={styles.manageCreateBlock}>
            <div className={styles.manageCreateHeader}>Create project</div>
            {projectCreateError ? <p className={styles.empty}>{projectCreateError}</p> : null}
            <form onSubmit={createProject} className={styles.manageCreateForm}>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="New project name"
                className={styles.input}
              />
              <input
                value={baseDomain}
                onChange={(e) => setBaseDomain(e.target.value)}
                placeholder="Base domain (e.g. example.com)"
                className={styles.input}
              />
              <button className={styles.primaryBtn} disabled={loading}>
                {loading ? "Creating..." : "Create"}
              </button>
            </form>
          </div>
        ) : null}
      </section>

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <h2>Customer KPI</h2>
          <span>{kpis?.period.days ?? 30}d window</span>
        </div>

        {kpisLoading ? <p className={styles.empty}>Loading KPI…</p> : null}
        {kpisError ? <p className={styles.empty}>{kpisError}</p> : null}

        {kpis ? (
          <div className={styles.kpiGrid}>
            <div className={styles.kpiCard}>
              <div className={styles.kpiLabel}>Health Rate</div>
              <div className={styles.kpiValue}>{kpis.rates.healthRate.toFixed(1)}%</div>
            </div>
            <div className={styles.kpiCard}>
              <div className={styles.kpiLabel}>Check Coverage</div>
              <div className={styles.kpiValue}>{kpis.rates.checkCoverageRate.toFixed(1)}%</div>
            </div>
            <div className={styles.kpiCard}>
              <div className={styles.kpiLabel}>Issue Rate</div>
              <div className={styles.kpiValue}>{kpis.rates.issueRate.toFixed(1)}%</div>
            </div>
            <div className={styles.kpiCard}>
              <div className={styles.kpiLabel}>Loss Rate</div>
              <div className={styles.kpiValue}>{kpis.rates.lossRate.toFixed(1)}%</div>
            </div>
            <div className={styles.kpiCard}>
              <div className={styles.kpiLabel}>Deleted Backlinks</div>
              <div className={styles.kpiValue}>{kpis.counts.deletedBacklinks}</div>
            </div>
            <div className={styles.kpiCard}>
              <div className={styles.kpiLabel}>Portfolio Value</div>
              <div className={styles.kpiValue}>{kpis.values.total.toFixed(2)}</div>
            </div>
            <div className={styles.kpiCard}>
              <div className={styles.kpiLabel}>At Risk Value</div>
              <div className={styles.kpiValue}>{kpis.values.atRisk.toFixed(2)}</div>
            </div>
          </div>
        ) : null}
      </section>

      <section className={styles.card}>
          <div className={styles.cardHeader}>
            <h2>Notifications</h2>
            <span>
              unread {notifications?.stats.unreadAlerts ?? 0} · open {notifications?.stats.openAlerts ?? 0}
            </span>
          </div>

          {notificationsLoading ? <p className={styles.empty}>Loading notifications…</p> : null}
          {notificationsError ? <p className={styles.empty}>{notificationsError}</p> : null}

          <form onSubmit={saveNotifications} className={styles.notificationsForm}>
            <input
              value={telegramChatIdInput}
              onChange={(e) => setTelegramChatIdInput(e.target.value)}
              placeholder="Telegram chat id (optional)"
              className={styles.input}
            />
            <button type="submit" className={styles.primaryBtn} disabled={notificationsSaving}>
              {notificationsSaving ? "Saving..." : "Save"}
            </button>
          </form>

          <p className={styles.notificationsHint}>
            Note: values like -100... are normal for Telegram group/channel chat IDs.
          </p>

          <div className={styles.notificationsRecent}>
            {(notifications?.recentAlerts ?? []).length === 0 ? (
              <p className={styles.empty}>No recent alerts</p>
            ) : (
              (notifications?.recentAlerts ?? []).map((alert) => (
                <div key={alert.id} className={styles.notificationsItem}>
                  <div className={styles.notificationsMeta}>
                    <span>{alert.type}</span>
                    <span>{new Date(alert.triggeredAt).toLocaleString()}</span>
                  </div>
                  <div className={styles.notificationsLink}>{alert.backlink.sourceUrl}</div>
                </div>
              ))
            )}
          </div>
      </section>

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <h2>Reports</h2>
          <span>{reports?.backlinksTotal ?? 0} backlinks</span>
        </div>

        {reportsLoading ? <p className={styles.empty}>Loading reports…</p> : null}
        {reportsError ? <p className={styles.empty}>{reportsError}</p> : null}

        {reports ? (
          <div className={styles.reportsBlock}>
            <div className={styles.reportsStats}>
              <div className={styles.reportsStatItem}>ACTIVE {reports.counts.ACTIVE}</div>
              <div className={styles.reportsStatItem}>ISSUE {reports.counts.ISSUE}</div>
              <div className={styles.reportsStatItem}>LOST {reports.counts.LOST}</div>
              <div className={styles.reportsStatItem}>DELETED {reports.counts.DELETED}</div>
            </div>

            <div className={styles.reportsCurrencyGrid}>
              {(Object.entries(reports.sumsByCurrency) as Array<
                [
                  "EUR" | "USD" | "UAH",
                  {
                    total: number;
                    active: number;
                    issue: number;
                    lost: number;
                    deleted: number;
                    lostInPeriod: number;
                    atRisk: number;
                  }
                ]
              >).map(([currency, row]) => (
                <div key={currency} className={styles.reportsCurrencyCard}>
                  <div className={styles.reportsCurrencyTitle}>{currency}</div>
                  <div className={styles.reportsCurrencyLine}>Total {row.total.toFixed(2)}</div>
                  <div className={styles.reportsCurrencyLine}>At risk {row.atRisk.toFixed(2)}</div>
                  <div className={styles.reportsCurrencyLine}>Lost 30d {row.lostInPeriod.toFixed(2)}</div>
                  <div className={styles.reportsCurrencyLine}>Deleted {row.deleted.toFixed(2)}</div>
                </div>
              ))}
            </div>

            <div className={styles.reportsActions}>
              <button type="button" className={styles.primaryBtn} onClick={exportCsv}>
                Export CSV
              </button>
              <button
                type="button"
                className={styles.primaryBtn}
                onClick={sendReportToTelegram}
                disabled={reportsSending}
              >
                {reportsSending ? "Sending..." : "Send to Telegram"}
              </button>
            </div>
            {reportsSendMessage ? <p className={styles.empty}>{reportsSendMessage}</p> : null}
          </div>
        ) : null}
      </section>

    </main>
  );
}
