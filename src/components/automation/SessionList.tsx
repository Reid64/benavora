"use client";

import { ArrowRight, CheckCircle, RotateCw } from "lucide-react";

import { Badge, Button, Table } from "@/components/ui";
import type { TableColumn } from "@/components/ui";
import { formatRelative } from "@/lib/utils/formatters";
import {
  STATUS_COLOR,
  STATUS_LABEL,
  type AutomationSessionListItem,
} from "@/components/automation/automation";

export type SessionListProps = {
  sessions: AutomationSessionListItem[];
  isLoading?: boolean;
  /** Open a session's detail view. */
  onOpen: (sessionId: string) => void;
  /** Re-run automation for a session's application (creates a new session). */
  onRerun?: (session: AutomationSessionListItem) => void;
  /** Navigate to approve a session (awaiting_approval only). */
  onApprove?: (session: AutomationSessionListItem) => void;
  /** id of the session currently being re-run, for the button spinner. */
  rerunningApplicationId?: string | null;
  /** Whether the current role may trigger a re-run (viewer is read-only). */
  canRerun?: boolean;
  /** Whether the current role may approve sessions (owner/admin only). */
  canApprove?: boolean;
  emptyMessage?: string;
};

/**
 * Table of automation sessions (BLUEPRINT §Phase 3 components - SessionList).
 * Columns: Application, Funder, Status, Steps, Created, Actions. Status badges
 * use the colors mapped from the automation_status enum.
 */
export function SessionList({
  sessions,
  isLoading = false,
  onOpen,
  onRerun,
  onApprove,
  rerunningApplicationId = null,
  canRerun = false,
  canApprove = false,
  emptyMessage = "No automation sessions yet.",
}: SessionListProps) {
  const columns: TableColumn<AutomationSessionListItem>[] = [
    {
      key: "opportunity",
      header: "Application",
      sortable: true,
      sortValue: (row) => (row.opportunityName ?? "").toLowerCase(),
      render: (row) => (
        <div className="min-w-0">
          <span className="block truncate font-medium text-navy-900">
            {row.opportunityName ?? "Untitled application"}
          </span>
          {row.targetUrl && (
            <span className="mt-0.5 block truncate text-xs text-navy-500">
              {row.targetUrl}
            </span>
          )}
        </div>
      ),
    },
    {
      key: "funder",
      header: "Funder",
      sortable: true,
      sortValue: (row) => (row.funderName ?? "").toLowerCase(),
      render: (row) =>
        row.funderName ? (
          <span className="text-navy-700">{row.funderName}</span>
        ) : (
          <span className="text-navy-400">-</span>
        ),
    },
    {
      key: "status",
      header: "Status",
      sortable: true,
      sortValue: (row) => STATUS_LABEL[row.status],
      render: (row) => (
        <Badge color={STATUS_COLOR[row.status]} withDot>
          {STATUS_LABEL[row.status]}
        </Badge>
      ),
    },
    {
      key: "steps",
      header: "Steps",
      align: "center",
      sortable: true,
      sortValue: (row) => row.stepCount,
      render: (row) => <span className="text-navy-600">{row.stepCount}</span>,
    },
    {
      key: "created",
      header: "Created",
      sortable: true,
      sortValue: (row) => row.createdAt,
      render: (row) => (
        <span className="text-navy-600">{formatRelative(row.createdAt)}</span>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (row) => (
        <div className="flex items-center justify-end gap-2">
          {canApprove && onApprove && row.status === "awaiting_approval" && (
            <Button
              variant="primary"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onApprove(row);
              }}
            >
              <CheckCircle className="h-4 w-4" aria-hidden />
              Approve
            </Button>
          )}
          {canRerun && onRerun && row.applicationId && row.status === "failed" && (
            <Button
              variant="ghost"
              size="sm"
              isLoading={rerunningApplicationId === row.applicationId}
              onClick={(e) => {
                e.stopPropagation();
                onRerun(row);
              }}
            >
              <RotateCw className="h-4 w-4" aria-hidden />
              Retry
            </Button>
          )}
          {canRerun && onRerun && row.applicationId && row.status !== "failed" && (
            <Button
              variant="ghost"
              size="sm"
              isLoading={rerunningApplicationId === row.applicationId}
              onClick={(e) => {
                e.stopPropagation();
                onRerun(row);
              }}
            >
              <RotateCw className="h-4 w-4" aria-hidden />
              Re-run
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={() => onOpen(row.id)}>
            View
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <Table
      columns={columns}
      data={sessions}
      rowKey={(row) => row.id}
      isLoading={isLoading}
      onRowClick={(row) => onOpen(row.id)}
      initialSort={{ key: "created", direction: "desc" }}
      emptyMessage={emptyMessage}
    />
  );
}
