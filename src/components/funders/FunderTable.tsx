"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Badge, SearchBar, Select, Table } from "@/components/ui";
import { AlertTriangle } from "lucide-react";
import type { SortDirection, TableColumn } from "@/components/ui";
import { useUrlState } from "@/lib/hooks/useUrlState";
import { FUNDER_CATEGORIES } from "@/lib/utils/constants";
import { formatDate, humanizeEnum } from "@/lib/utils/formatters";
import type { Enums, Tables } from "@/types/database";

type FunderCategory = Enums<"funder_category">;

/** A funder row enriched with the aggregate counts shown in the list. */
export type FunderRow = Tables<"funders"> & {
  contactCount: number;
  openOpportunityCount: number;
  relationshipScore: number | null;
  isStale: boolean;
};

export type FunderTableProps = {
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

const DEFAULT_SORT = { key: "name", direction: "asc" as SortDirection };

/**
 * Sortable funder list with keyword search, a category filter, and optional
 * AutoApply batch-selection (BLUEPRINT §4.2, WORKER_ARCHITECTURE §9).
 */
export function FunderTable({
  funders,
  isLoading = false,
  queuedFunderIds = new Set(),
  onQueueSelected,
}: FunderTableProps) {
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
  const sort = {
    key: searchParams.get("sort") ?? DEFAULT_SORT.key,
    direction:
      searchParams.get("dir") === "desc"
        ? ("desc" as SortDirection)
        : ("asc" as SortDirection),
  };

  function handleSortChange(next: { key: string; direction: SortDirection }) {
    const isDefault =
      next.key === DEFAULT_SORT.key && next.direction === DEFAULT_SORT.direction;
    setParams({
      sort: isDefault ? null : next.key,
      dir: isDefault ? null : next.direction,
    });
  }

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

  // IDs of funders in the filtered list that are selectable for AutoApply
  // (have a giving_portal_url and are not already queued).
  const selectableIds = useMemo(
    () =>
      filtered
        .filter((f) => f.giving_portal_url?.trim() && !queuedFunderIds.has(f.id))
        .map((f) => f.id),
    [filtered, queuedFunderIds],
  );

  const allVisibleSelected =
    selectableIds.length > 0 && selectableIds.every((id) => selectedIds.has(id));
  const someVisibleSelected =
    !allVisibleSelected && selectableIds.some((id) => selectedIds.has(id));

  function toggleSelectAll() {
    if (allVisibleSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        selectableIds.forEach((id) => next.delete(id));
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        selectableIds.forEach((id) => next.add(id));
        return next;
      });
    }
  }

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

  const columns: TableColumn<FunderRow>[] = [
    // Checkbox column — only rendered when onQueueSelected is provided.
    ...(onQueueSelected
      ? [
          {
            key: "select",
            header: (
              <input
                type="checkbox"
                aria-label="Select all visible funders"
                checked={allVisibleSelected}
                ref={(el) => {
                  if (el) el.indeterminate = someVisibleSelected;
                }}
                onChange={toggleSelectAll}
                onClick={(e) => e.stopPropagation()}
                disabled={selectableIds.length === 0}
                className="h-4 w-4 rounded border-navy-300 text-indigo-600 focus:ring-indigo-500 disabled:opacity-40 cursor-pointer disabled:cursor-default"
              />
            ),
            render: (row: FunderRow) => {
              if (!row.giving_portal_url?.trim()) return null;
              const isQueued = queuedFunderIds.has(row.id);
              return (
                <input
                  type="checkbox"
                  aria-label={`Select ${row.name}`}
                  checked={selectedIds.has(row.id)}
                  disabled={isQueued}
                  onChange={() => toggleFunder(row.id)}
                  onClick={(e) => e.stopPropagation()}
                  title={isQueued ? "Already queued" : undefined}
                  className="h-4 w-4 rounded border-navy-300 text-indigo-600 focus:ring-indigo-500 disabled:opacity-40 cursor-pointer disabled:cursor-default"
                />
              );
            },
            className: "w-10",
          } satisfies TableColumn<FunderRow>,
        ]
      : []),
    {
      key: "name",
      header: "Name",
      sortable: true,
      sortValue: (row) => row.name.toLowerCase(),
      render: (row) => (
        <div className="flex items-center gap-2">
          <span className="font-medium text-navy-900">{row.name}</span>
          {row.isStale && (
            <span title="No interaction in 180+ days with score of 0">
              <Badge variant="warning">
                <AlertTriangle className="h-3 w-3" aria-hidden />
                Stale
              </Badge>
            </span>
          )}
        </div>
      ),
    },
    {
      key: "category",
      header: "Category",
      sortable: true,
      sortValue: (row) => row.category,
      render: (row) => (
        <Badge color="indigo">{humanizeEnum(row.category)}</Badge>
      ),
    },
    {
      key: "contacts",
      header: "Contacts",
      align: "right",
      sortable: true,
      sortValue: (row) => row.contactCount,
      render: (row) => row.contactCount,
    },
    {
      key: "open_opportunities",
      header: "Open Opportunities",
      align: "right",
      sortable: true,
      sortValue: (row) => row.openOpportunityCount,
      render: (row) => row.openOpportunityCount,
    },
    {
      key: "last_contacted",
      header: "Last Contact",
      sortable: true,
      sortValue: (row) => row.last_contacted_at ?? "",
      render: (row) =>
        row.last_contacted_at ? (
          formatDate(row.last_contacted_at)
        ) : (
          <span className="text-navy-400">Never</span>
        ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="sm:max-w-xs sm:flex-1">
          <SearchBar
            defaultValue={query}
            onSearch={(value) => setParams({ q: value || null })}
            placeholder="Search funders..."
            aria-label="Search funders"
          />
        </div>
        <div className="sm:w-56">
          <Select
            aria-label="Filter by category"
            options={CATEGORY_FILTER_OPTIONS}
            value={category}
            onChange={(e) =>
              setParams({
                category: e.target.value === "all" ? null : e.target.value,
              })
            }
          />
        </div>
      </div>

      <Table
        columns={columns}
        data={filtered}
        rowKey={(row) => row.id}
        isLoading={isLoading}
        onRowClick={(row) => router.push(`/funders/${row.id}`)}
        sort={sort}
        onSortChange={handleSortChange}
        emptyMessage="No funders match your filters."
      />

      {selectedCount > 0 && onQueueSelected && (
        <div className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-4 rounded-xl bg-navy-900 px-6 py-3 shadow-xl">
          <span className="text-sm font-medium text-white">
            {selectedCount} funder{selectedCount !== 1 ? "s" : ""} selected
          </span>
          <button
            type="button"
            onClick={handleQueueClick}
            disabled={isQueuing}
            className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-60"
          >
            {isQueuing ? "Queuing…" : "Queue Selected"}
          </button>
        </div>
      )}
    </div>
  );
}
