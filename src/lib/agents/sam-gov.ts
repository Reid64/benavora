// SAM.gov Research Agent — AGENTS.md Agent 16.
//
// Polls the SAM.gov federal opportunities API for records matching search
// profile keywords (BEHAVIORAL_CONTRACTS §18).
//
// Per-run behaviour:
//   1. Runs multiple keyword searches (housing-focused phrases + any caller-
//      supplied keywords) to maximise coverage — typically 150+ results vs
//      the old single-query 25.
//   2. Paginates each keyword until all records retrieved or 200 max.
//   3. Deduplicates by noticeId in memory across all searches before touching
//      the database.
//   4. Parses award.ceiling/floor and responseDeadLine from the response.
//   5. Deduplicates against existing opportunities by name OR url before
//      inserting new records into the opportunities table.
//   6. Returns the full list of discovered opportunities plus creation counts.
//
// Key contract (BEHAVIORAL_CONTRACTS §18): missing or invalid API key causes
// the run to fail with a typed AgentError surfaced to the route handler.

import {
  AgentError,
  BaseAgent,
  type AgentExecution,
  type BaseAgentOptions,
} from "@/lib/agents/base-agent";
import type { AgentType } from "@/types/agents";

const SAM_GOV_URL =
  "https://api.sam.gov/opportunities/v2/search";

// Six housing-focused keyword phrases run as separate searches to maximise
// coverage. Each paginates up to 200 records, giving ~1200 candidates before dedup.
const HOUSING_KEYWORD_QUERIES = [
  "affordable housing",
  "transitional housing reentry",
  "homelessness prevention",
  "community development housing",
  "veterans housing",
  "rural housing development",
];

const PAGE_SIZE = 25;
const MAX_RECORDS_PER_KEYWORD = 200;

export interface SamGovInput {
  /** Plaintext (already-decrypted) SAM.gov API key. */
  apiKey: string;
  keywords: string[];
  postedFrom?: string;
  postedTo?: string;
}

export interface SamGovOpportunity {
  title: string;
  agency: string;
  solicitation_number: string;
  type: string;
  posted_date: string | null;
  response_deadline: string | null;
  amount_max: number | null;
  amount_min: number | null;
  url: string | null;
  source: "sam.gov";
}

export interface SamGovResult {
  opportunities: SamGovOpportunity[];
  count: number;
  opportunitiesCreated: number;
}

interface RawAward {
  ceiling?: unknown;
  floor?: unknown;
}

interface RawOpportunity {
  title?: unknown;
  solicitationNumber?: unknown;
  noticeId?: unknown;
  type?: unknown;
  baseType?: unknown;
  postedDate?: unknown;
  responseDeadLine?: unknown;
  description?: unknown;
  fullParentPathName?: unknown;
  organizationHierarchy?: unknown;
  award?: RawAward;
}

interface SamGovResponse {
  totalRecords?: unknown;
  opportunitiesData?: RawOpportunity[];
  data?: RawOpportunity[];
}

function toStr(val: unknown): string {
  if (typeof val === "string") return val.trim();
  if (val === null || val === undefined) return "";
  return String(val).trim();
}

function toNumber(val: unknown): number | null {
  if (val === null || val === undefined || val === "") return null;
  const n = Number(val);
  return isFinite(n) ? n : null;
}

function toPositiveNumber(val: unknown): number | null {
  const n = toNumber(val);
  return n !== null && n > 0 ? n : null;
}

// SAM.gov dates arrive as ISO strings ("2025-03-01T23:59:00-05:00") or
// "YYYY-MM-DD". Extract the date portion only.
function normaliseDate(val: unknown): string | null {
  const raw = toStr(val);
  if (!raw) return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(raw);
  return match?.[1] ?? null;
}

function extractAgency(hit: RawOpportunity): string {
  const path = toStr(hit.fullParentPathName);
  if (path) {
    // Path format: "GRANDPARENT.PARENT.AGENCY" — take the last segment.
    const parts = path.split(".");
    return parts[parts.length - 1]?.trim() ?? path;
  }
  if (Array.isArray(hit.organizationHierarchy)) {
    const orgs = hit.organizationHierarchy as Array<{ name?: unknown }>;
    const last = orgs[orgs.length - 1];
    return toStr(last?.name);
  }
  return "";
}

function extractHits(body: SamGovResponse): RawOpportunity[] {
  if (Array.isArray(body.opportunitiesData)) return body.opportunitiesData;
  if (Array.isArray(body.data)) return body.data;
  return [];
}

function toTotalRecords(val: unknown): number {
  const n = Number(val);
  return isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export class SamGovResearchAgent extends BaseAgent<SamGovInput, SamGovResult> {
  readonly agentType: AgentType = "sam_gov_research";

  constructor(options: BaseAgentOptions) {
    // Multi-keyword paginated search needs more than the 60s default; cap at
    // 270s to leave a 30s buffer under the 300s Vercel function limit.
    super({ ...options, timeoutMs: options.timeoutMs ?? 270_000 });
  }

  protected async execute(
    input: SamGovInput,
  ): Promise<AgentExecution<SamGovResult>> {
    if (!input.apiKey) {
      throw new AgentError(
        "SAM.gov API key is required.",
        "key_missing",
        400,
      );
    }

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

    const effectiveQueries = queries.filter(Boolean);
    if (effectiveQueries.length === 0) {
      throw new AgentError(
        "At least one keyword is required.",
        "no_keywords",
        400,
      );
    }

    // Run each keyword query with pagination, deduplicating by noticeId.
    const allHitsMap = new Map<string, RawOpportunity>();

    for (const keyword of effectiveQueries) {
      let page = 0;
      let totalRecords = PAGE_SIZE; // optimistic initial value to enter loop

      while (page * PAGE_SIZE < Math.min(totalRecords, MAX_RECORDS_PER_KEYWORD)) {
        const params = new URLSearchParams({
          api_key: input.apiKey,
          q: keyword,
          ptype: "o",
          limit: String(PAGE_SIZE),
          offset: String(page * PAGE_SIZE),
        });
        if (input.postedFrom) params.set("postedFrom", input.postedFrom);
        if (input.postedTo) params.set("postedTo", input.postedTo);

        try {
          const response = await fetch(`${SAM_GOV_URL}?${params.toString()}`, {
            method: "GET",
            headers: { Accept: "application/json" },
            signal: AbortSignal.timeout(30_000),
          });

          if (response.status === 403 || response.status === 401) {
            throw new AgentError(
              "SAM.gov API key is invalid or expired.",
              "key_invalid",
              401,
            );
          }

          if (!response.ok) break; // non-fatal: skip remaining pages for this keyword

          const rawBody = (await response.json()) as SamGovResponse;

          // On first page, read totalRecords to determine pagination depth.
          if (page === 0) {
            totalRecords = toTotalRecords(rawBody.totalRecords);
          }

          const hits = extractHits(rawBody);
          if (hits.length === 0) break;

          for (const hit of hits) {
            const noticeId = toStr(hit.noticeId ?? hit.solicitationNumber);
            if (noticeId && !allHitsMap.has(noticeId)) {
              allHitsMap.set(noticeId, hit);
            }
          }
        } catch (err) {
          if (err instanceof AgentError) throw err;
          break; // non-fatal network error: skip remaining pages for this keyword
        }

        page++;
      }
    }

    // Map deduplicated hits to structured opportunities.
    const opportunities: SamGovOpportunity[] = Array.from(
      allHitsMap.values(),
    ).map((hit) => {
      const noticeId = toStr(hit.noticeId ?? hit.solicitationNumber);
      const award: RawAward = hit.award ?? {};
      return {
        title: toStr(hit.title),
        agency: extractAgency(hit),
        solicitation_number: toStr(hit.solicitationNumber ?? hit.noticeId),
        type: toStr(hit.type ?? hit.baseType),
        posted_date: normaliseDate(hit.postedDate),
        response_deadline: normaliseDate(hit.responseDeadLine),
        amount_max: toPositiveNumber(award.ceiling),
        amount_min: toPositiveNumber(award.floor),
        url: noticeId ? `https://sam.gov/opp/${noticeId}` : null,
        source: "sam.gov" as const,
      };
    });

    let opportunitiesCreated = 0;

    for (const opp of opportunities) {
      if (!opp.title) continue;

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

      const row: Record<string, unknown> = {
        organization_id: this.organizationId,
        name: opp.title,
        category: "government_grant",
        source: "sam.gov",
        source_type: "government_federal",
        status: "open",
      };

      if (opp.response_deadline) row.deadline = opp.response_deadline;
      if (opp.amount_max !== null) row.amount_max = opp.amount_max;
      if (opp.amount_min !== null) row.amount_min = opp.amount_min;
      if (opp.url) row.url = opp.url;

      const { error } = await this.client.from("opportunities").insert(row);

      if (!error) opportunitiesCreated++;
    }

    const queryLabel =
      effectiveQueries.length === 1
        ? `"${effectiveQueries[0]}"`
        : `${effectiveQueries.length} keyword queries`;

    return {
      data: { opportunities, count: opportunities.length, opportunitiesCreated },
      outputSummary: `SAM.gov search across ${queryLabel} found ${opportunities.length} unique opportunity(ies); ${opportunitiesCreated} new record(s) created.`,
      itemsFound: opportunities.length,
      itemsProcessed: opportunitiesCreated,
      tokensUsed: 0,
    };
  }
}
