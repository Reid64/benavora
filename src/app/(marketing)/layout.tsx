"use client";

import { usePathname } from "next/navigation";
import { Fraunces, Inter } from "next/font/google";
import { MarketingNav } from "@/components/marketing/MarketingNav";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";
import { mk } from "@/lib/marketing/theme";

// Marketing route-group layout. Provides the shared forest/paper nav + footer
// (src/components/marketing/MarketingNav.tsx, MarketingFooter.tsx) for the
// marketing pages.
//
// /how-it-works is still the old converted v15 marketing page (its own dark
// B-token visual system, own nav/footer) and is not in scope for the mkt-003
// Home rewrite, so it keeps rendering standalone until it gets its own
// Forest-and-paper pass. The landing page ("/") was rewritten in mkt-003 to
// use the shared mk tokens and no longer brings its own nav/footer, so it now
// gets the shared chrome like every other marketing page.
// See test-evidence/marketing/mkt-001-inventory.md and mkt-003-before.md.

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

  // /how-it-works still renders standalone (own nav + footer, old dark
  // visual system) until it gets rewritten in a later mkt- queue item.
  if (pathname === "/how-it-works") {
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
