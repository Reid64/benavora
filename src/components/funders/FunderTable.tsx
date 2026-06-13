"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";

import { Badge, SearchBar, Select, Table } from "@/components/ui";
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
};

export type FunderTableProps = {
  funders: FunderRow[];
  isLoading?: boolean;
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
 * Sortable funder list with keyword search and a category filter
 * (BLUEPRINT §4.2). Filtering and sorting run client-side over the provided
 * rows. Clicking a row opens the funder detail page. Search, filter, and sort
 * are persisted to the URL so they survive sidebar navigation.
 */
export function FunderTable({ funders, isLoading = false }: FunderTableProps) {
  const router = useRouter();
  const { searchParams, setParams } = useUrlState();

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

  const columns: TableColumn<FunderRow>[] = [
    {
      key: "name",
      header: "Name",
      sortable: true,
      sortValue: (row) => row.name.toLowerCase(),
      render: (row) => (
        <span className="font-medium text-navy-900">{row.name}</span>
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
    </div>
  );
}
