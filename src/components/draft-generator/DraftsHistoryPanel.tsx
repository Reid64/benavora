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
  /** Style version cards for a dark card background (draft generator page). Defaults to light. */
  dark?: boolean;
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
  dark = false,
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
      <p
        className={dark ? undefined : "text-sm text-navy-500"}
        style={dark ? { fontSize: "13px", color: "rgba(248,250,252,0.5)" } : undefined}
      >
        Loading version history...
      </p>
    );
  }

  if (versions.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-6 text-center">
        <History className={dark ? "h-6 w-6" : "h-6 w-6 text-navy-300"} style={dark ? { color: "rgba(248,250,252,0.3)" } : undefined} aria-hidden />
        <p
          className={dark ? undefined : "text-sm text-navy-500"}
          style={dark ? { fontSize: "13px", color: "rgba(248,250,252,0.5)" } : undefined}
        >
          No saved versions yet. Generate a draft and it will be saved here
          automatically.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span
          className={dark ? undefined : undefined}
          style={dark ? { fontSize: "12px", color: "rgba(248,250,252,0.5)" } : { fontSize: "12px", color: "rgba(11,11,11,0.72)" }}
        >
          {versions.length} {versions.length === 1 ? "version" : "versions"} ·
          newest first
        </span>
        {dark ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowCompare(true)}
            disabled={!canCompare}
            title={canCompare ? "Compare the two selected versions" : "Select two versions to compare"}
          >
            <GitCompare className="h-3.5 w-3.5" aria-hidden />
            Compare
          </Button>
        ) : (
          // Bypasses the shared Button's `bg-surface` variant — globals.css
          // hard-overrides `.bg-surface` with `!important`, which a Tailwind
          // utility (even `!bg-[...]`) loses to on cascade order. A plain
          // button with inline style sidesteps that entirely.
          <button
            type="button"
            onClick={() => setShowCompare(true)}
            disabled={!canCompare}
            title={canCompare ? "Compare the two selected versions" : "Select two versions to compare"}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-60"
            style={{ backgroundColor: "#F8F5EE", border: "1px solid rgba(11,11,11,0.25)", color: "#0B0B0B" }}
          >
            <GitCompare className="h-3.5 w-3.5" aria-hidden />
            Compare
          </button>
        )}
      </div>

      <ul className="space-y-2">
        {versions.map((version) => {
          const isActive = version.id === activeVersionId;
          const isSelected = compareIds.includes(version.id);
          const human = HUMANIZATION_BADGE[version.humanizationStatus];
          return (
            <li
              key={version.id}
              className={dark ? "transition" : "transition"}
              style={
                dark
                  ? {
                      backgroundColor: isActive ? "rgba(168,85,247,0.1)" : "rgba(0,0,0,0.15)",
                      borderRadius: "10px",
                      padding: "14px",
                      marginBottom: "8px",
                      border: isActive ? "1px solid rgba(168,85,247,0.4)" : "1px solid rgba(255,255,255,0.06)",
                    }
                  : {
                      backgroundColor: "#F8F5EE",
                      borderRadius: "10px",
                      padding: "12px 14px",
                      boxShadow: isActive ? "0 2px 8px rgba(13,148,136,0.3)" : "0 1px 3px rgba(16,27,45,0.2)",
                      border: isActive ? "1.5px solid #0D9488" : "1px solid rgba(164,113,44,0.25)",
                    }
              }
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={dark ? undefined : "text-sm font-semibold text-navy-900"}
                      style={dark ? { fontSize: "14px", fontWeight: 700, color: "rgba(248,250,252,0.9)" } : undefined}
                    >
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
                  <p
                    className={dark ? undefined : "mt-1 text-xs text-navy-500"}
                    style={dark ? { marginTop: "4px", fontSize: "12px", color: "rgba(248,250,252,0.4)" } : undefined}
                  >
                    {formatTimestamp(version.createdAt)} ·{" "}
                    {humanizeEnum(version.templateType)}
                    {version.source !== "generated" && (
                      <> · {humanizeEnum(version.source)}</>
                    )}
                  </p>
                </div>
                <label
                  className={dark ? "flex shrink-0 items-center gap-1.5" : "flex shrink-0 items-center gap-1.5 text-xs text-navy-500"}
                  style={dark ? { fontSize: "12px", color: "rgba(248,250,252,0.5)" } : undefined}
                >
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
