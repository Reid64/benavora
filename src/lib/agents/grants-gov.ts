// Grants.gov Research Agent — AGENTS.md Agent 15.
//
// Polls the public Grants.gov API (no auth required) for federal grant
// opportunities matching search profile keywords (BEHAVIORAL_CONTRACTS §17).
//
// Per-run behaviour:
//   1. Runs multiple keyword searches (housing-focused phrases + any caller-
//      supplied keywords) to maximise coverage.
//   2. Deduplicates by externalId in memory across all searches before
//      touching the database.
//   3. Deduplicates against existing opportunities by name OR url before
//      inserting new records into the opportunities table.
//   4. Returns the full list of discovered opportunities and a count of newly
//      created rows so callers can poll without fetching the whole table.
//
// Error handling: per-query HTTP failures are skipped (non-fatal, handled
// inside searchGrantsGovOpportunities). A total fetch failure wraps in
// AgentError so BaseAgent can log status="failed".
//
// WIRING NOTE (Phase 5.4, 2026-09-15 — supersedes the 2026-08-04 "hangs
// indefinitely" finding): root-caused. The prior implementation posted every
// query against `https://apply07.grants.gov/grantsws/rest/...` — the
// decommissioned legacy REST host. Each of the ~13 housing keyword queries
// plus up to 50 detail fetches plus a 50-row backfill pass all silently
// failed/timed-out against that dead host one at a time, stacking into a
// multi-minute hang well past what looked like "not responding" in a short
// manual test, even though every individual fetch did carry its own
// AbortSignal.timeout.
//
// Fix: this class now calls src/lib/sources/grantsgov-client.ts's
// searchGrantsGovOpportunities(), the same live-verified v1
// (api.grants.gov/v1/api/search2) client the daily cron
// (grantsgov-sync.ts/syncGrantsGovForOrg) already uses successfully, wrapped
// in fetchWithRetry with a 30s per-request timeout. The v1 search2 endpoint
// does not expose a verified per-opportunity detail call in this codebase
// (see grantsgov-client.ts's own header: only `search2` is implemented;
// `fetchOpportunity` is documented by Grants.gov but not yet built here), so
// the two-pass detail-enrichment and sparse-row backfill this class used to
// do against the dead detail endpoint have been removed rather than pointed
// at a fabricated replacement — opportunities are now created from listing
// data only (title, external id, close date; no description/eligibility/
// award-ceiling/documents from this class). This class remains reachable
// only via the manual `/api/agents/grants-gov` route and the
// `/api/agents/research` multi-source flow, same as before.

import {
  AgentError,
  BaseAgent,
  type AgentExecution,
  type BaseAgentOptions,
} from "@/lib/agents/base-agent";
import type { AgentType } from "@/types/agents";
import { searchGrantsGovOpportunities } from "@/lib/sources/grantsgov-client";

// Focused keyword phrases for Faith Foundation: emergency/transitional housing
// in rural Texas, reentry, addiction recovery, and federal housing programs.
const HOUSING_KEYWORD_QUERIES = [
  "homeless housing",
  "transitional housing",
  "emergency shelter",
  "reentry housing",
  "recovery housing",
  "rural housing",
  "community development block grant",
  "HOME Investment Partnership",
  "Emergency Solutions Grant",
  "Continuum of Care",
  "faith-based community",
  "substance abuse recovery housing",
];

export interface GrantsGovInput {
  keywords: string[];
  categories?: string[];
  dateRange?: { from?: string; to?: string };
}

export interface OpportunityDocument {
  title: string;
  url: string;
}

export interface GrantsGovOpportunity {
  title: string;
  agency: string;
  opportunity_number: string;
  close_date: string | null;
  award_ceiling: number | null;
  award_floor: number | null;
  description: string | null;
  eligibility_requirements: string | null;
  geographic_restrictions: string | null;
  opportunity_documents: OpportunityDocument[];
  url: string | null;
  source: "grants.gov";
}

export interface GrantsGovResult {
  opportunities: GrantsGovOpportunity[];
  count: number;
  opportunitiesCreated: number;
  /** Always 0 now — the detail/backfill passes that used to populate this
   * depended on the dead apply07 detail endpoint and were removed. Kept on
   * the interface so existing callers destructuring this field don't break. */
  backfilledRows: number;
}

// Keywords that increase relevance score for Faith Foundation's mission.
const RELEVANCE_KEYWORDS = [
  "housing",
  "homeless",
  "shelter",
  "reentry",
  "recovery",
  "rural",
  "community development",
  "faith",
  "texas",
  "nonprofit",
];

// Titles/descriptions matching any of these terms are immediately rejected.
const REJECT_LIST = [
  "disability",
  "veteran education",
  "criminal alien",
  "stem",
  "defense",
  "agriculture",
  "farmers",
  "fisheries",
  "nih",
  "cdc",
  "nasa",
  "dod research",
  "clinical trial",
];

/**
 * Score an opportunity 0–100 based on keyword overlap with Faith Foundation's
 * mission. Returns { score, rejected } — rejected is the first REJECT_LIST term
 * found in the text (non-null means the opportunity must be discarded).
 */
function scoreRelevance(
  title: string,
  description: string | null,
): { score: number; rejected: string | null } {
  const text = `${title} ${description ?? ""}`.toLowerCase();

  for (const term of REJECT_LIST) {
    if (text.includes(term)) {
      return { score: 0, rejected: term };
    }
  }

  let score = 0;
  for (const kw of RELEVANCE_KEYWORDS) {
    if (text.includes(kw)) score += 10;
  }
  return { score: Math.min(score, 100), rejected: null };
}

export class GrantsGovResearchAgent extends BaseAgent<
  GrantsGovInput,
  GrantsGovResult
> {
  readonly agentType: AgentType = "grants_gov_research";

  constructor(options: BaseAgentOptions) {
    super({ ...options, timeoutMs: options.timeoutMs ?? 60_000 });
  }

  protected async execute(
    input: GrantsGovInput,
  ): Promise<AgentExecution<GrantsGovResult>> {
    // Build query list: always run all housing-focused phrases; append the
    // caller's keywords as one extra search if they differ from the defaults.
    const userQuery = input.keywords.filter(Boolean).join(" ").trim();
    const queries: string[] = [...HOUSING_KEYWORD_QUERIES];
    if (
      userQuery &&
      !HOUSING_KEYWORD_QUERIES.some((q) =>
        q.toLowerCase().includes(userQuery.toLowerCase()),
      )
    ) {
      queries.push(userQuery);
    }

    // Require at least one query.
    const effectiveQueries = queries.filter(Boolean);
    if (effectiveQueries.length === 0) {
      throw new AgentError(
        "At least one keyword is required.",
        "no_keywords",
        400,
      );
    }

    // Run each query against the live v1 search2 API and collect hits,
    // deduplicating by externalId in memory.
    const allHitsMap = new Map<string, GrantsGovOpportunity>();

    for (const keyword of effectiveQueries) {
      const hits = await searchGrantsGovOpportunities(keyword, {
        fundingCategories: input.categories,
      });

      for (const hit of hits) {
        if (allHitsMap.has(hit.externalId)) continue;
        allHitsMap.set(hit.externalId, {
          title: hit.name,
          // search2 hits carry no agency field — categorization below falls
          // back to "government_grant" for every row from this class.
          agency: "",
          opportunity_number: hit.externalId,
          close_date: hit.deadline,
          award_ceiling: hit.amount,
          award_floor: null,
          description: hit.description,
          eligibility_requirements: null,
          geographic_restrictions: null,
          opportunity_documents: [],
          url: `https://www.grants.gov/search-results-detail/${hit.externalId}`,
          source: "grants.gov" as const,
        });
      }
    }

    const opportunities = Array.from(allHitsMap.values());
    let opportunitiesCreated = 0;

    for (const opp of opportunities) {
      if (!opp.title) continue;

      // Relevance filter: skip irrelevant grants before any DB queries.
      const { score, rejected } = scoreRelevance(opp.title, opp.description);
      if (rejected !== null) {
        continue;
      }
      if (score < 40) {
        continue;
      }

      // Dedup by name
      const { data: byName } = await this.client
        .from("opportunities")
        .select("id")
        .eq("organization_id", this.organizationId)
        .eq("name", opp.title)
        .maybeSingle();
      if (byName) continue;

      // Dedup by url
      if (opp.url) {
        const { data: byUrl } = await this.client
          .from("opportunities")
          .select("id")
          .eq("organization_id", this.organizationId)
          .eq("url", opp.url)
          .maybeSingle();
        if (byUrl) continue;
      }

      // Provenance requirement (AR-17.6): url is the only stored source this
      // agent has for any enriched field below. Without it, description/
      // deadline/amount would be unverifiable after the fact.
      if (!opp.url) continue;

      const row: Record<string, unknown> = {
        organization_id: this.organizationId,
        name: opp.title,
        category: "government_grant" as const,
        source: "grants.gov",
        source_type: "government_federal",
        status: "open",
        url: opp.url,
      };

      if (opp.description) row.description = opp.description;
      if (opp.close_date) row.deadline = opp.close_date;
      if (opp.award_ceiling !== null) row.amount_max = opp.award_ceiling;
      if (opp.award_floor !== null) row.amount_min = opp.award_floor;

      const { data: inserted, error } = await this.client
        .from("opportunities")
        .insert(row)
        .select("id")
        .single();

      if (!error && inserted) {
        opportunitiesCreated++;
        if (row.deadline) {
          await this.client.from("deadlines").insert({
            organization_id: this.organizationId,
            opportunity_id: inserted.id,
            deadline_type: "application_deadline" as const,
            due_date: row.deadline as string,
            title: `${row.name as string} – Application Deadline`,
          });
        }
      }
    }

    const queryLabel =
      effectiveQueries.length === 1
        ? `"${effectiveQueries[0]}"`
        : `${effectiveQueries.length} keyword queries`;

    return {
      data: {
        opportunities,
        count: opportunities.length,
        opportunitiesCreated,
        backfilledRows: 0,
      },
      outputSummary: `Grants.gov ${queryLabel}: ${opportunities.length} unique, ${opportunitiesCreated} new record(s).`,
      itemsFound: opportunities.length,
      itemsProcessed: opportunitiesCreated,
      tokensUsed: 0,
    };
  }
}
