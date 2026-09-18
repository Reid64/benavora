// Local Business Sponsorship Research Agent - AGENTS.md Agent 15.
//
// Finds local businesses likely to sponsor community initiatives and turns them
// into funder records - plus sponsorship opportunities when a page advertises a
// program, and outreach_contacts when a business has no giving page to apply
// through. It drives off the organization's active local-flavored
// search_profiles and runs the shared research pipeline for each:
//
//   active local profiles → build local-sponsorship queries from keywords +
//   geography → search the web (search-engine) → fetch candidate pages
//   (web-fetcher) → extract a structured opportunity (result-parser, via Claude)
//   → de-duplicate (deduplicator) → create the funder (with a has_giving_page
//   assessment) + the opportunity when present (status open, source = profile
//   name) + opportunity_keywords → score eligibility (Agent 02). For funders with
//   no giving page, the Cold Outreach Agent (Agent 11) extracts contacts and
//   scores giving_likelihood into outreach_contacts.
//
// Contracts honored: every query is organization_id-scoped (§2); discovered
// opportunities default to status 'open' and source = profile name, and
// eligibility scoring runs on each new one (§17); de-duplication runs before any
// insert (§17); outreach_contacts stay separate from CRM contacts (§13); the run
// logs to agent_runs with token usage via BaseAgent (§15). Work is bounded so the
// run stays within the 60s agent ceiling - any truncation is recorded in the run
// summary so a cap is never silent.

import { DEFAULT_MAX_TOKENS, DEFAULT_MODEL } from "@/lib/ai/claude";
import {
  BaseAgent,
  type AgentExecution,
  type BaseAgentOptions,
  AGENT_TIMEOUT_MULTI_STEP_MS,
} from "@/lib/agents/base-agent";
import { ColdOutreachAgent } from "@/lib/agents/cold-outreach";
import { EligibilityScorer } from "@/lib/agents/eligibility-scorer";
import { checkDuplicate } from "@/lib/agents/research/deduplicator";
import {
  parseOpportunity,
  type ParsedOpportunity,
} from "@/lib/agents/research/result-parser";
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
 * at least one of these to be in scope for local-sponsorship research.
 */
export const LOCAL_CATEGORIES: readonly FunderCategory[] = [
  "local_community_grant",
  "corporate_sponsorship",
];

/** Sources local-sponsorship research draws from (open web only). */
const LOCAL_SOURCES: SearchSource[] = ["google"];

export interface LocalSponsorshipInput {
  /**
   * Restrict the run to specific search profiles (e.g. a single "Run Now").
   * When omitted, every active profile carrying a local category runs.
   */
  profileIds?: string[] | null;
}

export interface LocalSponsorshipResult {
  /** Opportunities successfully extracted from candidate pages (pre-dedup). */
  opportunitiesFound: number;
  /** New opportunity rows actually created this run. */
  opportunitiesCreated: number;
  /** New funder rows created this run. */
  fundersCreated: number;
  /** outreach_contacts rows created for businesses without a giving page. */
  outreachContactsCreated: number;
}

export interface LocalSponsorshipOptions extends BaseAgentOptions {
  /** Model override (resolved from platform_config `ai.model` by the caller). */
  model?: string;
  /** Max output tokens (platform_config `ai.max_tokens`). */
  maxTokens?: number;
}

// Run bounds - keep the synchronous pipeline within the 60s agent ceiling
// (AGENTS.md §15). Outreach extraction adds extra Claude calls, so the page cap
// is a touch lower than the other research agents.
const MAX_QUERIES_PER_PROFILE = 4;
const MAX_HITS_PER_QUERY = 5;
const MAX_PAGES_PER_RUN = 5;
const MAX_NEW_OPPS_PER_RUN = 4;
/** Cap on cold-outreach extractions per run (each is its own Claude call). */
const MAX_OUTREACH_COMPANIES = 3;
/** Drop low-quality extractions rather than persist junk (mirrors the route). */
const MIN_CONFIDENCE = 40;

/** A business without a giving page, queued for cold-outreach extraction. */
interface OutreachTarget {
  companyName: string;
  websiteUrl: string;
  funderId: string | null;
}

export class LocalSponsorshipResearchAgent extends BaseAgent<
  LocalSponsorshipInput,
  LocalSponsorshipResult
> {
  readonly agentType: AgentType = "local_sponsorship";

  private readonly model: string;
  private readonly maxTokens: number;

  constructor(options: LocalSponsorshipOptions) {
    super({ ...options, timeoutMs: options.timeoutMs ?? AGENT_TIMEOUT_MULTI_STEP_MS });
    this.model = options.model ?? DEFAULT_MODEL;
    this.maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  }

  protected async execute(
    input: LocalSponsorshipInput,
  ): Promise<AgentExecution<LocalSponsorshipResult>> {
    this.setPhase("resolving search profiles");
    const profiles = await this.resolveProfiles(input.profileIds ?? null);

    if (profiles.length === 0) {
      return {
        data: {
          opportunitiesFound: 0,
          opportunitiesCreated: 0,
          fundersCreated: 0,
          outreachContactsCreated: 0,
        },
        outputSummary:
          "No active search profiles target local sponsorships; nothing to research.",
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
    // Companies without a giving page, deduped by name, for post-loop outreach.
    const outreachTargets = new Map<string, OutreachTarget>();
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

      const queries = buildLocalQueries(profile);
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

        const opp =
          parsed.opportunity && parsed.confidence >= MIN_CONFIDENCE
            ? parsed.opportunity
            : null;

        // A page is worth tracking as a sponsor only if it yielded an
        // opportunity OR shows a clear sponsorship/community signal. Otherwise
        // it is likely a directory or unrelated page - skip it.
        const signal = hasSponsorshipSignal(page.text);
        if (!opp && !signal) continue;

        const companyName = pickCompanyName(opp, url);
        if (!companyName) continue;

        // Negative filter (Configuration page "excluded funders"): skip a
        // business the profile has explicitly excluded.
        if (profileExcludesFunder(profile, companyName)) continue;

        // Assess whether the business has a giving page to apply through
        // (task spec step 5). False → cold-outreach target (step 6).
        const givingPage = assessGivingPage(page.text);

        const category =
          opp?.category ?? firstLocalCategory(profile) ?? profile.categories[0] ?? "corporate_sponsorship";

        const { funderId, created: funderCreated } = await this.resolveFunder(
          companyName,
          category,
          url,
          givingPage,
        );
        if (funderCreated) fundersCreated++;

        if (opp) {
          // Final fuzzy de-dup on the extracted name + funder (Contracts §17).
          const nameDup = await checkDuplicate({
            client: this.client,
            organizationId: this.organizationId,
            url,
            name: opp.name,
            funderName: opp.funder_name ?? companyName,
          });
          if (!nameDup.isDuplicate) {
            opportunitiesFound++;
            profileFound++;
            const opportunityId = await this.createOpportunity(
              opp,
              category,
              funderId,
              profile,
            );
            if (opportunityId) {
              opportunitiesCreated++;
              newOpportunityIds.push(opportunityId);
            }
          }
        }

        // Queue businesses without a giving page for contact extraction,
        // deduped by company name and capped for the run.
        if (!givingPage && outreachTargets.size < MAX_OUTREACH_COMPANIES) {
          const key = companyName.toLowerCase();
          if (!outreachTargets.has(key)) {
            outreachTargets.set(key, {
              companyName,
              websiteUrl: originOf(url) ?? url,
              funderId,
            });
          }
        }
      }

      // Stamp last_run_at and accumulate the profile's lifetime results.
      await markProfileRun(ctx, profile, profileFound);
    }

    // Cold-outreach extraction for businesses without a giving page (task spec
    // step 6). The Cold Outreach Agent (Agent 11) fetches the site, extracts
    // contacts, and scores giving_likelihood - reused so that scoring lives in
    // one place (task spec step 7). Each run logs its own agent_runs row.
    let outreachContactsCreated = 0;
    for (const target of outreachTargets.values()) {
      try {
        const outreach = new ColdOutreachAgent({
          client: this.client,
          organizationId: this.organizationId,
          triggeredBy: this.triggeredBy,
          model: this.model,
          maxTokens: this.maxTokens,
        });
        const outcome = await outreach.run({
          companyName: target.companyName,
          websiteUrl: target.websiteUrl,
          funderId: target.funderId,
        });
        outreachContactsCreated += outcome.data.contactsCreated;
      } catch (err) {
        console.error(
          `[local-sponsorship] outreach extraction failed for ${target.companyName}:`,
          err,
        );
      }
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
          `[local-sponsorship] eligibility scoring failed for ${opportunityId}:`,
          err,
        );
      }
    }

    const truncated =
      pagesProcessed >= MAX_PAGES_PER_RUN ||
      opportunitiesCreated >= MAX_NEW_OPPS_PER_RUN;
    const summary =
      `Local sponsorship research across ${profilesRun.length} profile(s) ` +
      `(${profilesRun.join(", ")}): fetched ${pagesProcessed} page(s), created ` +
      `${fundersCreated} funder(s), ${opportunitiesCreated} opportunit${
        opportunitiesCreated === 1 ? "y" : "ies"
      }, and ${outreachContactsCreated} outreach contact(s).` +
      (truncated ? " Run bounds reached; remaining candidates were not processed." : "");

    return {
      data: {
        opportunitiesFound,
        opportunitiesCreated,
        fundersCreated,
        outreachContactsCreated,
      },
      outputSummary: summary,
      itemsFound: opportunitiesFound,
      itemsProcessed: opportunitiesCreated + outreachContactsCreated,
      tokensUsed,
    };
  }

  // --- profile selection -----------------------------------------------------

  /**
   * The profiles this run will process. Two modes:
   *   - Caller-supplied ids (a single "Run Now"): honor the explicit choice -
   *     any active profile, even one not tagged local. Missing or paused
   *     profiles are silently skipped.
   *   - No ids ("Run all"): every active profile carrying a local category, so
   *     an automated sweep only touches local-relevant profiles.
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
    // has local-sponsorship research disabled is skipped on an automated sweep.
    return active.filter(
      (p) => isLocalProfile(p) && profileAgentEnabled(p, this.agentType),
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
        sources: LOCAL_SOURCES,
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
   * Resolve the funder for a business: find an existing one by name (org-scoped),
   * or create it with the derived category and a has_giving_page assessment
   * (task spec step 5). A discovered business always has a name here, so a funder
   * is always returned unless the insert fails.
   */
  private async resolveFunder(
    companyName: string,
    category: FunderCategory,
    sourceUrl: string,
    hasGivingPage: boolean,
  ): Promise<{ funderId: string | null; created: boolean }> {
    const name = companyName.trim();
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
      console.error("[local-sponsorship] funder lookup failed:", err);
    }

    const { data: created, error } = await this.client
      .from("funders")
      .insert({
        organization_id: this.organizationId,
        name,
        category,
        website: originOf(sourceUrl),
        has_giving_page: hasGivingPage,
        notes: "Discovered by the Local Business Sponsorship Research agent.",
      } satisfies TablesInsert<"funders">)
      .select("id")
      .single();

    if (error || !created?.id) {
      console.error("[local-sponsorship] funder insert failed:", error);
      return { funderId: null, created: false };
    }
    return { funderId: created.id as string, created: true };
  }

  /** Insert one opportunity row and its keywords; returns the new id or null. */
  private async createOpportunity(
    opp: ParsedOpportunity,
    category: FunderCategory,
    funderId: string | null,
    profile: ResearchSearchProfile,
  ): Promise<string | null> {
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
        // Local sponsorships are corporate giving by default; a community
        // foundation or local-government page is reclassified from the text.
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
      console.error("[local-sponsorship] opportunity insert failed:", insertError);
      return null;
    }

    const opportunityId = inserted.id as string;
    await this.createKeywords(opportunityId, profile.keywords);
    return opportunityId;
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
      console.error("[local-sponsorship] keyword insert failed:", error);
    }
  }
}

// --- helpers -----------------------------------------------------------------

/** True if the profile targets at least one (non-excluded) local category. */
function isLocalProfile(profile: ResearchSearchProfile): boolean {
  return effectiveCategories(profile).some((c) => LOCAL_CATEGORIES.includes(c));
}

/** The profile's first local category, used as the opportunity-category fallback. */
function firstLocalCategory(
  profile: ResearchSearchProfile,
): FunderCategory | null {
  return effectiveCategories(profile).find((c) => LOCAL_CATEGORIES.includes(c)) ?? null;
}

/**
 * Expand a profile into local-sponsorship search queries using the task's
 * templates. The first template is per-keyword; the community-sponsor and
 * chamber-of-commerce templates are geography-anchored and added once.
 * De-duplicated and capped to bound a run's web traffic.
 */
export function buildLocalQueries(profile: ResearchSearchProfile): string[] {
  const geo = profile.geographicScope?.trim() ?? "";
  const queries: string[] = [];

  // Keywords plus the profile's weighted focus areas / population tags.
  for (const rawKeyword of profileQueryTerms(profile)) {
    const keyword = rawKeyword.trim();
    if (keyword === "") continue;
    queries.push([`${keyword} local business sponsorship`, geo].filter(Boolean).join(" "));
  }
  queries.push(["community sponsor", geo].filter(Boolean).join(" "));
  queries.push(["chamber of commerce", geo, "business directory"].filter(Boolean).join(" "));

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
 * True when the page shows a sponsorship / community-giving signal, used to keep
 * a business worth tracking even when no structured opportunity was extracted.
 */
export function hasSponsorshipSignal(pageText: string): boolean {
  return /\bsponsor(ship)?s?\b|\bcommunity (giving|involvement|investment|support)\b|\bdonation(s)?\b|\bcharitable\b|\bgiving back\b|\bfoundation\b/i.test(
    pageText,
  );
}

/**
 * Assess whether a business has a giving page to apply through (task spec step
 * 5). True when the page exposes an application/request path; false otherwise,
 * which routes the business to cold outreach (step 6).
 */
export function assessGivingPage(pageText: string): boolean {
  return /\b(grant|sponsorship|donation|funding)\s+(application|request)\b|\bapply for (a |an )?(grant|sponsorship|donation|funding)\b|\bgiving (guidelines|program)\b|\b(donation|sponsorship) request form\b|\bonline application\b/i.test(
    pageText,
  );
}

/**
 * Choose a company name for a discovered business: the parsed funder name, then
 * the parsed opportunity name, then a label derived from the host. Returns null
 * when none of these yields anything usable.
 */
export function pickCompanyName(
  opp: ParsedOpportunity | null,
  url: string,
): string | null {
  const fromOpp = opp?.funder_name?.trim() || opp?.name?.trim() || "";
  if (fromOpp !== "") return fromOpp;
  return hostLabel(url);
}

/** Derive a readable company label from a URL's host (e.g. "Acme Builders"). */
export function hostLabel(url: string): string | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  const main = host
    .replace(/^www\./, "")
    .split(".")
    .slice(0, -1) // drop the TLD
    .join(" ")
    .replace(/[-_]+/g, " ")
    .trim();
  if (main === "") return null;
  return main
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/** The scheme+host of a URL (used as a discovered funder's website), or null. */
function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}
