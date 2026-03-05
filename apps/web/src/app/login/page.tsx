"use client";

import { FormEvent, Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import styles from "./page.module.css";

type AuthMode = "login" | "register";
type LoginStage = "credentials" | "twoFactor";
const RESEND_COOLDOWN_SECONDS = 60;
const RESEND_COOLDOWN_STORAGE_KEY = "lm_login_2fa_resend_unlock_at";

export default function LoginPage() {
  return (
    <Suspense fallback={<main className={styles.page} />}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = useMemo(() => searchParams.get("next") || "/dashboard", [searchParams]);

  const [mode, setMode] = useState<AuthMode>(
    searchParams.get("mode") === "register" ? "register" : "login"
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [loginStage, setLoginStage] = useState<LoginStage>("credentials");
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [verificationCode, setVerificationCode] = useState("");
  const [verificationHint, setVerificationHint] = useState<string | null>(null);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendCooldownLeft, setResendCooldownLeft] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== "login" || loginStage !== "twoFactor") {
      return;
    }

    const rawUnlockAt = window.localStorage.getItem(RESEND_COOLDOWN_STORAGE_KEY);
    const unlockAt = rawUnlockAt ? Number(rawUnlockAt) : NaN;
    if (!Number.isFinite(unlockAt)) {
      return;
    }

    const secondsLeft = Math.max(0, Math.ceil((unlockAt - Date.now()) / 1000));
    setResendCooldownLeft(secondsLeft);
  }, [mode, loginStage]);

  useEffect(() => {
    if (resendCooldownLeft > 0) {
      const unlockAt = Date.now() + resendCooldownLeft * 1000;
      window.localStorage.setItem(RESEND_COOLDOWN_STORAGE_KEY, String(unlockAt));
      return;
    }

    window.localStorage.removeItem(RESEND_COOLDOWN_STORAGE_KEY);
  }, [resendCooldownLeft]);

  useEffect(() => {
    if (resendCooldownLeft <= 0) {
      return;
    }

    const timerId = window.setTimeout(() => {
      setResendCooldownLeft((prev) => Math.max(prev - 1, 0));
    }, 1000);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [resendCooldownLeft]);

  function resetTwoFactorState() {
    setLoginStage("credentials");
    setChallengeId(null);
    setVerificationCode("");
    setVerificationHint(null);
    setResendCooldownLeft(0);
    window.localStorage.removeItem(RESEND_COOLDOWN_STORAGE_KEY);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail || !password) {
      setError("Email and password are required");
      return;
    }

    setLoading(true);
    try {
      const endpoint = mode === "login" ? "/api/auth/login" : "/api/auth/register";
      const payload: Record<string, string> = {
        email: trimmedEmail,
        password,
      };

      if (mode === "register") {
        payload.organizationName = organizationName.trim();
      }

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "Authentication failed");
        return;
      }

      if (mode === "login") {
        if (!data?.requiresTwoFactor || !data?.challengeId) {
          setError("Two-factor challenge was not created");
          return;
        }

        setChallengeId(String(data.challengeId));
        setLoginStage("twoFactor");
        setVerificationCode("");
        setResendCooldownLeft(RESEND_COOLDOWN_SECONDS);

        const expiresAtText = data?.expiresAt
          ? new Date(String(data.expiresAt)).toLocaleTimeString()
          : null;

        if (data?.devCode) {
          setVerificationHint(
            `DEV only: email provider not configured. Code ${String(data.devCode)} (expires ${
              expiresAtText ?? "soon"
            })`
          );
        } else {
          setVerificationHint(
            `We sent a 6-digit code to ${trimmedEmail}${
              expiresAtText ? ` (expires ${expiresAtText})` : ""
            }.`
          );
        }
        return;
      }

      router.replace(nextPath);
      router.refresh();
    } catch {
      setError("Authentication failed");
    } finally {
      setLoading(false);
    }
  }

  async function onVerifyTwoFactor(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!challengeId) {
      setError("Two-factor challenge is missing. Please sign in again.");
      return;
    }

    const normalizedCode = verificationCode.trim();
    if (!/^\d{6}$/.test(normalizedCode)) {
      setError("Enter a valid 6-digit code");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/login/verify-2fa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challengeId,
          code: normalizedCode,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "Verification failed");
        return;
      }

      window.localStorage.removeItem(RESEND_COOLDOWN_STORAGE_KEY);
      router.replace(nextPath);
      router.refresh();
    } catch {
      setError("Verification failed");
    } finally {
      setLoading(false);
    }
  }

  async function onResendCode() {
    if (!challengeId) {
      setError("Two-factor challenge is missing. Please sign in again.");
      return;
    }

    if (resendCooldownLeft > 0) {
      return;
    }

    setError(null);
    setResendLoading(true);
    try {
      const res = await fetch("/api/auth/login/resend-2fa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "Failed to resend code");
        return;
      }

      const nextChallengeId = String(data?.challengeId ?? "");
      if (nextChallengeId) {
        setChallengeId(nextChallengeId);
      }

      setResendCooldownLeft(RESEND_COOLDOWN_SECONDS);

      const expiresAtText = data?.expiresAt
        ? new Date(String(data.expiresAt)).toLocaleTimeString()
        : null;

      if (data?.devCode) {
        setVerificationHint(
          `DEV only: email provider not configured. Code ${String(data.devCode)} (expires ${
            expiresAtText ?? "soon"
          })`
        );
      } else {
        setVerificationHint(
          `We sent a new 6-digit code to ${email.trim().toLowerCase()}${
            expiresAtText ? ` (expires ${expiresAtText})` : ""
          }.`
        );
      }
    } catch {
      setError("Failed to resend code");
    } finally {
      setResendLoading(false);
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <div className={styles.header}>
          <h1>Link Monitor by Adler</h1>
          <p>{mode === "login" ? "Sign in to continue" : "Create your account"}</p>
        </div>

        <div className={styles.switcher}>
          <button
            type="button"
            onClick={() => {
              setMode("login");
              resetTwoFactorState();
              setError(null);
            }}
            className={mode === "login" ? styles.switchActive : styles.switchBtn}
          >
            Login
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("register");
              resetTwoFactorState();
              setError(null);
            }}
            className={mode === "register" ? styles.switchActive : styles.switchBtn}
          >
            Register
          </button>
        </div>

        {mode === "login" && loginStage === "twoFactor" ? (
          <form onSubmit={onVerifyTwoFactor} className={styles.form}>
            <label className={styles.field}>
              <span>Verification code</span>
              <input
                value={verificationCode}
                onChange={(e) => setVerificationCode(e.target.value)}
                placeholder="6-digit code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                required
              />
            </label>

            {verificationHint ? <p className={styles.hint}>{verificationHint}</p> : null}
            {error ? <p className={styles.error}>{error}</p> : null}

            <button type="submit" disabled={loading} className={styles.submit}>
              {loading ? "Verifying..." : "Verify and sign in"}
            </button>

            <button
              type="button"
              onClick={onResendCode}
              className={styles.secondaryBtn}
              disabled={loading || resendLoading || resendCooldownLeft > 0}
            >
              {resendLoading
                ? "Resending..."
                : resendCooldownLeft > 0
                ? `Resend code in ${resendCooldownLeft}s`
                : "Resend code"}
            </button>

            <button
              type="button"
              onClick={resetTwoFactorState}
              className={styles.secondaryBtn}
              disabled={loading || resendLoading}
            >
              Back
            </button>
          </form>
        ) : (
          <form onSubmit={onSubmit} className={styles.form}>
            <label className={styles.field}>
              <span>Email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                required
              />
            </label>

            <label className={styles.field}>
              <span>Password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === "register" ? "At least 8 characters" : "Your password"}
                minLength={mode === "register" ? 8 : undefined}
                required
              />
            </label>

            {mode === "register" ? (
              <label className={styles.field}>
                <span>Organization name (optional)</span>
                <input
                  value={organizationName}
                  onChange={(e) => setOrganizationName(e.target.value)}
                  placeholder="My team"
                />
              </label>
            ) : null}

            {error ? <p className={styles.error}>{error}</p> : null}

            <button type="submit" disabled={loading} className={styles.submit}>
              {loading ? "Please wait..." : mode === "login" ? "Sign in" : "Create account"}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
