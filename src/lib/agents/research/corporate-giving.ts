// Corporate Giving Research Agent - AGENTS.md Agent 12.
//
// Discovers companies with active donation / community-giving programs and turns
// them into opportunity (and funder) records the rest of Benavora can work. It
// drives off the organization's active corporate-flavored search_profiles and
// runs the shared research pipeline for each:
//
//   active corporate profiles → build corporate-giving queries from keywords →
//   search the web (search-engine) → fetch candidate pages (web-fetcher) →
//   extract a structured opportunity (result-parser, via Claude) → de-duplicate
//   (deduplicator) → create the funder if new + the opportunity (status open,
//   source = profile name) + opportunity_keywords → score eligibility (Agent 02).
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
} from "@/lib/agents/base-agent";
import { EligibilityScorer } from "@/lib/agents/eligibility-scorer";
import { checkDuplicate } from "@/lib/agents/research/deduplicator";
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
import { search } from "@/lib/agents/research/search-engine";
import { fetchPage, type ResearchContext } from "@/lib/agents/research/web-fetcher";
import { inferSourceType } from "@/lib/opportunities/source-type";
import type { AgentType } from "@/types/agents";
import type { Enums, TablesInsert } from "@/types/database";

type FunderCategory = Enums<"funder_category">;

/**
 * Funder categories this agent targets (task spec). A search profile must carry
 * at least one of these to be in scope for corporate-giving research.
 */
export const CORPORATE_CATEGORIES: readonly FunderCategory[] = [
  "corporate_donation",
  "corporate_sponsorship",
  "corporate_foundation",
  "in_kind_donation",
  "materials_donation",
];

export interface CorporateGivingInput {
  /**
   * Restrict the run to specific search profiles (e.g. a single "Run Now").
   * When omitted, every active profile carrying a corporate category runs.
   */
  profileIds?: string[] | null;
}

export interface CorporateGivingResult {
  /** Opportunities successfully extracted from candidate pages (pre-dedup). */
  opportunitiesFound: number;
  /** New opportunity rows actually created this run. */
  opportunitiesCreated: number;
  /** New funder rows created to back those opportunities. */
  fundersCreated: number;
}

export interface CorporateGivingOptions extends BaseAgentOptions {
  /** Model override (resolved from platform_config `ai.model` by the caller). */
  model?: string;
  /** Max output tokens (platform_config `ai.max_tokens`). */
  maxTokens?: number;
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
 * Query templates the corporate-giving agent expands each profile keyword into
 * (task spec). Geographic scope, when set, is appended to narrow results.
 */
const QUERY_TEMPLATES = [
  (kw: string) => `${kw} corporate giving program`,
  (kw: string) => `${kw} community investment donations`,
  (kw: string) => `${kw} corporate foundation grants`,
  (kw: string) => `${kw} sponsorship application`,
];

export class CorporateGivingResearchAgent extends BaseAgent<
  CorporateGivingInput,
  CorporateGivingResult
> {
  readonly agentType: AgentType = "corporate_research";

  private readonly model: string;
  private readonly maxTokens: number;

  constructor(options: CorporateGivingOptions) {
    super({ ...options, timeoutMs: options.timeoutMs ?? 300_000 });
    this.model = options.model ?? DEFAULT_MODEL;
    this.maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  }

  protected async execute(
    input: CorporateGivingInput,
  ): Promise<AgentExecution<CorporateGivingResult>> {
    const profiles = await this.resolveProfiles(input.profileIds ?? null);

    if (profiles.length === 0) {
      return {
        data: { opportunitiesFound: 0, opportunitiesCreated: 0, fundersCreated: 0 },
        outputSummary:
          "No active search profiles target corporate giving; nothing to research.",
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

      const queries = buildCorporateQueries(profile);
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
        // an opportunity from a funder the profile has explicitly excluded.
        if (profileExcludesFunder(profile, opp.funder_name)) continue;

        // Category is required on opportunities; fall back to the profile's first
        // corporate category when the page did not state one.
        const category =
          opp.category ?? firstCorporateCategory(profile) ?? profile.categories[0] ?? null;
        if (!category) continue;

        // Create the funder if it does not already exist (task spec step g).
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
            eligibility_requirements: opp.eligibility_requirements,
            required_documents: opp.required_documents,
            application_method: opp.application_method,
            recurrence: opp.recurrence,
            geographic_restrictions: opp.geographic_restrictions,
            status: "open",
            source: profile.name,
            // Corporate-giving discoveries classify as corporate giving unless
            // the page reads as a community foundation / faith-based source.
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
          console.error("[corporate-giving] opportunity insert failed:", insertError);
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
          `[corporate-giving] eligibility scoring failed for ${opportunityId}:`,
          err,
        );
      }
    }

    const truncated =
      pagesProcessed >= MAX_PAGES_PER_RUN ||
      opportunitiesCreated >= MAX_NEW_OPPS_PER_RUN;
    const summary =
      `Corporate giving research across ${profilesRun.length} profile(s) ` +
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
   *     any active profile, even one not tagged corporate. Missing or paused
   *     profiles are silently skipped.
   *   - No ids ("Run all"): every active profile carrying a corporate category,
   *     so an automated sweep only touches corporate-relevant profiles.
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
    // has corporate research disabled is skipped on an automated sweep.
    return active.filter(
      (p) => isCorporateProfile(p) && profileAgentEnabled(p, this.agentType),
    );
  }

  // --- candidate gathering ----------------------------------------------------

  /** Run the profile's queries and collect new candidate URLs, run-deduped + capped. */
  private async gatherCandidates(
    queries: string[],
    seenUrls: Set<string>,
  ): Promise<string[]> {
    const candidates: string[] = [];
    for (const query of queries) {
      const hits = await search({
        query,
        sources: ["google"],
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
   * step g). Returns a null funder id when the page named no funder.
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
      console.error("[corporate-giving] funder lookup failed:", err);
    }

    const { data: created, error } = await this.client
      .from("funders")
      .insert({
        organization_id: this.organizationId,
        name,
        category,
        website: originOf(sourceUrl),
        notes: "Discovered by the Corporate Giving Research agent.",
      } satisfies TablesInsert<"funders">)
      .select("id")
      .single();

    if (error || !created?.id) {
      console.error("[corporate-giving] funder insert failed:", error);
      return { funderId: null, created: false };
    }
    return { funderId: created.id as string, created: true };
  }

  /** Create opportunity_keywords from the profile's keywords (task spec step g). */
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
      console.error("[corporate-giving] keyword insert failed:", error);
    }
  }
}

// --- helpers -----------------------------------------------------------------

/** True if the profile targets at least one (non-excluded) corporate category. */
function isCorporateProfile(profile: ResearchSearchProfile): boolean {
  return effectiveCategories(profile).some((c) => CORPORATE_CATEGORIES.includes(c));
}

/** The profile's first corporate category, used as the opportunity-category fallback. */
function firstCorporateCategory(
  profile: ResearchSearchProfile,
): FunderCategory | null {
  return (
    effectiveCategories(profile).find((c) => CORPORATE_CATEGORIES.includes(c)) ??
    null
  );
}

/**
 * Expand a profile's keywords into corporate-giving search queries using the
 * task's templates, appending geographic scope when set. De-duplicated and
 * capped to keep a run's web traffic bounded.
 */
export function buildCorporateQueries(profile: ResearchSearchProfile): string[] {
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

/** The scheme+host of a URL (used as a discovered funder's website), or null. */
function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}
