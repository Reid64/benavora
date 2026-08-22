import type { DdGeography } from "@/lib/donor-discovery/adapters/google-places";
import type { Json } from "@/types/database";

/**
 * Deterministic prospect scoring (DONOR_DISCOVERY_ARCHITECTURE.md §2D).
 * `scoreProspect` is pure — no I/O, no database access — so the worker's
 * scoring stage (worker/dd-request-processor.ts) does all the fetching
 * (directory record, org budget, linked foundation's giving capacity) and
 * hands this module plain data. That's what makes the weight math and
 * rationale text unit-testable without a database.
 */

// ── Weights ──────────────────────────────────────────────────────────────────

export interface ScoringWeights {
  givingProgram: number;
  donationForm: number;
  inKindSignals: number;
  linkedFoundation: number;
  geoMatch: number;
  sizeAppropriate: number;
  /** NEW (2026-08-22, grantmaker-mode spread fix): tiered by asset_amount. Fires from BMF data alone, no web enrichment needed. */
  assetSize: number;
  /** NEW: bonus for a foundation structurally confirmed as a grantmaker (NTEE T2x/T3x or foundation_type 02/03/04) — see bmf-directory.ts's module doc. */
  grantmakerType: number;
  /** NEW: bonus for HQ proximity to the requesting org's own city/state — distinct from geoMatch (which only checks the *requested* geography). */
  geoProximityToOrg: number;
  /** NEW: confidence of the cause-match method recorded in enrichment.match_basis by bmf-directory.ts (ntee_code_direct > name_keyword_match). */
  matchBasisQuality: number;
}

/**
 * Sums to 100 — DONOR_DISCOVERY_ARCHITECTURE.md §2D's point allocation,
 * rebalanced 2026-08-22 to add four grantmaker-mode signals (assetSize,
 * grantmakerType, geoProximityToOrg, matchBasisQuality) that fire from BMF
 * data alone. The original six web-enrichment-leaning weights were reduced
 * proportionally to make room — see the rubric section in
 * DONOR_DISCOVERY_ARCHITECTURE.md for the full rationale and worked example.
 */
export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  givingProgram: 15,
  donationForm: 15,
  inKindSignals: 10,
  linkedFoundation: 10,
  geoMatch: 10,
  sizeAppropriate: 5,
  assetSize: 15,
  grantmakerType: 10,
  geoProximityToOrg: 5,
  matchBasisQuality: 5,
};

/**
 * Merges `organizations.donor_discovery_scoring_weights` (migration 074)
 * onto the defaults. Only finite, non-negative numeric overrides for known
 * weight keys are honored; anything else (missing column, malformed jsonb,
 * a negative or non-numeric override) falls back to the default for that key.
 */
export function parseScoringWeights(raw: Json | null | undefined): ScoringWeights {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_SCORING_WEIGHTS };
  }

  const obj = raw as Record<string, unknown>;
  const merged = { ...DEFAULT_SCORING_WEIGHTS };

  for (const key of Object.keys(DEFAULT_SCORING_WEIGHTS) as Array<keyof ScoringWeights>) {
    const value = obj[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      merged[key] = value;
    }
  }

  return merged;
}

// ── Inputs ───────────────────────────────────────────────────────────────────

/** The subset of `donor_discovery_directory` scoring needs. */
export interface ScoringDirectoryRecord {
  /** `donor_discovery_directory.enrichment` (§2B `DonorProspectExtraction` shape, loosely typed since it's jsonb). */
  enrichment: Record<string, unknown> | null;
  hq_address: string | null;
  geo: { lat: number; lng: number } | null;
  linked_foundation_id: string | null;
  /** 0..1, or null/undefined when unlinked. */
  linkage_confidence: number | null;
}

export interface ScoringRequestContext {
  geography: DdGeography;
  /** The requesting org's own annual operating budget (`organizations.annual_budget`). */
  organizationAnnualBudget?: number | null;
  /** Linked foundation's giving capacity (`foundation_directory.giving_total`, falling back to `asset_amount`), when `linked_foundation_id` is set. */
  linkedFoundationGivingCapacity?: number | null;
  /** NEW: requesting org's own `organizations.city` — powers geoProximityToOrg. */
  organizationCity?: string | null;
  /** NEW: requesting org's own `organizations.state` — powers geoProximityToOrg. */
  organizationState?: string | null;
}

export interface ScoreResult {
  score: number;
  rationale: string;
}

// ── Signal: giving program / donation form / in-kind ────────────────────────

// giving_focus_areas is free text extracted by Claude (web-extractor.ts); no
// dedicated "in-kind" field exists in the extraction schema, so in-kind
// evidence is detected as a keyword match against the focus-area text —
// the closest concrete signal §2B actually produces today.
const IN_KIND_KEYWORDS = [
  "in-kind",
  "in kind",
  "sponsorship",
  "sponsorships",
  "materials donation",
  "material donations",
  "equipment donation",
  "product donation",
  "donate materials",
  "donate equipment",
  "donated supplies",
];

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

function hasGivingProgram(enrichment: Record<string, unknown> | null): boolean {
  return enrichment?.has_giving_program === true;
}

function hasDonationForm(enrichment: Record<string, unknown> | null): boolean {
  return enrichment?.has_donation_form === true;
}

function hasInKindSignals(enrichment: Record<string, unknown> | null): boolean {
  if (!enrichment) return false;
  const haystack = asStringArray(enrichment.giving_focus_areas).join(" ").toLowerCase();
  if (!haystack) return false;
  return IN_KIND_KEYWORDS.some((keyword) => haystack.includes(keyword));
}

// ── Signal: geo match ────────────────────────────────────────────────────────

const EARTH_RADIUS_KM = 6371;
const KM_PER_MILE = 1.60934;

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(Math.min(1, h)));
}

// Pulls a two-letter state code from a formatted US address string like
// "123 Main St, Austin, TX 78701" or "Austin, TX" (zip optional — BMF-sourced
// addresses (bmf-directory.ts's hqAddress()) don't always carry a zip; a
// zip-required regex here silently disabled this signal for every BMF
// prospect until 2026-08-22 — see DONOR_DISCOVERY_ARCHITECTURE.md's rubric
// section). Requires the trailing token to look like a real US state code
// (2 letters preceded by a comma), not just any 2-letter word.
function extractStateFromAddress(address: string | null): string | null {
  if (!address) return null;
  const match = address.match(/,\s*([A-Za-z]{2})(?:\s*\d{5}(-\d{4})?)?\s*$/);
  return match?.[1] ? match[1].toUpperCase() : null;
}

function isGeoMatch(record: ScoringDirectoryRecord, geography: DdGeography): boolean {
  if ("national" in geography && geography.national) return true;

  if ("center" in geography && "radius_mi" in geography) {
    if (!record.geo) return false;
    return haversineKm(record.geo, geography.center) <= geography.radius_mi * KM_PER_MILE;
  }

  if ("states" in geography) {
    const state = extractStateFromAddress(record.hq_address);
    if (!state) return false;
    return geography.states.some((s) => s.toUpperCase() === state);
  }

  return false;
}

// ── Signal: geo proximity to the requesting org (distinct from geoMatch) ────
// geoMatch only checks whether a prospect falls inside the *requested*
// geography (which, for a states/national request, every result already
// satisfies by construction — SQL filtered on it). This signal instead
// rewards prospects close to the org's *own* location: same city as the org
// scores highest, same state scores partial credit, neither scores zero.
// Deliberately coarse (no distance geocoding — foundation_directory has no
// lat/lng) but real, city/state-derived spread rather than a constant.
// City is always the comma-segment immediately before the state segment,
// regardless of whether a street prefix is present ("City, ST zip" from
// bmf-directory.ts's hqAddress(), or "Street, City, ST zip" from adapters
// that do include a street) — taking the *first* segment (an earlier draft
// of this function did) silently mis-extracts the street as the city
// whenever one is present.
function extractCityFromAddress(address: string): string | null {
  const parts = address
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length < 2) return null;
  return parts[parts.length - 2] ?? null;
}

function geoProximityScore(
  record: ScoringDirectoryRecord,
  context: ScoringRequestContext,
): number {
  if (!context.organizationState) return 0;
  const address = record.hq_address ?? "";
  const state = extractStateFromAddress(address);
  if (!state || state !== context.organizationState.toUpperCase()) return 0;

  if (context.organizationCity) {
    const cityPart = extractCityFromAddress(address)?.toUpperCase();
    if (cityPart && cityPart === context.organizationCity.trim().toUpperCase()) {
      return 1; // same city — full credit
    }
  }
  return 0.5; // same state, different (or unknown) city — partial credit
}

// ── Signal: asset size (tiered, fires from BMF data alone) ─────────────────
// A foundation's own asset base is a real, always-available capacity signal
// for grantmaker-mode prospects that have zero web enrichment — bigger
// endowment generally means bigger grants and more grantmaking activity.
// Tiered (not a raw multiplier) so a single outlier mega-foundation doesn't
// dominate the scale; see DONOR_DISCOVERY_ARCHITECTURE.md's rubric section
// for the tier boundaries and worked example.
const ASSET_SIZE_TIERS: Array<{ min: number; fraction: number }> = [
  { min: 50_000_000, fraction: 1.0 },
  { min: 10_000_000, fraction: 0.75 },
  { min: 2_000_000, fraction: 0.5 },
  { min: 0, fraction: 0.25 },
];

function assetSizeFraction(enrichment: Record<string, unknown> | null): number {
  const raw = enrichment?.asset_amount;
  const assets = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(assets) || assets <= 0) return 0;
  for (const tier of ASSET_SIZE_TIERS) {
    if (assets >= tier.min) return tier.fraction;
  }
  return 0;
}

// ── Signal: grantmaker type confidence (fires from BMF data alone) ─────────
// bmf-directory.ts's grantmaker-mode structural filter already narrowed
// enumeration to foundation_type in (02,03,04) OR ntee T2%/T3%, and stamps
// `is_grantmaker_ntee`/`is_grantmaker_foundation_type` onto enrichment at
// upsert time. NTEE T2x/T3x ("grantmaking" is the org's own primary IRS
// activity code) is the stronger of the two signals — full credit; the
// foundation_type-only case is real but weaker (private-foundation tax
// status doesn't by itself distinguish a grantmaker from a private operating
// foundation) — partial credit.
function grantmakerTypeFraction(enrichment: Record<string, unknown> | null): number {
  if (!enrichment) return 0;
  if (enrichment.is_grantmaker_ntee === true) return 1;
  if (enrichment.is_grantmaker_foundation_type === true) return 0.5;
  return 0;
}

// ── Signal: match_basis quality (fires from BMF data alone) ────────────────
// Mirrors bmf-directory.ts's cause-match tiering (see its module doc):
// ntee_code_direct (the foundation's own classification already is the
// requested cause) is a stronger signal than name_keyword_match (a fallback
// text match). operating_nonprofit_mode / missing / unrecognized carries no
// credit — it isn't a grantmaker-mode cause-match result at all.
const MATCH_BASIS_FRACTIONS: Record<string, number> = {
  "990pf_grants_data": 1,
  ntee_code_direct: 1,
  name_keyword_match: 0.5,
};

function matchBasisFraction(enrichment: Record<string, unknown> | null): number {
  const basis = enrichment?.match_basis;
  return typeof basis === "string" ? (MATCH_BASIS_FRACTIONS[basis] ?? 0) : 0;
}

// ── Signal: size-appropriate ─────────────────────────────────────────────────

// A funder whose total giving is a rounding error next to the org's budget
// isn't a realistic ask; one many orders of magnitude larger is likely an
// institutional grantmaker this generic prospecting pass shouldn't claim
// credit for identifying. Both bounds are deliberately generous — this is a
// coarse plausibility filter, not an eligibility gate.
const SIZE_APPROPRIATE_MIN_RATIO = 0.02;
const SIZE_APPROPRIATE_MAX_RATIO = 200;

function isSizeAppropriate(context: ScoringRequestContext): boolean {
  const budget = context.organizationAnnualBudget;
  const capacity = context.linkedFoundationGivingCapacity;
  if (!budget || budget <= 0 || !capacity || capacity <= 0) return false;
  const ratio = capacity / budget;
  return ratio >= SIZE_APPROPRIATE_MIN_RATIO && ratio <= SIZE_APPROPRIATE_MAX_RATIO;
}

// ── Rationale ────────────────────────────────────────────────────────────────

function joinWithCommasAnd(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

interface FiredSignals {
  givingProgram: boolean;
  donationForm: boolean;
  inKindSignals: boolean;
  linkedFoundation: boolean;
  linkageConfidencePct: number;
  geoMatch: boolean;
  sizeAppropriate: boolean;
  assetSizeFraction: number;
  grantmakerTypeFraction: number;
  geoProximityFraction: number;
  matchBasis: string | null;
}

function assetSizeDescription(fraction: number): string | null {
  if (fraction >= 1) return "has a large asset base (>= $50M)";
  if (fraction >= 0.75) return "has a substantial asset base (>= $10M)";
  if (fraction >= 0.5) return "has a moderate asset base (>= $2M)";
  if (fraction > 0) return "has an asset base on file";
  return null;
}

function matchBasisDescription(basis: string | null): string | null {
  if (basis === "ntee_code_direct" || basis === "990pf_grants_data") {
    return "is directly classified under the requested cause area";
  }
  if (basis === "name_keyword_match") {
    return "matched the requested cause area by name";
  }
  return null;
}

function buildRationale(signals: FiredSignals): string {
  const parts: string[] = [];
  if (signals.givingProgram) parts.push("has an active giving program");
  if (signals.donationForm) parts.push("has a donation or sponsorship request form");
  if (signals.inKindSignals) parts.push("shows in-kind giving signals");
  if (signals.linkedFoundation) {
    parts.push(`is linked to a corporate foundation (${signals.linkageConfidencePct}% confidence)`);
  }
  if (signals.geoMatch) parts.push("is located within the requested geography");
  if (signals.sizeAppropriate) parts.push("is sized appropriately for this ask");
  const assetDesc = assetSizeDescription(signals.assetSizeFraction);
  if (assetDesc) parts.push(assetDesc);
  if (signals.grantmakerTypeFraction >= 1) parts.push("is IRS-classified as a grantmaking foundation");
  else if (signals.grantmakerTypeFraction > 0) parts.push("is registered as a private foundation");
  if (signals.geoProximityFraction >= 1) parts.push("is headquartered in the same city as your organization");
  else if (signals.geoProximityFraction > 0) parts.push("is headquartered in the same state as your organization");
  const matchDesc = matchBasisDescription(signals.matchBasis);
  if (matchDesc) parts.push(matchDesc);

  if (parts.length === 0) return "No positive signals found for this prospect.";

  return `This prospect ${joinWithCommasAnd(parts)}.`;
}

// ── Public entry point ───────────────────────────────────────────────────────

/**
 * Deterministic 0-100 score for one directory record against one request's
 * context. Same inputs always produce the same output — no randomness, no
 * network/database calls, no dependence on wall-clock time.
 */
export function scoreProspect(
  directoryRecord: ScoringDirectoryRecord,
  requestContext: ScoringRequestContext,
  weights: ScoringWeights = DEFAULT_SCORING_WEIGHTS,
): ScoreResult {
  const enrichment = directoryRecord.enrichment;

  const givingProgramFired = hasGivingProgram(enrichment);
  const donationFormFired = hasDonationForm(enrichment);
  const inKindFired = hasInKindSignals(enrichment);
  const linkageConfidence = directoryRecord.linked_foundation_id
    ? Math.max(0, Math.min(1, directoryRecord.linkage_confidence ?? 0))
    : 0;
  const geoMatchFired = isGeoMatch(directoryRecord, requestContext.geography);
  const sizeAppropriateFired = isSizeAppropriate(requestContext);
  const assetFraction = assetSizeFraction(enrichment);
  const grantmakerFraction = grantmakerTypeFraction(enrichment);
  const geoProximityFraction = geoProximityScore(directoryRecord, requestContext);
  const matchFraction = matchBasisFraction(enrichment);
  const matchBasis = typeof enrichment?.match_basis === "string" ? (enrichment.match_basis as string) : null;

  const rawScore =
    (givingProgramFired ? weights.givingProgram : 0) +
    (donationFormFired ? weights.donationForm : 0) +
    (inKindFired ? weights.inKindSignals : 0) +
    weights.linkedFoundation * linkageConfidence +
    (geoMatchFired ? weights.geoMatch : 0) +
    (sizeAppropriateFired ? weights.sizeAppropriate : 0) +
    weights.assetSize * assetFraction +
    weights.grantmakerType * grantmakerFraction +
    weights.geoProximityToOrg * geoProximityFraction +
    weights.matchBasisQuality * matchFraction;

  const score = Math.round(Math.max(0, Math.min(100, rawScore)));

  const rationale = buildRationale({
    givingProgram: givingProgramFired,
    donationForm: donationFormFired,
    inKindSignals: inKindFired,
    linkedFoundation: linkageConfidence > 0,
    linkageConfidencePct: Math.round(linkageConfidence * 100),
    geoMatch: geoMatchFired,
    sizeAppropriate: sizeAppropriateFired,
    assetSizeFraction: assetFraction,
    grantmakerTypeFraction: grantmakerFraction,
    geoProximityFraction,
    matchBasis,
  });

  return { score, rationale };
}
