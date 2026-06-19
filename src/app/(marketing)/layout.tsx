"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Marketing route-group layout. Provides the shared dark nav + footer for the
// secondary marketing pages (/privacy, /terms, /for-consultants).
//
// The landing page ("/") is the converted v15 marketing page — it is fully
// self-contained (its own nav, footer, and GLOBAL CSS, including a `nav {}`
// rule). Wrapping it in this chrome would duplicate the nav and let the v15
// global styles collide with it, so we render the landing without chrome.

const NAV_LINKS: { label: string; href: string }[] = [
  { label: "How It Works", href: "/#how" },
  { label: "Features", href: "/#features" },
  { label: "Pricing", href: "/#pricing" },
  { label: "FAQ", href: "/#faq" },
  { label: "For Agencies", href: "/for-consultants" },
];

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  // Landing page renders standalone (it brings its own nav + footer).
  if (pathname === "/") {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#0a0a1a] text-gray-200">
      {/* Top nav */}
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[#0a0a1a]/90 backdrop-blur">
        <nav className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-6 py-3">
          <Link href="/" className="flex items-center" aria-label="Benavora home">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/benavora-logo.png"
              alt="Benavora"
              style={{ height: "80px", width: "auto" }}
            />
          </Link>

          <div className="hidden items-center gap-7 lg:flex">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-sm text-gray-300 transition hover:text-white"
              >
                {link.label}
              </Link>
            ))}
          </div>

          <div className="flex items-center gap-3 sm:gap-4">
            <Link
              href="/login"
              className="text-sm text-gray-300 transition hover:text-white"
            >
              Login
            </Link>
            <Link
              href="/login"
              className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-orange-900/30 transition hover:bg-orange-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a1a]"
            >
              Start Free Trial
            </Link>
          </div>
        </nav>
      </header>

      <main className="flex-1">{children}</main>

      {/* Footer */}
      <footer className="border-t border-white/10 bg-[#0a0a1a]">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 text-sm text-gray-500 sm:flex-row">
          <p>© 2026 Benavora. All rights reserved.</p>
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
            <Link href="/privacy" className="transition hover:text-gray-300">
              Privacy Policy
            </Link>
            <Link href="/terms" className="transition hover:text-gray-300">
              Terms of Service
            </Link>
            <Link
              href="/for-consultants"
              className="transition hover:text-gray-300"
            >
              For Consultants
            </Link>
            <a
              href="mailto:support@benavora.com"
              className="transition hover:text-gray-300"
            >
              support@benavora.com
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
