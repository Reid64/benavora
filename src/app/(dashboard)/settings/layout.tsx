"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { useProfile } from "@/lib/hooks/useProfile";

const NAV_ITEMS = [
  { label: "General", href: "/settings" },
  { label: "Organization Setup", href: "/settings/organization-setup" },
  { label: "Integrations", href: "/settings/integrations" },
  { label: "Agents", href: "/settings/agents" },
  { label: "Notifications", href: "/settings/notifications" },
  { label: "Branding", href: "/settings/branding" },
  { label: "Custom APIs", href: "/settings/custom-apis" },
  { label: "Scraping Targets", href: "/settings/scraping" },
  { label: "Billing", href: "/billing", ownerOnly: true },
  { label: "White-Label", href: "/settings/white-label", ownerOnly: true },
] as const;

export default function SettingsLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { profile } = useProfile();
  const isOwner = profile?.role === "owner";

  return (
    <div className="space-y-6">
      <nav
        className="flex gap-1 overflow-x-auto border-b border-border"
        aria-label="Settings navigation"
      >
        {NAV_ITEMS.filter((item) => !("ownerOnly" in item && item.ownerOnly) || isOwner).map(({ label, href }) => {
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
                  ? "text-primary after:absolute after:bottom-0 after:left-0 after:h-0.5 after:w-full after:bg-primary"
                  : "text-text-muted hover:text-text"
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
