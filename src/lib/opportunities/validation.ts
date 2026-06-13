// Cross-provider validation - shared, CLIENT-SAFE domain logic (migration 014).
//
// This module holds the pure pieces of the validation feature that both the
// server orchestrator (lib/agents/consensus-validator) and the browser UI
// (OpportunityDetail, ValidationBadge) need: the verdict/consensus types, the
// provider + field constants, and the pure {@link computeConsensus} rule. It
// imports NO server-only code (no AI SDKs, no env, no Supabase), so it is safe
// to bundle into a Client Component - keeping the consensus rule in exactly one
// place that the API gate and the badge both derive from.

import type { BadgeColor } from "@/components/ui";
import type { Enums } from "@/types/database";

export type ValidationVerdict = Enums<"validation_verdict">;

/** The two providers, with stable ids matching the `validations.provider` column. */
export const VALIDATION_PROVIDERS = {
  claude: { id: "anthropic_claude", label: "Anthropic Claude" },
  gemini: { id: "google_gemini", label: "Google Gemini" },
} as const;

/** The four fields every provider judges. */
export const VALIDATION_FIELDS = [
  "existence",
  "eligibility",
  "deadline",
  "amounts",
] as const;
export type ValidationField = (typeof VALIDATION_FIELDS)[number];

/** A provider's judgement on one field. */
export interface FieldCheck {
  ok: boolean;
  note: string;
}

export type ValidationChecks = Record<ValidationField, FieldCheck>;

/** The structured verdict a provider returns and we persist into `details`. */
export interface ParsedVerdict {
  verdict: ValidationVerdict;
  /** Provider's self-reported confidence, 0-100. */
  confidence: number;
  checks: ValidationChecks;
  summary: string;
}

// --- consensus ---------------------------------------------------------------

export type ConsensusStatus =
  | "verified" // both providers independently returned `verified`
  | "discrepancy" // at least one provider flagged a discrepancy
  | "unverifiable" // ran but providers could not confidently verify
  | "pending"; // fewer than two providers have weighed in yet

export interface ConsensusSummary {
  status: ConsensusStatus;
  /** True only for `verified` - the gate for the "Verified" badge. */
  isVerified: boolean;
  /** How many providers returned `verified`. */
  verifiedCount: number;
  /** How many provider verdicts exist. */
  providerCount: number;
  label: string;
  color: BadgeColor;
}

/** The minimal shape {@link computeConsensus} needs from a `validations` row. */
export interface ValidationVerdictRow {
  verdict: ValidationVerdict;
}

/**
 * Derive the consensus badge from the stored provider verdicts. PURE - the API
 * route and the UI both call it so the badge logic lives in exactly one place.
 * "Verified" requires BOTH providers to independently agree; any single
 * discrepancy demotes the whole opportunity to "Needs review".
 */
export function computeConsensus(
  rows: ValidationVerdictRow[],
): ConsensusSummary {
  const providerCount = rows.length;
  const verifiedCount = rows.filter((r) => r.verdict === "verified").length;
  const hasDiscrepancy = rows.some((r) => r.verdict === "discrepancy");

  if (providerCount < 2) {
    return {
      status: "pending",
      isVerified: false,
      verifiedCount,
      providerCount,
      label: providerCount === 0 ? "Not validated" : "Validation pending",
      color: "gray",
    };
  }
  if (hasDiscrepancy) {
    return {
      status: "discrepancy",
      isVerified: false,
      verifiedCount,
      providerCount,
      label: "Needs review",
      color: "red",
    };
  }
  if (verifiedCount >= 2) {
    return {
      status: "verified",
      isVerified: true,
      verifiedCount,
      providerCount,
      label: "Verified",
      color: "green",
    };
  }
  return {
    status: "unverifiable",
    isVerified: false,
    verifiedCount,
    providerCount,
    label: "Unverified",
    color: "yellow",
  };
}
