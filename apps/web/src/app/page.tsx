import type { Metadata } from "next";
import Link from "next/link";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Link Monitor by Adler — Backlink Monitoring Platform",
  description:
    "Monitor backlinks, detect issues early, and deliver reliable SEO reporting from one dashboard.",
  openGraph: {
    title: "Link Monitor by Adler",
    description:
      "Backlink intelligence platform for agencies and in-house SEO teams.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Link Monitor by Adler",
    description:
      "Track backlink health, protect revenue, and prove SEO impact with clear reporting.",
  },
};

const plans = [
  { name: "Starter", price: "$39", note: "for small teams" },
  { name: "Pro", price: "$129", note: "for growing agencies" },
  { name: "Agency", price: "$349", note: "for portfolio scale" },
];

const benefits = [
  "Daily backlink checks with queue-based reliability",
  "Alerts for issue/lost transitions with Telegram support",
  "Portfolio KPI, report export, and operational dashboard",
  "Team-ready access with organization roles",
];

export default function LandingPage() {
  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <span className={styles.badge}>Backlink intelligence platform</span>
        <h1>Monitor backlinks, protect SEO revenue, prove client value.</h1>
        <p>
          Link Monitor by Adler helps teams detect lost links faster, track portfolio health, and deliver
          reliable reporting clients trust.
        </p>
        <div className={styles.heroActions}>
          <Link href="/login?mode=register" className={styles.primaryBtn}>
            Create workspace
          </Link>
        </div>
      </section>

      <section className={styles.section}>
        <h2>Why teams choose Link Monitor by Adler</h2>
        <div className={styles.featureGrid}>
          {benefits.map((benefit) => (
            <article key={benefit} className={styles.featureCard}>
              <p>{benefit}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2>Simple pricing</h2>
          <Link href="/billing" className={styles.inlineLink}>
            Open billing →
          </Link>
        </div>

        <div className={styles.planGrid}>
          {plans.map((plan) => (
            <article key={plan.name} className={styles.planCard}>
              <div className={styles.planName}>{plan.name}</div>
              <div className={styles.planPrice}>{plan.price}</div>
              <div className={styles.planNote}>{plan.note}</div>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.ctaSection}>
        <h2>Ready to launch smarter backlink operations?</h2>
        <p>Start a trial workspace now or request a product demo for your team.</p>
        <div className={styles.ctaActions}>
          <Link href="/login?mode=register" className={styles.primaryBtn}>
            Start trial
          </Link>
          <a href="mailto:hello@linkmonitor.app" className={styles.secondaryBtn}>
            Book demo
          </a>
        </div>
      </section>
    </main>
  );
}
