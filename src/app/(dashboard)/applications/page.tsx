"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { KanbanSquare, List } from "lucide-react";

import { Button, EmptyState, LoadingSpinner } from "@/components/ui";
import { PipelineBoard } from "@/components/applications/PipelineBoard";
import {
  loadPipelineApplications,
  type EnrichedApplication,
} from "@/components/applications/pipeline";
import { createClient } from "@/lib/supabase/client";
import { canEdit, useProfile } from "@/lib/hooks/useProfile";

/**
 * Applications pipeline board (BLUEPRINT §4.5). Renders the 12-stage kanban
 * board with drag-and-drop transitions. Reads are RLS-scoped to the
 * organization; viewers see a read-only board (no dragging). A toggle links to
 * the alternative list view.
 */
export default function ApplicationsPage() {
  const { profile } = useProfile();
  const [applications, setApplications] = useState<EnrichedApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-navy-900">
            Applications
          </h1>
          <p className="mt-1 text-sm text-navy-500">
            Your funding pipeline. Drag a card to move it between stages.
          </p>
        </div>
        <div className="inline-flex items-center gap-1 rounded-lg border border-navy-200 bg-white p-1 shadow-sm">
          <span className="inline-flex items-center gap-1.5 rounded-md bg-teal-50 px-3 py-1.5 text-sm font-medium text-teal-700">
            <KanbanSquare className="h-4 w-4" aria-hidden />
            Board
          </span>
          <Link
            href="/applications/list"
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-navy-600 transition hover:bg-navy-50"
          >
            <List className="h-4 w-4" aria-hidden />
            List
          </Link>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {loading ? (
        <LoadingSpinner center label="Loading pipeline..." />
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
      ) : (
        <PipelineBoard
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
