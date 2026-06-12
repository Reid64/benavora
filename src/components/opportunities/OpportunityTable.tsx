"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";

import { Badge, Table } from "@/components/ui";
import type { TableColumn } from "@/components/ui";
import {
  EligibilityBar,
  OPPORTUNITY_STATUS_COLOR,
  RecommendationBadge,
} from "@/components/opportunities/eligibility";
import {
  OpportunityFilters,
  type OpportunityFilterValue,
} from "@/components/opportunities/OpportunityFilters";
import { useUrlState } from "@/lib/hooks/useUrlState";
import {
  FUNDER_CATEGORIES,
  OPPORTUNITY_STATUSES,
} from "@/lib/utils/constants";
import { formatCurrency, formatDate, humanizeEnum } from "@/lib/utils/formatters";
import type { Enums, Tables } from "@/types/database";

/** An opportunity enriched with its keyword tags and funder name for the list. */
export type OpportunityRow = Tables<"opportunities"> & {
  keywords: string[];
  funderName: string | null;
};

export type OpportunityTableProps = {
  opportunities: OpportunityRow[];
  isLoading?: boolean;
};

/** Lexicographic YYYY-MM-DD compare works because ISO dates sort that way. */
function deadlineDay(deadline: string | null): string {
  return deadline ? deadline.slice(0, 10) : "";
}

/**
 * Opportunity list with the full filter set (BLUEPRINT §4.4): keyword search,
 * category, status, deadline range, and eligibility-score range. Filtering and
 * sorting run client-side over the provided rows; clicking a row opens detail.
 */
export function OpportunityTable({
  opportunities,
  isLoading = false,
}: OpportunityTableProps) {
  const router = useRouter();
  const { searchParams, setParams } = useUrlState();

  // The full filter set lives in the URL so it survives sidebar navigation and
  // refresh. Enum-typed params are validated against their allowed values so a
  // hand-edited URL can't wedge the list into showing nothing.
  const filters: OpportunityFilterValue = useMemo(() => {
    const categoryParam = searchParams.get("category");
    const statusParam = searchParams.get("status");
    return {
      query: searchParams.get("q") ?? "",
      category:
        categoryParam &&
        (FUNDER_CATEGORIES as readonly string[]).includes(categoryParam)
          ? (categoryParam as Enums<"funder_category">)
          : "all",
      status:
        statusParam &&
        (OPPORTUNITY_STATUSES as readonly string[]).includes(statusParam)
          ? (statusParam as Enums<"opportunity_status">)
          : "all",
      deadlineFrom: searchParams.get("from") ?? "",
      deadlineTo: searchParams.get("to") ?? "",
      scoreMin: searchParams.get("min") ?? "",
      scoreMax: searchParams.get("max") ?? "",
    };
  }, [searchParams]);

  function handleFiltersChange(next: OpportunityFilterValue) {
    setParams({
      q: next.query || null,
      category: next.category === "all" ? null : next.category,
      status: next.status === "all" ? null : next.status,
      from: next.deadlineFrom || null,
      to: next.deadlineTo || null,
      min: next.scoreMin || null,
      max: next.scoreMax || null,
    });
  }

  const filtered = useMemo(() => {
    const q = filters.query.trim().toLowerCase();
    const min = filters.scoreMin.trim() === "" ? null : Number(filters.scoreMin);
    const max = filters.scoreMax.trim() === "" ? null : Number(filters.scoreMax);

    return opportunities.filter((opp) => {
      if (filters.category !== "all" && opp.category !== filters.category) {
        return false;
      }
      if (filters.status !== "all" && opp.status !== filters.status) {
        return false;
      }

      const day = deadlineDay(opp.deadline);
      if (filters.deadlineFrom) {
        if (!day || day < filters.deadlineFrom) return false;
      }
      if (filters.deadlineTo) {
        if (!day || day > filters.deadlineTo) return false;
      }

      if (min != null && !Number.isNaN(min)) {
        if (opp.eligibility_score == null || opp.eligibility_score < min) {
          return false;
        }
      }
      if (max != null && !Number.isNaN(max)) {
        if (opp.eligibility_score == null || opp.eligibility_score > max) {
          return false;
        }
      }

      if (!q) return true;
      return (
        opp.name.toLowerCase().includes(q) ||
        (opp.description?.toLowerCase().includes(q) ?? false) ||
        (opp.funderName?.toLowerCase().includes(q) ?? false) ||
        opp.keywords.some((k) => k.toLowerCase().includes(q))
      );
    });
  }, [opportunities, filters]);

  const columns: TableColumn<OpportunityRow>[] = [
    {
      key: "name",
      header: "Name",
      sortable: true,
      sortValue: (row) => row.name.toLowerCase(),
      render: (row) => (
        <div className="min-w-0">
          <span className="font-medium text-navy-900">{row.name}</span>
          {row.funderName && (
            <span className="mt-0.5 block text-xs text-navy-500">
              {row.funderName}
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
      render: (row) => <Badge color="indigo">{humanizeEnum(row.category)}</Badge>,
    },
    {
      key: "deadline",
      header: "Deadline",
      sortable: true,
      // Sort undated rows last in ascending order.
      sortValue: (row) => row.deadline ?? "9999",
      render: (row) =>
        row.deadline ? (
          formatDate(row.deadline)
        ) : (
          <span className="text-navy-400">—</span>
        ),
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      sortable: true,
      sortValue: (row) => row.amount_max ?? row.amount_available ?? 0,
      render: (row) =>
        row.amount_max != null || row.amount_available != null ? (
          formatCurrency(row.amount_max ?? row.amount_available)
        ) : (
          <span className="text-navy-400">—</span>
        ),
    },
    {
      key: "eligibility",
      header: "Eligibility",
      sortable: true,
      // Unscored rows sort below scored ones.
      sortValue: (row) => row.eligibility_score ?? -1,
      render: (row) => <EligibilityBar score={row.eligibility_score} />,
    },
    {
      key: "recommendation",
      header: "Recommendation",
      sortable: true,
      sortValue: (row) => row.recommendation ?? "",
      render: (row) =>
        row.recommendation ? (
          <RecommendationBadge recommendation={row.recommendation} />
        ) : (
          <span className="text-navy-400">—</span>
        ),
    },
    {
      key: "status",
      header: "Status",
      sortable: true,
      sortValue: (row) => row.status ?? "",
      render: (row) =>
        row.status ? (
          <Badge color={OPPORTUNITY_STATUS_COLOR[row.status]}>
            {humanizeEnum(row.status)}
          </Badge>
        ) : (
          <span className="text-navy-400">—</span>
        ),
    },
  ];

  return (
    <div className="space-y-4">
      <OpportunityFilters value={filters} onChange={handleFiltersChange} />
      <Table
        columns={columns}
        data={filtered}
        rowKey={(row) => row.id}
        isLoading={isLoading}
        onRowClick={(row) => router.push(`/opportunities/${row.id}`)}
        initialSort={{ key: "deadline", direction: "asc" }}
        emptyMessage="No opportunities match your filters."
      />
    </div>
  );
}
