// Grants API service layer (BEHAVIORAL_CONTRACTS "GET/PATCH/POST /api/grants").
//
// SERVER-ONLY. Shared by the three grants route handlers
// (`/api/grants`, `/api/grants/[id]`, `/api/grants/[id]/rescore`).
//
// ─────────────────────────────────────────────────────────────────────────────
// Governance ⇄ schema mapping (authoritative: the live schema - Iron Law 8).
//
// BEHAVIORAL_CONTRACTS names a `grants` table with columns `source_type`,
// `eligibility_flag`, `amount_requested`, `amount_awarded`, `match_percentage`,
// `eligibility_notes`, and `eligibility_scored_at`. NONE of those exist in the
// live database (`src/types/database.ts`, migrations 001-009). The implemented,
// internally-consistent entity is the `opportunities` table. Renaming it to
// `grants` would break migration-001 RLS (`current_org_id()`), `database.ts`,
// the research/eligibility agents, and every page - the same posture already
// recorded for the auth-model and `is_proven` divergences (see STATE files).
//
// So "grant" == an `opportunities` row, and the contract's grant vocabulary maps
// onto real columns as follows. This is a presentation mapping only; reads and
// writes touch ONLY the real `opportunities` and `search_profiles` tables.
//
//   contract field          → real column / derivation
//   ─────────────────────────────────────────────────────────────────
//   source_type             → category            (funder_category enum)
//   status                  → status              (opportunity_status enum)
//   amount_requested        → amount_min          (funder award floor)
//   amount_awarded          → amount_available    (funder pool available)
//   deadline                → deadline
//   match_percentage        → match_percentage    (0-100, agent-owned; falls
//                                                  back to eligibility_score for
//                                                  rows scored before migration 012)
//   eligibility_flag        → derived from the match percentage (see below)
//   eligibility_notes       → recommendation_reasoning
//   eligibility_scored_at   → updated_at          (set by the scoring agent)
// ─────────────────────────────────────────────────────────────────────────────

import type { SupabaseClient } from "@supabase/supabase-js";

import { FUNDER_CATEGORIES, OPPORTUNITY_STATUSES } from "@/lib/utils/constants";
import { formatCurrency, formatDate, humanizeEnum } from "@/lib/utils/formatters";

/** Eligibility buckets exposed by the contract's `eligibility_flag`. */
export const ELIGIBILITY_FLAGS = [
  "high_match",
  "moderate_match",
  "low_match",
  "unscored",
] as const;

export type EligibilityFlag = (typeof ELIGIBILITY_FLAGS)[number];

/**
 * Bucket an agent-owned eligibility score (0-100) into the contract's flag.
 * Mirrors the EligibilityScorer rubric: 80+ apply, 60-79 review, <60 skip.
 */
export function deriveEligibilityFlag(
  score: number | null | undefined,
): EligibilityFlag {
  if (score === null || score === undefined) return "unscored";
  if (score >= 80) return "high_match";
  if (score >= 60) return "moderate_match";
  return "low_match";
}

/** Columns selected for every grant read. Mirrors the real `opportunities` row. */
export const GRANT_SELECT =
  "id, organization_id, funder_id, name, category, description, amount_available, amount_min, amount_max, deadline, url, eligibility_requirements, required_documents, application_method, recurrence, geographic_restrictions, eligibility_score, recommendation, recommendation_reasoning, match_percentage, is_high_priority, match_mismatch_reasons, status, source, discovered_at, created_at, updated_at";

/** Shape of a raw `opportunities` row as read with {@link GRANT_SELECT}. */
export interface OpportunityRow {
  id: string;
  organization_id: string;
  funder_id: string | null;
  name: string;
  category: string;
  description: string | null;
  amount_available: number | null;
  amount_min: number | null;
  amount_max: number | null;
  deadline: string | null;
  url: string | null;
  eligibility_requirements: string | null;
  required_documents: string[] | null;
  application_method: string | null;
  recurrence: string | null;
  geographic_restrictions: string | null;
  eligibility_score: number | null;
  recommendation: string | null;
  recommendation_reasoning: string | null;
  match_percentage: number | null;
  is_high_priority: boolean;
  match_mismatch_reasons: string[] | null;
  status: string | null;
  source: string | null;
  discovered_at: string;
  created_at: string;
  updated_at: string;
}

/**
 * The contract's `Grant` response object. Contract-named fields are mapped from
 * real columns (see the mapping table above); a few real-only fields are also
 * surfaced so "full detail" reads are complete. Monetary amounts include the
 * raw integer and a formatted display string (Contracts conventions). Timestamps
 * are ISO 8601 UTC strings exactly as stored.
 */
export interface Grant {
  id: string;
  organization_id: string;
  funder_id: string | null;
  name: string;
  source_type: string;
  source_type_label: string;
  status: string | null;
  description: string | null;
  url: string | null;
  amount_requested: number | null;
  amount_requested_display: string;
  amount_awarded: number | null;
  amount_awarded_display: string;
  amount_max: number | null;
  amount_max_display: string;
  deadline: string | null;
  deadline_display: string;
  match_percentage: number | null;
  eligibility_flag: EligibilityFlag;
  eligibility_notes: string | null;
  recommendation: string | null;
  eligibility_scored_at: string | null;
  eligibility_requirements: string | null;
  geographic_restrictions: string | null;
  required_documents: string[] | null;
  application_method: string | null;
  recurrence: string | null;
  source: string | null;
  discovered_at: string;
  created_at: string;
  updated_at: string;
}

/** Map a real `opportunities` row to the contract's `Grant` response shape. */
export function serializeGrant(row: OpportunityRow): Grant {
  const scored = row.eligibility_score !== null;
  // Prefer the dedicated match_percentage column (migration 012); fall back to
  // the eligibility score for rows scored before it existed.
  const matchPercentage = row.match_percentage ?? row.eligibility_score;
  return {
    id: row.id,
    organization_id: row.organization_id,
    funder_id: row.funder_id,
    name: row.name,
    source_type: row.category,
    source_type_label: humanizeEnum(row.category),
    status: row.status,
    description: row.description,
    url: row.url,
    amount_requested: row.amount_min,
    amount_requested_display: formatCurrency(row.amount_min),
    amount_awarded: row.amount_available,
    amount_awarded_display: formatCurrency(row.amount_available),
    amount_max: row.amount_max,
    amount_max_display: formatCurrency(row.amount_max),
    deadline: row.deadline,
    deadline_display: formatDate(row.deadline),
    match_percentage: matchPercentage,
    eligibility_flag: deriveEligibilityFlag(matchPercentage),
    eligibility_notes: row.recommendation_reasoning,
    recommendation: row.recommendation,
    // The scoring agent stamps `updated_at` when it writes the score; surface it
    // as the "scored at" time only when a score actually exists.
    eligibility_scored_at: scored ? row.updated_at : null,
    eligibility_requirements: row.eligibility_requirements,
    geographic_restrictions: row.geographic_restrictions,
    required_documents: row.required_documents,
    application_method: row.application_method,
    recurrence: row.recurrence,
    source: row.source,
    discovered_at: row.discovered_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// --- validation helpers ------------------------------------------------------

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True for a syntactically valid UUID (the `id` path-param shape). */
export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** True if `value` is a member of the live `funder_category` enum. */
export function isFunderCategory(value: string): boolean {
  return (FUNDER_CATEGORIES as readonly string[]).includes(value);
}

/** True if `value` is a member of the live `opportunity_status` enum. */
export function isOpportunityStatus(value: string): boolean {
  return (OPPORTUNITY_STATUSES as readonly string[]).includes(value);
}

/** True if `value` parses as a real calendar date (ISO 8601 / date string). */
export function isValidDateString(value: string): boolean {
  const t = Date.parse(value);
  return Number.isFinite(t);
}

// --- ownership resolution ----------------------------------------------------

export type OwnershipResult =
  | { status: "ok" }
  | { status: "forbidden" }
  | { status: "not_found" }
  | { status: "error" };

/**
 * Distinguish the contract's 403 (grant exists, other org) from 404 (no such
 * grant). RLS hides cross-tenant rows from the session client, so it cannot tell
 * the two apart on its own. A minimal service-role probe reads ONLY the owning
 * `organization_id` for the id and compares it to the caller's org - it never
 * returns cross-tenant data, it only reveals existence (which the contract's 403
 * already implies). All grant DATA returned to the caller still comes from the
 * RLS-scoped session client.
 */
export async function resolveGrantOwnership(
  admin: SupabaseClient,
  id: string,
  organizationId: string,
): Promise<OwnershipResult> {
  const { data, error } = await admin
    .from("opportunities")
    .select("organization_id")
    .eq("id", id)
    .maybeSingle();

  if (error) return { status: "error" };
  if (!data) return { status: "not_found" };
  if ((data.organization_id as string) !== organizationId) {
    return { status: "forbidden" };
  }
  return { status: "ok" };
}
