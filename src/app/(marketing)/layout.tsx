"use client";

import { usePathname } from "next/navigation";
import { Fraunces, Inter } from "next/font/google";
import { MarketingNav } from "@/components/marketing/MarketingNav";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";
import { mk } from "@/lib/marketing/theme";

// Marketing route-group layout. Provides the shared forest/paper nav + footer
// (src/components/marketing/MarketingNav.tsx, MarketingFooter.tsx) for the
// secondary marketing pages (/for-consultants, /pricing, /privacy, /terms,
// /security).
//
// The landing page ("/") is the converted v15 marketing page — it is fully
// self-contained (its own nav, footer, and GLOBAL CSS, including a `nav {}`
// rule). Wrapping it in this chrome would duplicate the nav and let the v15
// global styles collide with it, so we render the landing without chrome.
//
// /how-it-works is a deep-dive continuation of the landing page (same dark B-token
// visual system, its own nav/footer) rather than a standalone marketing sub-page —
// same reasoning as "/", so it's exempted the same way.
// See test-evidence/marketing/mkt-001-inventory.md for the full reasoning.

const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["500", "600"],
  variable: "--mk-display",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--mk-body",
  display: "swap",
});

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
    <div
      className={`${fraunces.variable} ${inter.variable}`}
      style={{ background: mk.paper, color: mk.ink, minHeight: "100vh" }}
    >
      <MarketingNav />
      {children}
      <MarketingFooter />
    </div>
  );
}
