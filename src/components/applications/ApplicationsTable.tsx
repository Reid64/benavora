"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp, ChevronsUpDown, Copy, ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/Button";
import {
  STAGE_LABEL,
  getTransitionRule,
  canMoveToStage,
  isUrgentDeadline,
  stagePillClassName,
  stagePillStyle,
  stagePillBadgeClass,
  type EnrichedApplication,
  type PipelineStage,
  executeTransition,
} from "@/components/applications/pipeline";
import { formatCurrency, formatDate } from "@/lib/utils/formatters";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";
import type { Tables } from "@/types/database";

// ── Group definitions ──────────────────────────────────────────────────────

type StageGroup = "discovery" | "preparation" | "active" | "outcome";

const GROUPS: { key: StageGroup; label: string; stages: PipelineStage[] }[] = [
  {
    key: "discovery",
    label: "Discovery",
    stages: ["discovered", "eligibility_review", "qualified"],
  },
  {
    key: "preparation",
    label: "Preparation",
    stages: ["drafting", "awaiting_documents", "ready_for_review"],
  },
  {
    key: "active",
    label: "Active",
    stages: ["submitted", "follow_up_due"],
  },
  {
    key: "outcome",
    label: "Outcome",
    stages: ["awarded", "denied", "reporting_required", "renewal_opportunity"],
  },
];

function stageGroup(stage: PipelineStage): StageGroup {
  for (const g of GROUPS) {
    if ((g.stages as readonly string[]).includes(stage)) return g.key;
  }
  return "discovery";
}

// ── Deadline urgency ───────────────────────────────────────────────────────

function DeadlineCell({ deadline }: { deadline: string | null }) {
  if (!deadline) return <span className="text-slate-400">—</span>;
  const urgent = isUrgentDeadline(deadline);
  return (
    <span className={urgent ? "text-[#EF4444] font-medium" : "text-slate-400"}>
      {formatDate(deadline)}
    </span>
  );
}

// ── Sort ───────────────────────────────────────────────────────────────────

type SortKey =
  | "opportunityName"
  | "funderName"
  | "amount"
  | "stage"
  | "deadline"
  | "updatedAt";
type SortDir = "asc" | "desc";

function sortValue(app: EnrichedApplication, key: SortKey): string | number {
  switch (key) {
    case "opportunityName":
      return (app.opportunityName ?? "").toLowerCase();
    case "funderName":
      return (app.funderName ?? "").toLowerCase();
    case "amount":
      return app.requested_amount ?? 0;
    case "stage":
      return app.stage;
    case "deadline":
      return app.deadline ?? "9999-12-31";
    case "updatedAt":
      return app.updated_at;
    default:
      return "";
  }
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ChevronsUpDown className="h-3.5 w-3.5 text-slate-300" aria-hidden />;
  return dir === "asc"
    ? <ChevronUp className="h-3.5 w-3.5" aria-hidden />
    : <ChevronDown className="h-3.5 w-3.5" aria-hidden />;
}

function SortHeader({
  label,
  sortKey,
  active,
  dir,
  onClick,
  className,
}: {
  label: string;
  sortKey: SortKey;
  active: boolean;
  dir: SortDir;
  onClick: (k: SortKey) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onClick(sortKey)}
      className={cn(
        "inline-flex items-center gap-1 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 transition hover:text-slate-700",
        className,
      )}
    >
      {label}
      <SortIcon active={active} dir={dir} />
    </button>
  );
}


// ── Main component ─────────────────────────────────────────────────────────

export type ApplicationsTableProps = {
  applications: EnrichedApplication[];
  role: Tables<"profiles">["role"] | undefined;
  changedBy: string | null;
  onChanged: () => void;
  /** Opens the clone-to-new-opportunity modal for this application. */
  onClone?: (application: EnrichedApplication) => void;
};

export function ApplicationsTable({
  applications,
  role,
  changedBy,
  onChanged,
  onClone,
}: ApplicationsTableProps) {
  const router = useRouter();

  // Filter
  const [groupFilter, setGroupFilter] = useState<StageGroup | "all">("all");

  // Sort
  const [sortKey, setSortKey] = useState<SortKey>("updatedAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // Selection
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Bulk action
  const [bulkTargetStage, setBulkTargetStage] = useState<PipelineStage | "">("");
  const [bulkResults, setBulkResults] = useState<{ name: string; ok: boolean; err?: string }[]>([]);
  const [bulkRunning, setBulkRunning] = useState(false);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
    setSelected(new Set());
  }

  const filtered = useMemo(() => {
    const base =
      groupFilter === "all"
        ? applications
        : applications.filter((a) => stageGroup(a.stage) === groupFilter);

    return [...base].sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      const factor = sortDir === "asc" ? 1 : -1;
      if (av < bv) return -1 * factor;
      if (av > bv) return 1 * factor;
      return 0;
    });
  }, [applications, groupFilter, sortKey, sortDir]);

  const allSelected = filtered.length > 0 && filtered.every((a) => selected.has(a.id));

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((a) => a.id)));
    }
  }

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const selectedApps = filtered.filter((a) => selected.has(a.id));

  async function executeBulk() {
    if (!bulkTargetStage) return;
    const apps = selectedApps;
    if (apps.length === 0) return;
    setBulkRunning(true);
    setBulkResults([]);
    const supabase = createClient();
    const target = bulkTargetStage as PipelineStage;
    const results: { name: string; ok: boolean; err?: string }[] = [];
    if (!canMoveToStage(target, role)) {
      setBulkResults([{ name: "All selected", ok: false, err: "Only owners and admins can move applications to Submitted." }]);
      setBulkRunning(false);
      return;
    }
    for (const app of apps) {
      const rule = getTransitionRule(app.stage, target);
      if (!rule.allowed) {
        results.push({
          name: app.opportunityName ?? "Untitled",
          ok: false,
          err: rule.reason ?? "Transition not allowed",
        });
        continue;
      }
      try {
        await executeTransition({
          supabase,
          application: app,
          target,
          condition: rule.condition,
          changedBy,
          note: null,
        });
        results.push({ name: app.opportunityName ?? "Untitled", ok: true });
      } catch (err) {
        results.push({
          name: app.opportunityName ?? "Untitled",
          ok: false,
          err: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }
    setBulkResults(results);
    setBulkRunning(false);
    setSelected(new Set());
    setBulkTargetStage("");
    onChanged();
  }

  const sortProps = { dir: sortDir, onClick: handleSort };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Group filter */}
        <div className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-surface p-1 shadow-sm">
          {(["all", "discovery", "preparation", "active", "outcome"] as const).map((g) => {
            const label =
              g === "all"
                ? "All"
                : GROUPS.find((x) => x.key === g)?.label ?? g;
            return (
              <button
                key={g}
                type="button"
                onClick={() => {
                  setGroupFilter(g);
                  setSelected(new Set());
                }}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium transition",
                  groupFilter === g
                    ? "bg-[#0077B6] text-white"
                    : "text-slate-600 hover:bg-slate-50",
                )}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* Bulk action bar */}
        {selectedApps.length > 0 && (
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-surface px-3 py-1.5 shadow-sm">
            <span className="text-sm text-slate-600">
              {selectedApps.length} selected
            </span>
            <select
              value={bulkTargetStage}
              onChange={(e) => setBulkTargetStage(e.target.value as PipelineStage | "")}
              className="rounded border border-slate-200 bg-surface px-2 py-1 text-sm text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0077B6]"
            >
              <option value="">Move to stage…</option>
              {(Object.keys(STAGE_LABEL) as PipelineStage[]).map((s) => (
                <option key={s} value={s}>
                  {STAGE_LABEL[s]}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              variant="secondary"
              onClick={executeBulk}
              disabled={!bulkTargetStage || bulkRunning}
            >
              {bulkRunning ? "Moving…" : "Apply"}
            </Button>
          </div>
        )}
      </div>

      {/* Bulk results */}
      {bulkResults.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
          {bulkResults.map((r, i) => (
            <p key={i} className={r.ok ? "text-green-700" : "text-red-700"}>
              {r.ok ? "✓" : "✗"} {r.name}
              {r.err ? ` — ${r.err}` : ""}
            </p>
          ))}
          <button
            type="button"
            className="mt-2 text-xs text-slate-500 underline"
            onClick={() => setBulkResults([])}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Sort header */}
      {filtered.length > 0 && (
        <div className="flex items-center gap-4 rounded-xl border border-border bg-surface px-5 py-2.5 shadow-sm table-header-dark">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={toggleAll}
            className="h-4 w-4 shrink-0 rounded border-slate-300 text-[#0077B6] focus:ring-[#0077B6]"
            aria-label="Select all"
          />
          <SortHeader label="Opportunity" sortKey="opportunityName" {...sortProps} active={sortKey === "opportunityName"} className="min-w-0 flex-1" />
          <SortHeader label="Funder" sortKey="funderName" {...sortProps} active={sortKey === "funderName"} className="hidden w-40 shrink-0 sm:inline-flex" />
          <SortHeader label="Amount" sortKey="amount" {...sortProps} active={sortKey === "amount"} className="w-28 shrink-0 justify-end" />
          <SortHeader label="Stage" sortKey="stage" {...sortProps} active={sortKey === "stage"} className="hidden w-44 shrink-0 md:inline-flex" />
          <SortHeader label="Deadline" sortKey="deadline" {...sortProps} active={sortKey === "deadline"} className="hidden w-24 shrink-0 lg:inline-flex" />
          <SortHeader label="Updated" sortKey="updatedAt" {...sortProps} active={sortKey === "updatedAt"} className="hidden w-24 shrink-0 lg:inline-flex" />
          <span className="w-28 shrink-0" aria-hidden />
        </div>
      )}

      {/* Row cards */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface p-12 text-center text-sm text-slate-500 shadow-sm">
          No applications in this group.
        </div>
      ) : (
        <div>
          {filtered.map((app) => (
            <div
              key={app.id}
              onClick={() => router.push(`/applications/${app.id}`)}
              className="flex cursor-pointer items-center gap-4 rounded-xl border border-border bg-surface p-5 mb-3 shadow-sm transition-shadow hover:shadow-md"
            >
              <input
                type="checkbox"
                checked={selected.has(app.id)}
                onChange={() => toggleRow(app.id)}
                onClick={(e) => e.stopPropagation()}
                className="h-4 w-4 shrink-0 rounded border-slate-300 text-[#0077B6] focus:ring-[#0077B6]"
                aria-label={`Select ${app.opportunityName ?? "application"}`}
              />

              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-semibold text-slate-900">
                  {app.opportunityName ?? "Untitled opportunity"}
                </p>
                <p className="mt-0.5 truncate text-sm text-slate-500 sm:hidden">
                  {app.funderName ?? "—"}
                </p>
              </div>

              <p className="hidden w-40 shrink-0 truncate text-sm text-slate-500 sm:block">
                {app.funderName ?? <span className="text-slate-400">—</span>}
              </p>

              <p className="w-28 shrink-0 text-right text-sm font-medium text-slate-700">
                {formatCurrency(app.requested_amount)}
              </p>

              <div className="hidden w-44 shrink-0 md:block">
                <span
                  className={cn(stagePillClassName(app.stage), stagePillBadgeClass(app.stage))}
                  style={stagePillStyle(app.stage)}
                >
                  {STAGE_LABEL[app.stage]}
                </span>
              </div>

              <div className="hidden w-24 shrink-0 text-sm lg:block">
                <DeadlineCell deadline={app.deadline} />
              </div>

              <p className="hidden w-24 shrink-0 text-sm text-slate-400 lg:block">
                {formatDate(app.updated_at)}
              </p>

              <div
                className="flex w-28 shrink-0 items-center justify-end gap-3 text-right"
                onClick={(e) => e.stopPropagation()}
              >
                {onClone && (
                  <button
                    type="button"
                    onClick={() => onClone(app)}
                    className="inline-flex items-center gap-1 text-xs text-slate-500 transition hover:text-[#0077B6]"
                    aria-label="Clone application to a new opportunity"
                  >
                    <Copy className="h-3.5 w-3.5" aria-hidden />
                    Clone
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => router.push(`/applications/${app.id}`)}
                  className="inline-flex items-center gap-1 text-xs text-[#0077B6] transition hover:text-[#005F92]"
                  aria-label="Open application"
                >
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                  View
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
