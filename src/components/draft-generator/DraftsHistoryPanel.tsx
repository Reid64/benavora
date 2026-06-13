"use client";

import { useMemo, useState } from "react";
import { format } from "date-fns";
import { GitCompare, History, RotateCcw } from "lucide-react";

import { Badge, Button, Modal } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import { diffLines, diffStats } from "@/lib/utils/diff";
import { humanizeEnum } from "@/lib/utils/formatters";
import type {
  DraftTemplateType,
  HumanizationStatus,
  KnowledgeSource,
} from "@/types/ai";

/** A saved draft version, as rendered in the history panel. */
export interface DraftVersionItem {
  id: string;
  versionNumber: number;
  templateType: DraftTemplateType;
  content: string;
  confidenceScore: number | null;
  sources: KnowledgeSource[];
  humanizationStatus: HumanizationStatus;
  /** 'generated' | 'regenerated' | 'reverted' (free-text, forward compatible). */
  source: string;
  createdAt: string;
}

export type DraftsHistoryPanelProps = {
  /** Versions for the selected opportunity, newest first. */
  versions: DraftVersionItem[];
  /** The version currently loaded in the editor, if any. */
  activeVersionId?: string | null;
  loading?: boolean;
  /** Load a version into the editor for viewing/editing. */
  onView: (version: DraftVersionItem) => void;
  /** Revert to a version (creates a new version from it). Hidden when omitted. */
  onRevert?: (version: DraftVersionItem) => void;
  /** Revert in progress (disables actions). */
  reverting?: boolean;
};

const HUMANIZATION_BADGE: Record<
  HumanizationStatus,
  { label: string; color: "gray" | "green" | "yellow" | "red" }
> = {
  not_humanized: { label: "Not humanized", color: "gray" },
  pending: { label: "Humanizing...", color: "yellow" },
  humanized: { label: "Humanized", color: "green" },
  failed: { label: "Humanize failed", color: "red" },
};

function confidenceColor(score: number | null): "gray" | "green" | "teal" | "yellow" | "red" {
  if (score == null) return "gray";
  if (score >= 90) return "green";
  if (score >= 70) return "teal";
  if (score >= 50) return "yellow";
  return "red";
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? "-"
    : format(date, "MMM d, yyyy · h:mm a");
}

/**
 * Drafts history panel (BLUEPRINT §4.8). Lists every saved version for the
 * selected opportunity with its timestamp and confidence score, and lets the
 * writer view a previous draft, compare any two versions side by side, or
 * revert to one. History is append-only - reverting creates a new version
 * rather than destroying past ones.
 */
export function DraftsHistoryPanel({
  versions,
  activeVersionId,
  loading = false,
  onView,
  onRevert,
  reverting = false,
}: DraftsHistoryPanelProps) {
  // Two selected version ids for comparison (most-recent-first selection).
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [showCompare, setShowCompare] = useState(false);

  const byId = useMemo(
    () => new Map(versions.map((v) => [v.id, v])),
    [versions],
  );

  function toggleCompare(id: string) {
    setCompareIds((prev) => {
      if (prev.includes(id)) return prev.filter((p) => p !== id);
      // Keep at most two; drop the oldest selection.
      return [...prev, id].slice(-2);
    });
  }

  const [olderId, newerId] = useMemo(() => {
    const chosen = compareIds
      .map((id) => byId.get(id))
      .filter((v): v is DraftVersionItem => Boolean(v))
      .sort((a, b) => a.versionNumber - b.versionNumber);
    return [chosen[0]?.id ?? null, chosen[1]?.id ?? null];
  }, [compareIds, byId]);

  const canCompare = Boolean(olderId && newerId);
  const older = olderId ? byId.get(olderId) ?? null : null;
  const newer = newerId ? byId.get(newerId) ?? null : null;

  const diff = useMemo(() => {
    if (!older || !newer) return null;
    const ops = diffLines(older.content, newer.content);
    return { ops, stats: diffStats(ops) };
  }, [older, newer]);

  if (loading) {
    return (
      <p className="text-sm text-navy-500">Loading version history...</p>
    );
  }

  if (versions.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-6 text-center">
        <History className="h-6 w-6 text-navy-300" aria-hidden />
        <p className="text-sm text-navy-500">
          No saved versions yet. Generate a draft and it will be saved here
          automatically.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-navy-500">
          {versions.length} {versions.length === 1 ? "version" : "versions"} ·
          newest first
        </span>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setShowCompare(true)}
          disabled={!canCompare}
          title={
            canCompare
              ? "Compare the two selected versions"
              : "Select two versions to compare"
          }
        >
          <GitCompare className="h-3.5 w-3.5" aria-hidden />
          Compare
        </Button>
      </div>

      <ul className="space-y-2">
        {versions.map((version) => {
          const isActive = version.id === activeVersionId;
          const isSelected = compareIds.includes(version.id);
          const human = HUMANIZATION_BADGE[version.humanizationStatus];
          return (
            <li
              key={version.id}
              className={cn(
                "rounded-lg border px-3 py-2.5 transition",
                isActive
                  ? "border-teal-400/40 bg-teal-400/5"
                  : "border-navy-200 hover:border-navy-300",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-navy-900">
                      Version {version.versionNumber}
                    </span>
                    {isActive && (
                      <Badge color="teal" withDot>
                        Loaded
                      </Badge>
                    )}
                    <Badge color={confidenceColor(version.confidenceScore)}>
                      {version.confidenceScore != null
                        ? `${version.confidenceScore}/100`
                        : "No score"}
                    </Badge>
                    <Badge color={human.color}>{human.label}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-navy-500">
                    {formatTimestamp(version.createdAt)} ·{" "}
                    {humanizeEnum(version.templateType)}
                    {version.source !== "generated" && (
                      <> · {humanizeEnum(version.source)}</>
                    )}
                  </p>
                </div>
                <label className="flex shrink-0 items-center gap-1.5 text-xs text-navy-500">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleCompare(version.id)}
                    className="h-3.5 w-3.5 rounded border-navy-300 text-teal-600 focus:ring-teal-500"
                    aria-label={`Select version ${version.versionNumber} to compare`}
                  />
                  Compare
                </label>
              </div>

              <div className="mt-2 flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onView(version)}
                  disabled={isActive}
                >
                  {isActive ? "Viewing" : "View"}
                </Button>
                {onRevert && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onRevert(version)}
                    isLoading={reverting}
                  >
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                    Revert to this
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <Modal
        isOpen={showCompare && canCompare}
        onClose={() => setShowCompare(false)}
        size="xl"
        title={
          older && newer
            ? `Comparing Version ${older.versionNumber} → Version ${newer.versionNumber}`
            : "Compare versions"
        }
        description={
          diff
            ? `${diff.stats.added} added · ${diff.stats.removed} removed line(s)`
            : undefined
        }
      >
        {diff && (
          <pre className="max-h-[60vh] overflow-auto rounded-lg bg-navy-50 p-3 font-mono text-xs leading-relaxed">
            {diff.ops.map((op, idx) => (
              <div
                key={idx}
                className={cn(
                  "whitespace-pre-wrap break-words px-2",
                  op.type === "add" && "bg-green-500/10 text-green-800",
                  op.type === "remove" && "bg-red-500/10 text-red-800",
                  op.type === "equal" && "text-navy-600",
                )}
              >
                <span className="select-none text-navy-400">
                  {op.type === "add" ? "+ " : op.type === "remove" ? "− " : "  "}
                </span>
                {op.line || " "}
              </div>
            ))}
          </pre>
        )}
      </Modal>
    </div>
  );
}
