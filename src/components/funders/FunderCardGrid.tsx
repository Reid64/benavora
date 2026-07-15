"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Select } from "@/components/ui";
import { FunderCard } from "@/components/funders/FunderCard";
import type { FunderRow } from "@/components/funders/FunderTable";
import { useUrlState } from "@/lib/hooks/useUrlState";
import { FUNDER_CATEGORIES } from "@/lib/utils/constants";
import { humanizeEnum } from "@/lib/utils/formatters";
import type { Enums } from "@/types/database";

type FunderCategory = Enums<"funder_category">;

export type FunderCardGridProps = {
  funders: FunderRow[];
  isLoading?: boolean;
  /** IDs of funders that already have a pending or processing queue item. */
  queuedFunderIds?: Set<string>;
  /** Called when the user queues the selected funders. */
  onQueueSelected?: (ids: string[]) => Promise<void>;
};

const CATEGORY_FILTER_OPTIONS = [
  { value: "all", label: "All categories" },
  ...FUNDER_CATEGORIES.map((value) => ({
    value,
    label: humanizeEnum(value),
  })),
];

/**
 * Card-grid funder list (Elevated Slate design system) with keyword search,
 * a category filter, and optional AutoApply batch-selection
 * (BLUEPRINT §4.2, WORKER_ARCHITECTURE §9).
 */
export function FunderCardGrid({
  funders,
  isLoading = false,
  queuedFunderIds = new Set(),
  onQueueSelected,
}: FunderCardGridProps) {
  const router = useRouter();
  const { searchParams, setParams } = useUrlState();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isQueuing, setIsQueuing] = useState(false);

  // State lives in the URL so it survives sidebar navigation and refresh.
  const query = searchParams.get("q") ?? "";
  const categoryParam = searchParams.get("category");
  const category: FunderCategory | "all" =
    categoryParam && (FUNDER_CATEGORIES as readonly string[]).includes(categoryParam)
      ? (categoryParam as FunderCategory)
      : "all";

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return funders.filter((funder) => {
      if (category !== "all" && funder.category !== category) return false;
      if (!q) return true;
      return (
        funder.name.toLowerCase().includes(q) ||
        (funder.geographic_focus?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [funders, query, category]);

  function toggleFunder(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  async function handleQueueClick() {
    const ids = [...selectedIds];
    if (ids.length === 0 || !onQueueSelected) return;
    setIsQueuing(true);
    try {
      await onQueueSelected(ids);
      setSelectedIds(new Set());
    } finally {
      setIsQueuing(false);
    }
  }

  const selectedCount = selectedIds.size;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="sm:max-w-xs sm:flex-1">
          <input
            type="search"
            value={query}
            onChange={(event) => setParams({ q: event.target.value || null })}
            placeholder="Search funders..."
            aria-label="Search funders"
            className="w-full bg-white border border-slate-200 rounded-lg px-4 py-2.5 text-sm text-slate-700 placeholder-slate-400 focus:border-[#0077B6] focus:ring-2 focus:ring-[#0077B6]/10 outline-none"
          />
        </div>
        <div className="sm:w-56">
          <Select
            aria-label="Filter by category"
            options={CATEGORY_FILTER_OPTIONS}
            value={category}
            onChange={(event) =>
              setParams({
                category: event.target.value === "all" ? null : event.target.value,
              })
            }
          />
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-32 animate-pulse rounded-xl border border-border bg-white-sunken"
            />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-border bg-white shadow-sm p-10 text-center text-sm text-slate-500">
          No funders match your filters.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((funder) => (
            <FunderCard
              key={funder.id}
              funder={funder}
              onClick={() => router.push(`/funders/${funder.id}`)}
              selectable={Boolean(onQueueSelected)}
              isSelected={selectedIds.has(funder.id)}
              isQueued={queuedFunderIds.has(funder.id)}
              onToggleSelect={() => toggleFunder(funder.id)}
            />
          ))}
        </div>
      )}

      {selectedCount > 0 && onQueueSelected && (
        <div className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-4 rounded-xl bg-slate-900 px-6 py-3 shadow-xl">
          <span className="text-sm font-medium text-white">
            {selectedCount} funder{selectedCount !== 1 ? "s" : ""} selected
          </span>
          <button
            type="button"
            onClick={handleQueueClick}
            disabled={isQueuing}
            className="rounded-lg bg-[#0077B6] px-4 py-1.5 text-sm font-medium text-white transition hover:bg-[#005F92] disabled:opacity-60"
          >
            {isQueuing ? "Queuing…" : "Queue Selected"}
          </button>
        </div>
      )}
    </div>
  );
}
