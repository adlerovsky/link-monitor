import Link from "next/link";
import type { Metadata } from "next";
import styles from "../legal.module.css";

export const metadata: Metadata = {
  title: "Terms of Service — Link Monitor by Adler",
  description: "Terms for using the Link Monitor by Adler platform.",
};

export default function TermsPage() {
  return (
    <main className={styles.page}>
      <article className={styles.card}>
        <h1 className={styles.title}>Terms of Service</h1>
        <p className={styles.meta}>Last updated: March 4, 2026</p>

        <h2 className={styles.sectionTitle}>Use of service</h2>
        <p className={styles.text}>
          By using Link Monitor by Adler, you agree to use the service lawfully and not interfere with system
          operation or security.
        </p>

        <h2 className={styles.sectionTitle}>Accounts and security</h2>
        <p className={styles.text}>
          You are responsible for your account credentials and activity under your organization.
          Notify us immediately about unauthorized access.
        </p>

        <h2 className={styles.sectionTitle}>Billing and subscriptions</h2>
        <p className={styles.text}>
          Paid plans are billed according to selected pricing. Plan changes may affect feature and
          usage limits.
        </p>

        <h2 className={styles.sectionTitle}>Service availability</h2>
        <p className={styles.text}>
          We aim for reliable uptime but cannot guarantee uninterrupted availability. Maintenance and
          external outages can impact service.
        </p>

        <h2 className={styles.sectionTitle}>Liability</h2>
        <p className={styles.text}>
          Link Monitor by Adler is provided on an as-is basis, with liability limited to the extent permitted
          by applicable law.
        </p>

        <h2 className={styles.sectionTitle}>Contact</h2>
        <p className={styles.text}>For legal questions, contact hello@linkmonitor.app.</p>
      </article>

      <Link href="/" className={styles.backLink}>
        ← Back to home
      </Link>
    </main>
  );
}
