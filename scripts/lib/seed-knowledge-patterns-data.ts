// ============================================================================
// BENAVORA — Knowledge Engine patterns seed data + seeding logic
//
// Extracted from scripts/seed-knowledge-patterns.ts so the 30 curated
// knowledge_patterns rows and the dedup/insert logic have one source of
// truth, shared by both the standalone `pnpm seed:patterns` script and
// scripts/populate-all-data.ts. knowledge_patterns has no unique constraint
// (it is shared, cross-org intelligence library data — see
// 096_knowledge_engine.sql header), so idempotency is handled here by
// checking pattern_description against what's already seeded and skipping
// duplicates.
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

type Confidence = "high" | "medium" | "low";

interface KnowledgePattern {
  pattern_type: string;
  category: string | null;
  funder_name: string | null;
  pattern_description: string;
  success_rate: number;
  sample_count: number;
  confidence: Confidence;
}

// Confidence follows sample_count directly: >=150 high, 50-149 medium, <50 low.
function confidenceFor(sampleCount: number): Confidence {
  if (sampleCount >= 150) return "high";
  if (sampleCount >= 50) return "medium";
  return "low";
}

function pattern(
  pattern_type: string,
  category: string | null,
  funder_name: string | null,
  pattern_description: string,
  success_rate: number,
  sample_count: number,
): KnowledgePattern {
  return {
    pattern_type,
    category,
    funder_name,
    pattern_description,
    success_rate,
    sample_count,
    confidence: confidenceFor(sample_count),
  };
}

// ----------------------------------------------------------------------------
// (1) 5 narrative patterns
// ----------------------------------------------------------------------------
const NARRATIVE_PATTERNS: KnowledgePattern[] = [
  pattern(
    "narrative",
    "need_statement",
    null,
    "Successful need statements cite national CDC or Census statistics alongside hyper-local community data, grounding broad trends in the applicant's specific service area rather than relying on national figures alone.",
    0.73,
    156,
  ),
  pattern(
    "narrative",
    "budget",
    null,
    "Proposals that explicitly mention leveraged or matching funding from other confirmed sources receive awards 2.1x larger on average than proposals relying solely on the requested grant amount.",
    0.68,
    89,
  ),
  pattern(
    "narrative",
    "evaluation",
    null,
    "Applications that include a third-party (external) evaluation plan increase success rate by 28 percentage points over applications relying only on internal, self-reported metrics.",
    0.71,
    203,
  ),
  pattern(
    "narrative",
    "logic_model",
    null,
    "Logic models structured in the W.K. Kellogg Foundation format (inputs, activities, outputs, outcomes, impact) are preferred by 73% of foundation reviewers over free-form narrative program descriptions.",
    0.73,
    112,
  ),
  pattern(
    "narrative",
    "narrative",
    null,
    "Executive summaries under 500 words have a 34% higher reviewer read-through rate than longer summaries, correlating with higher overall application scores.",
    0.67,
    445,
  ),
];

// ----------------------------------------------------------------------------
// (2) 5 timing patterns
// ----------------------------------------------------------------------------
const TIMING_PATTERNS: KnowledgePattern[] = [
  pattern(
    "timing",
    "timing",
    "HUD",
    "Federal housing grant postings peak in October; organizations that begin drafting in August have the most runway to meet the typical 60-90 day application window and are funded at a materially higher rate than late starters.",
    0.62,
    134,
  ),
  pattern(
    "timing",
    "timing",
    "HHS",
    "HHS discretionary grants average a 45-day review cycle from submission deadline to notice of award; applicants who build a 60-day post-award mobilization buffer into their program timeline report a 71% on-time program launch rate.",
    0.71,
    97,
  ),
  pattern(
    "timing",
    "timing",
    "USDA",
    "USDA Rural Development grant funds are apportioned by federal fiscal year and are frequently exhausted by Q3; applications submitted in Q1 (October-December) are funded at a notably higher rate than those submitted in Q3-Q4.",
    0.64,
    78,
  ),
  pattern(
    "timing",
    "timing",
    null,
    "Foundation grant applications submitted Tuesday through Thursday show a 23% higher program-officer response rate than Monday or Friday submissions, correlating with modestly higher advancement to full-proposal stage.",
    0.58,
    267,
  ),
  pattern(
    "timing",
    "timing",
    null,
    "Renewal applications submitted 90 days before current grant expiration have an 89% approval rate, compared to roughly 61% for renewals submitted within 30 days of expiration.",
    0.89,
    178,
  ),
];

// ----------------------------------------------------------------------------
// (3) 5 budget patterns
// ----------------------------------------------------------------------------
const BUDGET_PATTERNS: KnowledgePattern[] = [
  pattern(
    "budget",
    "budget",
    null,
    "Grant budgets requesting an indirect cost/overhead rate above 15% are rejected by 67% of private foundations reviewed, though federally negotiated rates and the 10% de minimis rate are broadly accepted.",
    0.33,
    142,
  ),
  pattern(
    "budget",
    "budget",
    null,
    "Applications that voluntarily offer a 1-to-1 (or greater) local match, even when not required by the funder, score an average of 12 points higher on federal discretionary grant reviewer rubrics.",
    0.66,
    91,
  ),
  pattern(
    "budget",
    "budget",
    null,
    "Budgets where personnel costs exceed 80% of the total requested amount are flagged as a weakness by 45% of reviewers, most often for insufficient direct program or materials investment.",
    0.41,
    118,
  ),
  pattern(
    "budget",
    "budget",
    null,
    "Budgets that include an explicit cost-per-outcome or cost-per-beneficiary calculation are funded at a materially higher rate than budgets presenting only aggregate line items, since reviewers can directly assess cost-effectiveness.",
    0.69,
    84,
  ),
  pattern(
    "budget",
    "budget",
    null,
    "Multi-year budget requests that show a declining reliance on the grant — a sustainability taper with increasing matched or earned revenue each year — are approved more often than flat multi-year asks with no sustainability plan.",
    0.64,
    73,
  ),
];

// ----------------------------------------------------------------------------
// (4) 5 funder-specific patterns — HUD, USDA, NIH, DOJ, NSF
// ----------------------------------------------------------------------------
const FUNDER_PATTERNS: KnowledgePattern[] = [
  pattern(
    "funder",
    "funder_intel",
    "HUD",
    "HUD Continuum of Care (CoC) Program applications are scored under the annual NOFO rubric with heaviest weight on system performance measures (bed utilization, length of time homeless); applicants with 3+ years of HMIS data trending downward in length-of-stay outperform first-time applicants.",
    0.61,
    96,
  ),
  pattern(
    "funder",
    "funder_intel",
    "USDA",
    "USDA Rural Development Community Facilities grants prioritize applicants serving towns under 20,000 population with median household income below the state non-metro median; applications explicitly citing both eligibility thresholds in the narrative are funded notably more often than those citing only one.",
    0.58,
    67,
  ),
  pattern(
    "funder",
    "funder_intel",
    "NIH",
    "NIH study sections weight the Significance and Approach review criteria most heavily in overall impact scores; applications with a dedicated preliminary-data figure demonstrating feasibility score in the top percentile far more often than applications relying on published-literature citations alone.",
    0.52,
    211,
  ),
  pattern(
    "funder",
    "funder_intel",
    "DOJ",
    "DOJ Office of Justice Programs solicitations under the Edward Byrne Memorial Justice Assistance Grant (JAG) formula favor applicants who partner with local law enforcement as a co-applicant or named subrecipient; joint law-enforcement/nonprofit applications are funded at a notably higher rate than nonprofit-only applications.",
    0.55,
    74,
  ),
  pattern(
    "funder",
    "funder_intel",
    "NSF",
    "NSF proposals reviewed under the Broader Impacts merit review criterion score higher when broader-impacts activities are integrated throughout the project narrative rather than confined to a single closing paragraph; integrated-narrative proposals are rated 'Excellent' on Broader Impacts far more often.",
    0.59,
    158,
  ),
];

// ----------------------------------------------------------------------------
// (5) 10 competitive intelligence patterns
// ----------------------------------------------------------------------------
const COMPETITIVE_PATTERNS: KnowledgePattern[] = [
  pattern(
    "competitive",
    "competitive",
    null,
    "Applicants whose annual operating budget falls within 0.5x-2x of the funder's median grant-recipient budget size are funded at nearly double the rate of applicants far outside that range, suggesting funders calibrate award size to perceived organizational capacity.",
    0.63,
    189,
  ),
  pattern(
    "competitive",
    "competitive",
    null,
    "First-time applicants to a foundation are funded at roughly half the rate of organizations with any prior application history with that funder, even when the prior application was declined — familiarity alone measurably improves odds.",
    0.34,
    224,
  ),
  pattern(
    "competitive",
    "competitive",
    null,
    "When a funder's prior-year Form 990 shows multiple grants awarded to organizations serving an identical geographic footprint and population, new applicants targeting that same narrow niche face measurably lower award odds due to concentrated giving patterns.",
    0.29,
    61,
  ),
  pattern(
    "competitive",
    "competitive",
    null,
    "Applications submitted in the final 48 hours before a rolling deadline are funded meaningfully less often than those submitted at least one week early, independent of proposal quality — likely reflecting reviewer fatigue and truncated Q&A opportunity with program officers.",
    0.44,
    143,
  ),
  pattern(
    "competitive",
    "competitive",
    null,
    "Organizations that request an amount below the funder's stated average grant size, rather than at or above it, are funded at a materially higher rate, suggesting a right-sized ask outperforms maximizing the request.",
    0.68,
    176,
  ),
  pattern(
    "competitive",
    "competitive",
    null,
    "When three or more similar-mission organizations in the same media market apply to the same corporate funder in a single cycle, award rate per applicant drops by roughly a third compared to cycles with less local competition — geographic exclusivity in the applicant pool measurably helps.",
    0.38,
    52,
  ),
  pattern(
    "competitive",
    "competitive",
    null,
    "Proposals that name specific peer organizations' documented outcomes and explain a complementary, non-duplicative service niche outperform proposals that ignore the competitive landscape entirely, particularly with community and regional foundations that fund a limited number of organizations per issue area.",
    0.57,
    68,
  ),
  pattern(
    "competitive",
    "competitive",
    null,
    "Applicants who received local or regional media coverage of their programs in the 12 months prior to applying are funded at a modestly higher rate than applicants with no media presence, most pronounced with corporate and community foundation funders that weigh visibility and reputational alignment.",
    0.54,
    99,
  ),
  pattern(
    "competitive",
    "competitive",
    null,
    "When a funder's board or trustee list includes a member affiliated with the applicant's sector — a former nonprofit executive, or an academic in the same field — applications are funded at nearly double the base rate, even absent a direct personal connection to the applicant.",
    0.66,
    87,
  ),
  pattern(
    "competitive",
    "competitive",
    null,
    "Multi-year funding commitments are awarded to fewer than 15% of applicants industry-wide but are heavily concentrated among organizations that previously received a single-year grant from the same funder and reported on it fully and accurately — clean reporting history is the strongest predictor of graduating from single-year to multi-year funding.",
    0.71,
    104,
  ),
];

export const ALL_PATTERNS: KnowledgePattern[] = [
  ...NARRATIVE_PATTERNS,
  ...TIMING_PATTERNS,
  ...BUDGET_PATTERNS,
  ...FUNDER_PATTERNS,
  ...COMPETITIVE_PATTERNS,
];

async function fetchExistingDescriptions(supabase: SupabaseClient): Promise<Set<string>> {
  const existing = new Set<string>();
  const PAGE = 1000;
  let from = 0;

  for (;;) {
    const { data, error } = await supabase
      .from("knowledge_patterns")
      .select("pattern_description")
      .range(from, from + PAGE - 1);

    if (error) {
      throw new Error(`could not query knowledge_patterns: ${error.message}`);
    }

    const batch = data ?? [];
    for (const row of batch as { pattern_description: string }[]) {
      existing.add(row.pattern_description);
    }

    if (batch.length < PAGE) break;
    from += PAGE;
  }

  return existing;
}

export async function seedKnowledgePatterns(supabase: SupabaseClient): Promise<void> {
  if (ALL_PATTERNS.length !== 30) {
    throw new Error(`expected exactly 30 patterns, built ${ALL_PATTERNS.length}`);
  }

  const existing = await fetchExistingDescriptions(supabase);
  const toInsert = ALL_PATTERNS.filter((p) => !existing.has(p.pattern_description));

  console.log(`  Total patterns defined: ${ALL_PATTERNS.length}`);
  console.log(`  Already seeded:         ${ALL_PATTERNS.length - toInsert.length}`);
  console.log(`  To insert:              ${toInsert.length}`);

  if (toInsert.length === 0) {
    console.log("  Nothing to do — all patterns already seeded.");
    return;
  }

  const { error } = await supabase.from("knowledge_patterns").insert(toInsert);
  if (error) {
    throw new Error(`insert failed: ${error.message}`);
  }

  console.log(`  Inserted ${toInsert.length} knowledge patterns.`);
}
