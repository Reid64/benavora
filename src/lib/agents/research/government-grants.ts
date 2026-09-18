// Government Grant Research Agent - AGENTS.md Agent 14.
//
// (Note on naming: a task brief once referred to this as "Agent 12" — per
// AGENTS.md's real registry, Agent 12 is the Corporate Giving Research Agent
// (src/lib/agents/research/corporate-giving.ts); this file, agent_type
// "government_research", is Agent 14. This is the class actually wired
// everywhere government research is triggered — the /api/agents/research
// route's agentType flow, the research page's "Government Grants" button, the
// scheduler, and orchestrator.ts's parallel lanes — so it was upgraded in
// place rather than adding a same-purpose parallel file under a new name.)
//
// Discovers federal, state, county, and city grant opportunities and turns them
// into opportunity (and funder) records. Four sources now run in parallel per
// run (BLUEPRINT §3.1, "elite" research-agent brief: parallel queries, dedicated
// API clients, KB semantic filtering, reflection, retry/backoff):
//
//   1. Profile-driven web search (original): active government-flavored
//      search_profiles → government queries → search Grants.gov (REST API) +
//      the web for state/county/HUD sources (search-engine) → fetch candidate
//      pages (web-fetcher) → extract a structured opportunity (result-parser,
//      via Claude) → de-duplicate (deduplicator) → create the funder/agency if
//      new + the opportunity (status open, source = profile name) +
//      opportunity_keywords.
//   2. Grants.gov REST API sync (grantsgov-sync.ts) — the verified-working
//      implementation; deliberately NOT src/lib/agents/grants-gov.ts, which
//      that file's own header comment documents as confirmed to hang
//      indefinitely and "not safe to run unattended" until root-caused.
//   3. SAM.gov REST API search (SamGovResearchAgent, Agent 16) — only when
//      SAM_GOV_API_KEY is configured (mirrors /api/agents/research's existing
//      multi-source flow); skipped, not failed, otherwise.
//   4. HUD funding-opportunities page monitor (HudMonitorAgent).
//
// Each of the three dedicated-API branches is independently branch-timeout-
// bounded (withBranchTimeout) so a pathological hang in one (network stall,
// upstream outage) cannot block the overall run past this agent's own
// timeoutMs — Promise.allSettled resolves every branch within that bound
// regardless of internal retries, at the cost of that branch's slower work
// continuing detached in the background (its results land on the next run's
// sweep, not lost — the same trade-off BaseAgent.run's own timeout already
// makes for the whole agent).
//
// After all four branches complete, newly created opportunities (this run's
// profile-driven ids, plus a created_at sweep for the other three branches,
// which do not return per-row ids) pass through two real filtering stages
// before eligibility scoring:
//   - KB semantic relevance (kb-relevance.ts): embeds the org's actual
//     configured focus (active search_profiles + knowledge_base) once, scores
//     each candidate by cosine similarity, and removes clear misses. Skipped
//     entirely (fail open) when there is no OPENAI_API_KEY or no configured
//     focus to score against — "cannot judge" must never mean "reject."
//   - Claude reflection pass: one batched call asking Claude to sanity-check
//     the KB-filtered shortlist against the org's mission and flag remaining
//     bad fits with a reason (catches domain mismatches embedding similarity
//     alone can miss, e.g. lexically close but substantively wrong). Fails
//     open on any error — a reflection failure keeps every candidate rather
//     than risk discarding a real discovery.
//
// Government-specific handling (profile-driven branch only): CFDA (Assistance
// Listing) and NOFO / funding opportunity numbers are extracted from the page
// when present and stored as searchable keywords plus a description prefix; a
// stated SAM.gov registration requirement is folded into the eligibility text.
// All of this is added ONLY when the page actually states it
// (BEHAVIORAL_CONTRACTS §9/§17: never fabricate).
//
// Contracts honored: every query is organization_id-scoped (§2); discovered
// opportunities default to status 'open', and eligibility scoring runs on
// every surviving new one (§17); de-duplication (URL, then fuzzy name+funder,
// or name/url per branch) runs before any insert (§17); the run logs to
// agent_runs with token usage via BaseAgent (§15). timeoutMs is raised to 270s
// (from BaseAgent's 60s default) to give the three parallel API branches room,
// mirroring its GrantsGovResearchAgent/SamGovResearchAgent siblings and
// leaving a 30s buffer under the 300s Vercel function ceiling.

import { callClaude, DEFAULT_MAX_TOKENS, DEFAULT_MODEL } from "@/lib/ai/claude";
import {
  BaseAgent,
  causeOf,
  type AgentExecution,
  type BaseAgentOptions,
  AGENT_TIMEOUT_MULTI_STEP_MS,
} from "@/lib/agents/base-agent";
import { EligibilityScorer } from "@/lib/agents/eligibility-scorer";
import { HudMonitorAgent } from "@/lib/agents/hud-monitor";
import { checkDuplicate } from "@/lib/agents/research/deduplicator";
import { applyQuerySuffix, type ResearchFocus } from "@/lib/agents/research/focus";
import { buildKbScorer, buildOrgFocusText } from "@/lib/agents/research/kb-relevance";
import { parseOpportunity } from "@/lib/agents/research/result-parser";
import {
  effectiveCategories,
  getActiveProfiles,
  getProfile,
  markProfileRun,
  profileAgentEnabled,
  profileExcludesFunder,
  profileQueryTerms,
  type ResearchSearchProfile,
} from "@/lib/agents/research/scheduler";
import { search, type SearchSource } from "@/lib/agents/research/search-engine";
import { fetchPage, type ResearchContext } from "@/lib/agents/research/web-fetcher";
import { SamGovResearchAgent } from "@/lib/agents/sam-gov";
import { searchEducationTrainingGrants } from "@/lib/agents/education-training-grants";
import { searchEnvironmentalClimateGrants } from "@/lib/agents/environmental-climate-grants";
import { searchHealthGrants } from "@/lib/agents/health-grants";
import { searchMinorityFarmerGrants } from "@/lib/agents/minority-farmer-grants";
import { inferSourceType } from "@/lib/opportunities/source-type";
import { persistGrantsGovHits, syncGrantsGovForOrg } from "@/lib/sources/grantsgov-sync";
import type { GrantsGovNormalizedOpportunity } from "@/lib/sources/grantsgov-client";
import type { AgentType } from "@/types/agents";
import type { Enums, TablesInsert } from "@/types/database";

type FunderCategory = Enums<"funder_category">;

/**
 * Funder categories this agent targets (task spec). A search profile must carry
 * at least one of these to be in scope for government research.
 */
export const GOVERNMENT_CATEGORIES: readonly FunderCategory[] = [
  "government_grant",
  "housing_grant",
  "education_grant",
];

/** Sources government research draws from (Grants.gov API + open web). */
const GOVERNMENT_SOURCES: SearchSource[] = ["grants_gov", "google"];

/** Default state for state-level queries; overridden by a profile's geo scope. */
const DEFAULT_STATE = "Texas";

export interface GovernmentGrantsInput {
  /**
   * Restrict the run to specific search profiles (e.g. a single "Run Now").
   * When omitted, every active profile carrying a government category runs.
   */
  profileIds?: string[] | null;
}

/** Per-source outcome for the three parallel dedicated-API branches. */
export interface GovernmentGrantsSourceOutcome {
  source: "grants_gov" | "sam_gov" | "hud" | "education" | "environment" | "health" | "minority_farmer";
  ok: boolean;
  created: number;
  /** Set when the branch did not run at all (e.g. no SAM.gov key configured). */
  skipped?: string;
  /** Set when the branch failed or timed out. */
  error?: string;
}

export interface GovernmentGrantsResult {
  /** Opportunities successfully extracted from candidate pages (pre-dedup). */
  opportunitiesFound: number;
  /** New opportunity rows actually created this run, across all 4 sources. */
  opportunitiesCreated: number;
  /** New funder rows created to back those opportunities. */
  fundersCreated: number;
  /** Per-source outcome for the grants_gov / sam_gov / hud branches. */
  sources: GovernmentGrantsSourceOutcome[];
  /** New opportunities removed by KB semantic-relevance filtering. */
  kbFiltered: number;
  /** New opportunities removed by the Claude reflection pass. */
  reflectionFiltered: number;
}

export interface GovernmentGrantsOptions extends BaseAgentOptions {
  /** Model override (resolved from platform_config `ai.model` by the caller). */
  model?: string;
  /** Max output tokens (platform_config `ai.max_tokens`). */
  maxTokens?: number;
  /**
   * Optional per-run specialization (parallel orchestration). When set, narrows
   * the search sources and/or appends a query suffix so several Government
   * passes (e.g. Grants.gov API vs. state agencies) can run side by side.
   */
  focus?: ResearchFocus;
}

// Run bounds - keep the synchronous pipeline within this agent's timeout
// (AGENTS.md §15). These are whole-run caps, applied across every profile.
const MAX_QUERIES_PER_PROFILE = 4;
const MAX_HITS_PER_QUERY = 5;
const MAX_PAGES_PER_RUN = 6;
const MAX_NEW_OPPS_PER_RUN = 5;
/** Drop low-quality extractions rather than persist junk (mirrors the route). */
const MIN_CONFIDENCE = 40;

/**
 * Per-branch bound for the three dedicated-API sources, well under this
 * agent's own 270s timeoutMs so Promise.allSettled always resolves every
 * branch with headroom left for KB filtering + reflection + eligibility
 * scoring afterward.
 */
const BRANCH_TIMEOUT_MS = 190_000;
/**
 * Keywords aggregated across the run's profiles and handed to the three API
 * branches, capped so a worst-case retry-exhaustion cascade on every keyword
 * still resolves within BRANCH_TIMEOUT_MS.
 */
const MAX_AGGREGATED_KEYWORDS = 6;
/** Below this KB-relevance score (0-100), a fresh discovery is removed. */
const KB_REJECT_THRESHOLD = 15;

export class GovernmentGrantsResearchAgent extends BaseAgent<
  GovernmentGrantsInput,
  GovernmentGrantsResult
> {
  readonly agentType: AgentType = "government_research";

  private readonly model: string;
  private readonly maxTokens: number;
  private readonly focus?: ResearchFocus;

  constructor(options: GovernmentGrantsOptions) {
    // Four sources now run per call (profile-driven web search + three
    // parallel dedicated-API branches); raise the timeout from BaseAgent's
    // 60s default to 270s to match, leaving a 30s buffer under the 300s
    // Vercel function ceiling (mirrors GrantsGovResearchAgent/
    // SamGovResearchAgent).
    super({ ...options, timeoutMs: options.timeoutMs ?? AGENT_TIMEOUT_MULTI_STEP_MS });
    this.model = options.model ?? DEFAULT_MODEL;
    this.maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.focus = options.focus;
  }

  protected async execute(
    input: GovernmentGrantsInput,
  ): Promise<AgentExecution<GovernmentGrantsResult>> {
    const profiles = await this.resolveProfiles(input.profileIds ?? null);

    if (profiles.length === 0) {
      return {
        data: {
          opportunitiesFound: 0,
          opportunitiesCreated: 0,
          fundersCreated: 0,
          sources: [],
          kbFiltered: 0,
          reflectionFiltered: 0,
        },
        outputSummary:
          "No active search profiles target government grants; nothing to research.",
        itemsFound: 0,
        itemsProcessed: 0,
        tokensUsed: 0,
      };
    }

    const runStartIso = new Date().toISOString();

    // Keywords shared by the three dedicated-API branches (capped so a
    // worst-case retry-exhaustion cascade still resolves within
    // BRANCH_TIMEOUT_MS - see the constant's comment).
    const aggregatedKeywords = Array.from(
      new Set(profiles.flatMap((p) => profileQueryTerms(p))),
    )
      .filter((k) => k.trim() !== "")
      .slice(0, MAX_AGGREGATED_KEYWORDS);

    // Run all four sources in parallel. The profile-driven branch is already
    // self-bounded (MAX_PAGES_PER_RUN / MAX_NEW_OPPS_PER_RUN) plus this
    // agent's own 270s BaseAgent timeout; the three dedicated-API branches
    // each get an explicit branch-level timeout so none can block the others
    // or the filtering stages that follow.
    const [webSearchResult, grantsGovOutcome, samGovOutcome, hudOutcome] =
      await Promise.all([
        this.runProfileDrivenBranch(profiles),
        withBranchTimeout(
          this.runGrantsGovBranch(aggregatedKeywords),
          BRANCH_TIMEOUT_MS,
          { source: "grants_gov", ok: false, created: 0, error: "branch timed out" },
        ),
        withBranchTimeout(
          this.runSamGovBranch(aggregatedKeywords),
          BRANCH_TIMEOUT_MS,
          { source: "sam_gov", ok: false, created: 0, error: "branch timed out" },
        ),
        withBranchTimeout(
          this.runHudBranch(aggregatedKeywords),
          BRANCH_TIMEOUT_MS,
          { source: "hud", ok: false, created: 0, error: "branch timed out" },
        ),
      ]);

    // Phase 5.4 (2026-09-15): the 4 category-scoped Grants.gov agents
    // (education/environmental/health/minority-farmer) were fully built,
    // tested, and never called by anything. They share the same "grants_gov"
    // source/externalId dedup key as runGrantsGovBranch above, so they run
    // SEQUENTIALLY after it (not inside the Promise.all with the other
    // branches) -- running them concurrently with each other or with
    // runGrantsGovBranch would let two branches both pass their own
    // independent "not found" externalId check before either insert
    // commits, double-inserting the same opportunity.
    const categoryOutcomes = await this.runCategoryGrantsBranches(aggregatedKeywords);

    const sources: GovernmentGrantsSourceOutcome[] = [
      grantsGovOutcome,
      samGovOutcome,
      hudOutcome,
      ...categoryOutcomes,
    ];

    // The three dedicated-API branches insert directly and don't return
    // per-row ids; sweep for what they created this run (mirrors
    // /api/agents/research's existing runSourceAndChain pattern).
    const sweptIds = await this.sweepNewOpportunityIds(runStartIso);
    const allNewIds = Array.from(
      new Set([...webSearchResult.newOpportunityIds, ...sweptIds]),
    );

    // Two real filtering stages before eligibility scoring. Both fail open:
    // an inability to judge relevance must never cost a genuine discovery.
    const afterKb = await this.applyKbFilter(allNewIds);
    const afterReflection = await this.applyReflectionFilter(afterKb.kept);

    // Eligibility scoring runs on every surviving new opportunity (Contracts
    // §17). Best-effort: each scorer logs its own run and a scoring failure
    // must never undo a successful discovery.
    for (const opportunityId of afterReflection.kept) {
      try {
        const scorer = new EligibilityScorer({
          client: this.client,
          organizationId: this.organizationId,
          triggeredBy: this.triggeredBy,
          model: this.model,
          maxTokens: this.maxTokens,
        });
        await scorer.run({ opportunityId });
      } catch (err) {
        console.error(
          `[government-grants] eligibility scoring failed for ${opportunityId}:`,
          err,
        );
      }
    }

    const opportunitiesCreated =
      webSearchResult.opportunitiesCreated +
      grantsGovOutcome.created +
      samGovOutcome.created +
      hudOutcome.created +
      categoryOutcomes.reduce((sum, o) => sum + o.created, 0) -
      afterKb.removed.length -
      afterReflection.removed.length;

    const truncated =
      webSearchResult.pagesProcessed >= MAX_PAGES_PER_RUN ||
      webSearchResult.opportunitiesCreated >= MAX_NEW_OPPS_PER_RUN;
    const focusPrefix = this.focus?.label ? `[${this.focus.label}] ` : "";
    const sourceSummaries = sources
      .map((s) => {
        if (s.skipped) return `${s.source} skipped (${s.skipped})`;
        if (!s.ok) return `${s.source} failed (${s.error ?? "unknown error"})`;
        return `${s.source} +${s.created}`;
      })
      .join(", ");
    const summary =
      `${focusPrefix}Government grant research across ${webSearchResult.profilesRun.length} ` +
      `profile(s) (${webSearchResult.profilesRun.join(", ")}): profile-driven web search fetched ` +
      `${webSearchResult.pagesProcessed} page(s) and found ${webSearchResult.opportunitiesFound} ` +
      `opportunit${webSearchResult.opportunitiesFound === 1 ? "y" : "ies"}; parallel API sources: ` +
      `${sourceSummaries}. ${afterKb.removed.length} removed by KB relevance, ` +
      `${afterReflection.removed.length} removed by reflection. ` +
      `${Math.max(0, opportunitiesCreated)} new opportunit${opportunitiesCreated === 1 ? "y" : "ies"} ` +
      `and ${webSearchResult.fundersCreated} new agency/funder(s) survived.` +
      (truncated ? " Profile-driven run bounds reached; remaining candidates were not processed." : "");

    return {
      data: {
        opportunitiesFound: webSearchResult.opportunitiesFound,
        opportunitiesCreated: Math.max(0, opportunitiesCreated),
        fundersCreated: webSearchResult.fundersCreated,
        sources,
        kbFiltered: afterKb.removed.length,
        reflectionFiltered: afterReflection.removed.length,
      },
      outputSummary: summary,
      itemsFound: webSearchResult.opportunitiesFound,
      itemsProcessed: Math.max(0, opportunitiesCreated),
      tokensUsed: webSearchResult.tokensUsed,
    };
  }

  // --- profile-driven branch (original discovery path) ------------------------

  /** Per-run outcome of the original profile-driven web-search discovery. */
  private async runProfileDrivenBranch(
    profiles: ResearchSearchProfile[],
  ): Promise<{
    opportunitiesFound: number;
    opportunitiesCreated: number;
    fundersCreated: number;
    pagesProcessed: number;
    tokensUsed: number;
    profilesRun: string[];
    newOpportunityIds: string[];
  }> {
    const ctx: ResearchContext = {
      client: this.client,
      organizationId: this.organizationId,
    };

    // URLs seen anywhere in this run (across profiles) - never fetch twice.
    const seenUrls = new Set<string>();
    const newOpportunityIds: string[] = [];
    let opportunitiesFound = 0;
    let opportunitiesCreated = 0;
    let fundersCreated = 0;
    let pagesProcessed = 0;
    let tokensUsed = 0;
    const profilesRun: string[] = [];

    for (const profile of profiles) {
      if (pagesProcessed >= MAX_PAGES_PER_RUN || opportunitiesCreated >= MAX_NEW_OPPS_PER_RUN) {
        break;
      }
      profilesRun.push(profile.name);

      const queries = applyQuerySuffix(buildGovernmentQueries(profile), this.focus);
      const candidates = await this.gatherCandidates(queries, seenUrls);

      let profileFound = 0;
      for (const url of candidates) {
        if (pagesProcessed >= MAX_PAGES_PER_RUN || opportunitiesCreated >= MAX_NEW_OPPS_PER_RUN) {
          break;
        }

        // Skip pages already turned into opportunities before paying to fetch.
        const urlDup = await checkDuplicate({
          client: this.client,
          organizationId: this.organizationId,
          url,
        });
        if (urlDup.isDuplicate) continue;

        pagesProcessed++;
        const page = await fetchPage(ctx, { url });
        if (!page.ok || !page.text) continue;

        const parsed = await parseOpportunity({
          rawContent: page.text,
          sourceUrl: url,
          model: this.model,
          maxTokens: this.maxTokens,
        });
        tokensUsed += parsed.tokensUsed;
        if (!parsed.opportunity || parsed.confidence < MIN_CONFIDENCE) continue;

        opportunitiesFound++;
        profileFound++;
        const opp = parsed.opportunity;

        // Final fuzzy de-dup on the extracted name + funder (Contracts §17).
        const nameDup = await checkDuplicate({
          client: this.client,
          organizationId: this.organizationId,
          url,
          name: opp.name,
          funderName: opp.funder_name,
        });
        if (nameDup.isDuplicate) continue;

        // Negative filter (Configuration page "excluded funders"): never create
        // an opportunity from an agency/funder the profile has excluded.
        if (profileExcludesFunder(profile, opp.funder_name)) continue;

        // Category is required on opportunities; fall back to the profile's first
        // government category when the page did not state one.
        const category =
          opp.category ?? firstGovernmentCategory(profile) ?? profile.categories[0] ?? null;
        if (!category) continue;

        // Pull government identifiers (CFDA / NOFO numbers) and the SAM.gov
        // registration requirement from the page, only when actually present.
        const gov = extractGovIdentifiers(page.text);

        // Create the agency/funder if it does not already exist (task spec).
        const { funderId, created: funderCreated } = await this.resolveFunder(
          opp.funder_name,
          category,
          url,
        );
        if (funderCreated) fundersCreated++;

        const { data: inserted, error: insertError } = await this.client
          .from("opportunities")
          .insert({
            organization_id: this.organizationId,
            funder_id: funderId,
            name: opp.name,
            category,
            description: prefixIdentifiers(opp.description, gov),
            amount_min: opp.amount_min,
            amount_max: opp.amount_max,
            deadline: opp.deadline,
            url: opp.url,
            eligibility_requirements: withSamNote(
              opp.eligibility_requirements,
              gov.samRequired,
            ),
            required_documents: opp.required_documents,
            application_method: opp.application_method,
            recurrence: opp.recurrence,
            geographic_restrictions: opp.geographic_restrictions,
            status: "open",
            source: profile.name,
            // Auto-classify the government tier. Extracted CFDA/NOFO numbers and
            // a SAM.gov requirement are strong federal signals; otherwise the
            // page text (state/county/city) decides the tier.
            source_type: inferSourceType({
              category,
              name: opp.name,
              description: opp.description,
              funderName: opp.funder_name,
              geographicScope:
                profile.geographicScope ?? opp.geographic_restrictions,
              eligibilityRequirements: opp.eligibility_requirements,
              extraText: [
                gov.samRequired ? "SAM.gov federal award" : "",
                ...gov.identifiers,
              ].join(" "),
            }),
          } satisfies TablesInsert<"opportunities">)
          .select("id")
          .single();

        if (insertError || !inserted?.id) {
          console.error("[government-grants] opportunity insert failed:", insertError);
          continue;
        }

        opportunitiesCreated++;
        const opportunityId = inserted.id as string;
        newOpportunityIds.push(opportunityId);

        // Profile keywords plus any extracted CFDA / NOFO numbers, so the
        // opportunity is findable by its federal identifiers.
        await this.createKeywords(opportunityId, [
          ...profile.keywords,
          ...gov.identifiers,
        ]);
      }

      // Stamp last_run_at and accumulate the profile's lifetime results.
      await markProfileRun(ctx, profile, profileFound);
    }

    return {
      opportunitiesFound,
      opportunitiesCreated,
      fundersCreated,
      pagesProcessed,
      tokensUsed,
      profilesRun,
      newOpportunityIds,
    };
  }

  // --- parallel dedicated-API branches -----------------------------------------

  /**
   * Grants.gov via the verified-working sync path (grantsgov-sync.ts), NOT
   * src/lib/agents/grants-gov.ts — that class's own header comment documents
   * a confirmed, reproducible indefinite-hang bug and says not to wire it
   * into any unattended path until root-caused. This branch stays real and
   * safe by construction.
   */
  private async runGrantsGovBranch(
    keywords: string[],
  ): Promise<GovernmentGrantsSourceOutcome> {
    try {
      const result = await syncGrantsGovForOrg(this.client, this.organizationId, keywords);
      return { source: "grants_gov", ok: true, created: result.newCount };
    } catch (err) {
      console.error("[government-grants:grants_gov] sync failed:", err);
      return {
        source: "grants_gov",
        ok: false,
        created: 0,
        error: err instanceof Error ? err.message : "unknown error",
      };
    }
  }

  /**
   * SAM.gov via SamGovResearchAgent (Agent 16). Mirrors
   * /api/agents/research's existing multi-source flow: reads the platform-wide
   * SAM_GOV_API_KEY env var (not a per-org integration_keys row - that is
   * this class's own aspirational-but-unused design per its header comment;
   * the global env var is what every live caller actually passes). Skipped,
   * not failed, when unset.
   */
  private async runSamGovBranch(
    keywords: string[],
  ): Promise<GovernmentGrantsSourceOutcome> {
    const apiKey = process.env.SAM_GOV_API_KEY;
    if (!apiKey) {
      return {
        source: "sam_gov",
        ok: true,
        created: 0,
        skipped: "SAM_GOV_API_KEY not configured",
      };
    }
    try {
      const agent = new SamGovResearchAgent({
        client: this.client,
        organizationId: this.organizationId,
        triggeredBy: this.triggeredBy,
      });
      const outcome = await agent.run({ apiKey, keywords });
      return { source: "sam_gov", ok: true, created: outcome.data.opportunitiesCreated };
    } catch (err) {
      console.error("[government-grants:sam_gov] run failed:", err);
      return {
        source: "sam_gov",
        ok: false,
        created: 0,
        error: err instanceof Error ? err.message : "unknown error",
      };
    }
  }

  /** HUD funding-opportunities page monitor (HudMonitorAgent). */
  private async runHudBranch(
    keywords: string[],
  ): Promise<GovernmentGrantsSourceOutcome> {
    try {
      const agent = new HudMonitorAgent({
        client: this.client,
        organizationId: this.organizationId,
        triggeredBy: this.triggeredBy,
      });
      const outcome = await agent.run({ keywords });
      return { source: "hud", ok: true, created: outcome.data.opportunitiesCreated };
    } catch (err) {
      console.error("[government-grants:hud] run failed:", err);
      return {
        source: "hud",
        ok: false,
        created: 0,
        error: err instanceof Error ? err.message : "unknown error",
      };
    }
  }

  /**
   * The 4 category-scoped Grants.gov searches (education/environmental/
   * health/minority-farmer), run sequentially (see the caller's comment on
   * why not concurrently) after runGrantsGovBranch has already committed its
   * inserts. Each persists via the shared persistGrantsGovHits() upsert —
   * the same "grants_gov" source + externalId dedup key as the generic
   * branch, under the org-wide "government_grant" category (no dedicated
   * enum values exist for environment/health/minority-farmer; education has
   * its own "education_grant" category). A failure in one category never
   * blocks the others.
   */
  private async runCategoryGrantsBranches(
    keywords: string[],
  ): Promise<GovernmentGrantsSourceOutcome[]> {
    const categories: Array<{
      source: GovernmentGrantsSourceOutcome["source"];
      search: (terms?: readonly string[]) => Promise<GrantsGovNormalizedOpportunity[]>;
      category: "government_grant" | "education_grant";
    }> = [
      { source: "education", search: searchEducationTrainingGrants, category: "education_grant" },
      { source: "environment", search: searchEnvironmentalClimateGrants, category: "government_grant" },
      { source: "health", search: searchHealthGrants, category: "government_grant" },
      { source: "minority_farmer", search: searchMinorityFarmerGrants, category: "government_grant" },
    ];

    const outcomes: GovernmentGrantsSourceOutcome[] = [];
    for (const { source, search, category } of categories) {
      try {
        const hits = await search(keywords.length > 0 ? keywords : undefined);
        const { newCount } = await persistGrantsGovHits(
          this.client,
          this.organizationId,
          hits,
          category,
        );
        outcomes.push({ source, ok: true, created: newCount });
      } catch (err) {
        console.error(`[government-grants:${source}] search/persist failed:`, err);
        outcomes.push({
          source,
          ok: false,
          created: 0,
          error: err instanceof Error ? err.message : "unknown error",
        });
      }
    }
    return outcomes;
  }

  /**
   * Opportunities created since `runStartIso` by the three dedicated-API
   * branches, which insert directly and don't return per-row ids. Scoped by
   * organization_id and a source_type in the branches' own vocabulary so an
   * unrelated concurrent insert (e.g. a user manually adding one) is not
   * swept in.
   */
  private async sweepNewOpportunityIds(runStartIso: string): Promise<string[]> {
    const { data, error } = await this.client
      .from("opportunities")
      .select("id, source")
      .eq("organization_id", this.organizationId)
      .gte("created_at", runStartIso)
      .in("source", ["grants_gov", "sam.gov", "hud.gov"]);
    if (error) {
      console.error("[government-grants] new-opportunity sweep failed:", error);
      return [];
    }
    return (data ?? []).map((r) => r.id as string);
  }

  // --- post-discovery filtering -------------------------------------------------

  /**
   * KB semantic-relevance filter: removes newly created opportunities that
   * score below KB_REJECT_THRESHOLD against the org's real configured focus.
   * Fails open (kept unchanged, nothing removed) when there's no scorer to
   * build (no OPENAI_API_KEY, or no active profiles/knowledge_base to score
   * against) - "cannot judge" must never mean "reject."
   */
  private async applyKbFilter(
    ids: string[],
  ): Promise<{ kept: string[]; removed: string[] }> {
    if (ids.length === 0) return { kept: [], removed: [] };

    const scorer = await buildKbScorer({
      client: this.client,
      organizationId: this.organizationId,
    });
    if (!scorer) return { kept: ids, removed: [] };

    const { data, error } = await this.client
      .from("opportunities")
      .select("id, name, description")
      .in("id", ids);
    if (error) {
      // Fails open by design (see docstring): "cannot judge" must never mean
      // "reject." Log the real cause distinctly, then keep every candidate.
      console.error(`[applyKbFilter] lookup failed: ${causeOf(error)}`);
      return { kept: ids, removed: [] };
    }
    if (!data) return { kept: ids, removed: [] };

    const kept: string[] = [];
    const removed: string[] = [];
    for (const row of data as Array<{ id: string; name: string; description: string | null }>) {
      const score = await scorer.score(`${row.name} ${row.description ?? ""}`);
      if (score < KB_REJECT_THRESHOLD) {
        removed.push(row.id);
      } else {
        kept.push(row.id);
      }
    }

    if (removed.length > 0) {
      await this.deleteOpportunities(removed, "kb-filter");
    }
    return { kept, removed };
  }

  /**
   * Claude reflection pass: one batched call sanity-checking the KB-filtered
   * shortlist against the org's mission, catching domain mismatches
   * embedding similarity alone can miss. Fails open on any error, empty
   * input, or malformed response - a reflection failure keeps every
   * candidate rather than risk discarding a real discovery.
   */
  private async applyReflectionFilter(
    ids: string[],
  ): Promise<{ kept: string[]; removed: string[] }> {
    if (ids.length === 0) return { kept: [], removed: [] };

    const { data, error } = await this.client
      .from("opportunities")
      .select("id, name, description, category")
      .in("id", ids);
    if (error) {
      // Fails open by design (see docstring): a reflection-filter failure
      // must keep every candidate, not discard them. Log the real cause
      // distinctly before falling back.
      console.error(`[applyReflectionFilter] lookup failed: ${causeOf(error)}`);
      return { kept: ids, removed: [] };
    }
    if (!data || data.length === 0) {
      return { kept: ids, removed: [] };
    }
    const candidates = data as Array<{
      id: string;
      name: string;
      description: string | null;
      category: string;
    }>;

    const focusText = await buildOrgFocusText({
      client: this.client,
      organizationId: this.organizationId,
    });
    if (!focusText) return { kept: ids, removed: [] };

    const listing = candidates
      .map(
        (c, i) =>
          `${i + 1}. id=${c.id} category=${c.category} name="${c.name}"\n   description: ${(c.description ?? "none").slice(0, 300)}`,
      )
      .join("\n");

    const prompt = `An organization's real configured mission/focus (from its own search profiles and knowledge base): ${focusText}

Below is a shortlist of grant opportunities a research agent just discovered for this organization. For each one, judge whether it is plausibly relevant to this organization's actual mission, or whether it is a clear domain mismatch (e.g. the org serves housing/reentry/recovery populations but the opportunity is for unrelated STEM research, defense contracting, agriculture, etc.).

Opportunities:
${listing}

Return ONLY a JSON array, one entry per opportunity, in this exact shape:
[{"id": "<id>", "keep": true|false, "reason": "<one short sentence>"}]

Only mark keep:false for a CLEAR mismatch. When genuinely uncertain, keep:true - never discard a plausible discovery on a guess.`;

    let text: string;
    let tokens = 0;
    try {
      const result = await callClaude({
        prompt,
        maxTokens: 1024,
        temperature: 0,
      });
      text = result.text;
      tokens = result.usage.totalTokens;
    } catch (err) {
      console.error("[government-grants:reflection] Claude call failed:", err);
      return { kept: ids, removed: [] };
    }

    let judged: Array<{ id?: unknown; keep?: unknown; reason?: unknown }>;
    try {
      const clean = text
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```\s*$/, "")
        .trim();
      const parsed: unknown = JSON.parse(clean);
      if (!Array.isArray(parsed)) throw new Error("not an array");
      judged = parsed;
    } catch (err) {
      console.error("[government-grants:reflection] malformed response:", err, tokens);
      return { kept: ids, removed: [] };
    }

    const rejectIds = new Set(
      judged
        .filter((j) => typeof j.id === "string" && j.keep === false)
        .map((j) => j.id as string),
    );

    const kept = ids.filter((id) => !rejectIds.has(id));
    const removed = ids.filter((id) => rejectIds.has(id));
    if (removed.length > 0) {
      for (const id of removed) {
        const reason = judged.find((j) => j.id === id)?.reason;
        console.log(`[government-grants:reflection] removed ${id}: ${String(reason ?? "no reason given")}`);
      }
      await this.deleteOpportunities(removed, "reflection");
    }
    return { kept, removed };
  }

  /** Best-effort delete of rejected opportunities (opportunity_keywords and deadlines cascade). */
  private async deleteOpportunities(ids: string[], stage: string): Promise<void> {
    const { error } = await this.client
      .from("opportunities")
      .delete()
      .eq("organization_id", this.organizationId)
      .in("id", ids);
    if (error) {
      console.error(`[government-grants:${stage}] delete failed (kept in DB):`, error);
    }
  }

  // --- profile selection -----------------------------------------------------

  /**
   * The profiles this run will process. Two modes:
   *   - Caller-supplied ids (a single "Run Now"): honor the explicit choice -
   *     any active profile, even one not tagged government. Missing or paused
   *     profiles are silently skipped.
   *   - No ids ("Run all"): every active profile carrying a government category,
   *     so an automated sweep only touches government-relevant profiles.
   */
  private async resolveProfiles(
    profileIds: string[] | null,
  ): Promise<ResearchSearchProfile[]> {
    const ctx: ResearchContext = {
      client: this.client,
      organizationId: this.organizationId,
    };

    if (profileIds && profileIds.length > 0) {
      const loaded = await Promise.all(
        profileIds.map((id) => getProfile(ctx, id)),
      );
      return loaded.filter(
        (p): p is ResearchSearchProfile => p != null && p.isActive,
      );
    }

    const active = await getActiveProfiles(ctx);
    // Honor the profile's per-agent toggle (Configuration page): a profile that
    // has government research disabled is skipped on an automated sweep.
    return active.filter(
      (p) => isGovernmentProfile(p) && profileAgentEnabled(p, this.agentType),
    );
  }

  // --- candidate gathering ----------------------------------------------------

  /** Run the profile's queries and collect new candidate URLs, run-deduped + capped. */
  private async gatherCandidates(
    queries: string[],
    seenUrls: Set<string>,
  ): Promise<string[]> {
    const candidates: string[] = [];
    const sources = this.focus?.sources ?? GOVERNMENT_SOURCES;
    for (const query of queries) {
      const hits = await search({
        query,
        sources,
        limitPerSource: MAX_HITS_PER_QUERY,
      });
      for (const hit of hits) {
        if (seenUrls.has(hit.url)) continue;
        seenUrls.add(hit.url);
        candidates.push(hit.url);
      }
    }
    return candidates;
  }

  // --- writes -----------------------------------------------------------------

  /**
   * Resolve the agency/funder for an opportunity: find an existing one by name
   * (org-scoped), or create it with the extracted/derived category. Returns a
   * null funder id when the page named no agency.
   */
  private async resolveFunder(
    funderName: string | null,
    category: FunderCategory,
    sourceUrl: string,
  ): Promise<{ funderId: string | null; created: boolean }> {
    const name = (funderName ?? "").trim();
    if (name === "") return { funderId: null, created: false };

    try {
      const { data: existing } = await this.client
        .from("funders")
        .select("id")
        .eq("organization_id", this.organizationId)
        .ilike("name", name)
        .limit(1)
        .maybeSingle();
      if (existing?.id) {
        return { funderId: existing.id as string, created: false };
      }
    } catch (err) {
      console.error("[government-grants] funder lookup failed:", err);
    }

    const { data: created, error } = await this.client
      .from("funders")
      .insert({
        organization_id: this.organizationId,
        name,
        category,
        website: originOf(sourceUrl),
        notes: "Discovered by the Government Grant Research agent.",
      } satisfies TablesInsert<"funders">)
      .select("id")
      .single();

    if (error || !created?.id) {
      console.error("[government-grants] funder insert failed:", error);
      return { funderId: null, created: false };
    }
    return { funderId: created.id as string, created: true };
  }

  /** Create opportunity_keywords from the supplied keywords (deduped, trimmed). */
  private async createKeywords(
    opportunityId: string,
    keywords: string[],
  ): Promise<void> {
    const unique = Array.from(
      new Set(keywords.map((k) => k.trim()).filter((k) => k !== "")),
    );
    if (unique.length === 0) return;

    const rows: TablesInsert<"opportunity_keywords">[] = unique.map((keyword) => ({
      organization_id: this.organizationId,
      opportunity_id: opportunityId,
      keyword,
    }));

    const { error } = await this.client.from("opportunity_keywords").insert(rows);
    if (error) {
      console.error("[government-grants] keyword insert failed:", error);
    }
  }
}

// --- helpers -----------------------------------------------------------------

/** True if the profile targets at least one (non-excluded) government category. */
function isGovernmentProfile(profile: ResearchSearchProfile): boolean {
  return effectiveCategories(profile).some((c) => GOVERNMENT_CATEGORIES.includes(c));
}

/** The profile's first government category, used as the opportunity-category fallback. */
function firstGovernmentCategory(
  profile: ResearchSearchProfile,
): FunderCategory | null {
  return (
    effectiveCategories(profile).find((c) => GOVERNMENT_CATEGORIES.includes(c)) ??
    null
  );
}

/**
 * Expand a profile's keywords into government search queries using the task's
 * templates (federal / state / county / HUD housing). The state segment uses the
 * profile's geographic scope when set, otherwise the default (Texas, the primary
 * operating area). De-duplicated and capped to bound a run's web traffic.
 */
export function buildGovernmentQueries(profile: ResearchSearchProfile): string[] {
  const geo = profile.geographicScope?.trim() ?? "";
  const state = geo !== "" ? geo : DEFAULT_STATE;
  const queries: string[] = [];

  // Keywords plus the profile's weighted focus areas / population tags.
  for (const rawKeyword of profileQueryTerms(profile)) {
    const keyword = rawKeyword.trim();
    if (keyword === "") continue;
    queries.push(`${keyword} federal grant`);
    queries.push(`${keyword} state grant ${state}`);
    queries.push(`${keyword} county grant`);
    queries.push(`${keyword} HUD housing grant`);
  }

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const q of queries) {
    const norm = q.trim().toLowerCase();
    if (norm === "" || seen.has(norm)) continue;
    seen.add(norm);
    unique.push(q.trim());
    if (unique.length >= MAX_QUERIES_PER_PROFILE) break;
  }
  return unique;
}

/** Government identifiers and flags pulled from a page (task spec step 5/6). */
export interface GovIdentifiers {
  /** CFDA (Assistance Listing) numbers, e.g. "14.218". */
  cfda: string[];
  /** NOFO / funding opportunity numbers, e.g. "HUD-2024-001". */
  nofo: string[];
  /** All identifiers combined, for use as searchable keywords. */
  identifiers: string[];
  /** True when the page states a SAM.gov registration requirement. */
  samRequired: boolean;
}

/**
 * Extract CFDA / NOFO numbers and the SAM.gov registration requirement from page
 * text. Conservative: a CFDA number is only taken when the "CFDA" / "Assistance
 * Listing" label appears nearby, so stray "12.345"-shaped strings are not
 * mistaken for identifiers. Returns empty results when the page states none -
 * nothing is fabricated (Contracts §9).
 */
export function extractGovIdentifiers(pageText: string): GovIdentifiers {
  const cfda = new Set<string>();
  const nofo = new Set<string>();

  const cfdaRe =
    /(?:CFDA|Assistance Listing)(?:\s*(?:#|No\.?|Number))?\s*[:#]?\s*(\d{2}\.\d{3})/gi;
  let m: RegExpExecArray | null;
  while ((m = cfdaRe.exec(pageText)) !== null) {
    if (m[1]) cfda.add(m[1]);
  }

  const nofoRe =
    /(?:NOFO|NOFA|Funding Opportunity Number|Opportunity Number|Announcement Number)\s*[:#]?\s*([A-Z][A-Z0-9][A-Z0-9-]{3,})/gi;
  while ((m = nofoRe.exec(pageText)) !== null) {
    if (m[1]) nofo.add(m[1].replace(/[.,;]+$/, ""));
  }

  const samRequired =
    /\bSAM\.gov\b|System for Award Management|Unique Entity Identifier|\bUEI\b/i.test(
      pageText,
    );

  const cfdaList = Array.from(cfda);
  const nofoList = Array.from(nofo);
  const identifiers = [
    ...cfdaList.map((c) => `CFDA ${c}`),
    ...nofoList.map((n) => `NOFO ${n}`),
  ];

  return { cfda: cfdaList, nofo: nofoList, identifiers, samRequired };
}

/** Prefix a description with any extracted federal identifiers, when present. */
function prefixIdentifiers(
  description: string | null,
  gov: GovIdentifiers,
): string | null {
  if (gov.identifiers.length === 0) return description;
  const prefix = `[${gov.identifiers.join("; ")}]`;
  const base = (description ?? "").trim();
  return base === "" ? prefix : `${prefix} ${base}`;
}

/**
 * Append a SAM.gov registration note to the eligibility text when the page
 * stated the requirement. Returns the original text unchanged otherwise, and
 * skips the note if the text already mentions SAM (no duplication).
 */
export function withSamNote(
  eligibility: string | null,
  samRequired: boolean,
): string | null {
  if (!samRequired) return eligibility;
  const base = (eligibility ?? "").trim();
  if (/sam\.gov|system for award management/i.test(base)) return eligibility;
  const note = "Requires active SAM.gov registration (federal award eligibility).";
  return base === "" ? note : `${base}\n\n${note}`;
}

/** The scheme+host of a URL (used as a discovered agency's website), or null. */
function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Races `work` against a `ms` timer, resolving with `fallback` if the timer
 * wins. Unlike BaseAgent's withTimeout (which rejects), this resolves so
 * Promise.all over several branches never aborts the whole run because one
 * branch is slow — the slow branch's own work keeps running in the
 * background and, if it eventually inserts rows, they are picked up by the
 * next run's sweep rather than lost.
 */
function withBranchTimeout<T>(
  work: Promise<T>,
  ms: number,
  fallback: T,
): Promise<T> {
  return Promise.race([
    work,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}
