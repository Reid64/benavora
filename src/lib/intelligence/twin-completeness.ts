// Digital Twin Completeness Engine (AUTONOMOUS_PLATFORM_VISION.md Phase 2
// "Fundability Intelligence Score" / AGENTS_v2.md AG-16 Digital Twin Builder).
//
// There is no `OrganizationalDigitalTwin` or `KnowledgeBaseProfile` type or
// table anywhere in this codebase. The real persisted twin is `DigitalTwin`
// (src/lib/intelligence/digital-twin-builder.ts), assembled from
// organizations + knowledge_base + board_members + outcomes + applications
// and upserted into `organizational_digital_twins` (migration 093,
// SCHEMA_REGISTRY_v2.md #49). That table also carries `vision` and
// `known_weaknesses` columns buildDigitalTwin() never populates, and several
// fields this engine needs (founding_date, founder_name, tax_status, ein,
// target_population) live on `organizations` directly and are never copied
// onto the twin. All of these are modeled below as optional so a caller can
// pass either the bare DigitalTwin or an organizations-enriched superset.
// The real "KB profile" is just the org's `knowledge_base` rows
// (SCHEMA_REGISTRY_v2.md's own note: the documented `knowledge_base_entries`
// table does not exist in prod, the live table is `knowledge_base`) --
// KnowledgeBaseProfile below wraps that row shape rather than inventing a
// column set with no backing table.
//
// Several requested checks have no backing column anywhere in the schema
// today (budget breakdown, financial trend, service radius, population
// served, state registrations, audit status, per-program outcomes). Those
// checks are always reported as missing/unattainable with a recommendation
// pointing at the schema gap, rather than fabricated -- this caps the
// achievable score for every org until the schema is extended, which
// correctly reflects the data that genuinely does not exist yet.

import { callClaude } from "@/lib/ai/claude";
import type {
  DigitalTwin,
  DigitalTwinBoardMember,
  DigitalTwinProgram,
} from "@/lib/intelligence/digital-twin-builder";

export interface OrganizationalDigitalTwin extends DigitalTwin {
  vision?: string | null;
  known_weaknesses?: string[];
  target_population?: string | null;
  founding_date?: string | null;
  founder_name?: string | null;
  tax_status?: string | null;
  ein?: string | null;
}

export interface KnowledgeBaseEntry {
  id: string;
  category: string;
  title: string;
  content: string;
  is_proven: boolean | null;
  funder_categories: string[] | null;
}

export interface KnowledgeBaseProfile {
  entries: KnowledgeBaseEntry[];
}

export interface TwinSectionReport {
  name: string;
  score: number;
  missing_fields: string[];
  quality_score: number;
  recommendations: string[];
}

export interface TwinCompletenessReport {
  overall_score: number;
  sections: TwinSectionReport[];
  blocking_agents: string[];
  estimated_revenue_impact: number;
}

/**
 * No table in this schema tracks an org's average grant size or monthly
 * application rate, so these are configurable assumptions rather than
 * derived facts. Callers with real figures (e.g. averaged from
 * `opportunities.amount_max` or `applications` volume) should pass them in.
 */
export interface RevenueImpactAssumptions {
  avgGrantValue: number;
  monthlyApplicationRate: number;
}

const DEFAULT_REVENUE_ASSUMPTIONS: RevenueImpactAssumptions = {
  avgGrantValue: 25_000,
  monthlyApplicationRate: 2,
};

interface SectionEvaluation {
  name: string;
  score: number;
  missing_fields: string[];
  recommendations: string[];
  qualityContent: string;
}

function wordCount(text: string | null | undefined): number {
  if (!text) return 0;
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

function kbByCategory(
  kb: KnowledgeBaseProfile,
  category: string,
): KnowledgeBaseEntry[] {
  return kb.entries.filter((e) => e.category === category);
}

function clampScore(points: number): number {
  return Math.max(0, Math.min(100, Math.round(points)));
}

// ---------------------------------------------------------------------------
// 1. Mission & Vision
// ---------------------------------------------------------------------------
function evaluateMissionAndVision(
  twin: OrganizationalDigitalTwin,
  kb: KnowledgeBaseProfile,
): SectionEvaluation {
  const missing: string[] = [];
  const recommendations: string[] = [];
  let score = 0;

  const missionWords = wordCount(twin.mission);
  if (missionWords >= 100) {
    score += 40;
  } else {
    missing.push("mission");
    recommendations.push(
      `Mission statement is ${missionWords} words -- expand to at least 100 words with concrete language.`,
    );
  }

  const impactEntries = kbByCategory(kb, "impact");
  const missionHasMetric = /\d/.test(twin.mission ?? "");
  if (missionHasMetric || impactEntries.length > 0) {
    score += 30;
  } else {
    missing.push("measurable_outcomes");
    recommendations.push(
      "Add a measurable outcome (a figure, percentage, or count) to the mission statement or an 'impact' Knowledge Base entry.",
    );
  }

  if (twin.target_population && twin.target_population.trim() !== "") {
    score += 30;
  } else {
    missing.push("target_population");
    recommendations.push(
      "Define the specific population the mission serves in the organization profile.",
    );
  }

  return {
    name: "mission_and_vision",
    score: clampScore(score),
    missing_fields: missing,
    recommendations,
    qualityContent: [twin.mission, twin.vision, ...impactEntries.map((e) => e.content)]
      .filter(Boolean)
      .join("\n\n"),
  };
}

// ---------------------------------------------------------------------------
// 2. Programs & Services
// ---------------------------------------------------------------------------
function evaluateProgramsAndServices(
  programs: DigitalTwinProgram[],
): SectionEvaluation {
  const missing: string[] = [];
  const recommendations: string[] = [];
  let score = 0;

  if (programs.length >= 3) {
    score += 34;
  } else {
    missing.push("programs");
    recommendations.push(
      `Only ${programs.length} program${programs.length === 1 ? "" : "s"} documented -- add Knowledge Base "program_description" entries until at least 3 exist.`,
    );
  }

  if (programs.length > 0) {
    const deepEnough = programs.filter((p) => wordCount(p.description) >= 50).length;
    score += 33 * (deepEnough / programs.length);
    if (deepEnough < programs.length) {
      missing.push("program_descriptions");
      recommendations.push(
        `${programs.length - deepEnough} program description(s) are under 50 words -- expand with specifics (who is served, how, and at what scale).`,
      );
    }
  } else {
    missing.push("program_descriptions");
  }

  // Per-program measurable outcomes have no backing column -- DigitalTwinProgram
  // is {title, description} only. Always unattainable until the schema adds it.
  missing.push("program_outcomes");
  recommendations.push(
    "Program outcomes are not yet a tracked field -- record outcome data for each program in the Knowledge Base under 'impact' until the programs data model supports it directly.",
  );

  return {
    name: "programs_and_services",
    score: clampScore(score),
    missing_fields: missing,
    recommendations,
    qualityContent: programs.map((p) => `${p.title}: ${p.description}`).join("\n\n"),
  };
}

// ---------------------------------------------------------------------------
// 3. Financial Profile
// ---------------------------------------------------------------------------
function evaluateFinancialProfile(
  twin: OrganizationalDigitalTwin,
): SectionEvaluation {
  const missing: string[] = [];
  const recommendations: string[] = [];
  let score = 0;

  if (twin.financial_profile.annual_budget != null) {
    score += 40;
  } else {
    missing.push("annual_revenue");
    recommendations.push("Enter an annual budget figure in the organization profile.");
  }

  // No revenue-source / expense breakdown column exists -- financial_profile
  // is a flat {annual_budget, total_staff, total_volunteers} map today.
  missing.push("budget_breakdown");
  recommendations.push(
    "Budget breakdown by revenue source and expense category is not yet tracked -- extend the financial profile schema before this can score.",
  );

  // No historical snapshots are persisted, so a 3-year trend can't be computed.
  missing.push("financial_trend");
  recommendations.push(
    "No historical budget snapshots are stored -- persist annual_budget periodically to compute a 3-year trend.",
  );

  return {
    name: "financial_profile",
    score: clampScore(score),
    missing_fields: missing,
    recommendations,
    qualityContent: JSON.stringify(twin.financial_profile),
  };
}

// ---------------------------------------------------------------------------
// 4. Leadership & Board
// ---------------------------------------------------------------------------
function evaluateLeadershipAndBoard(
  board: DigitalTwinBoardMember[],
): SectionEvaluation {
  const missing: string[] = [];
  const recommendations: string[] = [];
  let score = 0;

  const countFraction = Math.min(board.length, 5) / 5;
  score += 40 * countFraction;
  if (board.length < 5) {
    missing.push("board_members");
    recommendations.push(
      `Only ${board.length} active board member${board.length === 1 ? "" : "s"} on record -- add board members until at least 5 are active.`,
    );
  }

  if (board.length > 0) {
    const withBio = board.filter((b) => wordCount(b.bio) >= 30).length;
    score += 30 * (withBio / board.length);
    if (withBio < board.length) {
      missing.push("board_bios");
      recommendations.push(
        `${board.length - withBio} board member bio(s) are under 30 words -- expand with background and relevance to the mission.`,
      );
    }

    const withProfessionalBackground = board.filter(
      (b) => Boolean(b.title) && Boolean(b.bio),
    ).length;
    score += 30 * (withProfessionalBackground / board.length);
    if (withProfessionalBackground < board.length) {
      missing.push("board_professional_background");
      recommendations.push(
        "Record a title and professional bio for every board member to establish credibility with funders.",
      );
    }
  } else {
    missing.push("board_bios", "board_professional_background");
  }

  return {
    name: "leadership_and_board",
    score: clampScore(score),
    missing_fields: missing,
    recommendations,
    qualityContent: board.map((b) => `${b.name} (${b.title ?? "no title"}): ${b.bio ?? ""}`).join("\n"),
  };
}

// ---------------------------------------------------------------------------
// 5. Geographic Service Area
// ---------------------------------------------------------------------------
function evaluateGeographicServiceArea(
  twin: OrganizationalDigitalTwin,
): SectionEvaluation {
  const missing: string[] = [];
  const recommendations: string[] = [];
  let score = 0;

  if (twin.service_areas.length > 0) {
    score += 40;
  } else {
    missing.push("service_area");
    recommendations.push("Set a city/state or service area in the organization profile.");
  }

  // Neither a service radius nor a population-served count exists on
  // organizations or organizational_digital_twins today.
  missing.push("service_radius");
  recommendations.push(
    "Service radius is not yet tracked -- add a geographic radius field to the organization profile.",
  );

  missing.push("population_served_count");
  recommendations.push(
    "Population served count is not yet tracked -- add a served-population estimate to the organization profile.",
  );

  return {
    name: "geographic_service_area",
    score: clampScore(score),
    missing_fields: missing,
    recommendations,
    qualityContent: twin.service_areas.join(", "),
  };
}

// ---------------------------------------------------------------------------
// 6. Target Population
// ---------------------------------------------------------------------------
function evaluateTargetPopulation(
  twin: OrganizationalDigitalTwin,
  kb: KnowledgeBaseProfile,
): SectionEvaluation {
  const missing: string[] = [];
  const recommendations: string[] = [];
  let score = 0;

  if (twin.target_population && twin.target_population.trim() !== "") {
    score += 40;
  } else {
    missing.push("demographics");
    recommendations.push("Define the demographics of the population served in the organization profile.");
  }

  const needStatements = kbByCategory(kb, "need_statement");
  if (needStatements.length > 0) {
    score += 30;
  } else {
    missing.push("needs_assessment");
    recommendations.push("Add a 'need_statement' Knowledge Base entry documenting the community need being addressed.");
  }

  const citesData = needStatements.some((e) => /\d/.test(e.content));
  if (citesData) {
    score += 30;
  } else {
    missing.push("community_data_citation");
    recommendations.push("Cite specific community data (census, HUD, BLS, etc.) in the need statement rather than general claims.");
  }

  return {
    name: "target_population",
    score: clampScore(score),
    missing_fields: missing,
    recommendations,
    qualityContent: [twin.target_population, ...needStatements.map((e) => e.content)]
      .filter(Boolean)
      .join("\n\n"),
  };
}

// ---------------------------------------------------------------------------
// 7. Impact & Outcomes
// ---------------------------------------------------------------------------
function evaluateImpactAndOutcomes(
  twin: OrganizationalDigitalTwin,
): SectionEvaluation {
  const missing: string[] = [];
  const recommendations: string[] = [];
  let score = 0;

  const outcomesCount = twin.stats.outcomes_count;
  score += 50 * (Math.min(outcomesCount, 3) / 3);
  if (outcomesCount < 3) {
    missing.push("measurable_outcomes");
    recommendations.push(
      `Only ${outcomesCount} recorded outcome${outcomesCount === 1 ? "" : "s"} -- record awarded/denied results as applications resolve to build measurable outcome history.`,
    );
  }

  const hasPriorYearResults = twin.key_strengths.some((s) => /award rate/i.test(s));
  if (hasPriorYearResults) {
    score += 50;
  } else {
    missing.push("prior_year_results");
    recommendations.push("Record enough outcomes to establish a prior-year award rate baseline.");
  }

  return {
    name: "impact_and_outcomes",
    score: clampScore(score),
    missing_fields: missing,
    recommendations,
    qualityContent: twin.key_strengths.join("\n"),
  };
}

// ---------------------------------------------------------------------------
// 8. Organizational History
// ---------------------------------------------------------------------------
function evaluateOrganizationalHistory(
  twin: OrganizationalDigitalTwin,
  kb: KnowledgeBaseProfile,
): SectionEvaluation {
  const missing: string[] = [];
  const recommendations: string[] = [];
  let score = 0;

  if (twin.founding_date && twin.founding_date.trim() !== "") {
    score += 40;
  } else {
    missing.push("founding_year");
    recommendations.push("Record the founding date in the organization profile.");
  }

  const historyEntries = kbByCategory(kb, "organizational_history");
  if (historyEntries.length > 0) {
    score += 30;
  } else {
    missing.push("milestones");
    recommendations.push("Add an 'organizational_history' Knowledge Base entry documenting key milestones.");
  }

  const hasAchievements =
    twin.key_strengths.length > 0 || historyEntries.some((e) => wordCount(e.content) >= 30);
  if (hasAchievements) {
    score += 30;
  } else {
    missing.push("key_achievements");
    recommendations.push("Document specific achievements (awards won, milestones reached, growth metrics) in organizational history.");
  }

  return {
    name: "organizational_history",
    score: clampScore(score),
    missing_fields: missing,
    recommendations,
    qualityContent: [twin.founder_name, ...historyEntries.map((e) => e.content)]
      .filter(Boolean)
      .join("\n\n"),
  };
}

// ---------------------------------------------------------------------------
// 9. Partnerships & Coalitions
// ---------------------------------------------------------------------------
function evaluatePartnershipsAndCoalitions(
  kb: KnowledgeBaseProfile,
): SectionEvaluation {
  const missing: string[] = [];
  const recommendations: string[] = [];
  let score = 0;

  const partnershipEntries = kbByCategory(kb, "partnerships");
  if (partnershipEntries.length >= 2) {
    score += 60;
  } else {
    missing.push("partners");
    recommendations.push(
      `Only ${partnershipEntries.length} partnership entry(ies) on file -- add 'partnerships' Knowledge Base entries until at least 2 exist.`,
    );
  }

  if (partnershipEntries.length > 0) {
    const deepEnough = partnershipEntries.filter((e) => wordCount(e.content) >= 30).length;
    score += 40 * (deepEnough / partnershipEntries.length);
    if (deepEnough < partnershipEntries.length) {
      missing.push("partnership_descriptions");
      recommendations.push("Expand partnership entries with a specific description of the relationship and shared work.");
    }
  } else {
    missing.push("partnership_descriptions");
  }

  return {
    name: "partnerships_and_coalitions",
    score: clampScore(score),
    missing_fields: missing,
    recommendations,
    qualityContent: partnershipEntries.map((e) => `${e.title}: ${e.content}`).join("\n\n"),
  };
}

// ---------------------------------------------------------------------------
// 10. Compliance & Certifications
// ---------------------------------------------------------------------------
function evaluateComplianceAndCertifications(
  twin: OrganizationalDigitalTwin,
): SectionEvaluation {
  const missing: string[] = [];
  const recommendations: string[] = [];
  let score = 0;

  if (twin.tax_status && twin.tax_status.trim() !== "") {
    score += 40;
  } else {
    missing.push("501c3_status");
    recommendations.push("Record the organization's tax-exempt status (e.g. 501(c)(3), 508(c)(1)(a)) in the organization profile.");
  }

  // Neither state charity registrations nor audit status has a column
  // anywhere in this schema.
  missing.push("state_registrations");
  recommendations.push("State charity registration status is not yet tracked -- add a compliance tracking field.");

  missing.push("audit_status");
  recommendations.push("Audit status is not yet tracked -- add an audit/financial-review status field.");

  return {
    name: "compliance_and_certifications",
    score: clampScore(score),
    missing_fields: missing,
    recommendations,
    qualityContent: [twin.tax_status, twin.ein].filter(Boolean).join(" / "),
  };
}

// ---------------------------------------------------------------------------
// Blocking agents
// ---------------------------------------------------------------------------
function computeBlockingAgents(twin: OrganizationalDigitalTwin): string[] {
  const blocked = new Set<string>();

  if (wordCount(twin.mission) < 50) {
    blocked.add("draft-generation");
    blocked.add("fundability-scorer");
  }
  if (Object.keys(twin.financial_profile).length === 0) {
    blocked.add("simulation-agent");
    blocked.add("probability-scorer");
  }
  if (twin.board_composition.length === 0) {
    blocked.add("relationship-builder");
  }
  if (twin.service_areas.length === 0) {
    blocked.add("community-need-predictor");
    blocked.add("opportunity-discovery");
  }

  return Array.from(blocked);
}

// ---------------------------------------------------------------------------
// Revenue impact
// ---------------------------------------------------------------------------
function estimateRevenueImpact(
  overallScore: number,
  assumptions: RevenueImpactAssumptions,
): number {
  const gapFraction = (100 - overallScore) / 100;
  return Math.round(
    gapFraction * assumptions.avgGrantValue * assumptions.monthlyApplicationRate * 0.15,
  );
}

// ---------------------------------------------------------------------------
// Claude quality assessment (depth/specificity, not presence)
// ---------------------------------------------------------------------------
async function assessSectionQuality(
  sections: SectionEvaluation[],
): Promise<Record<string, number>> {
  const fallback: Record<string, number> = {};
  for (const section of sections) {
    // Content-depth heuristic used if the AI call is unavailable or fails.
    fallback[section.name] = clampScore((wordCount(section.qualityContent) / 150) * 100);
  }

  const nonEmptySections = sections.filter((s) => s.qualityContent.trim() !== "");
  if (nonEmptySections.length === 0) {
    return fallback;
  }

  const prompt = [
    "Assess the depth and specificity (not mere presence) of each section of this nonprofit's",
    "organizational profile, used as source material for AI grant-writing. Score each 0-100:",
    "100 = specific, evidence-backed, funder-ready; 0 = empty or generic filler.",
    "",
    ...nonEmptySections.map(
      (s) => `## ${s.name}\n${s.qualityContent.slice(0, 600)}`,
    ),
    "",
    'Return ONLY a JSON object mapping each section name above to an integer 0-100, e.g. {"mission_and_vision":72}. No prose.',
  ].join("\n");

  try {
    const response = await callClaude({ prompt, maxTokens: 200 });
    const parsed = JSON.parse(response.text.trim()) as Record<string, unknown>;
    const scores: Record<string, number> = { ...fallback };
    for (const section of sections) {
      const value = parsed[section.name];
      if (typeof value === "number" && Number.isFinite(value)) {
        scores[section.name] = clampScore(value);
      }
    }
    return scores;
  } catch {
    return fallback;
  }
}

/**
 * Scores an organization's Digital Twin across 10 weighted sections (10
 * points each), evaluates content depth via Claude, maps incompleteness to
 * the autonomous agents it limits, and estimates a monthly revenue impact.
 */
export async function calculateTwinCompleteness(
  twin: OrganizationalDigitalTwin,
  kb: KnowledgeBaseProfile,
  revenueAssumptions: RevenueImpactAssumptions = DEFAULT_REVENUE_ASSUMPTIONS,
): Promise<TwinCompletenessReport> {
  const evaluations: SectionEvaluation[] = [
    evaluateMissionAndVision(twin, kb),
    evaluateProgramsAndServices(twin.programs),
    evaluateFinancialProfile(twin),
    evaluateLeadershipAndBoard(twin.board_composition),
    evaluateGeographicServiceArea(twin),
    evaluateTargetPopulation(twin, kb),
    evaluateImpactAndOutcomes(twin),
    evaluateOrganizationalHistory(twin, kb),
    evaluatePartnershipsAndCoalitions(kb),
    evaluateComplianceAndCertifications(twin),
  ];

  const qualityScores = await assessSectionQuality(evaluations);

  const sections: TwinSectionReport[] = evaluations.map((e) => ({
    name: e.name,
    score: e.score,
    missing_fields: e.missing_fields,
    quality_score: qualityScores[e.name] ?? 0,
    recommendations: e.recommendations,
  }));

  const overall_score = clampScore(
    sections.reduce((sum, s) => sum + s.score, 0) / sections.length,
  );

  return {
    overall_score,
    sections,
    blocking_agents: computeBlockingAgents(twin),
    estimated_revenue_impact: estimateRevenueImpact(overall_score, revenueAssumptions),
  };
}
