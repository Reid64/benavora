// ============================================================================
// BENAVORA — platform_learning_patterns seed from Intelligence Library
//
// One-time seed: converts each intelligence_funded_proposals record
// (supabase/migrations/048_grant_intelligence.sql; all 113 current records
// are federal awards from NIH RePORTER / NSF / Federal Register / USASpending
// SAMHSA-HRSA — see scripts/ingest-*.ts) into reusable cross-org patterns in
// platform_learning_patterns (src/supabase/migrations/083_global_learning_network.sql,
// hardened in 099_learning_network_hardening.sql).
//
// Deviation from the task-given field list, noted per this repo's own
// convention (see learning-network-aggregator-agent.ts's header for the same
// pattern): SCHEMA_REGISTRY_v2.md documents an OLDER intelligence_funded_proposals
// shape (title/abstract/organization/narrative_sections) that does not match
// the live table. Migration 048 (confirmed against every ingest-*.ts script
// that writes to this table) is the real schema: source, funder_name,
// funder_type, grant_program, award_amount, award_year, category (text[]),
// full_text, metadata (jsonb). This script is written against that real
// schema, not the stale registry entry.
//
// platform_learning_patterns.funder_category is a plain `text` column (no
// enum/CHECK constraint at the DB level — verified in migration 083), but is
// populated here using the same funder_category enum vocabulary
// learning-network-aggregator-agent.ts (AG-36) already writes, so rows from
// both sources stay comparable. ntee_code is populated from the proposal's
// own `category` text[] tag (joined) per the task spec — these are topical
// tags ("health", "research", "federal", "nofa"), not real IRS NTEE codes;
// there is no live EIN->NTEE resolution path for this table (same documented
// gap AG-36 has for its own nteeCode, see that file's header note #4).
//
// Idempotency: winning_examples carries an extra `source_proposal_id` field
// (beyond the task's literal excerpt/funder/amount shape) so a re-run can
// detect and skip proposals already seeded, instead of duplicating rows —
// platform_learning_patterns has no unique constraint on
// (pattern_type, funder_category, ntee_code), so a second run without this
// guard would silently double every pattern.
//
//   pnpm seed:platform-patterns
// ============================================================================

import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

import { createAdminClient } from "../src/lib/supabase/admin";
import { callClaude } from "../src/lib/ai/claude";

const MAX_NARRATIVE_CHARS_FOR_CLAUDE = 6000;
const MAX_PHRASES = 5;
const MAX_KEYWORDS = 10;
const MIN_KEYWORD_LENGTH = 4;
const EXCERPT_MAX_LENGTH = 200;
const CLAUDE_CALL_DELAY_MS = 150;

type PatternType = "narrative_language" | "keyword" | "timing" | "budget_structure";

interface ProposalRow {
  id: string;
  source: string;
  funder_name: string | null;
  funder_type: string | null;
  award_amount: number | null;
  award_year: number | null;
  category: string[] | null;
  full_text: string | null;
  metadata: Record<string, unknown> | null;
}

interface WinningExample {
  excerpt: string;
  funder: string | null;
  amount: number | null;
  source_proposal_id: string;
}

const STOPWORDS = new Set([
  "about", "above", "after", "again", "against", "all", "also", "always",
  "among", "amount", "another", "application", "applications", "around",
  "because", "become", "before", "being", "below", "between", "both", "case",
  "cases", "community", "could", "current", "currently", "during", "each",
  "either", "every", "existing", "first", "focus", "following", "found",
  "from", "further", "given", "grant", "grants", "group", "have", "having",
  "here", "however", "include", "includes", "including", "information",
  "into", "involve", "involves", "large", "later", "least", "level",
  "local", "many", "may", "more", "most", "much", "must", "national",
  "need", "needs", "number", "often", "only", "other", "over", "part",
  "please", "process", "program", "programs", "project", "projects",
  "provide", "provides", "purpose", "rate", "rates", "recent", "related",
  "result", "results", "same", "several", "should", "significant", "since",
  "some", "specific", "state", "still", "such", "support", "than", "that",
  "their", "them", "then", "there", "these", "they", "this", "those",
  "through", "time", "total", "toward", "under", "until", "used", "using",
  "very", "were", "what", "when", "where", "which", "while", "will",
  "with", "within", "without", "would", "years",
]);

function ok(step: string, detail: string) {
  console.log(`  ✓ ${step}: ${detail}`);
}

function fail(step: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`  ✗ ${step}: ${message}`);
}

function fatal(message: string): never {
  console.error(`\nFATAL: ${message}`);
  process.exit(1);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function truncateExcerpt(value: string, max = EXCERPT_MAX_LENGTH): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

/** Step 2: local word-frequency count, top 10 non-stopword keywords. */
function extractKeywords(fullText: string): string[] {
  const words = fullText
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  const freq = new Map<string, number>();
  for (const word of words) {
    if (word.length < MIN_KEYWORD_LENGTH) continue;
    if (STOPWORDS.has(word)) continue;
    if (/^\d+$/.test(word)) continue;
    freq.set(word, (freq.get(word) ?? 0) + 1);
  }

  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_KEYWORDS)
    .map(([word]) => word);
}

/** Step 1: Claude call to extract the 5 most impactful grant-winning phrases. */
async function extractNarrativePhrases(fullText: string): Promise<{ phrases: string[]; tokensUsed: number }> {
  const system =
    "Extract the 5 most impactful grant-winning phrases from this narrative. " +
    "These should be phrases that demonstrate community need, organizational " +
    "capacity, or measurable impact. Return JSON array of strings only.";

  const response = await callClaude({
    system,
    prompt: fullText.slice(0, MAX_NARRATIVE_CHARS_FOR_CLAUDE),
    maxTokens: 300,
    temperature: 0.2,
  });

  return { phrases: parseJsonStringArray(response.text).slice(0, MAX_PHRASES), tokensUsed: response.usage.totalTokens };
}

/** Tolerant JSON-array-of-strings parse — Claude sometimes wraps the array
 * in prose or a markdown code fence despite the "JSON only" instruction. */
function parseJsonStringArray(text: string): string[] {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end <= start) return [];
  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string" && v.trim() !== "");
  } catch {
    return [];
  }
}

/** Step 3: award_year -> timing insight. Null when no award_year on file. */
function buildTimingInsight(awardYear: number | null): string | null {
  if (!awardYear) return null;
  return `Awarded in fiscal year ${awardYear}.`;
}

/** Step 4: budget structure, only if recognizable budget data is present in
 * metadata. None of the current ingest-*.ts scripts (NIH RePORTER, NSF,
 * Federal Register, SAMHSA/HRSA) write a budget breakdown into metadata —
 * this checks a few plausible shapes defensively but is expected to return
 * null for all 113 current records rather than fabricate a structure. */
function buildBudgetStructure(metadata: Record<string, unknown> | null): string | null {
  if (!metadata) return null;
  const candidate =
    metadata.budget_structure ?? metadata.budget_breakdown ?? metadata.budget ?? null;
  if (!candidate || typeof candidate !== "object") return null;
  const rec = candidate as Record<string, unknown>;
  const parts = Object.entries(rec)
    .filter(([, v]) => typeof v === "number" || typeof v === "string")
    .map(([k, v]) => `${k}: ${v}`);
  return parts.length > 0 ? parts.join(", ") : null;
}

/** funder_category, mapped to the same enum vocabulary
 * learning-network-aggregator-agent.ts (AG-36) writes for org-outcome-derived
 * patterns, so rows from both sources stay comparable. All 113 current
 * records are federal sources, so government_grant is the realistic default;
 * name-based heuristics are included for any future non-federal ingestion. */
function mapFunderCategory(row: ProposalRow): string {
  const name = (row.funder_name ?? "").toLowerCase();
  const type = (row.funder_type ?? "").toLowerCase();
  const source = row.source.toLowerCase();

  if (/foundation/.test(name) || /foundation/.test(type)) return "private_foundation";
  if (/\b(corp|corporation|company|inc|llc)\b/.test(name)) return "corporate_foundation";
  if (
    /nih|nsf|samhsa|hrsa|hud|doj|usda|federal|department of|agency/.test(name) ||
    /nih|nsf|samhsa|hrsa|hud|doj|usda|federal|department of|agency/.test(type) ||
    /nih_reporter|nsf|federal_register|samhsa|hrsa|usaspending/.test(source)
  ) {
    return "government_grant";
  }
  return "government_grant"; // observed default across all current sources
}

/** ntee_code per task spec ("from category field") — the proposal's own
 * topical category tags joined, not a real IRS NTEE code (see file header). */
function deriveNteeCode(category: string[] | null): string | null {
  if (!category || category.length === 0) return null;
  return category.join(",");
}

async function loadAlreadySeededProposalIds(supabase: ReturnType<typeof createAdminClient>): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("platform_learning_patterns")
    .select("winning_examples")
    .in("pattern_type", ["narrative_language", "keyword", "timing", "budget_structure"]);

  if (error) {
    fail("load existing patterns for idempotency check", error);
    return new Set();
  }

  const seeded = new Set<string>();
  for (const row of (data ?? []) as Array<{ winning_examples: unknown }>) {
    const examples = Array.isArray(row.winning_examples) ? (row.winning_examples as WinningExample[]) : [];
    for (const ex of examples) {
      if (ex && typeof ex === "object" && typeof ex.source_proposal_id === "string") {
        seeded.add(ex.source_proposal_id);
      }
    }
  }
  return seeded;
}

async function insertPattern(
  supabase: ReturnType<typeof createAdminClient>,
  args: {
    patternType: PatternType;
    patternContent: string;
    funderCategory: string;
    nteeCode: string | null;
    winningExample: WinningExample;
  },
): Promise<void> {
  const { error } = await supabase.from("platform_learning_patterns").insert({
    pattern_type: args.patternType,
    funder_category: args.funderCategory,
    ntee_code: args.nteeCode,
    pattern_content: args.patternContent,
    success_rate: 0.85,
    sample_count: 1,
    avg_award_amount: args.winningExample.amount,
    winning_examples: [args.winningExample],
  } as never);

  if (error) {
    throw new Error(`Failed to insert ${args.patternType} pattern: ${error.message}`);
  }
}

async function main() {
  let supabase: ReturnType<typeof createAdminClient>;
  try {
    supabase = createAdminClient();
  } catch (error) {
    fatal(error instanceof Error ? error.message : String(error));
  }

  console.log("Seeding platform_learning_patterns from intelligence_funded_proposals...\n");

  const { data: proposalRows, error: proposalsError } = await supabase
    .from("intelligence_funded_proposals")
    .select("id, source, funder_name, funder_type, award_amount, award_year, category, full_text, metadata");

  if (proposalsError) {
    fatal(`Failed to load intelligence_funded_proposals: ${proposalsError.message}`);
  }

  const proposals = (proposalRows ?? []) as ProposalRow[];
  console.log(`Loaded ${proposals.length} intelligence_funded_proposals record(s).\n`);

  const alreadySeeded = await loadAlreadySeededProposalIds(supabase);
  if (alreadySeeded.size > 0) {
    ok("idempotency check", `${alreadySeeded.size} proposal(s) already seeded — will be skipped`);
  }

  const counts: Record<PatternType, number> = {
    narrative_language: 0,
    keyword: 0,
    timing: 0,
    budget_structure: 0,
  };
  let skippedNoText = 0;
  let skippedAlreadySeeded = 0;
  let failed = 0;
  let totalTokensUsed = 0;

  for (const proposal of proposals) {
    if (alreadySeeded.has(proposal.id)) {
      skippedAlreadySeeded++;
      continue;
    }

    const fullText = proposal.full_text?.trim() ?? "";
    if (!fullText) {
      skippedNoText++;
      continue;
    }

    const funderCategory = mapFunderCategory(proposal);
    const nteeCode = deriveNteeCode(proposal.category);
    const baseExample: Omit<WinningExample, "excerpt"> = {
      funder: proposal.funder_name,
      amount: proposal.award_amount,
      source_proposal_id: proposal.id,
    };
    const excerpt = truncateExcerpt(fullText);

    try {
      // Step 1 + insert: narrative_language
      const { phrases, tokensUsed } = await extractNarrativePhrases(fullText);
      totalTokensUsed += tokensUsed;
      await sleep(CLAUDE_CALL_DELAY_MS);

      if (phrases.length > 0) {
        await insertPattern(supabase, {
          patternType: "narrative_language",
          patternContent: phrases.join(" | "),
          funderCategory,
          nteeCode,
          winningExample: { ...baseExample, excerpt },
        });
        counts.narrative_language++;
      }

      // Step 2 + insert: keyword
      const keywords = extractKeywords(fullText);
      if (keywords.length > 0) {
        await insertPattern(supabase, {
          patternType: "keyword",
          patternContent: keywords.join(", "),
          funderCategory,
          nteeCode,
          winningExample: { ...baseExample, excerpt },
        });
        counts.keyword++;
      }

      // Step 3 + insert: timing
      const timingInsight = buildTimingInsight(proposal.award_year);
      if (timingInsight) {
        await insertPattern(supabase, {
          patternType: "timing",
          patternContent: timingInsight,
          funderCategory,
          nteeCode,
          winningExample: { ...baseExample, excerpt },
        });
        counts.timing++;
      }

      // Step 4 + insert: budget_structure (only if metadata carries real data)
      const budgetStructure = buildBudgetStructure(proposal.metadata);
      if (budgetStructure) {
        await insertPattern(supabase, {
          patternType: "budget_structure",
          patternContent: budgetStructure,
          funderCategory,
          nteeCode,
          winningExample: { ...baseExample, excerpt },
        });
        counts.budget_structure++;
      }

      ok(
        proposal.id,
        `${phrases.length} phrase(s), ${keywords.length} keyword(s)` +
          `${timingInsight ? ", timing" : ""}${budgetStructure ? ", budget" : ""}`,
      );
    } catch (error) {
      fail(proposal.id, error);
      failed++;
    }
  }

  const totalCreated = Object.values(counts).reduce((sum, n) => sum + n, 0);

  console.log("\n" + "=".repeat(70));
  console.log("SEED COMPLETE");
  console.log("=".repeat(70));
  console.log(`Total patterns created: ${totalCreated}`);
  console.log("Breakdown by pattern_type:");
  for (const [type, count] of Object.entries(counts)) {
    console.log(`  - ${type}: ${count}`);
  }
  console.log(`\nProposals processed: ${proposals.length - skippedAlreadySeeded - skippedNoText - failed}`);
  console.log(`Skipped (already seeded): ${skippedAlreadySeeded}`);
  console.log(`Skipped (no full_text): ${skippedNoText}`);
  console.log(`Failed: ${failed}`);
  console.log(`Claude tokens used: ${totalTokensUsed}`);
}

main().catch((error) => {
  fatal(error instanceof Error ? error.message : String(error));
});
