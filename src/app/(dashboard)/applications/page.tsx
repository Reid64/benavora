"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { KanbanSquare, LayoutList, RefreshCw } from "lucide-react";

import { Button, EmptyState, LoadingSpinner } from "@/components/ui";
import { PageHeader } from "@/components/layout/PageHeader";
import { ApplicationsTable } from "@/components/applications/ApplicationsTable";
import { GroupedKanban } from "@/components/applications/GroupedKanban";
import {
  loadPipelineApplications,
  type EnrichedApplication,
} from "@/components/applications/pipeline";
import { createClient } from "@/lib/supabase/client";
import { canEdit, useProfile } from "@/lib/hooks/useProfile";
import { cn } from "@/lib/utils/cn";

type ViewMode = "table" | "kanban";

export default function ApplicationsPage() {
  const { profile } = useProfile();
  const [applications, setApplications] = useState<EnrichedApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>("table");

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

  const editable = canEdit(profile?.role);
  const showEmpty = !loading && !error && applications.length === 0;

  return (
    <div className="min-h-screen space-y-6 bg-page p-6">
      <PageHeader
        title="Applications"
        description={
          view === "table"
            ? "Sort, filter, and bulk-move applications through the funding pipeline."
            : "Drag cards between groups to move applications to a new phase."
        }
        actions={
          <div className="flex items-center gap-3">
            {/* Renewals link */}
            <Link
              href="/renewals"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 shadow-sm transition hover:bg-slate-50"
            >
              <RefreshCw className="h-4 w-4" aria-hidden />
              Renewals
            </Link>

            {/* View toggle */}
            <div className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
              <button
                type="button"
                onClick={() => setView("table")}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition",
                  view === "table"
                    ? "bg-[#0077B6] text-white"
                    : "text-slate-600 hover:bg-slate-50",
                )}
                aria-current={view === "table" ? "true" : undefined}
              >
                <LayoutList className="h-4 w-4" aria-hidden />
                Table
              </button>
              <button
                type="button"
                onClick={() => setView("kanban")}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition",
                  view === "kanban"
                    ? "bg-[#0077B6] text-white"
                    : "text-slate-600 hover:bg-slate-50",
                )}
                aria-current={view === "kanban" ? "true" : undefined}
              >
                <KanbanSquare className="h-4 w-4" aria-hidden />
                Kanban
              </button>
            </div>
          </div>
        }
      />

      {/* Error */}
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <LoadingSpinner center label="Loading pipeline…" />
      ) : showEmpty ? (
        <EmptyState
          icon={KanbanSquare}
          title="No applications yet"
          description="Create an application from a qualified opportunity to start tracking it through the pipeline."
          action={
            <Link href="/opportunities">
              <Button variant="secondary">Browse opportunities</Button>
            </Link>
          }
        />
      ) : view === "table" ? (
        <ApplicationsTable
          applications={applications}
          role={profile?.role}
          changedBy={profile?.id ?? null}
          onChanged={load}
        />
      ) : (
        <GroupedKanban
          applications={applications}
          interactive={editable}
          role={profile?.role}
          changedBy={profile?.id ?? null}
          onChanged={load}
        />
      )}
    </div>
  );
}
