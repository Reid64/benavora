"use client";

import { useState } from "react";
import { X } from "lucide-react";

import { Button, SearchBar, Select } from "@/components/ui";
import {
  FUNDER_CATEGORIES,
  OPPORTUNITY_STATUSES,
} from "@/lib/utils/constants";
import { humanizeEnum } from "@/lib/utils/formatters";
import type { Enums } from "@/types/database";

type FunderCategory = Enums<"funder_category">;
type OpportunityStatus = Enums<"opportunity_status">;

/** The full set of opportunity-list filters (BLUEPRINT §4.4). */
export type OpportunityFilterValue = {
  /** Keyword search across name, description, and keyword tags. */
  query: string;
  category: FunderCategory | "all";
  status: OpportunityStatus | "all";
  /** Deadline range as YYYY-MM-DD date-input strings ("" = unbounded). */
  deadlineFrom: string;
  deadlineTo: string;
  /** Eligibility score range as 0–100 strings ("" = unbounded). */
  scoreMin: string;
  scoreMax: string;
};

export const EMPTY_OPPORTUNITY_FILTERS: OpportunityFilterValue = {
  query: "",
  category: "all",
  status: "all",
  deadlineFrom: "",
  deadlineTo: "",
  scoreMin: "",
  scoreMax: "",
};

const CATEGORY_OPTIONS = [
  { value: "all", label: "All categories" },
  ...FUNDER_CATEGORIES.map((value) => ({ value, label: humanizeEnum(value) })),
];

const STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  ...OPPORTUNITY_STATUSES.map((value) => ({
    value,
    label: humanizeEnum(value),
  })),
];

export type OpportunityFiltersProps = {
  value: OpportunityFilterValue;
  onChange: (value: OpportunityFilterValue) => void;
};

function isActive(value: OpportunityFilterValue): boolean {
  return (
    value.query.trim() !== "" ||
    value.category !== "all" ||
    value.status !== "all" ||
    value.deadlineFrom !== "" ||
    value.deadlineTo !== "" ||
    value.scoreMin !== "" ||
    value.scoreMax !== ""
  );
}

/**
 * Filter controls for the opportunities list: keyword search, category, status,
 * a deadline range, and an eligibility-score range. Fully controlled — the
 * parent owns the filter state and applies it (OpportunityTable).
 */
export function OpportunityFilters({ value, onChange }: OpportunityFiltersProps) {
  // SearchBar is uncontrolled/debounced; remount it on "Clear" so its input
  // visually resets along with the rest of the filters.
  const [searchKey, setSearchKey] = useState(0);

  function patch(partial: Partial<OpportunityFilterValue>) {
    onChange({ ...value, ...partial });
  }

  function clearAll() {
    onChange(EMPTY_OPPORTUNITY_FILTERS);
    setSearchKey((k) => k + 1);
  }

  return (
    <div className="space-y-4 rounded-xl border border-navy-200 bg-white p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="lg:max-w-xs lg:flex-1">
          <SearchBar
            key={searchKey}
            defaultValue={value.query}
            onSearch={(query) => patch({ query })}
            placeholder="Search name, description, keywords…"
            aria-label="Search opportunities"
          />
        </div>
        <div className="lg:w-56">
          <Select
            aria-label="Filter by category"
            options={CATEGORY_OPTIONS}
            value={value.category}
            onChange={(e) =>
              patch({ category: e.target.value as FunderCategory | "all" })
            }
          />
        </div>
        <div className="lg:w-44">
          <Select
            aria-label="Filter by status"
            options={STATUS_OPTIONS}
            value={value.status}
            onChange={(e) =>
              patch({ status: e.target.value as OpportunityStatus | "all" })
            }
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-navy-600">
            Deadline from
          </label>
          <input
            type="date"
            value={value.deadlineFrom}
            max={value.deadlineTo || undefined}
            onChange={(e) => patch({ deadlineFrom: e.target.value })}
            aria-label="Deadline from"
            className="block w-full rounded-lg border border-navy-300 bg-white px-3 py-2 text-sm text-navy-900 shadow-sm transition focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-navy-600">
            Deadline to
          </label>
          <input
            type="date"
            value={value.deadlineTo}
            min={value.deadlineFrom || undefined}
            onChange={(e) => patch({ deadlineTo: e.target.value })}
            aria-label="Deadline to"
            className="block w-full rounded-lg border border-navy-300 bg-white px-3 py-2 text-sm text-navy-900 shadow-sm transition focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-navy-600">
            Min eligibility
          </label>
          <input
            type="number"
            min={0}
            max={100}
            value={value.scoreMin}
            onChange={(e) => patch({ scoreMin: e.target.value })}
            placeholder="0"
            aria-label="Minimum eligibility score"
            className="block w-full rounded-lg border border-navy-300 bg-white px-3 py-2 text-sm text-navy-900 shadow-sm transition placeholder:text-navy-400 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-navy-600">
            Max eligibility
          </label>
          <input
            type="number"
            min={0}
            max={100}
            value={value.scoreMax}
            onChange={(e) => patch({ scoreMax: e.target.value })}
            placeholder="100"
            aria-label="Maximum eligibility score"
            className="block w-full rounded-lg border border-navy-300 bg-white px-3 py-2 text-sm text-navy-900 shadow-sm transition placeholder:text-navy-400 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
        </div>
      </div>

      {isActive(value) && (
        <div className="flex justify-end">
          <Button variant="secondary" size="sm" onClick={clearAll}>
            <X className="h-4 w-4" aria-hidden />
            Clear filters
          </Button>
        </div>
      )}
    </div>
  );
}
