"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const NAV_ITEMS = [
  { label: "General", href: "/settings" },
  { label: "Integrations", href: "/settings/integrations" },
  { label: "Branding", href: "/settings/branding" },
  { label: "Custom APIs", href: "/settings/custom-apis" },
  { label: "Scraping Targets", href: "/settings/scraping" },
] as const;

export default function SettingsLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="space-y-6">
      <nav
        className="flex gap-1 overflow-x-auto border-b border-white/10"
        aria-label="Settings navigation"
      >
        {NAV_ITEMS.map(({ label, href }) => {
          const active =
            href === "/settings"
              ? pathname === "/settings"
              : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`relative whitespace-nowrap px-3 pb-3 pt-1 text-sm font-medium transition-colors ${
                active
                  ? "text-teal-400 after:absolute after:bottom-0 after:left-0 after:h-0.5 after:w-full after:bg-teal-400"
                  : "text-navy-400 hover:text-navy-200"
              }`}
            >
              {label}
            </Link>
          );
        })}
      </nav>
      {children}
    </div>
  );
}
