// Foundation Grant Research Agent - AGENTS.md Agent 13.
//
// Discovers private- and corporate-foundation grant opportunities and turns them
// into opportunity (and funder) records. It drives off the organization's active
// foundation-flavored search_profiles and runs the shared research pipeline for
// each:
//
//   active foundation profiles → build foundation queries from keywords →
//   search Foundation Directory + the web (search-engine) → fetch candidate pages
//   (web-fetcher) → extract a structured opportunity (result-parser, via Claude) →
//   de-duplicate (deduplicator) → create the funder if new + the opportunity
//   (status open, source = profile name) + opportunity_keywords → score
//   eligibility (Agent 02).
//
// Foundation-specific handling: when a page states a Letter-of-Inquiry (LOI)
// requirement or a named application cycle, that fact is folded into the
// opportunity's eligibility_requirements so it is not lost - only when the page
// actually states it (BEHAVIORAL_CONTRACTS §9/§17: never fabricate).
//
// Contracts honored: every query is organization_id-scoped (§2); discovered
// opportunities default to status 'open' and source = profile name, and
// eligibility scoring runs on each new one (§17); de-duplication (URL, then
// fuzzy name+funder) runs before any insert (§17); the run logs to agent_runs
// with token usage via BaseAgent (§15). Work is bounded so the run stays within
// the 60s agent ceiling - any truncation is recorded in the run summary so a cap
// is never silent.

import { DEFAULT_MAX_TOKENS, DEFAULT_MODEL } from "@/lib/ai/claude";
import {
  BaseAgent,
  type AgentExecution,
  type BaseAgentOptions,
  AGENT_TIMEOUT_MULTI_STEP_MS,
} from "@/lib/agents/base-agent";
import { EligibilityScorer } from "@/lib/agents/eligibility-scorer";
import { checkDuplicate } from "@/lib/agents/research/deduplicator";
import { applyQuerySuffix, type ResearchFocus } from "@/lib/agents/research/focus";
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
import { inferSourceType } from "@/lib/opportunities/source-type";
import type { AgentType } from "@/types/agents";
import type { Enums, TablesInsert } from "@/types/database";

type FunderCategory = Enums<"funder_category">;

/**
 * Funder categories this agent targets (task spec). A search profile must carry
 * at least one of these to be in scope for foundation research.
 */
export const FOUNDATION_CATEGORIES: readonly FunderCategory[] = [
  "private_foundation",
  "corporate_foundation",
];

/** Sources foundation research draws from (Foundation Directory + open web). */
const FOUNDATION_SOURCES: SearchSource[] = ["foundation_directory", "google"];

export interface FoundationGrantsInput {
  /**
   * Restrict the run to specific search profiles (e.g. a single "Run Now").
   * When omitted, every active profile carrying a foundation category runs.
   */
  profileIds?: string[] | null;
}

export interface FoundationGrantsResult {
  /** Opportunities successfully extracted from candidate pages (pre-dedup). */
  opportunitiesFound: number;
  /** New opportunity rows actually created this run. */
  opportunitiesCreated: number;
  /** New funder rows created to back those opportunities. */
  fundersCreated: number;
}

export interface FoundationGrantsOptions extends BaseAgentOptions {
  /** Model override (resolved from platform_config `ai.model` by the caller). */
  model?: string;
  /** Max output tokens (platform_config `ai.max_tokens`). */
  maxTokens?: number;
  /**
   * Optional per-run specialization (parallel orchestration). When set, narrows
   * the search sources and/or appends a query suffix so several Foundation
   * passes (e.g. Foundation Directory vs. faith-based funders) can run side by
   * side.
   */
  focus?: ResearchFocus;
}

// Run bounds - keep the synchronous pipeline within the 60s agent ceiling
// (AGENTS.md §15). These are whole-run caps, applied across every profile.
const MAX_QUERIES_PER_PROFILE = 4;
const MAX_HITS_PER_QUERY = 5;
const MAX_PAGES_PER_RUN = 6;
const MAX_NEW_OPPS_PER_RUN = 5;
/** Drop low-quality extractions rather than persist junk (mirrors the route). */
const MIN_CONFIDENCE = 40;

/**
 * Query templates the foundation agent expands each profile keyword into (task
 * spec). Geographic scope, when set, is appended to narrow results.
 */
const QUERY_TEMPLATES = [
  (kw: string) => `${kw} foundation grant opportunity`,
  (kw: string) => `${kw} private foundation funding`,
  (kw: string) => `${kw} community foundation grants`,
];

export class FoundationGrantsResearchAgent extends BaseAgent<
  FoundationGrantsInput,
  FoundationGrantsResult
> {
  readonly agentType: AgentType = "foundation_research";

  private readonly model: string;
  private readonly maxTokens: number;
  private readonly focus?: ResearchFocus;

  constructor(options: FoundationGrantsOptions) {
    super({ ...options, timeoutMs: options.timeoutMs ?? AGENT_TIMEOUT_MULTI_STEP_MS });
    this.model = options.model ?? DEFAULT_MODEL;
    this.maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.focus = options.focus;
  }

  protected async execute(
    input: FoundationGrantsInput,
  ): Promise<AgentExecution<FoundationGrantsResult>> {
    this.setPhase("resolving search profiles");
    const profiles = await this.resolveProfiles(input.profileIds ?? null);

    if (profiles.length === 0) {
      return {
        data: { opportunitiesFound: 0, opportunitiesCreated: 0, fundersCreated: 0 },
        outputSummary:
          "No active search profiles target foundation grants; nothing to research.",
        itemsFound: 0,
        itemsProcessed: 0,
        tokensUsed: 0,
      };
    }

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
      this.setPhase(`gathering candidates for profile "${profile.name}" (page ${pagesProcessed}/${MAX_PAGES_PER_RUN})`);

      const queries = applyQuerySuffix(buildFoundationQueries(profile), this.focus);
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
        this.setPhase(`fetching page ${pagesProcessed}/${MAX_PAGES_PER_RUN} for profile "${profile.name}"`);
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
        // an opportunity from a funder the profile has explicitly excluded.
        if (profileExcludesFunder(profile, opp.funder_name)) continue;

        // Category is required on opportunities; fall back to the profile's first
        // foundation category when the page did not state one.
        const category =
          opp.category ?? firstFoundationCategory(profile) ?? profile.categories[0] ?? null;
        if (!category) continue;

        // Create the funder if it does not already exist (task spec step 5).
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
            description: opp.description,
            amount_min: opp.amount_min,
            amount_max: opp.amount_max,
            deadline: opp.deadline,
            url: opp.url,
            // Fold a stated LOI/application-cycle requirement into the
            // eligibility text so the foundation-specific gate is preserved.
            eligibility_requirements: withFoundationNotes(
              opp.eligibility_requirements,
              page.text,
            ),
            required_documents: opp.required_documents,
            application_method: opp.application_method,
            recurrence: opp.recurrence,
            geographic_restrictions: opp.geographic_restrictions,
            status: "open",
            source: profile.name,
            // Auto-classify the funding source from what the page stated, so
            // discovered opportunities land in the right source-type tab/badge.
            source_type: inferSourceType({
              category,
              name: opp.name,
              description: opp.description,
              funderName: opp.funder_name,
              geographicScope: profile.geographicScope,
              eligibilityRequirements: opp.eligibility_requirements,
            }),
          } satisfies TablesInsert<"opportunities">)
          .select("id")
          .single();

        if (insertError || !inserted?.id) {
          console.error("[foundation-grants] opportunity insert failed:", insertError);
          continue;
        }

        opportunitiesCreated++;
        const opportunityId = inserted.id as string;
        newOpportunityIds.push(opportunityId);

        await this.createKeywords(opportunityId, profile.keywords);
      }

      // Stamp last_run_at and accumulate the profile's lifetime results.
      await markProfileRun(ctx, profile, profileFound);
    }

    // Eligibility scoring runs automatically on every newly discovered
    // opportunity (Contracts §17). Best-effort: each scorer logs its own run and
    // a scoring failure must never undo a successful discovery.
    for (const opportunityId of newOpportunityIds) {
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
          `[foundation-grants] eligibility scoring failed for ${opportunityId}:`,
          err,
        );
      }
    }

    const truncated =
      pagesProcessed >= MAX_PAGES_PER_RUN ||
      opportunitiesCreated >= MAX_NEW_OPPS_PER_RUN;
    const focusPrefix = this.focus?.label ? `[${this.focus.label}] ` : "";
    const summary =
      `${focusPrefix}Foundation grant research across ${profilesRun.length} profile(s) ` +
      `(${profilesRun.join(", ")}): fetched ${pagesProcessed} page(s), found ` +
      `${opportunitiesFound} opportunit${opportunitiesFound === 1 ? "y" : "ies"}, ` +
      `created ${opportunitiesCreated} new and ${fundersCreated} new funder(s).` +
      (truncated ? " Run bounds reached; remaining candidates were not processed." : "");

    return {
      data: { opportunitiesFound, opportunitiesCreated, fundersCreated },
      outputSummary: summary,
      itemsFound: opportunitiesFound,
      itemsProcessed: opportunitiesCreated,
      tokensUsed,
    };
  }

  // --- profile selection -----------------------------------------------------

  /**
   * The profiles this run will process. Two modes:
   *   - Caller-supplied ids (a single "Run Now"): honor the explicit choice -
   *     any active profile, even one not tagged foundation. Missing or paused
   *     profiles are silently skipped.
   *   - No ids ("Run all"): every active profile carrying a foundation category,
   *     so an automated sweep only touches foundation-relevant profiles.
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
    // has foundation research disabled is skipped on an automated sweep.
    return active.filter(
      (p) => isFoundationProfile(p) && profileAgentEnabled(p, this.agentType),
    );
  }

  // --- candidate gathering ----------------------------------------------------

  /** Run the profile's queries and collect new candidate URLs, run-deduped + capped. */
  private async gatherCandidates(
    queries: string[],
    seenUrls: Set<string>,
  ): Promise<string[]> {
    const candidates: string[] = [];
    const sources = this.focus?.sources ?? FOUNDATION_SOURCES;
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
   * Resolve the funder for an opportunity: find an existing one by name
   * (org-scoped), or create it with the extracted/derived category (task spec
   * step 5). Returns a null funder id when the page named no funder.
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
      console.error("[foundation-grants] funder lookup failed:", err);
    }

    const { data: created, error } = await this.client
      .from("funders")
      .insert({
        organization_id: this.organizationId,
        name,
        category,
        website: originOf(sourceUrl),
        notes: "Discovered by the Foundation Grant Research agent.",
      } satisfies TablesInsert<"funders">)
      .select("id")
      .single();

    if (error || !created?.id) {
      console.error("[foundation-grants] funder insert failed:", error);
      return { funderId: null, created: false };
    }
    return { funderId: created.id as string, created: true };
  }

  /** Create opportunity_keywords from the profile's keywords (task spec step 5). */
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
      console.error("[foundation-grants] keyword insert failed:", error);
    }
  }
}

// --- helpers -----------------------------------------------------------------

/** True if the profile targets at least one (non-excluded) foundation category. */
function isFoundationProfile(profile: ResearchSearchProfile): boolean {
  return effectiveCategories(profile).some((c) => FOUNDATION_CATEGORIES.includes(c));
}

/** The profile's first foundation category, used as the opportunity-category fallback. */
function firstFoundationCategory(
  profile: ResearchSearchProfile,
): FunderCategory | null {
  return (
    effectiveCategories(profile).find((c) => FOUNDATION_CATEGORIES.includes(c)) ??
    null
  );
}

/**
 * Expand a profile's keywords into foundation search queries using the task's
 * templates, appending geographic scope when set. De-duplicated and capped to
 * keep a run's web traffic bounded.
 */
export function buildFoundationQueries(profile: ResearchSearchProfile): string[] {
  const geo = profile.geographicScope?.trim() ?? "";
  const queries: string[] = [];

  // Keywords plus the profile's weighted focus areas / population tags.
  for (const rawKeyword of profileQueryTerms(profile)) {
    const keyword = rawKeyword.trim();
    if (keyword === "") continue;
    for (const template of QUERY_TEMPLATES) {
      queries.push([template(keyword), geo].filter(Boolean).join(" "));
    }
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

/**
 * Append foundation-specific gates (LOI requirement, named application cycle) to
 * the extracted eligibility text - but ONLY when the page actually states them
 * (Contracts §9: never fabricate). Returns the original text unchanged when the
 * page mentions neither, so nothing is invented.
 */
export function withFoundationNotes(
  eligibility: string | null,
  pageText: string,
): string | null {
  const lower = pageText.toLowerCase();
  const notes: string[] = [];

  if (/\bletter of inquiry\b|\bletter of intent\b|\bLOI\b/.test(pageText)) {
    notes.push("Letter of Inquiry (LOI) required before a full application.");
  }
  if (/\brolling (basis|deadline)\b|\baccepted year-round\b/.test(lower)) {
    notes.push("Applications accepted on a rolling basis.");
  } else if (/\bannual (grant )?cycle\b|\bonce (a|per) year\b/.test(lower)) {
    notes.push("Annual application cycle.");
  }

  if (notes.length === 0) return eligibility;

  const base = (eligibility ?? "").trim();
  const note = notes.join(" ");
  // Avoid duplicating a note the extracted text already conveys.
  if (base.toLowerCase().includes("letter of inquiry") && notes.length === 1) {
    return eligibility;
  }
  return base === "" ? note : `${base}\n\n${note}`;
}

/** The scheme+host of a URL (used as a discovered funder's website), or null. */
function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}
