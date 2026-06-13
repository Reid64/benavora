import { Award, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui";

export type ProvenBadgeProps = {
  /** knowledge_base.is_proven - set ONLY by the Recursive Learning Agent. */
  isProven: boolean | null | undefined;
  /** knowledge_base.proven_count - how many awarded apps used this entry. */
  provenCount?: number | null;
  /**
   * proven_narratives.effectiveness_score (0-1), when available. Rendered as a
   * percentage alongside the proven badge.
   */
  effectivenessScore?: number | null;
  /** Render a muted "Not yet proven" badge when the entry is not proven. */
  showWhenUnproven?: boolean;
  className?: string;
};

/**
 * Read-only indicator of an entry's "proven" status (BLUEPRINT §4.7).
 *
 * is_proven and proven_count are set EXCLUSIVELY by the Recursive Learning Agent
 * from awarded outcomes (Behavioral Contracts §8) - this component only displays
 * them and never offers a way to edit them.
 */
export function ProvenBadge({
  isProven,
  provenCount,
  effectivenessScore,
  showWhenUnproven = false,
  className,
}: ProvenBadgeProps) {
  if (!isProven) {
    if (!showWhenUnproven) return null;
    return (
      <Badge color="gray" className={className}>
        Not yet proven
      </Badge>
    );
  }

  const count = provenCount ?? 0;
  const pct =
    effectivenessScore != null && !Number.isNaN(effectivenessScore)
      ? `${Math.round(effectivenessScore * 100)}%`
      : null;

  return (
    <span className="inline-flex items-center gap-1.5">
      <Badge color="purple" className={className}>
        <Award className="h-3.5 w-3.5" aria-hidden />
        Proven
        {count > 0 && (
          <span className="font-normal">
            · {count} win{count === 1 ? "" : "s"}
          </span>
        )}
      </Badge>
      {pct && (
        <Badge color="teal">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
          {pct} effective
        </Badge>
      )}
    </span>
  );
}
