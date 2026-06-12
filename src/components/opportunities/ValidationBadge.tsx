import { ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";

import { Badge } from "@/components/ui";
import {
  computeConsensus,
  type ConsensusStatus,
  type ConsensusSummary,
  type ValidationVerdictRow,
} from "@/lib/opportunities/validation";

const STATUS_ICON: Record<
  ConsensusStatus,
  typeof ShieldCheck | null
> = {
  verified: ShieldCheck,
  discrepancy: ShieldAlert,
  unverifiable: ShieldQuestion,
  pending: null,
};

export type ValidationBadgeProps = {
  /** Pass a precomputed consensus, or the raw verdict rows to derive it from. */
  consensus?: ConsensusSummary;
  rows?: ValidationVerdictRow[];
  /**
   * Hide entirely when nothing has been validated yet (providerCount 0).
   * Useful in lists/cards where only the "Verified" outcome matters.
   */
  hideUntilValidated?: boolean;
  /** Render only when the opportunity is fully verified (for list/card use). */
  verifiedOnly?: boolean;
};

/**
 * Cross-provider validation badge (migration 014). Green "Verified" only when
 * BOTH independent AI providers agreed; red "Needs review" on any discrepancy;
 * otherwise a muted pending/unverified state. The consensus logic is shared with
 * the API route via {@link computeConsensus} so the badge can never drift from
 * the gate that produced it.
 */
export function ValidationBadge({
  consensus,
  rows,
  hideUntilValidated = false,
  verifiedOnly = false,
}: ValidationBadgeProps) {
  const summary = consensus ?? computeConsensus(rows ?? []);

  if (verifiedOnly && !summary.isVerified) return null;
  if (hideUntilValidated && summary.providerCount === 0) return null;

  const Icon = STATUS_ICON[summary.status];
  return (
    <Badge color={summary.color}>
      {Icon && <Icon className="h-3.5 w-3.5" aria-hidden />}
      {summary.label}
    </Badge>
  );
}
