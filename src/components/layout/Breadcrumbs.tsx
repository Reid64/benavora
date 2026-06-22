"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";

import { NAV_ITEMS } from "@/components/layout/nav-items";

/** Known section labels keyed by route segment, seeded from the nav config. */
const SEGMENT_LABELS: Record<string, string> = {
  ...Object.fromEntries(
    NAV_ITEMS.map((item) => [item.href.replace(/^\//, ""), item.label]),
  ),
  // Header nav items (not in sidebar NAV_ITEMS but still need correct labels).
  dashboard: "Dashboard",
  research: "Research",
  opportunities: "Opportunities",
  autoapply: "AutoApply",
  "draft-generator": "Draft Generator",
  new: "New",
  list: "List",
  profile: "Profile",
  narratives: "Narratives",
  answers: "Answers",
  analytics: "Analytics",
  campaigns: "Campaigns",
};

function labelForSegment(segment: string): string {
  if (SEGMENT_LABELS[segment]) return SEGMENT_LABELS[segment];
  // Dynamic route params (uuids) - show a generic, non-leaky label.
  if (/^[0-9a-f-]{12,}$/i.test(segment)) return "Detail";
  // Fallback: title-case the raw segment.
  return segment
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Dynamic breadcrumbs derived from the current pathname.
 * Every segment except the last links to its accumulated path.
 */
export function Breadcrumbs() {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);

  if (segments.length === 0) return null;

  const crumbs = segments.map((segment, index) => {
    const href = `/${segments.slice(0, index + 1).join("/")}`;
    return {
      href,
      label: labelForSegment(segment),
      isLast: index === segments.length - 1,
    };
  });

  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex items-center gap-1.5 text-sm">
        {crumbs.map((crumb) => (
          <li key={crumb.href} className="flex items-center gap-1.5">
            {crumb.isLast ? (
              <span
                className="font-semibold text-white"
                aria-current="page"
              >
                {crumb.label}
              </span>
            ) : (
              <>
                <Link
                  href={crumb.href}
                  className="text-navy-300 transition hover:text-white"
                >
                  {crumb.label}
                </Link>
                <ChevronRight
                  className="h-4 w-4 text-navy-500"
                  aria-hidden
                />
              </>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
