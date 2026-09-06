// Funding Potential Scan — scoring engine (follow-up to migration 172's
// intake-only scope; see supabase/migrations/172_scan_submissions.sql and
// src/app/(marketing)/scan/ScanClient.tsx, both of which explicitly defer
// "the scoring engine" to this sub-prompt).
//
// This is a deterministic, rules-based heuristic over the real `opportunities`
// table — NOT a real-time AI analysis, NOT a statistical prediction, and it
// never names a specific funder. It exists to turn (mission, fundingPriority,
// state) into a directional score plus plain-language guidance, degrading to
// generic category-level guidance whenever real matches are too thin to
// support a confident claim (opportunities table sparse for that category/
// state combo), rather than ever inventing a specific funder or dollar figure.
//
// DELIBERATE RLS BYPASS — read before changing the client this takes: a scan
// visitor is anonymous and has no organization_id (Contracts §2's "every
// query is organization_id-scoped" doesn't apply here — there is no org to
// scope to yet), and `opportunities` is otherwise a strictly org-isolated
// table (see the `opportunities_org_isolation` RLS policy, migration 001).
// Matching against real, live opportunities therefore requires a service-role
// client passed in by the caller (see src/lib/supabase/admin.ts) that reads
// across every organization's discovered opportunities, not just one. That is
// safe here specifically because this module returns only aggregated
// category/geography/amount signals — it never surfaces an opportunity's id,
// name, description, funder_id, or organization_id, so no other org's
// discovered-opportunity data is ever exposed to the visitor. Do not widen
// the select() below without re-checking that invariant.
//
// CATEGORY-DERIVATION LIMITATION (documented, not silently glossed over): the
// `funder_category` enum (src/lib/utils/constants.ts FUNDER_CATEGORIES) mixes
// funder-TYPE values (government_grant, private_foundation, corporate_*,
// in_kind_donation, materials_donation) with cause-TOPIC values (housing_grant,
// education_grant, faith_compatible_grant, local_community_grant,
// down_payment_assistance). Only the topic values can be reliably derived
// from free-text mission keywords; type values can't (a housing mission can
// be funded by a government grant OR a private foundation — type is
// orthogonal to topic). So this engine only ever matches against the topic
// subset. A mission with no topic keyword hit (or one whose real matches are
// funder-type-categorized rather than topic-categorized) correctly falls
// through to the degraded, category-level-guidance path rather than being
// mis-scored as "no relevant funding exists."

import type { SupabaseClient } from "@supabase/supabase-js";

import { geographicTextsOverlap } from "@/lib/intelligence/geographic-gap-analysis";
import {
  SCAN_US_STATES,
  SCAN_FUNDING_PRIORITIES,
  type ScanFundingPriority,
} from "@/lib/scan/constants";

/** Caps how many open opportunities a single scan will read - keeps this
 * anonymous, unauthenticated endpoint's query cost bounded regardless of how
 * large the real table grows. */
export const OPPORTUNITY_ROW_LIMIT = 1000;

/** Below this many open rows in the real table overall, treat the data as too
 * sparse to score confidently, independent of category/geo match quality -
 * this is the "research agents queue hasn't populated much data yet" case
 * called out in the spec. */
const MIN_POOL_SIZE_FOR_CONFIDENCE = 8;

/** Below this many real, topically- and geographically-relevant rows, don't
 * claim a confident match even if the table overall is well-populated. */
const MIN_MATCHES_FOR_CONFIDENCE = 3;

type TopicCategory =
  | "housing_grant"
  | "education_grant"
  | "faith_compatible_grant"
  | "local_community_grant"
  | "down_payment_assistance";

interface TopicMatch {
  category: TopicCategory;
  label: string;
}

const TOPIC_CATEGORY_KEYWORDS: ReadonlyArray<{
  category: TopicCategory;
  label: string;
  pattern: RegExp;
}> = [
  {
    category: "housing_grant",
    label: "Housing Grant",
    pattern: /\b(housing|homeless|shelter|tenant|renter|homeowners?)\b/i,
  },
  {
    category: "education_grant",
    label: "Education Grant",
    pattern: /\b(education|school|student|literacy|scholarship|tutoring|classroom)\b/i,
  },
  {
    category: "faith_compatible_grant",
    label: "Faith-Compatible Grant",
    pattern: /\b(church|ministry|congregation|faith-based|worship)\b/i,
  },
  {
    category: "local_community_grant",
    label: "Local Community Grant",
    pattern: /\b(community|neighborhood)\b/i,
  },
  {
    category: "down_payment_assistance",
    label: "Down Payment Assistance",
    pattern: /\b(down\s*payment|homebuyer|home\s*ownership)\b/i,
  },
];

function deriveTopics(primaryMission: string): TopicMatch[] {
  return TOPIC_CATEGORY_KEYWORDS.filter((t) => t.pattern.test(primaryMission)).map((t) => ({
    category: t.category,
    label: t.label,
  }));
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export type FundingPotentialTier = "strong" | "moderate" | "emerging" | "early_stage";

function scoreToTier(score: number): FundingPotentialTier {
  if (score >= 75) return "strong";
  if (score >= 50) return "moderate";
  if (score >= 30) return "emerging";
  return "early_stage";
}

interface ComputeScoreInput {
  degraded: boolean;
  matchedCount: number;
  poolSize: number;
  topicCount: number;
}

function computeScore({ degraded, matchedCount, poolSize, topicCount }: ComputeScoreInput): number {
  if (degraded) {
    // A topic hit with a couple of thin matches still beats total silence,
    // but the cap keeps this band well below "moderate" so it never reads as
    // a confident match.
    const base = topicCount > 0 ? 20 : 10;
    return clamp(base + Math.min(15, matchedCount * 5), 0, 40);
  }
  const base = 40;
  const matchComponent = Math.min(35, matchedCount * 7);
  const poolComponent = Math.min(15, Math.round(Math.log2(poolSize + 1) * 3));
  const topicComponent = Math.min(10, topicCount * 5);
  return clamp(base + matchComponent + poolComponent + topicComponent, 0, 100);
}

interface OpportunityScanRow {
  category: string;
  geographic_restrictions: string | null;
  amount_min: number | null;
  amount_max: number | null;
}

interface AmountRange {
  min: number;
  max: number;
}

interface BuildGuidanceInput {
  degraded: boolean;
  topics: TopicMatch[];
  matchedCount: number;
  poolSize: number;
  stateName: string;
  fundingPriority: ScanFundingPriority;
  amountRange: AmountRange | null;
}

function buildGuidance({
  degraded,
  topics,
  matchedCount,
  poolSize,
  stateName,
  fundingPriority,
  amountRange,
}: BuildGuidanceInput): string[] {
  const priorityLabel =
    SCAN_FUNDING_PRIORITIES.find((p) => p.value === fundingPriority)?.label ??
    "your current funding priority";
  const guidance: string[] = [];

  if (topics.length === 0) {
    guidance.push(
      `We couldn't confidently match your mission statement to one of our tracked funding categories. General guidance: nonprofits pursuing ${priorityLabel.toLowerCase()} typically explore government grants, private foundations, and local community grants regardless of cause area.`,
    );
  } else {
    const labels = topics.map((t) => t.label).join(", ");
    const plural = topics.length > 1;
    if (degraded) {
      guidance.push(
        `Based on your mission, organizations like yours typically pursue funding in the ${labels} categor${plural ? "ies" : "y"}. We don't yet have enough open opportunities tracked for ${stateName} in ${plural ? "these categories" : "this category"} to give you a confident match - our research agents are continuously adding new opportunities, so check back soon.`,
      );
    } else {
      guidance.push(
        `We found ${matchedCount} open opportunit${matchedCount === 1 ? "y" : "ies"} currently tracked in the ${labels} categor${plural ? "ies" : "y"} with no stated restriction excluding ${stateName}.`,
      );
      if (amountRange) {
        guidance.push(
          `Typical award sizes among these tracked opportunities range from $${amountRange.min.toLocaleString()} to $${amountRange.max.toLocaleString()}. This reflects real opportunities in our database today, not a promise of what your organization will receive.`,
        );
      }
    }
  }

  if (poolSize < MIN_POOL_SIZE_FOR_CONFIDENCE) {
    guidance.push(
      "Our opportunities database is still being populated for this category and region, so this scan reflects category-level guidance rather than a full match against real-time funding data.",
    );
  }

  return guidance;
}

export interface FundingPotentialScanInput {
  primaryMission: string;
  fundingPriority: ScanFundingPriority;
  state: string;
}

export interface FundingPotentialScanResult {
  /** 0-100 rules-based heuristic score. Not a statistically calibrated
   * probability and not an AI-generated judgment. */
  score: number;
  tier: FundingPotentialTier;
  /** true when real matches were too thin (by category, geography, or overall
   * table population) to support a confident score - the caller-facing UI
   * should present `guidance` as general category-level advice, not a match. */
  degraded: boolean;
  /** Human-readable labels of the topic categories derived from the mission
   * text. Empty when no topic keyword was recognized. */
  categoriesConsidered: string[];
  /** Total open opportunities read from the real table (pre category/geo
   * filtering) - the "is the table populated at all" signal. */
  poolSize: number;
  /** Real opportunities that are both topically and geographically relevant. */
  matchedCount: number;
  /** Real min/max amount across matched rows that have an amount on file.
   * Never fabricated; null when no matched row has an amount. */
  amountRange: AmountRange | null;
  guidance: string[];
  methodology: string;
}

const METHODOLOGY_DISCLAIMER =
  "This is a rules-based heuristic that compares your stated mission and state against the categories and geographic restrictions of open opportunities currently tracked in Benavora's opportunities database. It is not a real-time AI analysis, a statistical prediction, or a guarantee of funding, and it does not identify or recommend any specific funder.";

/**
 * Scores a Funding Potential Scan submission's mission/priority/state against
 * the real `opportunities` table. `supabase` MUST be a service-role client
 * (src/lib/supabase/admin.ts createAdminClient()) - see the file-level
 * comment for why this deliberately reads across organization_id boundaries.
 */
export async function computeFundingPotentialScan(
  input: FundingPotentialScanInput,
  supabase: SupabaseClient,
): Promise<FundingPotentialScanResult> {
  const { primaryMission, fundingPriority, state } = input;

  const stateEntry = SCAN_US_STATES.find((s) => s.abbr === state.trim().toUpperCase());
  const stateName = stateEntry?.name ?? state;

  const topics = deriveTopics(primaryMission);
  const topicCategorySet = new Set<string>(topics.map((t) => t.category));

  const { data, error } = await supabase
    .from("opportunities")
    .select("category, geographic_restrictions, amount_min, amount_max")
    .eq("status", "open")
    .limit(OPPORTUNITY_ROW_LIMIT);

  if (error) {
    throw new Error(`Failed to load opportunities: ${error.message}`);
  }

  const rows = (data ?? []) as OpportunityScanRow[];
  const poolSize = rows.length;

  const relevantRows =
    topicCategorySet.size > 0 ? rows.filter((r) => topicCategorySet.has(r.category)) : [];

  const geoMatchedRows = relevantRows.filter((r) => {
    const geoText = (r.geographic_restrictions ?? "").trim();
    if (!geoText) return true; // no restriction stated - open to any state
    return geographicTextsOverlap(stateName, geoText);
  });

  const matchedCount = geoMatchedRows.length;
  const degraded =
    topicCategorySet.size === 0 ||
    poolSize < MIN_POOL_SIZE_FOR_CONFIDENCE ||
    matchedCount < MIN_MATCHES_FOR_CONFIDENCE;

  const amounts = geoMatchedRows.flatMap((r) =>
    [r.amount_min, r.amount_max].filter((n): n is number => typeof n === "number"),
  );
  const amountRange: AmountRange | null =
    amounts.length > 0 ? { min: Math.min(...amounts), max: Math.max(...amounts) } : null;

  const score = computeScore({
    degraded,
    matchedCount,
    poolSize,
    topicCount: topicCategorySet.size,
  });

  const guidance = buildGuidance({
    degraded,
    topics,
    matchedCount,
    poolSize,
    stateName,
    fundingPriority,
    amountRange: degraded ? null : amountRange,
  });

  return {
    score,
    tier: scoreToTier(score),
    degraded,
    categoriesConsidered: topics.map((t) => t.label),
    poolSize,
    matchedCount,
    amountRange: degraded ? null : amountRange,
    guidance,
    methodology: METHODOLOGY_DISCLAIMER,
  };
}
