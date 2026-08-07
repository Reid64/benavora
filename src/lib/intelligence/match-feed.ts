// Personalized Match Feed (FEATURE_REGISTRY_v2.md #85, Phase 2 Pillar 2 —
// "per-org scoring of opportunities against the org's Digital Twin").
//
// Deterministic (non-Claude), following the same design principle as AG-15's
// grant-probability-engine.ts: the ranking itself must be inspectable and
// must not depend on a Claude call (latency/cost shouldn't gate a feed that
// needs to load fast). A Claude-written one-line summary could be layered on
// top later as an optional enrichment; this module deliberately does not add
// one — the deterministic keyword-overlap reasons already explain "why" a
// match ranked where it did.
//
// Purpose: rank an org's open `opportunities` by how well each one's subject
// matter (name/description/eligibility text) aligns with what the org's
// Organizational Digital Twin (migration 093) says the org actually does —
// its mission, its programs, its service areas — then blend that affinity
// score with AG-15's own `opportunity_probability_scores.overall_score` when
// one exists for that opportunity, so the feed reflects both "does this fit
// what we do" and "how likely are we to actually win it."
//
// Real data sources (organization_id-scoped, confirmed live against
// migration 093 / 001 DDL — do not add fields not present in these tables):
//   - organizational_digital_twins: mission (text), programs (jsonb array of
//     {title, description}), service_areas (text[]), key_strengths (text[]),
//     twin_completeness_score (integer 0-100).
//   - opportunities: name, description, eligibility_requirements,
//     geographic_restrictions, category, amount_min/max, deadline, status.
//   - opportunity_probability_scores: overall_score (AG-15's real output,
//     only present once AG-15 has scored a given opportunity/org pair).
//
// Affinity score (0-100), three weighted signals summing to 100%:
//   1. mission_affinity   40% — keyword overlap between the twin's mission +
//      key_strengths and the opportunity's name/description/eligibility text.
//   2. program_affinity   35% — best-matching twin program's keyword overlap
//      against the same opportunity text (programs are concrete service
//      offerings, a distinct signal from mission language).
//   3. geographic_fit     25% — twin.service_areas vs the opportunity's
//      geographic_restrictions text.
//
// Combined score: when AG-15 has already scored this opportunity for this
// org, combinedScore = affinityScore * 0.55 + overall_score * 0.45. When no
// AG-15 score exists yet (the same open-vs-scored branch AG-15's own
// grant-probability-engine.ts already documents), weight is not fabricated —
// combinedScore = affinityScore, unblended, and the result is flagged
// probabilityBlended: false so the UI can be honest about it.
//
// Personalization confidence is reported separately from the score itself
// (never silently baked in) — driven by twin.twin_completeness_score, so a
// caller can surface "personalization is limited, your Digital Twin is only
// N% complete" instead of presenting a ranking as meaningful when the
// underlying Twin barely has content.

const NEUTRAL_MISSION_AFFINITY = 0.3;
const NEUTRAL_PROGRAM_AFFINITY = 0.3;
const NEUTRAL_GEO_FIT = 0.5;

const MISSION_WEIGHT = 0.4;
const PROGRAM_WEIGHT = 0.35;
const GEO_WEIGHT = 0.25;

const AFFINITY_BLEND_WEIGHT = 0.55;
const PROBABILITY_BLEND_WEIGHT = 0.45;

const MAX_OPPORTUNITIES_SCANNED = 500;
const DEFAULT_FEED_SIZE = 25;

// Common English stopwords plus grant-domain filler words that appear in
// nearly every opportunity/mission text and would inflate overlap without
// carrying real subject-matter signal (e.g. "grant"/"funding"/"apply").
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "for", "with",
  "as", "by", "at", "from", "is", "are", "was", "were", "be", "been", "being",
  "this", "that", "these", "those", "it", "its", "their", "our", "your", "we",
  "you", "they", "will", "shall", "may", "can", "not", "no", "any", "all",
  "each", "other", "such", "than", "then", "which", "who", "whom", "what",
  "into", "through", "during", "before", "after", "above", "below", "up",
  "down", "out", "off", "over", "under", "again", "further", "once", "here",
  "there", "when", "where", "why", "how", "if", "have", "has", "had", "do",
  "does", "did", "must", "should", "would", "about", "per", "including",
  "grant", "grants", "grantee", "grantees", "funding", "funder", "funders",
  "fund", "funds", "apply", "applying", "application", "applications",
  "opportunity", "opportunities", "organization", "organizations", "org",
  "orgs", "nonprofit", "nonprofits", "program", "programs", "project",
  "projects", "eligible", "eligibility", "requirement", "requirements",
  "amount", "award", "awards", "deadline", "must", "will", "may",
]);

function tokenize(...parts: (string | null | undefined)[]): Set<string> {
  const text = parts.filter((p): p is string => !!p && p.trim() !== "").join(" ");
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w) && !/^\d+$/.test(w));
  return new Set(words);
}

function overlapRatio(base: Set<string>, other: Set<string>): {
  ratio: number;
  matched: string[];
} {
  if (base.size === 0) return { ratio: 0, matched: [] };
  const matched: string[] = [];
  for (const w of base) {
    if (other.has(w)) matched.push(w);
  }
  return { ratio: Math.min(1, matched.length / base.size), matched };
}

export interface DigitalTwinRow {
  mission: string | null;
  service_areas: string[] | null;
  programs: { title?: string; description?: string }[] | null;
  key_strengths: string[] | null;
  twin_completeness_score: number | null;
}

export interface OpportunityRow {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  eligibility_requirements: string | null;
  geographic_restrictions: string | null;
  amount_min: number | null;
  amount_max: number | null;
  deadline: string | null;
  funder_id: string | null;
}

export interface MatchFeedFactor {
  name: "mission_affinity" | "program_affinity" | "geographic_fit";
  weight: number;
  value: number;
  contribution: number;
}

export interface MatchFeedEntry {
  opportunityId: string;
  opportunityName: string;
  category: string | null;
  amountMin: number | null;
  amountMax: number | null;
  deadline: string | null;
  funderId: string | null;
  funderName: string | null;
  affinityScore: number;
  probabilityScore: number | null;
  probabilityBlended: boolean;
  combinedScore: number;
  factors: MatchFeedFactor[];
  matchedProgram: string | null;
  reasons: string[];
}

export type PersonalizationLevel = "none" | "limited" | "partial" | "strong";

export interface MatchFeedResult {
  personalizationLevel: PersonalizationLevel;
  twinCompletenessScore: number;
  entries: MatchFeedEntry[];
  opportunitiesScanned: number;
  opportunitiesTotal: number;
}

function personalizationLevel(twinCompletenessScore: number): PersonalizationLevel {
  if (twinCompletenessScore <= 0) return "none";
  if (twinCompletenessScore < 40) return "limited";
  if (twinCompletenessScore < 70) return "partial";
  return "strong";
}

function factor(
  name: MatchFeedFactor["name"],
  weight: number,
  value: number,
): MatchFeedFactor {
  const clamped = Math.max(0, Math.min(1, value));
  return { name, weight, value: clamped, contribution: weight * clamped * 100 };
}

function scoreMission(
  twinKeywords: Set<string>,
  oppKeywords: Set<string>,
): { factor: MatchFeedFactor; matched: string[] } {
  if (twinKeywords.size === 0) {
    return { factor: factor("mission_affinity", MISSION_WEIGHT, NEUTRAL_MISSION_AFFINITY), matched: [] };
  }
  const { ratio, matched } = overlapRatio(twinKeywords, oppKeywords);
  return { factor: factor("mission_affinity", MISSION_WEIGHT, ratio), matched };
}

function scoreProgram(
  programs: { title?: string; description?: string }[],
  oppKeywords: Set<string>,
): { factor: MatchFeedFactor; program: string | null; matched: string[] } {
  if (!programs || programs.length === 0) {
    return {
      factor: factor("program_affinity", PROGRAM_WEIGHT, NEUTRAL_PROGRAM_AFFINITY),
      program: null,
      matched: [],
    };
  }

  let best = { ratio: 0, matched: [] as string[], title: null as string | null };
  for (const p of programs) {
    const title = p.title ?? null;
    const programKeywords = tokenize(p.title, p.description);
    if (programKeywords.size === 0) continue;
    const { ratio, matched } = overlapRatio(programKeywords, oppKeywords);
    if (ratio > best.ratio) {
      best = { ratio, matched, title };
    }
  }

  return {
    factor: factor("program_affinity", PROGRAM_WEIGHT, best.ratio),
    program: best.title,
    matched: best.matched,
  };
}

function scoreGeography(
  serviceAreas: string[],
  geographicRestrictions: string | null,
): { factor: MatchFeedFactor; matchedArea: string | null } {
  const restriction = (geographicRestrictions ?? "").trim();

  if (restriction === "") {
    // No stated restriction — treat as nationally open, a full geographic fit.
    return { factor: factor("geographic_fit", GEO_WEIGHT, 1.0), matchedArea: null };
  }

  if (serviceAreas.length === 0) {
    // Opportunity has a real restriction but the twin has no service areas
    // on record — genuinely unknown, not a fabricated match or mismatch.
    return { factor: factor("geographic_fit", GEO_WEIGHT, NEUTRAL_GEO_FIT), matchedArea: null };
  }

  const restrictionLower = restriction.toLowerCase();
  for (const area of serviceAreas) {
    const areaLower = area.toLowerCase().trim();
    if (areaLower === "") continue;
    if (restrictionLower.includes(areaLower) || areaLower.includes(restrictionLower)) {
      return { factor: factor("geographic_fit", GEO_WEIGHT, 1.0), matchedArea: area };
    }
  }

  // Real restriction present and none of the org's service areas matched it.
  return { factor: factor("geographic_fit", GEO_WEIGHT, 0.15), matchedArea: null };
}

function buildReasons(
  entry: {
    matchedMissionKeywords: string[];
    matchedProgram: string | null;
    matchedProgramKeywords: string[];
    matchedArea: string | null;
    geoRestriction: string | null;
  },
): string[] {
  const reasons: string[] = [];

  if (entry.matchedProgram && entry.matchedProgramKeywords.length > 0) {
    reasons.push(
      `Matches your program "${entry.matchedProgram}" (shared terms: ${entry.matchedProgramKeywords
        .slice(0, 4)
        .join(", ")}).`,
    );
  }

  if (entry.matchedMissionKeywords.length > 0) {
    reasons.push(
      `Aligns with your mission (shared terms: ${entry.matchedMissionKeywords.slice(0, 4).join(", ")}).`,
    );
  }

  if (entry.matchedArea) {
    reasons.push(`Located within your listed service area: ${entry.matchedArea}.`);
  } else if (entry.geoRestriction) {
    reasons.push(
      `Geographic restriction ("${entry.geoRestriction}") does not match any of your listed service areas.`,
    );
  }

  if (reasons.length === 0) {
    reasons.push(
      "Limited overlap found with your organizational profile — review manually before prioritizing.",
    );
  }

  return reasons;
}

/**
 * Compute the Personalized Match Feed for one org: ranks its open
 * opportunities by affinity to the org's Digital Twin, blended with any
 * existing AG-15 probability score. Read-only — computes in real time on
 * every call rather than persisting a new table, per this feature's own
 * scope (a cache/materialized table is a legitimate follow-up only if this
 * proves measurably expensive at real data volumes, not a speculative
 * addition up front).
 */
export async function computeMatchFeed(
  orgId: string,
  supabase: any,
  limit: number = DEFAULT_FEED_SIZE,
): Promise<MatchFeedResult> {
  const [twinRes, oppsRes] = await Promise.all([
    supabase
      .from("organizational_digital_twins")
      .select("mission, service_areas, programs, key_strengths, twin_completeness_score")
      .eq("organization_id", orgId)
      .maybeSingle(),
    supabase
      .from("opportunities")
      .select(
        "id, name, category, description, eligibility_requirements, geographic_restrictions, amount_min, amount_max, deadline, funder_id",
      )
      .eq("organization_id", orgId)
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(MAX_OPPORTUNITIES_SCANNED),
  ]);

  const twin = (twinRes.data ?? null) as DigitalTwinRow | null;
  const opportunities = (oppsRes.data ?? []) as OpportunityRow[];

  const twinCompletenessScore = twin?.twin_completeness_score ?? 0;
  const serviceAreas = (twin?.service_areas ?? []).filter((s) => !!s && s.trim() !== "");
  const programs = twin?.programs ?? [];
  const missionKeywords = tokenize(twin?.mission, ...(twin?.key_strengths ?? []));

  let probabilityByOpp = new Map<string, number>();
  let funderNameById = new Map<string, string>();
  if (opportunities.length > 0) {
    const oppIds = opportunities.map((o) => o.id);
    const funderIds = [...new Set(opportunities.map((o) => o.funder_id).filter((id): id is string => !!id))];

    const [probRes, fundersRes] = await Promise.all([
      supabase
        .from("opportunity_probability_scores")
        .select("opportunity_id, overall_score")
        .eq("organization_id", orgId)
        .in("opportunity_id", oppIds),
      funderIds.length > 0
        ? supabase.from("funders").select("id, name").in("id", funderIds)
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    ]);

    probabilityByOpp = new Map(
      ((probRes.data ?? []) as { opportunity_id: string; overall_score: number | null }[]).map((r) => [
        r.opportunity_id,
        r.overall_score ?? 0,
      ]),
    );
    funderNameById = new Map(
      ((fundersRes.data ?? []) as { id: string; name: string }[]).map((f) => [f.id, f.name]),
    );
  }

  const entries: MatchFeedEntry[] = opportunities.map((opp) => {
    const oppKeywords = tokenize(opp.name, opp.description, opp.eligibility_requirements);

    const mission = scoreMission(missionKeywords, oppKeywords);
    const program = scoreProgram(programs, oppKeywords);
    const geo = scoreGeography(serviceAreas, opp.geographic_restrictions);

    const factors = [mission.factor, program.factor, geo.factor];
    const affinityScore = Math.max(
      0,
      Math.min(100, Math.round(factors.reduce((sum, f) => sum + f.contribution, 0))),
    );

    const probabilityScore = probabilityByOpp.has(opp.id) ? probabilityByOpp.get(opp.id)! : null;
    const probabilityBlended = probabilityScore != null;
    const combinedScore = probabilityBlended
      ? Math.round(affinityScore * AFFINITY_BLEND_WEIGHT + probabilityScore! * PROBABILITY_BLEND_WEIGHT)
      : affinityScore;

    const reasons = buildReasons({
      matchedMissionKeywords: mission.matched,
      matchedProgram: program.program,
      matchedProgramKeywords: program.matched,
      matchedArea: geo.matchedArea,
      geoRestriction: opp.geographic_restrictions,
    });

    return {
      opportunityId: opp.id,
      opportunityName: opp.name,
      category: opp.category,
      amountMin: opp.amount_min,
      amountMax: opp.amount_max,
      deadline: opp.deadline,
      funderId: opp.funder_id,
      funderName: opp.funder_id ? funderNameById.get(opp.funder_id) ?? null : null,
      affinityScore,
      probabilityScore,
      probabilityBlended,
      combinedScore,
      factors,
      matchedProgram: program.program,
      reasons,
    };
  });

  entries.sort((a, b) => b.combinedScore - a.combinedScore);

  return {
    personalizationLevel: personalizationLevel(twinCompletenessScore),
    twinCompletenessScore,
    entries: entries.slice(0, limit),
    opportunitiesScanned: opportunities.length,
    opportunitiesTotal: opportunities.length,
  };
}
