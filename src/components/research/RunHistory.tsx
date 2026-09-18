"use client";

import { Badge, Table } from "@/components/ui";
import type { BadgeColor, TableColumn } from "@/components/ui";
import type { AgentRunStatus, AgentType } from "@/types/agents";
import { formatRelative, humanizeEnum } from "@/lib/utils/formatters";

/** One agent_runs row as returned by /api/agents/research/status. */
export type AgentRunRecord = {
  id: string;
  agent_type: AgentType;
  status: AgentRunStatus | null;
  items_found: number | null;
  items_processed: number | null;
  duration_ms: number | null;
  error_message: string | null;
  created_at: string | null;
};

export type RunHistoryProps = {
  runs: AgentRunRecord[];
  isLoading: boolean;
};

const STATUS_COLOR: Record<AgentRunStatus, BadgeColor> = {
  pending: "gray",
  running: "blue",
  completed: "green",
  failed: "red",
  skipped: "gray",
};

/** Format a duration in ms as a compact label. */
function formatDuration(ms: number | null): string {
  if (ms == null) return "-";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Agent run history (AGENTS.md §15). Shows the organization's recent research
 * agent runs - status, items found/processed, duration, and any error - in a
 * sortable, paginated table. Presentational: the page fetches the rows from the
 * status endpoint (organization_id derived server-side, never sent here).
 */
export function RunHistory({ runs, isLoading }: RunHistoryProps) {
  const columns: TableColumn<AgentRunRecord>[] = [
    {
      key: "agent_type",
      header: "Agent",
      render: (r) => (
        <span className="font-medium text-navy-800">
          {humanizeEnum(r.agent_type)}
        </span>
      ),
      sortable: true,
      sortValue: (r) => r.agent_type,
    },
    {
      key: "status",
      header: "Status",
      render: (r) => {
        const status = r.status ?? "pending";
        return <Badge color={STATUS_COLOR[status]}>{humanizeEnum(status)}</Badge>;
      },
      sortable: true,
      sortValue: (r) => r.status ?? "pending",
    },
    {
      key: "items",
      header: "Found / processed",
      align: "right",
      render: (r) => (
        <span className="tabular-nums text-navy-600">
          {r.items_found ?? 0} / {r.items_processed ?? 0}
        </span>
      ),
      sortable: true,
      sortValue: (r) => r.items_found ?? 0,
    },
    {
      key: "duration_ms",
      header: "Duration",
      align: "right",
      render: (r) => (
        <span className="tabular-nums text-navy-600">
          {formatDuration(r.duration_ms)}
        </span>
      ),
      sortable: true,
      sortValue: (r) => r.duration_ms ?? 0,
    },
    {
      key: "created_at",
      header: "When",
      render: (r) => (
        <span className="text-navy-500">{formatRelative(r.created_at)}</span>
      ),
      sortable: true,
      sortValue: (r) => (r.created_at ? Date.parse(r.created_at) : 0),
    },
    {
      key: "error_message",
      header: "Detail",
      render: (r) =>
        r.error_message ? (
          <span className="text-red-600" title={r.error_message}>
            {r.error_message}
          </span>
        ) : (
          <span className="text-navy-300">-</span>
        ),
    },
  ];

  return (
    <Table
      columns={columns}
      data={runs}
      rowKey={(r) => r.id}
      pageSize={10}
      isLoading={isLoading}
      initialSort={{ key: "created_at", direction: "desc" }}
      emptyMessage="No agent runs yet. Run a search profile or wait for the scheduled sweep."
    />
  );
}
