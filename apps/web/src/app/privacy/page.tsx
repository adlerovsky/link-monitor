import Link from "next/link";
import type { Metadata } from "next";
import styles from "../legal.module.css";

export const metadata: Metadata = {
  title: "Privacy Policy — Link Monitor by Adler",
  description: "How Link Monitor by Adler collects, uses, and protects your data.",
};

export default function PrivacyPage() {
  return (
    <main className={styles.page}>
      <article className={styles.card}>
        <h1 className={styles.title}>Privacy Policy</h1>
        <p className={styles.meta}>Last updated: March 4, 2026</p>

        <h2 className={styles.sectionTitle}>Information we collect</h2>
        <p className={styles.text}>
          We collect account data (email, organization), workspace content (projects, backlinks,
          reports), and technical logs needed to keep the service stable and secure.
        </p>

        <h2 className={styles.sectionTitle}>How we use information</h2>
        <p className={styles.text}>
          Data is used to provide monitoring, alerts, reporting, billing operations, and support.
          We process data to improve product reliability and prevent abuse.
        </p>

        <h2 className={styles.sectionTitle}>Data sharing</h2>
        <p className={styles.text}>
          We do not sell customer data. We only share data with infrastructure and payment providers
          required to run Link Monitor by Adler.
        </p>

        <h2 className={styles.sectionTitle}>Data retention and deletion</h2>
        <p className={styles.text}>
          We retain data while your account is active and as needed for legal or operational
          obligations. You can request deletion via support.
        </p>

        <h2 className={styles.sectionTitle}>Contact</h2>
        <p className={styles.text}>For privacy requests, contact hello@linkmonitor.app.</p>
      </article>

      <Link href="/" className={styles.backLink}>
        ← Back to home
      </Link>
    </main>
  );
}
