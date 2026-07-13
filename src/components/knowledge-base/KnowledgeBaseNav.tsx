"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils/cn";

const TABS = [
  { label: "Overview", href: "/knowledge-base" },
  { label: "Organization Profile", href: "/knowledge-base/profile" },
  { label: "Narratives", href: "/knowledge-base/narratives" },
  { label: "Standard Answers", href: "/knowledge-base/answers" },
];

/**
 * Shared sub-navigation across the Knowledge Base pages (BLUEPRINT §4.7):
 * overview, organization profile, narratives, and standard answers.
 */
export function KnowledgeBaseNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-wrap items-center gap-2" aria-label="Knowledge base sections">
      {TABS.map((tab) => {
        const active =
          tab.href === "/knowledge-base"
            ? pathname === tab.href
            : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "whitespace-nowrap transition-colors",
              active
                ? "rounded-lg bg-[#0077B6] px-4 py-2 text-sm font-semibold text-white"
                : "rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:text-[#0077B6]",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
