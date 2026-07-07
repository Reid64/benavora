"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  ExternalLink,
} from "lucide-react";
import { differenceInCalendarDays } from "date-fns";

import { Badge, type BadgeColor } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  STAGE_LABEL,
  getTransitionRule,
  canMoveToStage,
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

export function stageBadgeColor(stage: PipelineStage): BadgeColor {
  switch (stage) {
    case "discovered":
    case "eligibility_review":
    case "qualified":
      return "blue";
    case "drafting":
    case "awaiting_documents":
    case "ready_for_review":
      return "purple";
    case "submitted":
    case "follow_up_due":
      return "green";
    case "awarded":
      return "green";
    case "denied":
      return "red";
    case "reporting_required":
      return "yellow";
    case "renewal_opportunity":
      return "teal";
    default:
      return "gray";
  }
}

// ── Deadline urgency ───────────────────────────────────────────────────────

function deadlineUrgency(
  deadline: string | null,
): "overdue" | "urgent" | "soon" | "normal" | null {
  if (!deadline) return null;
  const days = differenceInCalendarDays(new Date(deadline), new Date());
  if (days < 0) return "overdue";
  if (days < 7) return "urgent";
  if (days < 30) return "soon";
  return "normal";
}

function DeadlineCell({ deadline }: { deadline: string | null }) {
  if (!deadline) return <span className="text-navy-400">—</span>;
  const urgency = deadlineUrgency(deadline);
  const cls =
    urgency === "overdue"
      ? "text-red-400 font-medium"
      : urgency === "urgent"
        ? "text-warning-text font-medium"
        : urgency === "soon"
          ? "text-yellow-400"
          : "text-navy-600";
  return <span className={cls}>{formatDate(deadline)}</span>;
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
  if (!active) return <ChevronsUpDown className="h-3.5 w-3.5 text-navy-300" aria-hidden />;
  return dir === "asc"
    ? <ChevronUp className="h-3.5 w-3.5" aria-hidden />
    : <ChevronDown className="h-3.5 w-3.5" aria-hidden />;
}

function Th({
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
    <th
      scope="col"
      className={cn("px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-navy-500", className)}
    >
      <button
        type="button"
        onClick={() => onClick(sortKey)}
        className="inline-flex items-center gap-1 transition hover:text-navy-700"
      >
        {label}
        <SortIcon active={active} dir={dir} />
      </button>
    </th>
  );
}


// ── Main component ─────────────────────────────────────────────────────────

export type ApplicationsTableProps = {
  applications: EnrichedApplication[];
  role: Tables<"profiles">["role"] | undefined;
  changedBy: string | null;
  onChanged: () => void;
};

export function ApplicationsTable({
  applications,
  role,
  changedBy,
  onChanged,
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

  const thProps = { active: false, dir: sortDir, onClick: handleSort };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Group filter */}
        <div className="inline-flex items-center gap-1 rounded-lg border border-navy-200 bg-white p-1">
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
                    ? "bg-navy-900 text-white"
                    : "text-navy-600 hover:bg-navy-50",
                )}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* Bulk action bar */}
        {selectedApps.length > 0 && (
          <div className="flex items-center gap-2 rounded-lg border border-navy-200 bg-white px-3 py-1.5">
            <span className="text-sm text-navy-600">
              {selectedApps.length} selected
            </span>
            <select
              value={bulkTargetStage}
              onChange={(e) => setBulkTargetStage(e.target.value as PipelineStage | "")}
              className="rounded border border-navy-200 bg-white px-2 py-1 text-sm text-navy-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
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
        <div className="rounded-lg border border-navy-200 bg-navy-50 px-4 py-3 text-sm">
          {bulkResults.map((r, i) => (
            <p key={i} className={r.ok ? "text-green-700" : "text-red-700"}>
              {r.ok ? "✓" : "✗"} {r.name}
              {r.err ? ` — ${r.err}` : ""}
            </p>
          ))}
          <button
            type="button"
            className="mt-2 text-xs text-navy-500 underline"
            onClick={() => setBulkResults([])}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-navy-200">
        <table className="min-w-full divide-y divide-navy-200">
          <thead className="bg-navy-50">
            <tr>
              <th scope="col" className="w-10 px-4 py-3">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  className="h-4 w-4 rounded border-navy-300 text-teal-600 focus:ring-teal-500"
                  aria-label="Select all"
                />
              </th>
              <Th
                label="Opportunity"
                sortKey="opportunityName"
                {...thProps}
                active={sortKey === "opportunityName"}
              />
              <Th
                label="Funder"
                sortKey="funderName"
                {...thProps}
                active={sortKey === "funderName"}
              />
              <Th
                label="Amount"
                sortKey="amount"
                {...thProps}
                active={sortKey === "amount"}
                className="text-right"
              />
              <Th
                label="Stage"
                sortKey="stage"
                {...thProps}
                active={sortKey === "stage"}
              />
              <Th
                label="Deadline"
                sortKey="deadline"
                {...thProps}
                active={sortKey === "deadline"}
              />
              <Th
                label="Updated"
                sortKey="updatedAt"
                {...thProps}
                active={sortKey === "updatedAt"}
              />
              <th scope="col" className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-navy-500">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-navy-200 bg-white">
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="px-4 py-12 text-center text-sm text-navy-500"
                >
                  No applications in this group.
                </td>
              </tr>
            ) : (
              filtered.map((app) => (
                <tr
                  key={app.id}
                  onClick={() => router.push(`/applications/${app.id}`)}
                  className="cursor-pointer transition hover:bg-navy-50"
                >
                  <td
                    className="w-10 px-4 py-3"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(app.id)}
                      onChange={() => toggleRow(app.id)}
                      className="h-4 w-4 rounded border-navy-300 text-teal-600 focus:ring-teal-500"
                      aria-label={`Select ${app.opportunityName ?? "application"}`}
                    />
                  </td>
                  <td className="max-w-[220px] px-4 py-3">
                    <p className="truncate text-sm font-medium text-navy-900">
                      {app.opportunityName ?? "Untitled opportunity"}
                    </p>
                  </td>
                  <td className="max-w-[160px] px-4 py-3">
                    <p className="truncate text-sm text-navy-600">
                      {app.funderName ?? <span className="text-navy-400">—</span>}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-right text-sm font-medium text-navy-700">
                    {formatCurrency(app.requested_amount)}
                  </td>
                  <td className="px-4 py-3">
                    <Badge color={stageBadgeColor(app.stage)} withDot>
                      {STAGE_LABEL[app.stage]}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <DeadlineCell deadline={app.deadline} />
                  </td>
                  <td className="px-4 py-3 text-sm text-navy-500">
                    {formatDate(app.updated_at)}
                  </td>
                  <td
                    className="px-4 py-3"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={() => router.push(`/applications/${app.id}`)}
                      className="inline-flex items-center gap-1 text-xs text-teal-600 transition hover:text-teal-700"
                      aria-label="Open application"
                    >
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                      View
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

    </div>
  );
}
