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
    <div className="border-b border-navy-200">
      <nav className="-mb-px flex gap-6 overflow-x-auto" aria-label="Knowledge base sections">
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
                "whitespace-nowrap border-b-2 px-1 py-3 text-sm font-medium transition",
                active
                  ? "border-teal-600 text-teal-600"
                  : "border-transparent text-navy-500 hover:border-navy-300 hover:text-navy-700",
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
