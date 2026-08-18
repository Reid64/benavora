"use client";

import type { CSSProperties } from "react";
import { AlertTriangle, Building2 } from "lucide-react";

import { Badge } from "@/components/ui";
import { formatDate, humanizeEnum } from "@/lib/utils/formatters";
import { cn } from "@/lib/utils/cn";
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

const FUNDER_BORDER_COLOR: Record<string, string> = {
  Government: "#0077B6",
  Foundation: "#6B48CC",
  Corporate: "#00B4D8",
};

const FUNDER_BORDER_CLASS: Record<string, string> = {
  Government: "border-accent-blue",
  Foundation: "border-accent-violet",
  Corporate: "border-accent-cyan",
};

function getFunderBorderStyle(category: FunderCategory): CSSProperties | undefined {
  const color = FUNDER_BORDER_COLOR[getFunderTypeBadge(category).label];
  return color ? { borderLeft: `4px solid ${color}` } : undefined;
}

function getFunderBorderClass(category: FunderCategory): string | undefined {
  return FUNDER_BORDER_CLASS[getFunderTypeBadge(category).label];
}

/** Colored relationship-score pill: green 70+, amber 40-69, red below 40, gray when unscored. */
function getScoreBadgeClassName(score: number | null): string {
  if (score === null) return "bg-slate-100 text-slate-500";
  if (score >= 70) return "bg-emerald-100 text-emerald-700";
  if (score >= 40) return "bg-amber-100 text-amber-700";
  return "bg-red-100 text-red-700";
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
      className={cn(
        "bg-surface rounded-xl shadow-sm border border-border p-5 hover:shadow-md hover:border-[#00B4D8] transition-all cursor-pointer card-depth",
        getFunderBorderClass(funder.category),
      )}
      style={getFunderBorderStyle(funder.category)}
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
          <span
            title="Relationship score"
            aria-label={
              funder.relationshipScore !== null
                ? `Relationship score ${funder.relationshipScore}`
                : "No relationship score yet"
            }
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${getScoreBadgeClassName(funder.relationshipScore)}`}
          >
            {funder.relationshipScore !== null ? funder.relationshipScore : "—"}
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
