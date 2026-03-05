"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import styles from "./page.module.css";

type UserProfileState = {
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string;
  plan: "FREE" | "STARTER" | "PRO" | "AGENCY";
};

export default function AccountPage() {
  const [profile, setProfile] = useState<UserProfileState | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [firstNameInput, setFirstNameInput] = useState("");
  const [lastNameInput, setLastNameInput] = useState("");
  const [phoneInput, setPhoneInput] = useState("");

  async function loadProfile() {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/profile", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data?.error ?? "Failed to load profile");
        return;
      }

      const next = (data?.profile ?? null) as UserProfileState | null;
      setProfile(next);
      setFirstNameInput(next?.firstName ?? "");
      setLastNameInput(next?.lastName ?? "");
      setPhoneInput(next?.phone ?? "");
      if (data?.warning) {
        setMessage(String(data.warning));
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadProfile();
  }, []);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const res = await fetch("/api/auth/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: firstNameInput,
          lastName: lastNameInput,
          phone: phoneInput,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "Failed to save profile");
        return;
      }

      const next = (data?.profile ?? null) as UserProfileState | null;
      setProfile(next);
      setMessage("Profile saved");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div>
          <h1 className={styles.heroTitle}>Account</h1>
          <p className={styles.heroSubtitle}>Manage your personal details and current plan.</p>
        </div>
        <Link href="/dashboard" className={styles.navBtn}>
          Back to dashboard
        </Link>
      </section>

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <h2>Personal profile</h2>
          <span>{profile?.plan ?? "--"} plan</span>
        </div>

        {loading ? <p className={styles.feedback}>Loading profile…</p> : null}
        {error ? <p className={styles.feedback}>{error}</p> : null}
        {message ? <p className={styles.feedback}>{message}</p> : null}

        <form onSubmit={saveProfile} className={styles.profileForm}>
          <div className={styles.formRowTwo}>
            <input
              value={firstNameInput}
              onChange={(e) => setFirstNameInput(e.target.value)}
              placeholder="First name"
              className={styles.input}
            />
            <input
              value={lastNameInput}
              onChange={(e) => setLastNameInput(e.target.value)}
              placeholder="Last name"
              className={styles.input}
            />
          </div>

          <div className={styles.formRowTwo}>
            <input
              value={phoneInput}
              onChange={(e) => setPhoneInput(e.target.value)}
              placeholder="Phone number"
              className={styles.input}
            />
            <input value={profile?.email ?? ""} readOnly placeholder="Email" className={styles.input} />
          </div>

          <div className={styles.metaRow}>
            <span className={styles.hint}>Current plan: {profile?.plan ?? "--"}</span>
            <button type="submit" className={styles.primaryBtn} disabled={saving}>
              {saving ? "Saving..." : "Save profile"}
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
