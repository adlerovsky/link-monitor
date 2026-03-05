"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type SessionState = {
  user?: {
    email?: string;
  } | null;
};

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  if (href === "/dashboard") return pathname === "/dashboard" || pathname.startsWith("/projects/");
  return pathname === href;
}

export default function SiteHeader() {
  const pathname = usePathname();
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);

  const nav = [...(sessionEmail ? [{ href: "/dashboard", label: "Dashboard" }] : [])];
  const brandHref = sessionEmail ? "/dashboard" : "/";

  const accountInitial = useMemo(() => {
    if (!sessionEmail) return "U";
    return sessionEmail.trim().charAt(0).toUpperCase() || "U";
  }, [sessionEmail]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setSessionLoading(true);
      try {
        const res = await fetch("/api/auth/session", { cache: "no-store" });
        if (cancelled) return;

        if (!res.ok) {
          setSessionEmail(null);
          return;
        }

        const data = (await res.json().catch(() => ({}))) as SessionState;
        if (cancelled) return;

        setSessionEmail(data?.user?.email ?? null);
      } finally {
        if (!cancelled) {
          setSessionLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pathname]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/";
  }

  return (
    <header className="siteHeader">
      <div className="siteHeaderInner">
        <Link href={brandHref} className="siteBrand" aria-label="Link Monitor by Adler home">
          <Image
            src="/logo.svg"
            alt="Link Monitor by Adler"
            className="siteBrandLogo"
            width={32}
            height={32}
            priority
          />
          <span className="siteBrandText">Link Monitor by Adler</span>
        </Link>

        <nav className="siteNav" aria-label="Primary">
          {sessionLoading ? <span className="siteSessionHint">Checking session…</span> : null}

          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={isActive(pathname, item.href) ? "siteNavLink siteNavLinkActive" : "siteNavLink"}
              aria-current={isActive(pathname, item.href) ? "page" : undefined}
            >
              {item.label}
            </Link>
          ))}

          {!sessionLoading && sessionEmail ? (
            <div className="siteAccountMenuWrap">
              <button
                type="button"
                className={menuOpen ? "siteAccountChip siteAccountChipActive" : "siteAccountChip"}
                onClick={() => setMenuOpen((v) => !v)}
                aria-expanded={menuOpen}
                aria-haspopup="menu"
                title={sessionEmail}
              >
                <span className="siteAccountAvatar" aria-hidden="true">
                  {accountInitial}
                </span>
                <span>Account</span>
                <span className="siteAccountChevron" aria-hidden="true">
                  ▾
                </span>
              </button>

              {menuOpen ? (
                <div className="siteAccountMenu" role="menu" aria-label="Account menu">
                  <Link
                    href="/account"
                    className="siteAccountMenuItem"
                    role="menuitem"
                    onClick={() => setMenuOpen(false)}
                  >
                    Personal cabinet
                  </Link>
                  <Link
                    href="/dashboard"
                    className="siteAccountMenuItem"
                    role="menuitem"
                    onClick={() => setMenuOpen(false)}
                  >
                    Dashboard
                  </Link>
                  <button type="button" onClick={logout} className="siteAccountMenuItemButton" role="menuitem">
                    Logout
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

          {!sessionLoading && !sessionEmail ? (
            <Link
              href="/login"
              className={isActive(pathname, "/login") ? "siteNavLink siteNavLinkActive" : "siteNavLink"}
              aria-current={isActive(pathname, "/login") ? "page" : undefined}
            >
              Login
            </Link>
          ) : null}
        </nav>
      </div>
    </header>
  );
}
