"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Badge, SearchBar, Select, Table } from "@/components/ui";
import type { TableColumn } from "@/components/ui";
import { ApplicationsViewToggle } from "@/components/applications/ApplicationsViewToggle";
import { useUrlState } from "@/lib/hooks/useUrlState";
import {
  STAGE_COLOR,
  STAGE_LABEL,
  daysInStage,
  loadPipelineApplications,
  type EnrichedApplication,
} from "@/components/applications/pipeline";
import { createClient } from "@/lib/supabase/client";
import { PIPELINE_STAGES } from "@/lib/utils/constants";
import { formatCurrency, formatDate, formatRelative } from "@/lib/utils/formatters";

/**
 * Applications list view (BLUEPRINT §4.5) - the table alternative to the kanban
 * board. Supports keyword search and a stage filter; clicking a row opens the
 * application detail. Reads are RLS-scoped to the organization.
 */
export default function ApplicationsListPage() {
  const router = useRouter();
  const { searchParams, setParams } = useUrlState();
  const [applications, setApplications] = useState<EnrichedApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Search and stage filter live in the URL so they survive navigation back to
  // the board view and the sidebar.
  const query = searchParams.get("q") ?? "";
  const stageParam = searchParams.get("stage");
  const stage =
    stageParam && (PIPELINE_STAGES as readonly string[]).includes(stageParam)
      ? stageParam
      : "all";

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await loadPipelineApplications(createClient());
      setApplications(rows);
    } catch {
      setError("Could not load applications.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return applications.filter((app) => {
      if (stage !== "all" && app.stage !== stage) return false;
      if (!q) return true;
      return (
        (app.opportunityName?.toLowerCase().includes(q) ?? false) ||
        (app.funderName?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [applications, query, stage]);

  const columns: TableColumn<EnrichedApplication>[] = [
    {
      key: "opportunity",
      header: "Opportunity",
      sortable: true,
      sortValue: (row) => row.opportunityName?.toLowerCase() ?? "",
      render: (row) => (
        <div className="min-w-0">
          <span className="font-medium text-navy-900">
            {row.opportunityName ?? "Untitled opportunity"}
          </span>
          {row.funderName && (
            <span className="mt-0.5 block text-xs text-navy-500">
              {row.funderName}
            </span>
          )}
        </div>
      ),
    },
    {
      key: "stage",
      header: "Stage",
      sortable: true,
      sortValue: (row) => PIPELINE_STAGES.indexOf(row.stage),
      render: (row) => (
        <Badge color={STAGE_COLOR[row.stage]}>{STAGE_LABEL[row.stage]}</Badge>
      ),
    },
    {
      key: "amount",
      header: "Requested",
      align: "right",
      sortable: true,
      sortValue: (row) => row.requested_amount ?? 0,
      render: (row) =>
        row.requested_amount != null ? (
          formatCurrency(row.requested_amount)
        ) : (
          <span className="text-navy-400">-</span>
        ),
    },
    {
      key: "deadline",
      header: "Deadline",
      sortable: true,
      sortValue: (row) => row.deadline ?? "9999",
      render: (row) =>
        row.deadline ? (
          formatDate(row.deadline)
        ) : (
          <span className="text-navy-400">-</span>
        ),
    },
    {
      key: "days_in_stage",
      header: "Days in stage",
      align: "right",
      sortable: true,
      sortValue: (row) => daysInStage(row.stageEnteredAt),
      render: (row) => daysInStage(row.stageEnteredAt),
    },
    {
      key: "updated",
      header: "Updated",
      sortable: true,
      sortValue: (row) => row.updated_at,
      render: (row) => formatRelative(row.updated_at),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-navy-900">
            Applications
          </h1>
          <p className="mt-1 text-sm text-navy-500">
            Every application in your pipeline, as a sortable list.
          </p>
        </div>
        <ApplicationsViewToggle active="list" />
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchBar
          defaultValue={query}
          onSearch={(value) => setParams({ q: value || null })}
          placeholder="Search by opportunity or funder..."
          aria-label="Search applications"
          className="sm:max-w-sm"
        />
        <Select
          aria-label="Filter by stage"
          value={stage}
          onChange={(e) =>
            setParams({ stage: e.target.value === "all" ? null : e.target.value })
          }
          className="sm:w-56"
          options={[
            { label: "All stages", value: "all" },
            ...PIPELINE_STAGES.map((s) => ({
              label: STAGE_LABEL[s],
              value: s,
            })),
          ]}
        />
      </div>

      <Table
        columns={columns}
        data={filtered}
        rowKey={(row) => row.id}
        isLoading={loading}
        onRowClick={(row) => router.push(`/applications/${row.id}`)}
        initialSort={{ key: "updated", direction: "desc" }}
        emptyMessage="No applications match your filters."
      />
    </div>
  );
}
