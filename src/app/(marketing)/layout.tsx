"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

// Marketing route-group layout. Provides the shared light nav + footer for the
// secondary marketing pages (/privacy, /terms, /for-consultants).
//
// The landing page ("/") is the converted v15 marketing page — it is fully
// self-contained (its own nav, footer, and GLOBAL CSS, including a `nav {}`
// rule). Wrapping it in this chrome would duplicate the nav and let the v15
// global styles collide with it, so we render the landing without chrome.
//
// /how-it-works is a deep-dive continuation of the landing page (same dark B-token
// visual system, its own nav/footer) rather than a standalone marketing sub-page —
// same reasoning as "/", so it's exempted the same way.

const NAV_LINKS: { label: string; href: string }[] = [
  { label: "How It Works", href: "/#how" },
  { label: "Features", href: "/#features" },
  { label: "Pricing", href: "/#pricing" },
  { label: "FAQ", href: "/#faq" },
  { label: "For Agencies", href: "/for-consultants" },
  { label: "Security", href: "/security" },
];

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  // Landing page and its deep-dive continuation render standalone (they bring
  // their own nav + footer, matching the landing page's dark visual system).
  if (pathname === "/" || pathname === "/how-it-works") {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-screen flex-col bg-surface text-slate-800">
      {/* Top nav */}
      <header className="sticky top-0 z-40 border-b border-[#e5e7eb] bg-white/90 backdrop-blur">
        <nav className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-6 py-3">
          <Link href="/" className="flex items-center ml-0" aria-label="Benavora home">
            <Image
              src="/benavora_logo.png"
              alt="Benavora"
              width={84}
              height={56}
              style={{ height: "56px", width: "auto" }}
            />
          </Link>

          <div className="hidden items-center gap-7 lg:flex">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-sm text-slate-800 transition hover:text-cyan-600"
              >
                {link.label}
              </Link>
            ))}
          </div>

          <div className="flex items-center gap-3 sm:gap-4">
            <Link
              href="/login"
              className="text-sm text-slate-800 transition hover:text-cyan-600"
            >
              Login
            </Link>
            <Link
              href="/login"
              className="rounded-lg bg-gradient-to-r from-[#00B4D8] to-[#0077B6] px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-cyan-900/10 transition hover:from-cyan-600 hover:to-cyan-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-600 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
            >
              Start Free Trial
            </Link>
          </div>
        </nav>
      </header>

      <main className="flex-1">{children}</main>

      {/* Footer */}
      <footer className="border-t border-[#e5e7eb] bg-slate-50">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 text-sm text-slate-400 sm:flex-row">
          <p>© 2026 Benavora. All rights reserved.</p>
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
            <Link href="/privacy" className="transition hover:text-cyan-600">
              Privacy Policy
            </Link>
            <Link href="/terms" className="transition hover:text-cyan-600">
              Terms of Service
            </Link>
            <Link
              href="/for-consultants"
              className="transition hover:text-cyan-600"
            >
              For Consultants
            </Link>
            <Link href="/security" className="transition hover:text-cyan-600">
              Security
            </Link>
            <a
              href="mailto:support@benavora.com"
              className="transition hover:text-cyan-600"
            >
              support@benavora.com
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
