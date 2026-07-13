"use client";

import { AlertTriangle, Building2 } from "lucide-react";

import { Badge } from "@/components/ui";
import { formatDate, humanizeEnum } from "@/lib/utils/formatters";
import type { Enums } from "@/types/database";
import type { FunderRow } from "@/components/funders/FunderTable";

type FunderCategory = Enums<"funder_category">;

const FUNDER_TYPE_BADGES: {
  label: string;
  className: string;
  test: (category: FunderCategory) => boolean;
}[] = [
  {
    label: "Government",
    className: "bg-[#DBEAFE] text-[#1D4ED8]",
    test: (category) => category.includes("government"),
  },
  {
    label: "Foundation",
    className: "bg-[#EDE9FE] text-[#6D28D9]",
    test: (category) => category.includes("foundation"),
  },
  {
    label: "Corporate",
    className: "bg-[#FEF3C7] text-[#92400E]",
    test: (category) => category.includes("corporate"),
  },
];

function getFunderTypeBadge(category: FunderCategory) {
  const match = FUNDER_TYPE_BADGES.find((entry) => entry.test(category));
  return match ?? { label: humanizeEnum(category), className: "bg-slate-100 text-slate-600" };
}

export type FunderCardProps = {
  funder: FunderRow;
  onClick: () => void;
  selectable?: boolean;
  isSelected?: boolean;
  isQueued?: boolean;
  onToggleSelect?: () => void;
};

/** Card view of a funder (Elevated Slate design system) — the grid alternative
 * to the sortable table used elsewhere (e.g. AI recommendations). */
export function FunderCard({
  funder,
  onClick,
  selectable = false,
  isSelected = false,
  isQueued = false,
  onToggleSelect,
}: FunderCardProps) {
  const typeBadge = getFunderTypeBadge(funder.category);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
      className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 hover:shadow-md hover:border-[#00B4D8] transition-all cursor-pointer"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-slate-900 truncate">{funder.name}</h3>
          <p className="text-sm text-slate-400 mt-0.5 truncate">
            {funder.geographic_focus || "Geography not set"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {selectable && funder.giving_portal_url?.trim() && (
            <input
              type="checkbox"
              aria-label={`Select ${funder.name}`}
              checked={isSelected}
              disabled={isQueued}
              onClick={(event) => event.stopPropagation()}
              onChange={() => onToggleSelect?.()}
              title={isQueued ? "Already queued" : undefined}
              className="h-4 w-4 rounded border-slate-300 text-[#0077B6] accent-[#0077B6] focus:ring-[#0077B6] disabled:opacity-40 cursor-pointer disabled:cursor-default"
            />
          )}
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${typeBadge.className}`}
          >
            {typeBadge.label}
          </span>
        </div>
      </div>

      {funder.isStale && (
        <div className="mt-2" title="No interaction in 180+ days with score of 0">
          <Badge variant="warning">
            <AlertTriangle className="h-3 w-3" aria-hidden />
            Stale
          </Badge>
        </div>
      )}

      <div className="flex items-center gap-4 mt-3 text-xs text-slate-400">
        <span>
          {funder.contactCount} contact{funder.contactCount !== 1 ? "s" : ""}
        </span>
        <span>
          {funder.openOpportunityCount} open opportunit
          {funder.openOpportunityCount !== 1 ? "ies" : "y"}
        </span>
        <span className="flex items-center gap-1">
          <Building2 className="h-3.5 w-3.5" aria-hidden />
          {funder.last_contacted_at ? formatDate(funder.last_contacted_at) : "Never contacted"}
        </span>
      </div>
    </div>
  );
}
