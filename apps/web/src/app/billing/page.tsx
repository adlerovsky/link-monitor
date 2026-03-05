"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import styles from "./page.module.css";

type BillingPlan = "FREE" | "STARTER" | "PRO" | "AGENCY";

type BillingState = {
  plan: BillingPlan;
  limits: { maxProjects: number; maxBacklinks: number };
  usage: { projects: number; backlinks: number };
  catalog: Array<{
    plan: BillingPlan;
    monthlyUsd: number;
    limits: { maxProjects: number; maxBacklinks: number };
  }>;
};

export default function BillingPage() {
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [billing, setBilling] = useState<BillingState | null>(null);
  const [billingLoading, setBillingLoading] = useState(false);
  const [upgradeLoading, setUpgradeLoading] = useState(false);
  const [billingError, setBillingError] = useState<string | null>(null);

  const publicCatalog: BillingState["catalog"] = [
    { plan: "FREE", monthlyUsd: 0, limits: { maxProjects: 1, maxBacklinks: 10 } },
    { plan: "STARTER", monthlyUsd: 39, limits: { maxProjects: 2, maxBacklinks: 100 } },
    { plan: "PRO", monthlyUsd: 129, limits: { maxProjects: 5, maxBacklinks: 1_000 } },
    { plan: "AGENCY", monthlyUsd: 349, limits: { maxProjects: 10, maxBacklinks: 10_000 } },
  ];

  const formatValuePerLink = (monthlyUsd: number, maxBacklinks: number) => {
    if (maxBacklinks <= 0) return "—";
    const perLink = monthlyUsd / maxBacklinks;
    return `$${perLink.toFixed(2)} / link`;
  };

  const formatLimit = (value: number) => new Intl.NumberFormat("en-US").format(value);

  const getUpgradeBenefit = (
    catalog: BillingState["catalog"],
    index: number
  ) => {
    if (index <= 1) return null;

    const current = catalog[index];
    const prev = catalog[index - 1];
    if (!current || !prev || prev.monthlyUsd <= 0 || prev.limits.maxBacklinks <= 0) return null;

    const currentPerLink = current.monthlyUsd / current.limits.maxBacklinks;
    const prevPerLink = prev.monthlyUsd / prev.limits.maxBacklinks;
    if (currentPerLink <= 0 || prevPerLink <= 0) return null;

    const ratio = prevPerLink / currentPerLink;
    if (ratio <= 1) return null;

    return `${ratio.toFixed(1)}x better vs ${prev.plan} (per link)`;
  };

  async function loadBilling() {
    setBillingLoading(true);
    setBillingError(null);

    try {
      const res = await fetch("/api/billing/current", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setBillingError(data?.error ?? "Failed to load billing");
        return;
      }

      setBilling(data as BillingState);
    } finally {
      setBillingLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const res = await fetch("/api/auth/session", { cache: "no-store" });
      if (!res.ok) {
        if (!cancelled) {
          setSessionEmail(null);
          setSessionLoading(false);
        }
        return;
      }

      const data = await res.json();
      if (!cancelled) {
        setSessionEmail(data?.user?.email ?? null);
        setSessionLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!sessionLoading && sessionEmail) {
      loadBilling();
    }
  }, [sessionLoading, sessionEmail]);

  async function upgradePlan(targetPlan: BillingPlan) {
    setUpgradeLoading(true);
    setBillingError(null);

    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetPlan }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBillingError(data?.error ?? "Upgrade failed");
        return;
      }

      await loadBilling();
    } finally {
      setUpgradeLoading(false);
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div>
          <h1 className={styles.heroTitle}>Billing</h1>
          <p className={styles.heroSubtitle}>
            {sessionEmail
              ? `Signed in as ${sessionEmail}`
              : "Public pricing and plans. Sign in to manage your workspace subscription."}
          </p>
        </div>
        <div className={styles.navActions}>
          {!sessionEmail ? (
            <>
              <Link href="/login" className={styles.navBtn}>
                Sign in
              </Link>
              <Link href="/login?mode=register" className={styles.navBtn}>
                Create account
              </Link>
            </>
          ) : null}
        </div>
      </section>

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div className={styles.cardTitle}>{sessionEmail ? "Current plan" : "Plans"}</div>
          <div className={styles.cardHint}>{sessionEmail ? billing?.plan ?? "--" : "Public pricing"}</div>
        </div>

        {sessionLoading ? <p className={styles.empty}>Loading…</p> : null}
        {sessionEmail && billingLoading ? <p className={styles.empty}>Loading billing…</p> : null}
        {sessionEmail && billingError ? <p className={styles.empty}>{billingError}</p> : null}

        {sessionEmail && billing ? (
          <>
            <p className={styles.cardHint}>
              Usage: {billing.usage.projects}/{billing.limits.maxProjects} projects · {billing.usage.backlinks}/
              {billing.limits.maxBacklinks} backlinks
            </p>

            <div className={styles.planGrid}>
              {billing.catalog.map((item, index) => {
                const active = item.plan === billing.plan;
                const benefit = getUpgradeBenefit(billing.catalog, index);
                const isBestChoice = item.plan === "AGENCY";
                return (
                  <div
                    key={item.plan}
                    className={`${active ? styles.planCardActive : styles.planCard} ${
                      isBestChoice ? styles.planCardBest : ""
                    }`}
                  >
                    <div className={styles.planName}>{item.plan}</div>
                    {isBestChoice ? <div className={styles.planBestBadge}>Best choice</div> : null}
                    <div className={styles.planPrice}>${item.monthlyUsd}</div>
                    <div className={styles.planPriceLabel}>per month</div>
                    <div className={styles.planLimitsBlock}>
                      <div className={styles.planLimitsTitle}>Plan limits</div>
                      <div className={styles.planLimitRow}>
                        <span>Projects</span>
                        <b>{formatLimit(item.limits.maxProjects)}</b>
                      </div>
                      <div className={styles.planLimitRow}>
                        <span>Backlinks</span>
                        <b>{formatLimit(item.limits.maxBacklinks)}</b>
                      </div>
                    </div>
                    <div className={styles.planValueStack}>
                      <div className={styles.planValueMetric}>
                        {formatValuePerLink(item.monthlyUsd, item.limits.maxBacklinks)}
                      </div>
                      {benefit ? <div className={styles.planBenefit}>{benefit}</div> : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => upgradePlan(item.plan)}
                      disabled={active || upgradeLoading}
                      className={active ? `${styles.primaryBtn} ${styles.primaryBtnCurrent}` : styles.primaryBtn}
                    >
                      {active ? "Current plan" : upgradeLoading ? "Updating..." : "Choose plan"}
                    </button>
                  </div>
                );
              })}
            </div>
          </>
        ) : null}

        {!sessionLoading && !sessionEmail ? (
          <>
            <p className={styles.cardHint}>
              Choose a plan that matches your backlink portfolio scale. You can upgrade after sign in.
            </p>

            <div className={styles.planGrid}>
              {publicCatalog.map((item, index) => {
                const benefit = getUpgradeBenefit(publicCatalog, index);
                const isBestChoice = item.plan === "AGENCY";
                return (
                <div key={item.plan} className={`${styles.planCard} ${isBestChoice ? styles.planCardBest : ""}`}>
                  <div className={styles.planName}>{item.plan}</div>
                  {isBestChoice ? <div className={styles.planBestBadge}>Best choice</div> : null}
                  <div className={styles.planPrice}>${item.monthlyUsd}</div>
                  <div className={styles.planPriceLabel}>per month</div>
                  <div className={styles.planLimitsBlock}>
                    <div className={styles.planLimitsTitle}>Plan limits</div>
                    <div className={styles.planLimitRow}>
                      <span>Projects</span>
                      <b>{formatLimit(item.limits.maxProjects)}</b>
                    </div>
                    <div className={styles.planLimitRow}>
                      <span>Backlinks</span>
                      <b>{formatLimit(item.limits.maxBacklinks)}</b>
                    </div>
                  </div>
                  <div className={styles.planValueStack}>
                    <div className={styles.planValueMetric}>
                      {formatValuePerLink(item.monthlyUsd, item.limits.maxBacklinks)}
                    </div>
                    {benefit ? <div className={styles.planBenefit}>{benefit}</div> : null}
                  </div>
                  <Link href="/login?mode=register" className={styles.primaryBtn}>
                    Start with {item.plan}
                  </Link>
                </div>
              )})}
            </div>
          </>
        ) : null}
      </section>
    </main>
  );
}
