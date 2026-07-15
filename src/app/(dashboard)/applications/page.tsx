"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { KanbanSquare, LayoutList, RefreshCw } from "lucide-react";

import { Button, EmptyState, LoadingSpinner, Modal, Select } from "@/components/ui";
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
  const router = useRouter();
  const { profile } = useProfile();
  const [applications, setApplications] = useState<EnrichedApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>("table");

  // Clone-to-new-opportunity modal.
  const [cloneSource, setCloneSource] = useState<EnrichedApplication | null>(null);
  const [opportunityOptions, setOpportunityOptions] = useState<
    { id: string; name: string }[]
  >([]);
  const [targetOpportunityId, setTargetOpportunityId] = useState("");
  const [cloning, setCloning] = useState(false);
  const [cloneError, setCloneError] = useState<string | null>(null);

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

  async function openCloneModal(application: EnrichedApplication) {
    setCloneError(null);
    setTargetOpportunityId("");
    setCloneSource(application);
    if (opportunityOptions.length === 0) {
      const supabase = createClient();
      const { data } = await supabase
        .from("opportunities")
        .select("id, name")
        .order("name");
      setOpportunityOptions(
        ((data ?? []) as { id: string; name: string }[]).map((o) => ({
          id: o.id,
          name: o.name,
        })),
      );
    }
  }

  async function handleClone() {
    if (!cloneSource || !targetOpportunityId) return;
    setCloning(true);
    setCloneError(null);
    try {
      const res = await fetch(`/api/applications/${cloneSource.id}/clone`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetOpportunityId }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        newApplicationId?: string;
        error?: string;
      };
      if (!res.ok) {
        setCloneError(payload.error ?? "Could not clone this application.");
        return;
      }
      setCloneSource(null);
      if (payload.newApplicationId) {
        router.push(`/applications/${payload.newApplicationId}`);
      }
    } catch {
      setCloneError("Could not reach the server. Please try again.");
    } finally {
      setCloning(false);
    }
  }

  const editable = canEdit(profile?.role);
  const showEmpty = !loading && !error && applications.length === 0;

  return (
    <div className="min-h-screen space-y-6 bg-[#CBD5E1] p-6 page-bg">
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
        <LoadingSpinner center label="Loading pipelineâ€¦" />
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
          onClone={openCloneModal}
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

      {/* Clone application */}
      <Modal
        isOpen={cloneSource !== null}
        onClose={() => {
          if (!cloning) setCloneSource(null);
        }}
        title="Clone application"
        description={
          cloneSource
            ? `The latest draft from "${cloneSource.opportunityName ?? "this application"}" will be adapted for the new opportunity.`
            : undefined
        }
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setCloneSource(null)}
              disabled={cloning}
            >
              Cancel
            </Button>
            <Button
              onClick={handleClone}
              isLoading={cloning}
              disabled={!targetOpportunityId}
            >
              Clone
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Select
            label="Target opportunity"
            placeholder="Select an opportunityâ€¦"
            value={targetOpportunityId}
            onChange={(e) => setTargetOpportunityId(e.target.value)}
            options={opportunityOptions.map((o) => ({
              label: o.name,
              value: o.id,
            }))}
          />
          {cloneError && (
            <p role="alert" className="text-sm text-red-600">
              {cloneError}
            </p>
          )}
        </div>
      </Modal>
    </div>
  );
}
