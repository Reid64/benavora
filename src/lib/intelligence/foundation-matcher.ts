// Foundation Matcher — multi-factor NTEE/geographic/asset/prior-giving
// scoring engine, used by src/lib/agents/opportunity-discovery-agent.ts
// (AG-17) to surface foundation_directory records worth pursuing for a
// given org, independent of the keyword-driven grants.gov/SAM.gov/Federal
// Register sweep that agent already does.
//
// This is a plain scoring module (not an AutonomousAgent subclass) — it has
// no run()/agent_runs lifecycle of its own; callers log their own
// agent_decisions rows for whatever they do with the returned matches, same
// as src/lib/intelligence/semantic-matcher.ts and relationship-scorer.ts.
//
// Deviations from the task-given spec, checked against real schema before
// writing (this repo's established convention — see
// src/lib/agents/eligibility-scoring-agent.ts's header for a prior
// instance):
//   - `organizations` has no NTEE/category column (confirmed: no migration
//     ever adds one — see src/lib/agents/relationship-graph-builder-agent.ts's
//     header for the same finding). Factor 1 resolves the org's NTEE major
//     group two ways: (a) if the org has an `ein`, look it up in the real
//     `nonprofits` table (migration 098_nonprofits_bmf.sql) — a genuine IRS
//     BMF ntee_code, not a guess; (b) otherwise fall back to the same
//     keyword-over-mission/population/service-area heuristic
//     relationship-graph-builder-agent.ts already established
//     (inferOrgNteeMajorGroup), duplicated here per this codebase's
//     established per-file OrgProfile/heuristic convention rather than
//     exported and shared (see that agent's OrgProfile, and the eight other
//     independent OrgProfile definitions across src/lib/agents/).
//     NOTE: per project memory (benavora-bmf-ingest-column-bug), the BMF
//     import script that populates `nonprofits` has a confirmed
//     column-scrambling bug and has likely inserted zero usable rows in
//     production — the lookup below is forward-defensive and silently falls
//     back to the keyword heuristic on a miss, exactly like every other
//     "table may be empty/not-yet-real" read in this codebase (see
//     relationship-graph-builder-agent.ts's corporate_relationships /
//     corporate_intent_signals handling for the same pattern).
//   - Factor 4 ("prior giving signals... query foundation_directory or
//     pig_nodes for giving history") is implemented against
//     `foundation_directory.enrichment` (grant_count, fiscal_year — real
//     990-derived columns, supabase/migrations/072_foundation_directory_990_
//     enrichment.sql) rather than pig_nodes/pig_edges. Per
//     relationship-graph-builder-agent.ts's own header finding, there is no
//     recipient-level "which NTEE-coded orgs did this funder give to" data
//     anywhere in this schema (pig_edges' `giving_cycle_aligned` edges are
//     themselves derived from these same enrichment fields, not a richer
//     source) — reading the enrichment fields directly is the real signal,
//     not a layer removed from it via a graph traversal.
//   - `contact_info` is populated from `foundation_directory.officers`
//     (jsonb, migration 058) and `contact_emails` (text[], migration 058) —
//     the real contact-bearing columns — not any `name`/`email` scalar
//     columns, which don't exist on this table.
//   - `estimated_grant_range` prefers real per-foundation data
//     (`enrichment.grant_range_min`/`grant_range_max`, both real 990-derived
//     fields) when present, falling back to an org-anchored estimate
//     (0.5x-1.5x of the org's own typical ask) only when the foundation has
//     no grant-range data on file.

import type { SupabaseClient } from "@supabase/supabase-js";

export interface OrgProfile {
  name: string;
  ein: string | null;
  missionStatement: string | null;
  targetPopulation: string | null;
  serviceArea: string | null;
  /** Real column is `organizations.annual_budget` — the task's "annual_revenue"
   * has no schema equivalent (see file header). */
  annualBudget: number | null;
  city: string | null;
  state: string | null;
}

export interface FoundationMatch {
  foundation_id: string;
  foundation_name: string;
  ein: string;
  match_score: number;
  match_reasons: string[];
  estimated_grant_range: { min: number; max: number };
  contact_info: { name?: string; email?: string };
}

interface NonprofitBmfRow {
  ntee_code: string | null;
}

interface FoundationDirectoryEnrichment {
  grant_count?: number | null;
  fiscal_year?: number | null;
  grant_range_min?: number | null;
  grant_range_max?: number | null;
}

interface FoundationDirectoryRow {
  id: string;
  name: string;
  ein: string | null;
  ntee_code: string | null;
  foundation_type: string | null;
  asset_amount: number | null;
  city: string | null;
  state: string | null;
  geographic_focus: string | null;
  officers: unknown;
  contact_emails: string[] | null;
  enrichment: FoundationDirectoryEnrichment | null;
}

interface NteeRule {
  primary: string[];
  secondary: string[];
  keywords: string[];
}

// Weights per the task spec — must sum to 1.0.
const NTEE_WEIGHT = 0.35;
const GEO_WEIGHT = 0.3;
const ASSET_WEIGHT = 0.2;
const PRIOR_WEIGHT = 0.15;

const MATCH_THRESHOLD = 0.5;
const MAX_RESULTS = 25;
const CANDIDATE_POOL_LIMIT = 500;

const TYPICAL_GRANT_RATE = 0.15;
const ASSET_MULTIPLE_MIN = 5;
const ASSET_MULTIPLE_MAX = 500;
const PRIOR_GIVING_LOOKBACK_YEARS = 3;

const SAME_CITY_SCORE = 1.0;
const SAME_STATE_SCORE = 0.7;
const NATIONAL_FUNDER_SCORE = 0.5;
const OUT_OF_STATE_SCORE = 0.1;

/** Coarse keyword → NTEE major-group letter map for the fallback heuristic.
 * Duplicated from relationship-graph-builder-agent.ts's
 * inferOrgNteeMajorGroup (per this codebase's established per-file
 * duplication convention — see file header), with an added 'F' branch (task
 * spec explicitly separates "Health orgs (E, F)") checked before 'E' so a
 * more specific "mental health" phrase wins over the broader "health" match.
 * Order matters — first matching key wins. */
const ORG_NTEE_KEYWORDS: Array<[string, string[]]> = [
  ["F", ["mental health", "behavioral health", "substance abuse", "counseling"]],
  ["L", ["housing", "shelter", "homeless", "transitional housing"]],
  ["E", ["health", "medical", "healthcare", "hospital", "clinic"]],
  ["B", ["education", "school", "literacy", "tutoring", "scholarship"]],
  ["O", ["youth development", "youth", "mentoring"]],
  ["P", ["human services", "social services", "family services", "crisis", "food bank"]],
  ["A", ["arts", "culture", "museum", "theater", "music"]],
  ["C", ["environment", "conservation", "wildlife", "sustainability"]],
  ["D", ["animal welfare", "humane society", "animal rescue"]],
  ["X", ["religion", "faith", "church", "ministry"]],
  ["Q", ["international", "refugee", "global"]],
  ["S", ["community development", "economic development", "community improvement"]],
];

/** Hardcoded org-major-group -> compatible-funder-major-group compatibility
 * matrix, per the task spec's three worked examples (E/F health, L housing,
 * B education) extended to the rest of ORG_NTEE_KEYWORDS's vocabulary so
 * every inferable org type has a rule. `T` (IRS "Philanthropy, Voluntarism &
 * Grantmaking Foundations") stands in for "community foundations" in every
 * entry, matching the task's repeated "+ community foundations" clause; it
 * is also detected directly off `foundation_type` (see computeNteeScore) for
 * foundations whose ntee_code wasn't classified under T. */
const NTEE_COMPATIBILITY_MATRIX: Record<string, NteeRule> = {
  E: { primary: ["E", "F"], secondary: ["P", "T"], keywords: ["health", "medical", "wellness", "clinic"] },
  F: { primary: ["F", "E"], secondary: ["P", "T"], keywords: ["mental health", "behavioral health", "counseling"] },
  L: { primary: ["L"], secondary: ["T", "S"], keywords: ["housing", "shelter", "affordable housing", "hud"] },
  B: { primary: ["B"], secondary: ["T"], keywords: ["education", "scholarship", "stem", "technology", "literacy"] },
  O: { primary: ["O"], secondary: ["B", "P", "T"], keywords: ["youth", "mentoring"] },
  P: { primary: ["P"], secondary: ["E", "L", "T"], keywords: ["human services", "family", "crisis"] },
  A: { primary: ["A"], secondary: ["T"], keywords: ["arts", "culture"] },
  C: { primary: ["C"], secondary: ["T"], keywords: ["environment", "conservation"] },
  D: { primary: ["D"], secondary: ["T"], keywords: ["animal welfare"] },
  X: { primary: ["X"], secondary: ["T"], keywords: ["faith", "religion"] },
  Q: { primary: ["Q"], secondary: ["T"], keywords: ["international", "refugee"] },
  S: { primary: ["S"], secondary: ["L", "T"], keywords: ["community development"] },
};

function toStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === "string");
}

function digitsOnly(value: string): string {
  return value.replace(/[^0-9]/g, "");
}

/** Tries a handful of plausible EIN formats against `nonprofits.ein`, since
 * the real stored format isn't guaranteed to match `organizations.ein`'s
 * format exactly (see file header re: the BMF import's known bugs). */
async function lookupNteeFromBmf(
  supabase: SupabaseClient,
  ein: string,
): Promise<string | null> {
  const raw = ein.trim();
  const digits = digitsOnly(raw);
  const dashed = digits.length === 9 ? `${digits.slice(0, 2)}-${digits.slice(2)}` : null;
  const candidates = Array.from(new Set([raw, digits, dashed].filter((v): v is string => Boolean(v))));

  for (const candidate of candidates) {
    try {
      const { data } = await supabase
        .from("nonprofits")
        .select("ntee_code")
        .eq("ein", candidate)
        .maybeSingle();
      const row = data as NonprofitBmfRow | null;
      if (row?.ntee_code && row.ntee_code.trim()) {
        return row.ntee_code.trim().charAt(0).toUpperCase();
      }
    } catch {
      // `nonprofits` may not exist yet in every environment, or the lookup
      // may simply miss — degrade to the keyword fallback either way.
      return null;
    }
  }
  return null;
}

function inferOrgNteeMajorGroupFromText(org: OrgProfile): string | null {
  const haystack = [org.missionStatement, org.targetPopulation, org.serviceArea]
    .filter((v): v is string => Boolean(v))
    .join(" ")
    .toLowerCase();
  if (!haystack) return null;

  for (const [majorGroup, keywords] of ORG_NTEE_KEYWORDS) {
    if (keywords.some((kw) => haystack.includes(kw))) return majorGroup;
  }
  return null;
}

/** Resolves the org's NTEE major group: real IRS BMF data first (via EIN),
 * free-text keyword inference second. Returns null if neither source
 * yields anything — callers treat that as "unknown cause area", not zero
 * matches. */
async function resolveOrgNteeMajorGroup(
  supabase: SupabaseClient,
  org: OrgProfile,
): Promise<{ majorGroup: string | null; source: "bmf" | "inferred" | "unknown" }> {
  if (org.ein) {
    const fromBmf = await lookupNteeFromBmf(supabase, org.ein);
    if (fromBmf) return { majorGroup: fromBmf, source: "bmf" };
  }
  const inferred = inferOrgNteeMajorGroupFromText(org);
  return { majorGroup: inferred, source: inferred ? "inferred" : "unknown" };
}

async function loadCandidateFoundations(
  supabase: SupabaseClient,
  orgMajorGroup: string | null,
): Promise<FoundationDirectoryRow[]> {
  let query = supabase
    .from("foundation_directory")
    .select(
      "id, name, ein, ntee_code, foundation_type, asset_amount, city, state, geographic_focus, officers, contact_emails, enrichment",
    )
    .not("asset_amount", "is", null);

  const rule = orgMajorGroup ? NTEE_COMPATIBILITY_MATRIX[orgMajorGroup] : undefined;
  if (rule) {
    const prefixes = Array.from(new Set([...rule.primary, ...rule.secondary]));
    const orFilter = prefixes.map((p) => `ntee_code.ilike.${p}%`).join(",");
    query = query.or(`${orFilter},foundation_type.ilike.%community%`);
  }

  const { data, error } = await query
    .order("asset_amount", { ascending: false, nullsFirst: false })
    .limit(CANDIDATE_POOL_LIMIT);

  if (error) {
    throw new Error(`Failed to load foundation_directory candidates: ${error.message}`);
  }
  return (data ?? []) as FoundationDirectoryRow[];
}

function computeNteeScore(
  orgMajorGroup: string | null,
  foundation: FoundationDirectoryRow,
): { score: number; reason: string | null } {
  const rule = orgMajorGroup ? NTEE_COMPATIBILITY_MATRIX[orgMajorGroup] : undefined;
  if (!orgMajorGroup || !rule) {
    return { score: 0.2, reason: null };
  }

  const foundationMajor = foundation.ntee_code?.trim().charAt(0).toUpperCase() ?? null;
  let score = 0;
  let reason: string | null = null;

  if (foundationMajor && rule.primary.includes(foundationMajor)) {
    score = 1.0;
    reason = `Foundation's NTEE code (${foundationMajor}) directly matches your organization's cause area`;
  } else if (foundationMajor && rule.secondary.includes(foundationMajor)) {
    score = 0.6;
    reason = `Foundation's NTEE code (${foundationMajor}) is a compatible funding category for your cause area`;
  }

  const isCommunityFoundation = (foundation.foundation_type ?? "").toLowerCase().includes("community");
  if (isCommunityFoundation && score < 0.5) {
    score = 0.5;
    reason = reason ?? "Community foundation with broad local funding priorities";
  }

  const haystack = [foundation.name, foundation.foundation_type ?? ""].join(" ").toLowerCase();
  const matchedKeyword = rule.keywords.find((kw) => haystack.includes(kw));
  if (matchedKeyword && score < 1.0) {
    score = Math.min(1, score + 0.2);
    reason = reason ?? `Funding priorities align with "${matchedKeyword}"`;
  }

  return { score, reason };
}

function computeGeoScore(
  org: OrgProfile,
  foundation: FoundationDirectoryRow,
): { score: number; reason: string } {
  const orgCity = org.city?.trim().toLowerCase() || null;
  const orgState = org.state?.trim().toUpperCase() || null;
  const fCity = foundation.city?.trim().toLowerCase() || null;
  const fState = foundation.state?.trim().toUpperCase() || null;
  const focusText = (foundation.geographic_focus ?? "").toLowerCase();
  const isNational = focusText.includes("national") || focusText.includes("nationwide");

  if (orgCity && fCity && orgCity === fCity) {
    return { score: SAME_CITY_SCORE, reason: `Located in your city (${foundation.city})` };
  }
  if (orgState && fState && orgState === fState) {
    return { score: SAME_STATE_SCORE, reason: `Located in your state (${fState})` };
  }
  if (isNational || (!fCity && !fState)) {
    return { score: NATIONAL_FUNDER_SCORE, reason: "National funder with no geographic restriction on file" };
  }
  return {
    score: OUT_OF_STATE_SCORE,
    reason: `Located outside your state (${[foundation.city, foundation.state].filter(Boolean).join(", ")})`,
  };
}

function computeAssetScore(
  org: OrgProfile,
  foundation: FoundationDirectoryRow,
): { score: number; reason: string | null; typicalGrant: number | null } {
  if (!org.annualBudget || org.annualBudget <= 0 || foundation.asset_amount == null) {
    return { score: 0.3, reason: null, typicalGrant: null };
  }

  const typicalGrant = org.annualBudget * TYPICAL_GRANT_RATE;
  const minAsset = typicalGrant * ASSET_MULTIPLE_MIN;
  const maxAsset = typicalGrant * ASSET_MULTIPLE_MAX;

  if (foundation.asset_amount >= minAsset && foundation.asset_amount <= maxAsset) {
    return {
      score: 1.0,
      reason: `Foundation assets ($${Math.round(foundation.asset_amount).toLocaleString()}) are sized to fund a request around $${Math.round(typicalGrant).toLocaleString()}`,
      typicalGrant,
    };
  }
  return { score: 0, reason: null, typicalGrant };
}

function computePriorGivingScore(
  foundation: FoundationDirectoryRow,
  orgMajorGroup: string | null,
): { score: number; reason: string | null } {
  if (!orgMajorGroup) return { score: 0, reason: null };

  const foundationMajor = foundation.ntee_code?.trim().charAt(0).toUpperCase() ?? null;
  const grantCount = foundation.enrichment?.grant_count ?? 0;
  const fiscalYear = foundation.enrichment?.fiscal_year ?? 0;
  const cutoffYear = new Date().getFullYear() - PRIOR_GIVING_LOOKBACK_YEARS;

  if (foundationMajor === orgMajorGroup && grantCount > 0 && fiscalYear >= cutoffYear) {
    return {
      score: 1.0,
      reason: `Funded ${grantCount} similar (NTEE ${orgMajorGroup}) organizations as recently as fiscal year ${fiscalYear}`,
    };
  }
  return { score: 0, reason: null };
}

function extractFirstOfficerName(officers: unknown): string | undefined {
  if (!Array.isArray(officers) || officers.length === 0) return undefined;
  const entry = officers[0];
  if (typeof entry === "string" && entry.trim()) return entry.trim();
  if (entry && typeof entry === "object") {
    const name = (entry as { name?: unknown }).name;
    if (typeof name === "string" && name.trim()) return name.trim();
  }
  return undefined;
}

function extractContactInfo(foundation: FoundationDirectoryRow): { name?: string; email?: string } {
  const info: { name?: string; email?: string } = {};
  const name = extractFirstOfficerName(foundation.officers);
  if (name) info.name = name;
  const emails = toStringArray(foundation.contact_emails);
  if (emails.length > 0) info.email = emails[0];
  return info;
}

function estimateGrantRange(
  foundation: FoundationDirectoryRow,
  typicalGrant: number | null,
): { min: number; max: number } {
  const rangeMin = foundation.enrichment?.grant_range_min;
  const rangeMax = foundation.enrichment?.grant_range_max;
  if (typeof rangeMin === "number" && typeof rangeMax === "number" && rangeMax > 0) {
    return { min: Math.round(rangeMin), max: Math.round(rangeMax) };
  }
  if (typicalGrant) {
    return { min: Math.round(typicalGrant * 0.5), max: Math.round(typicalGrant * 1.5) };
  }
  return { min: 0, max: 0 };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Scores `foundation_directory` records against an org's profile using the
 * four-factor NTEE / geographic / asset-size / prior-giving model described
 * in the task spec (weights 35/30/20/15). Returns matches scoring at least
 * 0.50, sorted descending, capped at 25.
 */
export async function findMatchingFoundations(
  orgProfile: OrgProfile,
  supabase: SupabaseClient,
): Promise<FoundationMatch[]> {
  const { majorGroup: orgMajorGroup } = await resolveOrgNteeMajorGroup(supabase, orgProfile);
  const candidates = await loadCandidateFoundations(supabase, orgMajorGroup);

  const matches: FoundationMatch[] = [];

  for (const foundation of candidates) {
    const ntee = computeNteeScore(orgMajorGroup, foundation);
    const geo = computeGeoScore(orgProfile, foundation);
    const asset = computeAssetScore(orgProfile, foundation);
    const prior = computePriorGivingScore(foundation, orgMajorGroup);

    const matchScore = round2(
      ntee.score * NTEE_WEIGHT +
        geo.score * GEO_WEIGHT +
        asset.score * ASSET_WEIGHT +
        prior.score * PRIOR_WEIGHT,
    );

    if (matchScore < MATCH_THRESHOLD) continue;

    const reasons = [ntee.reason, geo.reason, asset.reason, prior.reason].filter(
      (r): r is string => Boolean(r),
    );

    matches.push({
      foundation_id: foundation.id,
      foundation_name: foundation.name,
      ein: foundation.ein ?? "",
      match_score: matchScore,
      match_reasons: reasons.length > 0 ? reasons : ["Meets the minimum multi-factor compatibility threshold"],
      estimated_grant_range: estimateGrantRange(foundation, asset.typicalGrant),
      contact_info: extractContactInfo(foundation),
    });
  }

  return matches.sort((a, b) => b.match_score - a.match_score).slice(0, MAX_RESULTS);
}
