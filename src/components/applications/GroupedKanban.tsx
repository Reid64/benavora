"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { StageTransitionModal } from "@/components/applications/StageTransitionModal";
import {
  STAGE_LABEL,
  isUrgentDeadline,
  stagePillClassName,
  stagePillStyle,
  stagePillBadgeClass,
  type EnrichedApplication,
  type PipelineStage,
} from "@/components/applications/pipeline";
import { formatCurrency, formatDate } from "@/lib/utils/formatters";
import { cn } from "@/lib/utils/cn";
import type { Tables } from "@/types/database";

// ── Group config ───────────────────────────────────────────────────────────

type GroupKey = "discovery" | "preparation" | "active" | "outcome";

const KANBAN_GROUPS: {
  key: GroupKey;
  label: string;
  headerColor: string;
  dotColor: string;
  stages: PipelineStage[];
  firstStage: PipelineStage;
}[] = [
  {
    key: "discovery",
    label: "Discovery",
    headerColor: "text-blue-400",
    dotColor: "bg-blue-400",
    stages: ["discovered", "eligibility_review", "qualified"],
    firstStage: "discovered",
  },
  {
    key: "preparation",
    label: "Preparation",
    headerColor: "text-primary",
    dotColor: "bg-primary",
    stages: ["drafting", "awaiting_documents", "ready_for_review"],
    firstStage: "drafting",
  },
  {
    key: "active",
    label: "Active",
    headerColor: "text-green-400",
    dotColor: "bg-green-500",
    stages: ["submitted", "follow_up_due"],
    firstStage: "submitted",
  },
  {
    key: "outcome",
    label: "Outcome",
    headerColor: "text-amber-400",
    dotColor: "bg-amber-400",
    stages: ["awarded", "denied", "reporting_required", "renewal_opportunity"],
    firstStage: "awarded",
  },
];

function stageGroupKey(stage: PipelineStage): GroupKey {
  for (const g of KANBAN_GROUPS) {
    if ((g.stages as readonly string[]).includes(stage)) return g.key;
  }
  return "discovery";
}

// ── Deadline urgency ───────────────────────────────────────────────────────

function deadlineClass(deadline: string | null): string {
  if (!deadline) return "text-slate-400";
  return isUrgentDeadline(deadline) ? "text-[#EF4444] font-medium" : "text-slate-400";
}

// ── Compact Kanban Card ────────────────────────────────────────────────────

function KanbanCard({
  app,
  draggable,
  onDragStart,
  onDragEnd,
  onClick,
}: {
  app: EnrichedApplication;
  draggable: boolean;
  onDragStart: (app: EnrichedApplication) => void;
  onDragEnd: () => void;
  onClick: (app: EnrichedApplication) => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", app.id);
        onDragStart(app);
      }}
      onDragEnd={onDragEnd}
      onClick={() => onClick(app)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick(app);
        }
      }}
      className={cn(
        "rounded-lg border border-border bg-surface p-2.5 text-left shadow-sm transition-shadow",
        "hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0077B6]",
        draggable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
      )}
    >
      {/* Line 1: opportunity name */}
      <p className="truncate text-xs font-medium text-slate-900">
        {app.opportunityName ?? "Untitled opportunity"}
      </p>

      {/* Line 2: funder + sub-stage pill */}
      <div className="mt-1 flex items-center justify-between gap-1">
        <p className="truncate text-xs text-slate-500">
          {app.funderName ?? "—"}
        </p>
        <span
          className={cn(
            stagePillClassName(app.stage),
            stagePillBadgeClass(app.stage),
            "shrink-0 !px-1.5 !py-0.5 !text-[10px]",
          )}
          style={stagePillStyle(app.stage)}
        >
          {STAGE_LABEL[app.stage]}
        </span>
      </div>

      {/* Line 3: amount + deadline */}
      <div className="mt-1.5 flex items-center justify-between gap-1">
        <span className="text-xs font-medium text-text-secondary">
          {formatCurrency(app.requested_amount)}
        </span>
        {app.deadline && (
          <span className={cn("text-[10px]", deadlineClass(app.deadline))}>
            {formatDate(app.deadline)}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Kanban Column ──────────────────────────────────────────────────────────

function KanbanColumn({
  group,
  applicationsByStage,
  interactive,
  draggingId,
  onDragStart,
  onDragEnd,
  onDrop,
  onCardClick,
}: {
  group: (typeof KANBAN_GROUPS)[number];
  applicationsByStage: Map<PipelineStage, EnrichedApplication[]>;
  interactive: boolean;
  draggingId: string | null;
  onDragStart: (app: EnrichedApplication) => void;
  onDragEnd: () => void;
  onDrop: (groupKey: GroupKey) => void;
  onCardClick: (app: EnrichedApplication) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  const allApps = group.stages.flatMap(
    (s) => applicationsByStage.get(s) ?? [],
  );
  const total = allApps.length;
  const draggingFromElsewhere =
    draggingId != null && !allApps.some((a) => a.id === draggingId);

  return (
    <div
      className="flex w-64 shrink-0 flex-col sm:w-auto sm:min-w-0 sm:flex-1"
      onDragOver={(e) => {
        if (!interactive) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => {
        if (!interactive) return;
        e.preventDefault();
        setIsDragOver(false);
        onDrop(group.key);
      }}
    >
      {/* Column header */}
      <div className="mb-2 flex items-center justify-between px-0.5">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="flex items-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
        >
          {collapsed ? (
            <ChevronRight className={cn("h-4 w-4 shrink-0", group.headerColor)} aria-hidden />
          ) : (
            <ChevronDown className={cn("h-4 w-4 shrink-0", group.headerColor)} aria-hidden />
          )}
          <span className={cn("text-sm font-semibold", group.headerColor)}>
            {group.label}
          </span>
          <Badge variant="neutral">{total}</Badge>
        </button>
      </div>

      {/* Column body */}
      {!collapsed && (
        <div
          className={cn(
            "flex flex-1 flex-col gap-1.5 rounded-lg border border-dashed p-2 transition min-h-[120px]",
            isDragOver && draggingFromElsewhere
              ? "border-accent bg-accent/5"
              : "border-border bg-white/50",
          )}
        >
          {total === 0 ? (
            <p className="py-8 text-center text-xs text-text-muted">
              No applications in this phase
            </p>
          ) : (
            group.stages.map((stage) => {
              const stageApps = applicationsByStage.get(stage) ?? [];
              if (stageApps.length === 0) return null;
              return (
                <div key={stage}>
                  {/* Sub-stage divider */}
                  <div className="mb-1.5 flex items-center gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                      {STAGE_LABEL[stage]}
                    </span>
                    <div className="flex-1 border-t border-border" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {stageApps.map((app) => (
                      <KanbanCard
                        key={app.id}
                        app={app}
                        draggable={interactive}
                        onDragStart={onDragStart}
                        onDragEnd={onDragEnd}
                        onClick={onCardClick}
                      />
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

// ── Main GroupedKanban ─────────────────────────────────────────────────────

export type GroupedKanbanProps = {
  applications: EnrichedApplication[];
  interactive: boolean;
  role: Tables<"profiles">["role"] | undefined;
  changedBy: string | null;
  onChanged: () => void;
};

export function GroupedKanban({
  applications,
  interactive,
  role,
  changedBy,
  onChanged,
}: GroupedKanbanProps) {
  const router = useRouter();

  const [dragging, setDragging] = useState<EnrichedApplication | null>(null);
  const [pending, setPending] = useState<{
    application: EnrichedApplication;
    target: PipelineStage;
  } | null>(null);

  const applicationsByStage = useMemo(() => {
    const map = new Map<PipelineStage, EnrichedApplication[]>();
    for (const stage of [
      "discovered",
      "eligibility_review",
      "qualified",
      "drafting",
      "awaiting_documents",
      "ready_for_review",
      "submitted",
      "follow_up_due",
      "awarded",
      "denied",
      "reporting_required",
      "renewal_opportunity",
    ] as PipelineStage[]) {
      map.set(stage, []);
    }
    for (const app of applications) {
      map.get(app.stage)?.push(app);
    }
    return map;
  }, [applications]);

  function handleDrop(groupKey: GroupKey) {
    const app = dragging;
    setDragging(null);
    if (!app) return;

    const targetGroup = KANBAN_GROUPS.find((g) => g.key === groupKey);
    if (!targetGroup) return;

    // If already in this group, no-op
    if (stageGroupKey(app.stage) === groupKey) return;

    // Auto-select the first sub-stage of the target group
    setPending({ application: app, target: targetGroup.firstStage });
  }

  function handleCardClick(app: EnrichedApplication) {
    router.push(`/applications/${app.id}`);
  }

  return (
    <>
      <div className="flex gap-3 overflow-x-auto pb-2 sm:grid sm:grid-cols-2 sm:overflow-visible sm:pb-0 xl:grid-cols-4">
        {KANBAN_GROUPS.map((group) => (
          <KanbanColumn
            key={group.key}
            group={group}
            applicationsByStage={applicationsByStage}
            interactive={interactive}
            draggingId={dragging?.id ?? null}
            onDragStart={setDragging}
            onDragEnd={() => setDragging(null)}
            onDrop={handleDrop}
            onCardClick={handleCardClick}
          />
        ))}
      </div>

      <StageTransitionModal
        isOpen={pending != null}
        onClose={() => setPending(null)}
        application={pending?.application ?? null}
        initialTargetStage={pending?.target ?? null}
        role={role}
        changedBy={changedBy}
        onComplete={() => {
          setPending(null);
          onChanged();
        }}
      />
    </>
  );
}
