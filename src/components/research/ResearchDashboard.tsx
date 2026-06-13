"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  CircleAlert,
  Loader2,
  Play,
  Radar,
  Sparkles,
} from "lucide-react";

import {
  Badge,
  Button,
  Card,
  EmptyState,
  LoadingSpinner,
  Select,
} from "@/components/ui";
import type { BadgeColor } from "@/components/ui";
import type { AgentRunStatus, AgentType } from "@/types/agents";
import {
  formatCurrency,
  formatRelative,
  humanizeEnum,
} from "@/lib/utils/formatters";
import type { Enums, Tables } from "@/types/database";

type FunderCategory = Enums<"funder_category">;

/** A research-discovered opportunity, flattened with its funder's name. */
export type ResearchDiscovery = {
  id: string;
  name: string;
  category: FunderCategory;
  amountMin: number | null;
  amountMax: number | null;
  source: string | null;
  discoveredAt: string | null;
  funderName: string | null;
};

/** Live status of one lane in a parallel "Run all" sweep. */
export type ParallelLaneStatus = {
  key: string;
  label: string;
  /** Source-type the lane specializes in (humanized for display). */
  sourceType: string | null;
  status: "running" | "completed" | "failed";
  /** New opportunities created by the lane (once it completes). */
  created?: number;
  /** Opportunities the lane extracted (pre-dedup). */
  found?: number;
  error?: string;
};

/** A recent research agent_runs row, for the activity / status feed. */
export type ResearchRun = {
  id: string;
  agent_type: AgentType;
  /** Coalesced to "pending" by the page when the row's status is null. */
  status: AgentRunStatus;
  output_summary: string | null;
  error_message: string | null;
  started_at: string | null;
};

export type ResearchDashboardProps = {
  profiles: Tables<"search_profiles">[];
  discoveries: ResearchDiscovery[];
  runs: ResearchRun[];
  /** Whether the current role may trigger research runs (BLUEPRINT §3.2). */
  editable: boolean;
  /** Profile whose "Run now" is in flight, if any. */
  runningProfileId: string | null;
  /** Whether the "Run all" trigger is in flight. */
  runningAll: boolean;
  /**
   * Live per-lane status of the current/last parallel sweep. Null until a
   * "Run all active" sweep is triggered; seeded as "running" then filled in
   * from the orchestrator response.
   */
  parallelLanes: ParallelLaneStatus[] | null;
  /** Cross-lane duplicate opportunities removed by the last sweep, if any. */
  duplicatesRemoved: number | null;
  /** Error from the most recent trigger, if any. */
  runError: string | null;
  isLoading: boolean;
  onRunProfile: (profileId: string) => void;
  onRunAll: () => void;
};

const RUN_STATUS_COLOR: Record<AgentRunStatus, BadgeColor> = {
  pending: "yellow",
  running: "blue",
  completed: "green",
  failed: "red",
};

const LANE_STATUS_COLOR: Record<ParallelLaneStatus["status"], BadgeColor> = {
  running: "blue",
  completed: "green",
  failed: "red",
};

const DATE_FILTERS = [
  { value: "all", label: "Any time" },
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
];

/**
 * Research agent dashboard (BLUEPRINT §3.1 "Research"). Two halves:
 *   - Profile cards with per-profile "Run now" controls plus a "Run all"
 *     trigger, and an activity feed showing recent agent runs with live status.
 *   - A discovery feed of recently surfaced opportunities (funder, category,
 *     amount, source) filterable by source / category / date, each linking to
 *     its opportunity detail page.
 *
 * Purely presentational: all data and the run triggers come from the page, which
 * owns the API calls (organization_id is derived server-side, never sent here).
 */
export function ResearchDashboard({
  profiles,
  discoveries,
  runs,
  editable,
  runningProfileId,
  runningAll,
  parallelLanes,
  duplicatesRemoved,
  runError,
  isLoading,
  onRunProfile,
  onRunAll,
}: ResearchDashboardProps) {
  const [sourceFilter, setSourceFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("all");

  const anyRunning = runningAll || runningProfileId !== null;

  // Distinct sources / categories present in the feed, for the filter dropdowns.
  const sourceOptions = useMemo(() => {
    const sources = new Set<string>();
    for (const d of discoveries) if (d.source) sources.add(d.source);
    return [
      { value: "all", label: "All sources" },
      ...Array.from(sources)
        .sort((a, b) => a.localeCompare(b))
        .map((s) => ({ value: s, label: s })),
    ];
  }, [discoveries]);

  const categoryOptions = useMemo(() => {
    const cats = new Set<string>();
    for (const d of discoveries) cats.add(d.category);
    return [
      { value: "all", label: "All categories" },
      ...Array.from(cats)
        .sort((a, b) => a.localeCompare(b))
        .map((c) => ({ value: c, label: humanizeEnum(c) })),
    ];
  }, [discoveries]);

  const filtered = useMemo(() => {
    const now = Date.now();
    const maxAgeMs =
      dateFilter === "all" ? null : Number(dateFilter) * 24 * 60 * 60 * 1000;
    return discoveries.filter((d) => {
      if (sourceFilter !== "all" && d.source !== sourceFilter) return false;
      if (categoryFilter !== "all" && d.category !== categoryFilter) return false;
      if (maxAgeMs != null) {
        const ts = d.discoveredAt ? Date.parse(d.discoveredAt) : NaN;
        if (!Number.isFinite(ts) || now - ts > maxAgeMs) return false;
      }
      return true;
    });
  }, [discoveries, sourceFilter, categoryFilter, dateFilter]);

  if (isLoading) {
    return <LoadingSpinner center label="Loading research dashboard…" />;
  }

  const activeCount = profiles.filter((p) => p.is_active).length;

  return (
    <div className="space-y-8">
      {runError && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {runError}
        </div>
      )}

      {/* Profiles + run controls */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-navy-900">Search profiles</h2>
          {editable && (
            <Button
              onClick={onRunAll}
              isLoading={runningAll}
              disabled={anyRunning || activeCount === 0}
            >
              <Radar className="h-4 w-4" aria-hidden />
              Run all active
            </Button>
          )}
        </div>

        {profiles.length === 0 ? (
          <EmptyState
            icon={Radar}
            title="No search profiles yet"
            description="Create keyword search profiles to tell the research agents what corporate giving to look for."
            action={
              <Link href="/search-profiles">
                <Button variant="secondary">Manage search profiles</Button>
              </Link>
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {profiles.map((profile) => {
              const running = runningProfileId === profile.id;
              return (
                <Card key={profile.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold text-navy-900">
                          {profile.name}
                        </h3>
                        <Badge color={profile.is_active ? "green" : "gray"} withDot>
                          {profile.is_active ? "Active" : "Paused"}
                        </Badge>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {profile.keywords.slice(0, 6).map((keyword) => (
                          <Badge key={keyword} color="blue">
                            {keyword}
                          </Badge>
                        ))}
                      </div>
                      <p className="mt-3 text-xs text-navy-400">
                        {profile.results_count ?? 0} found · last run{" "}
                        {profile.last_run_at
                          ? formatRelative(profile.last_run_at)
                          : "never"}
                      </p>
                    </div>
                    {editable && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => onRunProfile(profile.id)}
                        isLoading={running}
                        disabled={anyRunning || !profile.is_active}
                        title={
                          profile.is_active
                            ? undefined
                            : "Activate this profile to run it."
                        }
                      >
                        <Play className="h-4 w-4" aria-hidden />
                        Run now
                      </Button>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* Parallel execution status (Run all active) */}
      {parallelLanes && parallelLanes.length > 0 && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-navy-900">
              Parallel execution
            </h2>
            {duplicatesRemoved != null && duplicatesRemoved > 0 && (
              <span className="text-xs text-navy-500">
                {duplicatesRemoved} cross-lane duplicate
                {duplicatesRemoved === 1 ? "" : "s"} removed
              </span>
            )}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {parallelLanes.map((lane) => (
              <Card key={lane.key}>
                <div className="flex items-start gap-3">
                  <LaneStatusIcon status={lane.status} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium text-navy-800">
                        {lane.label}
                      </span>
                      <Badge color={LANE_STATUS_COLOR[lane.status]}>
                        {lane.status === "running"
                          ? "Running"
                          : lane.status === "completed"
                            ? "Done"
                            : "Failed"}
                      </Badge>
                      {lane.sourceType && (
                        <Badge color="purple">{humanizeEnum(lane.sourceType)}</Badge>
                      )}
                    </div>
                    <p className="mt-1 truncate text-xs text-navy-500">
                      {lane.status === "completed"
                        ? `${lane.created ?? 0} created · ${lane.found ?? 0} found`
                        : lane.status === "failed"
                          ? (lane.error ?? "Lane failed.")
                          : "Searching…"}
                    </p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* Activity / status feed */}
      {runs.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-navy-900">Recent activity</h2>
          <Card noPadding>
            <div className="divide-y divide-navy-100">
              {runs.map((run) => (
                <div key={run.id} className="flex items-start gap-3 px-4 py-3">
                  <RunStatusIcon status={run.status} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-navy-800">
                        {humanizeEnum(run.agent_type)}
                      </span>
                      <Badge color={RUN_STATUS_COLOR[run.status]}>
                        {humanizeEnum(run.status)}
                      </Badge>
                      <span className="text-xs text-navy-400">
                        {formatRelative(run.started_at)}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-sm text-navy-500">
                      {run.error_message ??
                        run.output_summary ??
                        "Run in progress…"}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </section>
      )}

      {/* Discovery feed */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-navy-900">
            Recent discoveries
          </h2>
          <div className="flex flex-wrap gap-2">
            <div className="w-40">
              <Select
                aria-label="Filter by source"
                options={sourceOptions}
                value={sourceFilter}
                onChange={(e) => setSourceFilter(e.target.value)}
              />
            </div>
            <div className="w-44">
              <Select
                aria-label="Filter by category"
                options={categoryOptions}
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
              />
            </div>
            <div className="w-36">
              <Select
                aria-label="Filter by date"
                options={DATE_FILTERS}
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
              />
            </div>
          </div>
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            icon={Sparkles}
            title="No discoveries yet"
            description={
              discoveries.length === 0
                ? "Run a search profile to discover corporate giving opportunities. New finds will appear here."
                : "No discoveries match the current filters."
            }
          />
        ) : (
          <div className="space-y-3">
            {filtered.map((d) => (
              <Link key={d.id} href={`/opportunities/${d.id}`} className="block">
                <Card className="transition hover:border-teal-300 hover:shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate font-semibold text-navy-900">
                        {d.name}
                      </h3>
                      <p className="mt-0.5 text-sm text-navy-500">
                        {d.funderName ?? "Unknown funder"}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Badge color="teal">{humanizeEnum(d.category)}</Badge>
                        {(d.amountMin != null || d.amountMax != null) && (
                          <span className="text-xs text-navy-500">
                            {formatCurrency(d.amountMin)} -{" "}
                            {formatCurrency(d.amountMax)}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      {d.source && <Badge color="purple">{d.source}</Badge>}
                      <p className="mt-1 text-xs text-navy-400">
                        {formatRelative(d.discoveredAt)}
                      </p>
                    </div>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/** Status glyph for a parallel-execution lane card. */
function LaneStatusIcon({ status }: { status: ParallelLaneStatus["status"] }) {
  if (status === "completed") {
    return (
      <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-500" aria-hidden />
    );
  }
  if (status === "failed") {
    return (
      <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-red-500" aria-hidden />
    );
  }
  return (
    <Loader2
      className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-blue-500"
      aria-hidden
    />
  );
}

/** Status glyph for an agent run row in the activity feed. */
function RunStatusIcon({ status }: { status: AgentRunStatus }) {
  if (status === "completed") {
    return (
      <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-500" aria-hidden />
    );
  }
  if (status === "failed") {
    return (
      <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-red-500" aria-hidden />
    );
  }
  return (
    <Loader2
      className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-blue-500"
      aria-hidden
    />
  );
}
