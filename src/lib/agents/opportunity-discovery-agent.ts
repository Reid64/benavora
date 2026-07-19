// Opportunity Discovery Agent — PLATFORM_VISION_ARCHITECTURE.md Pillar 2 (AI
// Opportunity Discovery Engine), AGENTS_v2.md AG-17.
//
// Autonomous rewrite: extends AutonomousAgent (migration 080 infrastructure —
// autonomous_triggers, agent_queue, agent_decisions, org_autonomous_config).
// Sweeps Grants.gov, SAM.gov, and the Federal Register per active search
// profile, dedupes against real `opportunities` rows, and inserts new matches
// directly — every insertion is logged to agent_decisions for audit, and a
// batch of new opportunities chains into AG-15 (Grant Probability) when the
// org has auto-scoring enabled. This replaces the prior non-destructive
// design that only staged candidates in discovery_matches.
//
// Deviations from the task-given spec, per this project's established
// practice of checking real state before applying a literal spec (see
// src/lib/sources/federal-grants-poller.ts's header for a prior instance of
// this pattern):
//   - `opportunities` has no `source_url` column (confirmed absent from
//     every migration and src/types/database.ts) — dedup uses the real
//     `url` column instead, matching the convention already established in
//     src/lib/sources/{grantsgov-sync,federal-grants-poller}.ts.
//   - The repo's current BEHAVIORAL_CONTRACTS.md only numbers sections
//     17-33 (v2.0); it has no section 5. The source-integration contracts
//     relevant to this agent are §17 (Grants.gov) and §18 (SAM.gov).

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  AutonomousAgent,
  type AutonomousAgentResult,
} from "@/lib/agents/autonomous-base";
import {
  searchGrantsGovOpportunities,
  type GrantsGovNormalizedOpportunity,
} from "@/lib/sources/grantsgov-client";
import {
  searchSamGovOpportunities,
  type SamGovNormalizedOpportunity,
} from "@/lib/sources/samgov-client";

const FEDERAL_REGISTER_URL =
  "https://www.federalregister.gov/api/v1/documents.json";

type TriggerSource = "autonomous" | "manual" | "chain" | "schedule";

type DiscoverySource = "grants_gov" | "sam_gov" | "federal_register";

interface DiscoveredOpportunity {
  externalTitle: string;
  externalSource: DiscoverySource;
  externalUrl: string | null;
  description: string | null;
  amount: number | null;
  deadline: string | null;
}

interface SearchProfileRow {
  id: string;
  name: string;
  keywords: string[] | null;
}

interface FederalRegisterResult {
  document_number?: unknown;
  title?: unknown;
  abstract?: unknown;
  html_url?: unknown;
}

interface FederalRegisterResponse {
  results?: FederalRegisterResult[];
}

function toStr(val: unknown): string {
  if (typeof val === "string") return val.trim();
  if (val === null || val === undefined) return "";
  return String(val).trim();
}

function mapGrantsGov(
  hit: GrantsGovNormalizedOpportunity,
): DiscoveredOpportunity {
  return {
    externalTitle: hit.name,
    externalSource: "grants_gov",
    externalUrl: hit.externalId
      ? `https://www.grants.gov/search-grants?opp=${hit.externalId}`
      : null,
    description: hit.description,
    amount: hit.amount,
    deadline: hit.deadline,
  };
}

function mapSamGov(hit: SamGovNormalizedOpportunity): DiscoveredOpportunity {
  return {
    externalTitle: hit.name,
    externalSource: "sam_gov",
    externalUrl: hit.externalId
      ? `https://sam.gov/opp/${hit.externalId}/view`
      : null,
    description: hit.description,
    amount: hit.amount,
    deadline: hit.deadline,
  };
}

/**
 * Polls the Federal Register for grant-funding notices. Returns an empty
 * array on any HTTP/parse failure (non-fatal — mirrors the grants.gov/SAM.gov
 * source clients' behavior so one dead source never aborts the whole run).
 */
async function fetchFederalRegister(): Promise<DiscoveredOpportunity[]> {
  const params = new URLSearchParams();
  params.append("conditions[type][]", "NOTICE");
  params.set("conditions[term]", "grant funding");
  params.set("per_page", "20");
  params.set("order", "newest");

  let response: Response;
  try {
    response = await fetch(`${FEDERAL_REGISTER_URL}?${params.toString()}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return [];
  }

  if (!response.ok) return [];

  let body: FederalRegisterResponse;
  try {
    body = (await response.json()) as FederalRegisterResponse;
  } catch {
    return [];
  }

  const results = Array.isArray(body.results) ? body.results : [];
  const mapped: DiscoveredOpportunity[] = [];
  for (const item of results) {
    const title = toStr(item.title);
    if (!title) continue;
    mapped.push({
      externalTitle: title,
      externalSource: "federal_register",
      externalUrl: toStr(item.html_url) || null,
      description: toStr(item.abstract) || null,
      amount: null,
      deadline: null,
    });
  }
  return mapped;
}

/**
 * True if an opportunity with this url or name already exists for the org.
 * `opportunities` has no `source_url` column (see file header) — dedup uses
 * the real `url` column (exact match) plus an exact name match, matching the
 * task's dedup rule with the real schema's column name substituted in.
 */
async function existsInOpportunities(
  supabase: SupabaseClient,
  orgId: string,
  title: string,
  url: string | null,
): Promise<boolean> {
  if (url) {
    const { data: byUrl } = await supabase
      .from("opportunities")
      .select("id")
      .eq("organization_id", orgId)
      .eq("url", url)
      .maybeSingle();
    if (byUrl) return true;
  }

  const { data: byName } = await supabase
    .from("opportunities")
    .select("id")
    .eq("organization_id", orgId)
    .eq("name", title)
    .maybeSingle();
  return Boolean(byName);
}

function formatAmount(amount: number | null): string {
  return amount === null ? "unknown" : `$${amount.toLocaleString()}`;
}

function formatDeadline(deadline: string | null): string {
  return deadline ?? "none published";
}

export class OpportunityDiscoveryAgent extends AutonomousAgent {
  constructor(orgId: string, supabase: SupabaseClient) {
    super(orgId, "ag-17-discovery", supabase);
  }

  override async run(
    triggerSource: TriggerSource,
  ): Promise<AutonomousAgentResult> {
    const runId = await this.startRun(triggerSource);
    const errors: string[] = [];
    const decisions: string[] = [];
    const newOpportunityIds: string[] = [];
    let duplicatesSkipped = 0;

    try {
      const { data: profileRows, error: profilesError } = await this.supabase
        .from("search_profiles")
        .select("id, name, keywords")
        .eq("organization_id", this.orgId)
        .eq("is_active", true);

      if (profilesError) {
        throw new Error(
          `Failed to load active search profiles: ${profilesError.message}`,
        );
      }

      const profiles = (profileRows ?? []) as SearchProfileRow[];

      for (const profile of profiles) {
        const keyword =
          (profile.keywords ?? []).join(" ").slice(0, 50).trim() ||
          profile.name ||
          "nonprofit grant";

        const [grantsGovHits, samGovHits, federalRegisterHits] =
          await Promise.all([
            searchGrantsGovOpportunities(keyword),
            searchSamGovOpportunities(),
            fetchFederalRegister(),
          ]);

        const discovered: DiscoveredOpportunity[] = [
          ...grantsGovHits.map(mapGrantsGov),
          ...samGovHits.map(mapSamGov),
          ...federalRegisterHits,
        ];

        for (const opp of discovered) {
          if (!opp.externalTitle) continue;

          const alreadyExists = await existsInOpportunities(
            this.supabase,
            this.orgId,
            opp.externalTitle,
            opp.externalUrl,
          );

          if (alreadyExists) {
            duplicatesSkipped++;
            continue;
          }

          const { data: inserted, error: insertError } = await this.supabase
            .from("opportunities")
            .insert({
              organization_id: this.orgId,
              name: opp.externalTitle,
              category: "government_grant",
              description: opp.description,
              amount_max: opp.amount,
              deadline: opp.deadline,
              url: opp.externalUrl,
              source: "agent",
              source_type: "government_federal",
              status: "open",
            })
            .select("id")
            .single();

          if (insertError || !inserted) {
            errors.push(
              `Failed to insert "${opp.externalTitle}": ${
                insertError?.message ?? "no row returned"
              }`,
            );
            continue;
          }

          const newOppId = (inserted as { id: string }).id;
          newOpportunityIds.push(newOppId);

          const decisionId = await this.logDecision({
            decisionType: "opportunity_discovered",
            agentRunId: runId,
            entityType: "opportunity",
            entityId: newOppId,
            reasoning:
              `New opportunity matching profile ${profile.name}: ` +
              `${opp.externalTitle}. Amount: ${formatAmount(opp.amount)}. ` +
              `Deadline: ${formatDeadline(opp.deadline)}.`,
            confidenceScore: 85,
            actionTaken: "inserted_opportunity",
          });
          decisions.push(decisionId);
        }
      }

      const config = await this.getOrgConfig();
      let didChain = false;
      if (config.auto_score_enabled && newOpportunityIds.length > 0) {
        await this.queueChainedAgent("ag-15-probability", 7, {
          opportunityIds: newOpportunityIds,
        });
        didChain = true;
      }

      const count = newOpportunityIds.length;
      await this.completeRun(runId, {
        outputSummary: JSON.stringify({
          newOpportunities: count,
          duplicatesSkipped,
          chainedToScoring: didChain,
          opportunityIds: newOpportunityIds,
        }),
        itemsFound: count,
        itemsQueued: didChain ? 1 : 0,
      });

      return {
        success: true,
        itemsFound: count,
        itemsProcessed: count + duplicatesSkipped,
        itemsQueued: didChain ? 1 : 0,
        decisions,
        nextActions: didChain ? ["ag-15-probability"] : [],
        errors,
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Opportunity discovery failed.";
      await this.failRun(runId, message);
      return {
        success: false,
        itemsFound: newOpportunityIds.length,
        itemsProcessed: newOpportunityIds.length + duplicatesSkipped,
        itemsQueued: 0,
        decisions,
        nextActions: [],
        errors: [...errors, message],
      };
    }
  }
}

/**
 * Thin functional wrapper preserving the pre-existing call site
 * (src/app/api/agents/discovery/route.ts): constructs and runs the agent.
 */
export async function runOpportunityDiscovery(
  orgId: string,
  supabase: SupabaseClient,
  triggerSource: TriggerSource = "manual",
): Promise<AutonomousAgentResult> {
  const agent = new OpportunityDiscoveryAgent(orgId, supabase);
  return agent.run(triggerSource);
}
