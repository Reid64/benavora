"use client";

import { useMemo } from "react";
import type { CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { LayoutGrid, List } from "lucide-react";

import { Badge, Table } from "@/components/ui";
import type { BadgeVariant, TableColumn } from "@/components/ui";
import {
  EligibilityBar,
  HighPriorityBadge,
  MatchBadge,
  OPPORTUNITY_STATUS_VARIANT,
  RecommendationBadge,
} from "@/components/opportunities/eligibility";
import {
  OpportunityFilters,
  type OpportunityFilterValue,
} from "@/components/opportunities/OpportunityFilters";
import { OpportunityCard } from "@/components/opportunities/OpportunityCard";
import { SourceTypeBadge } from "@/components/opportunities/SourceTypeBadge";
import {
  SourceTypeTabs,
  type SourceTypeTabValue,
} from "@/components/opportunities/SourceTypeTabs";
import { useUrlState } from "@/lib/hooks/useUrlState";
import {
  isOpportunitySourceType,
  type OpportunitySourceType,
} from "@/lib/opportunities/source-type";
import {
  FUNDER_CATEGORIES,
  OPPORTUNITY_SOURCE_TYPES,
  OPPORTUNITY_STATUSES,
} from "@/lib/utils/constants";
import { cn } from "@/lib/utils/cn";
import { decodeHtmlEntities, formatCurrency, formatDate, humanizeEnum } from "@/lib/utils/formatters";
import type { Enums, Tables } from "@/types/database";

/** An opportunity enriched with its keyword tags and funder name for the list. */
export type OpportunityRow = Tables<"opportunities"> & {
  keywords: string[];
  funderName: string | null;
  /** Stage of the most recent application for this opportunity, if any. */
  applicationStage?: string | null;
  /** Grant Probability Engine score (opportunity_probability_scores.overall_score), 0-100. */
  probabilityScore?: number | null;
};

const PROBABILITY_BADGE_STYLE: Record<"green" | "amber" | "red" | "gray", CSSProperties> = {
  green: { backgroundColor: "#10B981", color: "#FFFFFF" },
  amber: { backgroundColor: "#F59E0B", color: "#FFFFFF" },
  red: { backgroundColor: "#EF4444", color: "#FFFFFF" },
  gray: { backgroundColor: "#9CA3AF", color: "#FFFFFF" },
};

/** Colored badge for a Grant Probability Engine score (green 70+, amber 40-69, red <40, gray unscored). */
export function ProbabilityBadge({ score }: { score: number | null | undefined }) {
  const tone: "green" | "amber" | "red" | "gray" =
    score == null ? "gray" : score >= 70 ? "green" : score >= 40 ? "amber" : "red";
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold"
      style={PROBABILITY_BADGE_STYLE[tone]}
    >
      {score == null ? "Not scored" : `${Math.round(score)}%`}
    </span>
  );
}

/** Map an application stage to a coarse application-status label + variant. */
function applicationStatusLabel(stage: string | null | undefined): {
  label: string;
  variant: BadgeVariant;
} {
  if (!stage) return { label: "Not Applied", variant: "neutral" };
  if (stage === "submitted") return { label: "Submitted", variant: "info" };
  if (stage === "awarded") return { label: "Awarded", variant: "success" };
  if (stage === "denied") return { label: "Denied", variant: "error" };
  return { label: `In Progress: ${humanizeEnum(stage)}`, variant: "warning" };
}

export type OpportunityTableProps = {
  opportunities: OpportunityRow[];
  isLoading?: boolean;
  /** Initial/forced sort column and direction. Defaults to Probability, High to Low. */
  defaultSort?: { key: string; direction: "asc" | "desc" };
};

type ViewMode = "table" | "cards";

/** Lexicographic YYYY-MM-DD compare works because ISO dates sort that way. */
function deadlineDay(deadline: string | null): string {
  return deadline ? deadline.slice(0, 10) : "";
}

/**
 * Opportunity list with the full filter set (BLUEPRINT §4.4): source-type tabs,
 * keyword search, category, status, deadline range, and eligibility-score range.
 * Renders as a sortable table or a card grid (the view toggle). Filtering and
 * sorting run client-side over the provided rows; selecting a row/card opens
 * detail. All filter + view state lives in the URL so it survives navigation.
 */
const DEFAULT_SORT = { key: "probability", direction: "desc" as const };

export function OpportunityTable({
  opportunities,
  isLoading = false,
  defaultSort = DEFAULT_SORT,
}: OpportunityTableProps) {
  const router = useRouter();
  const { searchParams, setParams } = useUrlState();

  const view: ViewMode = searchParams.get("view") === "cards" ? "cards" : "table";

  // The full filter set lives in the URL so it survives sidebar navigation and
  // refresh. Enum-typed params are validated against their allowed values so a
  // hand-edited URL can't wedge the list into showing nothing.
  const filters: OpportunityFilterValue = useMemo(() => {
    const categoryParam = searchParams.get("category");
    const statusParam = searchParams.get("status");
    const sourceParam = searchParams.get("source");
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
      sourceType: isOpportunitySourceType(sourceParam) ? sourceParam : "all",
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
      source: next.sourceType === "all" ? null : next.sourceType,
      from: next.deadlineFrom || null,
      to: next.deadlineTo || null,
      min: next.scoreMin || null,
      max: next.scoreMax || null,
    });
  }

  // Source-type counts across the unfiltered list, for the tab badges.
  const sourceCounts = useMemo(() => {
    const counts = Object.fromEntries(
      OPPORTUNITY_SOURCE_TYPES.map((type) => [type, 0]),
    ) as Record<OpportunitySourceType, number>;
    for (const opp of opportunities) {
      if (opp.source_type) counts[opp.source_type] += 1;
    }
    return counts;
  }, [opportunities]);

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
      if (
        filters.sourceType !== "all" &&
        opp.source_type !== filters.sourceType
      ) {
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
      key: "probability",
      header: "Probability",
      sortable: true,
      // Unscored rows sort below scored ones.
      sortValue: (row) => row.probabilityScore ?? -1,
      render: (row) => <ProbabilityBadge score={row.probabilityScore} />,
    },
    {
      key: "name",
      header: "Name",
      sortable: true,
      sortValue: (row) => decodeHtmlEntities(row.name).toLowerCase(),
      render: (row) => (
        <div className="min-w-0">
          <span className="font-medium text-navy-900">{decodeHtmlEntities(row.name)}</span>
          {row.funderName && (
            <span className="mt-0.5 block text-xs text-navy-500">
              {row.funderName}
            </span>
          )}
        </div>
      ),
    },
    {
      key: "source_type",
      header: "Source",
      sortable: true,
      sortValue: (row) => row.source_type ?? "",
      render: (row) =>
        row.source_type ? (
          <SourceTypeBadge sourceType={row.source_type} />
        ) : (
          <span className="text-navy-400">-</span>
        ),
    },
    {
      key: "category",
      header: "Category",
      sortable: true,
      sortValue: (row) => row.category,
      render: (row) => <Badge variant="neutral">{humanizeEnum(row.category)}</Badge>,
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
          <span className="text-navy-400">-</span>
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
          <span className="font-semibold text-slate-900">
            {formatCurrency(row.amount_max ?? row.amount_available)}
          </span>
        ) : (
          <span className="text-navy-400">-</span>
        ),
    },
    {
      key: "match",
      header: "Match",
      sortable: true,
      // Unscored rows sort below scored ones.
      sortValue: (row) => row.match_percentage ?? -1,
      render: (row) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <MatchBadge percentage={row.match_percentage} />
          {row.is_high_priority && <HighPriorityBadge />}
        </div>
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
          <span className="text-navy-400">-</span>
        ),
    },
    {
      key: "status",
      header: "Status",
      sortable: true,
      sortValue: (row) => row.status ?? "",
      render: (row) => {
        if (!row.status) return <span className="text-navy-400">-</span>;
        if (row.status === "open") {
          return (
            <span className="inline-flex items-center rounded-full bg-[#DCFCE7] px-2.5 py-1 text-xs font-semibold text-[#15803D] badge-green">
              {humanizeEnum(row.status)}
            </span>
          );
        }
        if (row.status === "closed") {
          return (
            <span className="inline-flex items-center rounded-full bg-[#FEE2E2] px-2.5 py-1 text-xs font-semibold text-[#B91C1C] badge-red">
              {humanizeEnum(row.status)}
            </span>
          );
        }
        return (
          <Badge variant={OPPORTUNITY_STATUS_VARIANT[row.status]}>
            {humanizeEnum(row.status)}
          </Badge>
        );
      },
    },
    {
      key: "application",
      header: "Application",
      sortable: true,
      sortValue: (row) => row.applicationStage ?? "",
      render: (row) => {
        if (!row.applicationStage) {
          return (
            <span className="rounded-full bg-[#F1F5F9] px-2.5 py-1 text-xs font-medium text-slate-500">
              Not Applied
            </span>
          );
        }
        const s = applicationStatusLabel(row.applicationStage);
        return <Badge variant={s.variant}>{s.label}</Badge>;
      },
    },
  ];

  // The card grid has no per-column sort, so it mirrors the table's current
  // default sort column (Probability, High to Low unless overridden).
  const sortedForCards = useMemo(() => {
    const column = columns.find((c) => c.key === defaultSort.key);
    if (!column?.sortValue) return filtered;
    const accessor = column.sortValue;
    const factor = defaultSort.direction === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = accessor(a);
      const bv = accessor(b);
      if (av < bv) return -1 * factor;
      if (av > bv) return 1 * factor;
      return 0;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, defaultSort.key, defaultSort.direction]);

  return (
    <div className="space-y-4">
      <SourceTypeTabs
        value={filters.sourceType}
        counts={sourceCounts}
        total={opportunities.length}
        onChange={(sourceType: SourceTypeTabValue) =>
          handleFiltersChange({ ...filters, sourceType })
        }
      />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1">
          <OpportunityFilters value={filters} onChange={handleFiltersChange} />
        </div>
        <ViewToggle view={view} onChange={(v) => setParams({ view: v === "table" ? null : v })} />
      </div>

      {view === "cards" ? (
        <CardGrid
          opportunities={sortedForCards}
          isLoading={isLoading}
          isEmpty={!isLoading && sortedForCards.length === 0}
        />
      ) : (
        <Table
          columns={columns}
          data={filtered}
          rowKey={(row) => row.id}
          isLoading={isLoading}
          onRowClick={(row) => router.push(`/opportunities/${row.id}`)}
          initialSort={defaultSort}
          emptyMessage="No opportunities match your filters."
          tableClassName="min-w-[700px] divide-y divide-slate-200"
          theadClassName="bg-sidebar table-header-dark"
        />
      )}
    </div>
  );
}

function ViewToggle({
  view,
  onChange,
}: {
  view: ViewMode;
  onChange: (view: ViewMode) => void;
}) {
  return (
    <div className="inline-flex shrink-0 rounded-lg border border-navy-200 bg-white p-0.5 shadow-sm">
      <button
        type="button"
        onClick={() => onChange("table")}
        aria-pressed={view === "table"}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition",
          view === "table"
            ? "bg-teal-600 text-white"
            : "text-navy-600 hover:bg-navy-50",
        )}
      >
        <List className="h-4 w-4" aria-hidden />
        Table
      </button>
      <button
        type="button"
        onClick={() => onChange("cards")}
        aria-pressed={view === "cards"}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition",
          view === "cards"
            ? "bg-teal-600 text-white"
            : "text-navy-600 hover:bg-navy-50",
        )}
      >
        <LayoutGrid className="h-4 w-4" aria-hidden />
        Cards
      </button>
    </div>
  );
}

function CardGrid({
  opportunities,
  isLoading,
  isEmpty,
}: {
  opportunities: OpportunityRow[];
  isLoading: boolean;
  isEmpty: boolean;
}) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="h-44 animate-pulse rounded-xl border border-navy-200 bg-navy-50"
          />
        ))}
      </div>
    );
  }
  if (isEmpty) {
    return (
      <div className="rounded-xl border border-border bg-white p-10 text-center text-sm text-navy-500 shadow-sm">
        No opportunities match your filters.
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {opportunities.map((opp) => (
        <OpportunityCard key={opp.id} opportunity={opp} />
      ))}
    </div>
  );
}
