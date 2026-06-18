"use client";

import Link from "next/link";
import { KanbanSquare, List, RefreshCw } from "lucide-react";

export type ApplicationsView = "board" | "list" | "renewals";

const VIEWS: {
  key: ApplicationsView;
  label: string;
  href: string;
  icon: typeof KanbanSquare;
}[] = [
  { key: "board", label: "Board", href: "/applications", icon: KanbanSquare },
  { key: "list", label: "List", href: "/applications/list", icon: List },
  { key: "renewals", label: "Renewals", href: "/renewals", icon: RefreshCw },
];

/**
 * Shared three-way view switch for the Applications section: Board, List, and
 * Renewals (the renewal-obligations view). Renders the active view as a static
 * pill and the others as links so the same control reads consistently on every
 * page that shows it.
 */
export function ApplicationsViewToggle({ active }: { active: ApplicationsView }) {
  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-navy-200 bg-white p-1 shadow-sm">
      {VIEWS.map((v) => {
        const Icon = v.icon;
        if (v.key === active) {
          return (
            <span
              key={v.key}
              aria-current="page"
              className="inline-flex items-center gap-1.5 rounded-md bg-teal-50 px-3 py-1.5 text-sm font-medium text-teal-700"
            >
              <Icon className="h-4 w-4" aria-hidden />
              {v.label}
            </span>
          );
        }
        return (
          <Link
            key={v.key}
            href={v.href}
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-navy-600 transition hover:bg-navy-50"
          >
            <Icon className="h-4 w-4" aria-hidden />
            {v.label}
          </Link>
        );
      })}
    </div>
  );
}
