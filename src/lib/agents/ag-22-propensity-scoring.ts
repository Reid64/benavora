// AG-22 Propensity Scoring Agent (CORPORATE_INTELLIGENCE_ARCHITECTURE.md §3,
// AGENTS_v2.md AG-22).
//
// Computes the 10 donation-propensity scores (PS-01..PS-10, §3A) for one
// corporate_prospects row and writes them into its `scores` jsonb (canonical
// rule §12.3: "All scoring data stored as jsonb. Never add columns per score
// type.").
//
// PS-02..PS-10 are each a single Claude call scored against the exact "Key
// Signals" §3A documents for that score, verbatim -- no invented signals --
// drawn from the prospect's `enrichment` jsonb (populated by EA-01..EA-10,
// corporate-enrichment-shared.ts) plus its own core columns (naics_code,
// employee_count_estimate, revenue_estimate, ownership flags).
//
// PS-01 (Overall Donation Likelihood) is NOT a Claude call. §3B's formula is
// applied directly to the 9 already-computed scores:
//   PS-01 = PS-02*0.3 + PS-03*0.2 + PS-04*0.1 + PS-05*0.1
//           + max(PS-06,PS-07,PS-08,PS-09,PS-10)*0.3
//
// Trigger: §2C, "Score Engine triggered automatically" once a prospect's
// `enrichment_completed_at` is set. worker/enrichment-processor.ts's
// triggerScoreEngine() is the real call site. This agent self-gates on
// `enrichment_completed_at` the same way EA-03/06/07/10 self-gate on their
// own prerequisite key in `enrichment` -- it runs only once EA-01..EA-10 have
// completed for this prospect, never guesses at an unenriched company.
//
// §3C ranking ("companies are ranked ... by PS-01 descending. Top 100 are
// flagged as priority_prospects. Rankings refresh after every enrichment
// cycle") is implemented globally across all scored corporate_prospects
// rather than "within each subscriber's prospect list" -- corporate_prospects
// has no organization_id (SCHEMA_REGISTRY_v2.md §4.4: shared, cross-org, same
// as foundation_directory; corporate-enrichment-shared.ts's header makes the
// same point for EA-0X). There is no per-org join table wiring this shared
// pool to individual subscribers today, so "priority_prospects" is computed
// once, globally, over the whole shared pool -- the closest honest reading
// of the spec against the live schema. The `ranking` sub-object (rank,
// is_priority_prospect) is stored inside `scores` alongside PS-01..10 for the
// same never-a-new-column reason.

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  AgentError,
  BaseAgent,
  type AgentExecution,
  type BaseAgentOptions,
} from "@/lib/agents/base-agent";
import {
  parseClaudeJson,
  truncateForClaude,
} from "@/lib/agents/corporate-enrichment-shared";
import { callClaude } from "@/lib/ai/claude";
import type { AgentType } from "@/types/agents";

export interface AG22Input {
  prospectId: string;
}

export interface PropensityScoreValue {
  score: number;
  rationale: string;
  top_factors: string[];
}

export interface AG22Result {
  skipped: boolean;
  scores: Record<string, PropensityScoreValue> | null;
}

interface FullProspectRow {
  id: string;
  legal_name: string;
  naics_code: string | null;
  naics_description: string | null;
  industry_category: string | null;
  employee_count_estimate: string | null;
  revenue_estimate: string | null;
  ownership_type: string | null;
  is_family_owned: boolean | null;
  is_veteran_owned: boolean | null;
  is_minority_owned: boolean | null;
  is_woman_owned: boolean | null;
  geographic_footprint: string[] | null;
  enrichment: Record<string, unknown> | null;
  enrichment_completed_at: string | null;
  scores: Record<string, unknown> | null;
}

/** §3A -- verbatim key-signal list per score. PS-01 is a formula, handled by computeOverallLikelihood(), not this list. */
const SCORE_RUBRICS: ReadonlyArray<{
  id: string;
  name: string;
  keySignals: string;
}> = [
  {
    id: "PS-02",
    name: "Cash Donation Probability",
    keySignals:
      "Foundation affiliation, giving portal, donation history, revenue estimate",
  },
  {
    id: "PS-03",
    name: "In-Kind Donation Probability",
    keySignals:
      "Product categories, excess inventory likelihood, donation history type",
  },
  {
    id: "PS-04",
    name: "Volunteer Probability",
    keySignals: "Employee count, CSR initiatives, community involvement",
  },
  {
    id: "PS-05",
    name: "Equipment Donation Probability",
    keySignals:
      "Equipment inventory, fleet vehicles, construction specialties",
  },
  {
    id: "PS-06",
    name: "Housing Compatibility",
    keySignals: "Construction NAICS codes, habitat partner, building materials",
  },
  {
    id: "PS-07",
    name: "Education Compatibility",
    keySignals: "Scholarship history, school partnerships, education ESG",
  },
  {
    id: "PS-08",
    name: "Food Compatibility",
    keySignals:
      "Food industry NAICS, food bank partnerships, product categories",
  },
  {
    id: "PS-09",
    name: "Veteran Compatibility",
    keySignals: "Veteran-owned flag, military partnerships, veteran causes",
  },
  {
    id: "PS-10",
    name: "Disaster Relief Compatibility",
    keySignals:
      "Disaster response capability, emergency response history, logistics capability",
  },
];

/** §3C: "Top 100 are flagged as priority_prospects." */
const PRIORITY_PROSPECT_LIMIT = 100;

/**
 * Soft cap on how many scored prospects one ranking refresh scans/holds in
 * memory. §3C's global re-rank is an O(N) read per refresh by nature (every
 * scored prospect's PS-01 must be compared to find the new top 100); at the
 * "tens of millions" scale CORPORATE_INTELLIGENCE_ARCHITECTURE.md §1A targets
 * this needs a real indexed SQL ORDER BY instead of an in-memory sort. Not
 * built here since corporate_prospects has never been run at that scale
 * (migration 107's own header: not confirmed applied to production).
 */
const MAX_RANKED_PROSPECTS_SCAN = 5_000;

async function fetchFullProspect(
  client: SupabaseClient,
  prospectId: string,
): Promise<FullProspectRow | null> {
  const { data, error } = await client
    .from("corporate_prospects")
    .select(
      "id, legal_name, naics_code, naics_description, industry_category, employee_count_estimate, revenue_estimate, ownership_type, is_family_owned, is_veteran_owned, is_minority_owned, is_woman_owned, geographic_footprint, enrichment, enrichment_completed_at, scores",
    )
    .eq("id", prospectId)
    .maybeSingle();

  if (error || !data) return null;
  return data as unknown as FullProspectRow;
}

/** Clamps to an integer 0-100. Unparseable/missing Claude output defaults to 0 (no evidence of propensity), never a fabricated midpoint. */
function clampScore(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function buildCompanySnapshot(prospect: FullProspectRow): string {
  return JSON.stringify(
    {
      legal_name: prospect.legal_name,
      naics_code: prospect.naics_code,
      naics_description: prospect.naics_description,
      industry_category: prospect.industry_category,
      employee_count_estimate: prospect.employee_count_estimate,
      revenue_estimate: prospect.revenue_estimate,
      ownership_type: prospect.ownership_type,
      is_family_owned: prospect.is_family_owned,
      is_veteran_owned: prospect.is_veteran_owned,
      is_minority_owned: prospect.is_minority_owned,
      is_woman_owned: prospect.is_woman_owned,
      geographic_footprint: prospect.geographic_footprint,
    },
    null,
    2,
  );
}

async function scoreOne(
  rubric: { id: string; name: string; keySignals: string },
  enrichmentJson: string,
  companySnapshot: string,
): Promise<{ value: PropensityScoreValue; tokensUsed: number }> {
  const prompt = `You are scoring a corporate prospect for "${rubric.name}" (${rubric.id}) as part of a nonprofit donor-discovery propensity model.

Score 0-100: the likelihood/compatibility this company is a fit for ${rubric.name}.
Key signals to weigh -- use exactly these, drawn from the data below, do not invent other signals: ${rubric.keySignals}.

Company snapshot:
${companySnapshot}

Full enrichment record (may be sparse or missing fields -- treat a missing signal as unknown, not as evidence against the company):
${truncateForClaude(enrichmentJson)}

Return ONLY valid JSON: {"score": integer 0-100, "rationale": string (1-2 sentences), "top_factors": string[] (the specific key signals above that drove this score, at most 4)}`;

  const result = await callClaude({ prompt, maxTokens: 400 });
  const parsed = parseClaudeJson<Partial<PropensityScoreValue>>(
    result.text,
    {},
  );

  const value: PropensityScoreValue = {
    score: clampScore(parsed.score),
    rationale:
      typeof parsed.rationale === "string" && parsed.rationale.trim()
        ? parsed.rationale.trim()
        : "Unable to compute a rationale from available enrichment data.",
    top_factors: Array.isArray(parsed.top_factors)
      ? parsed.top_factors.filter((v): v is string => typeof v === "string")
      : [],
  };

  return { value, tokensUsed: result.usage.totalTokens };
}

/** §3B formula: PS-01 = PS-02×0.3 + PS-03×0.2 + PS-04×0.1 + PS-05×0.1 + max(PS-06..PS-10)×0.3. Not a Claude call. */
function computeOverallLikelihood(
  scores: Record<string, PropensityScoreValue>,
): PropensityScoreValue {
  const ps02 = scores["PS-02"]!.score;
  const ps03 = scores["PS-03"]!.score;
  const ps04 = scores["PS-04"]!.score;
  const ps05 = scores["PS-05"]!.score;

  const compatibilityScores: Array<[string, number]> = [
    ["Housing Compatibility", scores["PS-06"]!.score],
    ["Education Compatibility", scores["PS-07"]!.score],
    ["Food Compatibility", scores["PS-08"]!.score],
    ["Veteran Compatibility", scores["PS-09"]!.score],
    ["Disaster Relief Compatibility", scores["PS-10"]!.score],
  ];
  const [maxCompatName, maxCompatScore] = compatibilityScores.reduce(
    (best, cur) => (cur[1] > best[1] ? cur : best),
  );

  const overall =
    ps02 * 0.3 + ps03 * 0.2 + ps04 * 0.1 + ps05 * 0.1 + maxCompatScore * 0.3;

  return {
    score: clampScore(overall),
    rationale: `Weighted aggregate per §3B: Cash Donation Probability×0.3 + In-Kind Donation Probability×0.2 + Volunteer Probability×0.1 + Equipment Donation Probability×0.1 + max(Housing/Education/Food/Veteran/Disaster Relief Compatibility)×0.3. Highest compatibility component was ${maxCompatName} (${maxCompatScore}).`,
    top_factors: [
      `Cash Donation Probability (${ps02}, weight 0.3)`,
      `In-Kind Donation Probability (${ps03}, weight 0.2)`,
      `Volunteer Probability (${ps04}, weight 0.1)`,
      `Equipment Donation Probability (${ps05}, weight 0.1)`,
      `${maxCompatName} (${maxCompatScore}, weight 0.3, highest of the 5 compatibility scores)`,
    ],
  };
}

export interface RankingRefreshResult {
  scanned: number;
  updated: number;
}

/**
 * §3C: re-rank every scored corporate_prospects row by PS-01 descending and
 * flag the top {@link PRIORITY_PROSPECT_LIMIT} as priority prospects. Global
 * across the whole shared pool -- see file header re: no per-org prospect
 * list exists for this table. Only writes a row whose stored `ranking`
 * sub-object actually changed (rank or priority flag), bounding write volume
 * on repeated refreshes to just the boundary that moved.
 */
export async function refreshPriorityRanking(
  client: SupabaseClient,
): Promise<RankingRefreshResult> {
  const { data, error } = await client
    .from("corporate_prospects")
    .select("id, scores")
    .not("scores_computed_at", "is", null)
    .limit(MAX_RANKED_PROSPECTS_SCAN);

  if (error || !data) return { scanned: 0, updated: 0 };

  if (data.length === MAX_RANKED_PROSPECTS_SCAN) {
    console.warn(
      `[AG-22 PropensityScoringAgent] Ranking refresh hit the ${MAX_RANKED_PROSPECTS_SCAN}-row scan cap -- ` +
        "global ranking is now an approximation over a subset, not the full scored pool. Needs an indexed " +
        "SQL query (ORDER BY scores->'PS-01'->>'score') instead of an in-memory scan once corporate_prospects " +
        "reaches this scale.",
    );
  }

  const rows = data as Array<{ id: string; scores: Record<string, unknown> | null }>;

  const ranked = rows
    .map((row) => {
      const ps01 = row.scores?.["PS-01"] as PropensityScoreValue | undefined;
      return {
        id: row.id,
        scores: row.scores,
        ps01Score: typeof ps01?.score === "number" ? ps01.score : -1,
      };
    })
    .sort((a, b) => b.ps01Score - a.ps01Score);

  let updated = 0;
  for (let i = 0; i < ranked.length; i++) {
    const row = ranked[i]!;
    const rank = i + 1;
    const isPriority = rank <= PRIORITY_PROSPECT_LIMIT;
    const existingRanking = (row.scores?.["ranking"] ?? null) as
      | { rank?: number; is_priority_prospect?: boolean }
      | null;

    if (
      existingRanking &&
      existingRanking.rank === rank &&
      existingRanking.is_priority_prospect === isPriority
    ) {
      continue;
    }

    const mergedScores = {
      ...(row.scores ?? {}),
      ranking: {
        rank,
        is_priority_prospect: isPriority,
        ranked_at: new Date().toISOString(),
      },
    };

    await client
      .from("corporate_prospects")
      .update({ scores: mergedScores })
      .eq("id", row.id);
    updated++;
  }

  return { scanned: ranked.length, updated };
}

export class PropensityScoringAgent extends BaseAgent<AG22Input, AG22Result> {
  readonly agentType: AgentType = "ag22_propensity_scoring";

  constructor(options: BaseAgentOptions) {
    // 9 sequential Claude calls per prospect -- BaseAgent's default 60s
    // timeout is too tight. Same 270s ceiling other multi-call agents use
    // (grants-gov.ts, nofa-parser.ts, sam-gov.ts, tdhca-scraper.ts).
    super({ ...options, timeoutMs: options.timeoutMs ?? 270_000 });
  }

  protected async execute(
    input: AG22Input,
  ): Promise<AgentExecution<AG22Result>> {
    const prospect = await fetchFullProspect(this.client, input.prospectId);
    if (!prospect) {
      throw new AgentError("Corporate prospect not found.", "not_found", 404);
    }

    if (!prospect.enrichment_completed_at) {
      return {
        data: { skipped: true, scores: null },
        outputSummary: `${prospect.legal_name}: skipped -- enrichment has not completed for this prospect yet (EA-01..EA-10 pipeline).`,
        itemsFound: 0,
        itemsProcessed: 0,
      };
    }

    const enrichmentJson = JSON.stringify(prospect.enrichment ?? {}, null, 2);
    const companySnapshot = buildCompanySnapshot(prospect);

    const computed: Record<string, PropensityScoreValue> = {};
    let tokensUsed = 0;

    for (const rubric of SCORE_RUBRICS) {
      const { value, tokensUsed: t } = await scoreOne(
        rubric,
        enrichmentJson,
        companySnapshot,
      );
      computed[rubric.id] = value;
      tokensUsed += t;
    }

    computed["PS-01"] = computeOverallLikelihood(computed);

    const mergedScores = { ...(prospect.scores ?? {}), ...computed };
    const now = new Date().toISOString();

    await this.client
      .from("corporate_prospects")
      .update({ scores: mergedScores, scores_computed_at: now })
      .eq("id", prospect.id);

    const rankingResult = await refreshPriorityRanking(this.client);

    return {
      data: { skipped: false, scores: computed },
      outputSummary: `${prospect.legal_name}: PS-01 (Overall Donation Likelihood)=${computed["PS-01"]!.score}, ${Object.keys(computed).length} scores computed. Ranking refreshed across ${rankingResult.scanned} scored prospect(s), ${rankingResult.updated} updated.`,
      itemsFound: Object.keys(computed).length,
      itemsProcessed: Object.keys(computed).length,
      tokensUsed,
    };
  }
}
