"use client";

import { cn } from "@/lib/utils/cn";
import { humanizeEnum } from "@/lib/utils/formatters";
import { OPPORTUNITY_SOURCE_TYPES } from "@/lib/utils/constants";
import type { OpportunitySourceType } from "@/lib/opportunities/source-type";

export type SourceTypeTabValue = OpportunitySourceType | "all";

export type SourceTypeTabsProps = {
  value: SourceTypeTabValue;
  /** Per-source counts across the unfiltered list, for the tab badges. */
  counts: Record<OpportunitySourceType, number>;
  /** Total number of opportunities (the "All" tab count). */
  total: number;
  onChange: (value: SourceTypeTabValue) => void;
};

/**
 * Tailwind background for each source-type dot. Distinct per type here (unlike
 * the per-row Source badge, which is always the "info" variant) because these
 * are filter tabs, not repeated status pills — a quick color key across the
 * whole strip is useful; the same variety on every table row was just noise.
 */
const DOT_BG: Record<OpportunitySourceType, string> = {
  government_federal: "bg-info-text",
  government_state: "bg-sky-500",
  government_local: "bg-teal-500",
  private_foundation: "bg-primary",
  corporate_giving: "bg-warning-text",
  community_foundation: "bg-success-text",
  faith_based: "bg-amber-500",
  international: "bg-pink-500",
};

/**
 * Source-type filter tabs for the Opportunities list (task spec). "All" plus one
 * tab per opportunity_source_type, each showing how many opportunities it holds.
 * Fully controlled - the parent owns the selected value and applies the filter.
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
          dotClass={DOT_BG[type]}
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
        "inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm transition",
        active
          ? "bg-[#3D6B50] font-semibold text-white"
          : "border border-slate-200 bg-surface font-medium text-slate-600 hover:border-[#3D6B50] hover:text-[#3D6B50]",
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
