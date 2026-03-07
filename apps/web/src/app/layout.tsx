import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import SiteHeader from "./components/site-header";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

function resolveAppUrl() {
  const raw = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim();
  if (!raw) return "https://linkmonitor.app";
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

const appUrl = resolveAppUrl();

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: {
    default: "Link Monitor by Adler",
    template: "%s | Link Monitor by Adler",
  },
  applicationName: "Link Monitor by Adler",
  description:
    "Backlink monitoring platform for tracking link health, alerts, and SEO portfolio performance.",
  openGraph: {
    title: "Link Monitor by Adler",
    description:
      "Backlink intelligence platform for agencies and in-house SEO teams.",
    type: "website",
    siteName: "Link Monitor by Adler",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Link Monitor by Adler",
    description: "Monitor backlinks, detect risks early, and ship reliable SEO reporting.",
    images: ["/opengraph-image"],
  },
  icons: {
    icon: "/icon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        <div className="siteShell">
          <SiteHeader />

          <div className="siteMain">{children}</div>

          <footer className="siteFooter">
            <div className="siteFooterInner">
              <span>© {new Date().getFullYear()} Link Monitor by Adler</span>
              <div className="siteFooterLinks">
                <Link href="/billing">Billing</Link>
                <Link href="/privacy">Privacy</Link>
                <Link href="/terms">Terms</Link>
              </div>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
