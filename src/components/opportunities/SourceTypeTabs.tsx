"use client";

import { cn } from "@/lib/utils/cn";
import { humanizeEnum } from "@/lib/utils/formatters";
import { OPPORTUNITY_SOURCE_TYPES } from "@/lib/utils/constants";
import type { OpportunitySourceType } from "@/lib/opportunities/source-type";
import { SOURCE_TYPE_COLOR } from "@/components/opportunities/SourceTypeBadge";
import type { BadgeColor } from "@/components/ui";

export type SourceTypeTabValue = OpportunitySourceType | "all";

export type SourceTypeTabsProps = {
  value: SourceTypeTabValue;
  /** Per-source counts across the unfiltered list, for the tab badges. */
  counts: Record<OpportunitySourceType, number>;
  /** Total number of opportunities (the "All" tab count). */
  total: number;
  onChange: (value: SourceTypeTabValue) => void;
};

/** Tailwind background for each source-type dot, keyed off the shared palette. */
const DOT_BG: Record<BadgeColor, string> = {
  gray: "bg-navy-400",
  teal: "bg-teal-500",
  indigo: "bg-teal-500",
  purple: "bg-plum-500",
  navy: "bg-navy-600",
  green: "bg-green-500",
  yellow: "bg-amber-500",
  red: "bg-red-500",
  blue: "bg-blue-500",
  sky: "bg-sky-500",
  orange: "bg-orange-500",
  pink: "bg-pink-500",
};

/**
 * Source-type filter tabs for the Opportunities list (task spec). "All" plus one
 * tab per opportunity_source_type, each showing how many opportunities it holds.
 * Fully controlled — the parent owns the selected value and applies the filter.
 * Source types with zero opportunities are hidden to keep the strip focused.
 */
export function SourceTypeTabs({
  value,
  counts,
  total,
  onChange,
}: SourceTypeTabsProps) {
  const visibleTypes = OPPORTUNITY_SOURCE_TYPES.filter(
    (type) => counts[type] > 0 || value === type,
  );

  return (
    <div
      className="flex flex-wrap items-center gap-2"
      role="tablist"
      aria-label="Filter opportunities by source type"
    >
      <TabButton
        label="All"
        count={total}
        active={value === "all"}
        onClick={() => onChange("all")}
      />
      {visibleTypes.map((type) => (
        <TabButton
          key={type}
          label={humanizeEnum(type)}
          count={counts[type]}
          dotClass={DOT_BG[SOURCE_TYPE_COLOR[type]]}
          active={value === type}
          onClick={() => onChange(type)}
        />
      ))}
    </div>
  );
}

function TabButton({
  label,
  count,
  dotClass,
  active,
  onClick,
}: {
  label: string;
  count: number;
  dotClass?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition",
        active
          ? "border-teal-600 bg-teal-600 text-white"
          : "border-navy-200 bg-white text-navy-600 hover:border-navy-300 hover:bg-navy-50",
      )}
    >
      {dotClass && (
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            active ? "bg-white/80" : dotClass,
          )}
          aria-hidden
        />
      )}
      {label}
      <span
        className={cn(
          "rounded-full px-1.5 text-xs tabular-nums",
          active ? "bg-white/20 text-white" : "bg-navy-100 text-navy-500",
        )}
      >
        {count}
      </span>
    </button>
  );
}
