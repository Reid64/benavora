// Government Grant Research Agent — AGENTS.md Agent 14.
//
// Discovers federal, state, county, and city grant opportunities and turns them
// into opportunity (and funder) records. It drives off the organization's active
// government-flavored search_profiles and runs the shared research pipeline for
// each:
//
//   active government profiles → build government queries from keywords →
//   search Grants.gov (REST API) + the web for state/county/HUD sources
//   (search-engine) → fetch candidate pages (web-fetcher) → extract a structured
//   opportunity (result-parser, via Claude) → de-duplicate (deduplicator) →
//   create the funder/agency if new + the opportunity (status open, source =
//   profile name) + opportunity_keywords → score eligibility (Agent 02).
//
// Government-specific handling: CFDA (Assistance Listing) and NOFO / funding
// opportunity numbers are extracted from the page when present and stored as
// searchable keywords plus a description prefix; a stated SAM.gov registration
// requirement is folded into the eligibility text. All of this is added ONLY
// when the page actually states it (BEHAVIORAL_CONTRACTS §9/§17: never
// fabricate).
//
// Contracts honored: every query is organization_id-scoped (§2); discovered
// opportunities default to status 'open' and source = profile name, and
// eligibility scoring runs on each new one (§17); de-duplication (URL, then
// fuzzy name+funder) runs before any insert (§17); the run logs to agent_runs
// with token usage via BaseAgent (§15). Work is bounded so the run stays within
// the 60s agent ceiling — any truncation is recorded in the run summary so a cap
// is never silent.

import { DEFAULT_MAX_TOKENS, DEFAULT_MODEL } from "@/lib/ai/claude";
import {
  BaseAgent,
  type AgentExecution,
  type BaseAgentOptions,
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

export interface GovernmentGrantsResult {
  /** Opportunities successfully extracted from candidate pages (pre-dedup). */
  opportunitiesFound: number;
  /** New opportunity rows actually created this run. */
  opportunitiesCreated: number;
  /** New funder rows created to back those opportunities. */
  fundersCreated: number;
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

// Run bounds — keep the synchronous pipeline within the 60s agent ceiling
// (AGENTS.md §15). These are whole-run caps, applied across every profile.
const MAX_QUERIES_PER_PROFILE = 4;
const MAX_HITS_PER_QUERY = 5;
const MAX_PAGES_PER_RUN = 6;
const MAX_NEW_OPPS_PER_RUN = 5;
/** Drop low-quality extractions rather than persist junk (mirrors the route). */
const MIN_CONFIDENCE = 40;

export class GovernmentGrantsResearchAgent extends BaseAgent<
  GovernmentGrantsInput,
  GovernmentGrantsResult
> {
  readonly agentType: AgentType = "government_research";

  private readonly model: string;
  private readonly maxTokens: number;
  private readonly focus?: ResearchFocus;

  constructor(options: GovernmentGrantsOptions) {
    super(options);
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
        data: { opportunitiesFound: 0, opportunitiesCreated: 0, fundersCreated: 0 },
        outputSummary:
          "No active search profiles target government grants; nothing to research.",
        itemsFound: 0,
        itemsProcessed: 0,
        tokensUsed: 0,
      };
    }

    const ctx: ResearchContext = {
      client: this.client,
      organizationId: this.organizationId,
    };

    // URLs seen anywhere in this run (across profiles) — never fetch twice.
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
          `[government-grants] eligibility scoring failed for ${opportunityId}:`,
          err,
        );
      }
    }

    const truncated =
      pagesProcessed >= MAX_PAGES_PER_RUN ||
      opportunitiesCreated >= MAX_NEW_OPPS_PER_RUN;
    const focusPrefix = this.focus?.label ? `[${this.focus.label}] ` : "";
    const summary =
      `${focusPrefix}Government grant research across ${profilesRun.length} profile(s) ` +
      `(${profilesRun.join(", ")}): fetched ${pagesProcessed} page(s), found ` +
      `${opportunitiesFound} opportunit${opportunitiesFound === 1 ? "y" : "ies"}, ` +
      `created ${opportunitiesCreated} new and ${fundersCreated} new agency/funder(s).` +
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
   *   - Caller-supplied ids (a single "Run Now"): honor the explicit choice —
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
 * mistaken for identifiers. Returns empty results when the page states none —
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
