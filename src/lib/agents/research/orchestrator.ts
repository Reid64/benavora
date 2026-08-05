// Parallel research orchestration (BLUEPRINT §3.1, BEHAVIORAL_CONTRACTS §17).
//
// "Run all active" launches every research lane in RESEARCH_AGENT_CONFIGS AT ONCE
// via Promise.allSettled - the four base families plus the four specialized
// source-type passes - instead of running them sequentially. allSettled (not
// Promise.all) is deliberate: one family failing or timing out must never abort
// the others, and every lane's status is reported back for the dashboard.
//
// Because the lanes run concurrently, two of them can each pass the per-insert
// checkDuplicate() - neither sees the other's just-committed row - and create the
// same opportunity in one sweep. So AFTER all lanes settle, a cross-result dedup
// pass (deduplicator.deduplicateResults) runs over the union of this sweep's new
// opportunities and removes the collisions, keeping the earliest-created row.
//
// Every query is organization_id-scoped: under the cron's service-role client RLS
// does not protect us (Contracts §2). The caller (route / cron) supplies the
// client, so this works for both the user-triggered and scheduled paths.

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  RESEARCH_AGENT_CONFIGS,
  type ResearchAgentConfig,
  type ResearchAgentOptions,
} from "@/lib/agents/research/agent-configs";
import {
  deduplicateResults,
  type ResultCandidate,
} from "@/lib/agents/research/deduplicator";
import {
  validateOpportunity,
  type ValidationOpportunity,
} from "@/lib/agents/consensus-validator";
import { isGeminiConfigured } from "@/lib/ai/gemini";
import type { AgentType } from "@/types/agents";

export interface OrchestrationOptions {
  client: SupabaseClient;
  organizationId: string;
  triggeredBy?: string | null;
  model: string;
  maxTokens: number;
  /** Restrict each lane to these profiles; null = each lane self-selects. */
  profileIds?: string[] | null;
  /** Subset of config keys to run; null/omitted runs every lane. */
  configKeys?: string[] | null;
  /**
   * Run cross-provider validation over this sweep's new opportunities after
   * dedup (migration 014). Defaults true, but the pass only runs when a
   * free-tier provider is configured (else consensus can never be reached, so
   * spending tokens on it is pointless). Best-effort and never fails the sweep.
   */
  autoValidate?: boolean;
  /** Cap on opportunities validated per sweep (cost/time guard). Default 5. */
  maxValidations?: number;
}

/** Per-lane result, surfaced to the dashboard's parallel-status panel. */
export interface ResearchLaneResult {
  key: string;
  label: string;
  agentType: AgentType;
  sourceType: ResearchAgentConfig["sourceType"];
  status: "completed" | "failed";
  runId: string | null;
  opportunitiesFound: number;
  opportunitiesCreated: number;
  fundersCreated: number;
  error?: string;
}

export interface OrchestrationResult {
  lanes: ResearchLaneResult[];
  /** Opportunities extracted across all lanes (pre cross-result dedup). */
  totalFound: number;
  /** New opportunity rows created across all lanes. */
  totalCreated: number;
  /** Cross-lane duplicate rows removed by the post-sweep dedup pass. */
  duplicatesRemoved: number;
  /** New opportunities sent through cross-provider validation this sweep. */
  opportunitiesValidated: number;
  /** Of those, how many reached "Verified" consensus (both providers agreed). */
  opportunitiesVerified: number;
  durationMs: number;
}

/** Counts an agent's execute() returns; read defensively (data is unknown). */
interface ResearchAgentData {
  opportunitiesFound?: number;
  opportunitiesCreated?: number;
  fundersCreated?: number;
}

/** Run every selected lane concurrently, then dedupe the union of discoveries. */
export async function runResearchAgentsInParallel(
  options: OrchestrationOptions,
): Promise<OrchestrationResult> {
  const startedAt = Date.now();
  // Marker for "created during this sweep" - set before any lane runs so the
  // dedup pass sees every row the lanes insert.
  const sweepStartIso = new Date(startedAt).toISOString();

  const configs = selectConfigs(options.configKeys ?? null);
  const agentOptions: ResearchAgentOptions = {
    client: options.client,
    organizationId: options.organizationId,
    triggeredBy: options.triggeredBy ?? null,
    model: options.model,
    maxTokens: options.maxTokens,
    // Real bottleneck found + fixed 2026-08-05: web-fetcher.ts's per-domain
    // rate limiter (RATE_LIMIT=10 req/RATE_WINDOW_MS=60s) uses a
    // module-level Map shared by every lane in this process -- when lanes
    // are run individually (manual trigger, one at a time) that's invisible,
    // but this orchestrator runs all 8 lanes in TRUE parallel, and several
    // share overlapping search-engine/source domains. Confirmed live: 7/8
    // lanes hit BaseAgent's 60s default timeout under real concurrent load,
    // even though every one of those same agent classes completes in
    // 1-60s when run alone (no rate-limit contention to wait through).
    // None of the 4 base agent classes override timeoutMs, so they all fell
    // back to the 60s default -- too tight for a lane that legitimately has
    // to queue behind up to 7 siblings for the same domain's shared budget.
    // 180s gives real headroom for that queuing without matching
    // GrantsGovResearchAgent's 270s (calibrated for a different, unrelated
    // two-pass-fetch design, not this contention pattern).
    timeoutMs: 180_000,
  };
  const profileIds = options.profileIds ?? null;

  // Launch all lanes simultaneously; runLane never throws, so allSettled here is
  // belt-and-suspenders - a settled rejection still maps to a failed lane.
  const settled = await Promise.allSettled(
    configs.map((cfg) => runLane(cfg, agentOptions, profileIds)),
  );

  // Map over configs (whose index is always in range) and pair each with its
  // settled result; settled[i] is defensively typed because indexed access can
  // be undefined (noUncheckedIndexedAccess), though lengths always match here.
  const lanes: ResearchLaneResult[] = configs.map((cfg, i) => {
    const res = settled[i];
    if (res?.status === "fulfilled") return res.value;
    return {
      ...laneIdentity(cfg),
      status: "failed",
      runId: null,
      opportunitiesFound: 0,
      opportunitiesCreated: 0,
      fundersCreated: 0,
      error:
        res?.status === "rejected" && res.reason instanceof Error
          ? res.reason.message
          : "Research lane failed.",
    };
  });

  const duplicatesRemoved = await dedupeSweep(
    options.client,
    options.organizationId,
    sweepStartIso,
  );

  // After research returns results, send this sweep's surviving findings to two
  // independent AI providers for consensus validation (migration 014). Gated on
  // a configured free-tier provider and bounded; best-effort.
  const autoValidate = options.autoValidate ?? true;
  const validation =
    autoValidate && isGeminiConfigured()
      ? await validateSweepFindings(
          options.client,
          options.organizationId,
          options.triggeredBy ?? null,
          sweepStartIso,
          options.model,
          options.maxValidations ?? 5,
        )
      : { validated: 0, verified: 0 };

  return {
    lanes,
    totalFound: lanes.reduce((s, l) => s + l.opportunitiesFound, 0),
    totalCreated: lanes.reduce((s, l) => s + l.opportunitiesCreated, 0),
    duplicatesRemoved,
    opportunitiesValidated: validation.validated,
    opportunitiesVerified: validation.verified,
    durationMs: Date.now() - startedAt,
  };
}

// --- internals ---------------------------------------------------------------

/** The lane identity fields shared by success and failure results. */
function laneIdentity(
  cfg: ResearchAgentConfig,
): Pick<ResearchLaneResult, "key" | "label" | "agentType" | "sourceType"> {
  return {
    key: cfg.key,
    label: cfg.label,
    agentType: cfg.agentType,
    sourceType: cfg.sourceType,
  };
}

/** Resolve which configs to run (all, or a validated subset by key). */
function selectConfigs(
  configKeys: string[] | null,
): readonly ResearchAgentConfig[] {
  if (!configKeys || configKeys.length === 0) return RESEARCH_AGENT_CONFIGS;
  const wanted = new Set(configKeys);
  const chosen = RESEARCH_AGENT_CONFIGS.filter((c) => wanted.has(c.key));
  return chosen.length > 0 ? chosen : RESEARCH_AGENT_CONFIGS;
}

/** Build and run one lane's agent, mapping its outcome to a lane result. */
async function runLane(
  cfg: ResearchAgentConfig,
  agentOptions: ResearchAgentOptions,
  profileIds: string[] | null,
): Promise<ResearchLaneResult> {
  const identity = laneIdentity(cfg);
  try {
    const agent = cfg.create(agentOptions);
    const outcome = await agent.run({ profileIds });
    const data = (outcome.data ?? {}) as ResearchAgentData;
    return {
      ...identity,
      status: "completed",
      runId: outcome.runId,
      opportunitiesFound: data.opportunitiesFound ?? 0,
      opportunitiesCreated: data.opportunitiesCreated ?? 0,
      fundersCreated: data.fundersCreated ?? 0,
    };
  } catch (err) {
    return {
      ...identity,
      status: "failed",
      runId: null,
      opportunitiesFound: 0,
      opportunitiesCreated: 0,
      fundersCreated: 0,
      error: err instanceof Error ? err.message : "Research lane failed.",
    };
  }
}

/** A sweep opportunity with its funder name flattened, for dedup comparison. */
interface SweepRow {
  id: string;
  name: string;
  url: string | null;
  funders: { name: string } | { name: string }[] | null;
}

/**
 * Fold cross-lane duplicate opportunities created during this sweep. Compares by
 * URL, then name + funder (deduplicator.deduplicateResults), keeps the earliest-
 * created row of each collision, and best-effort removes the rest (its keywords
 * first, then the row). Never throws - a cleanup failure leaves the duplicate in
 * place rather than breaking the sweep. Returns the number of rows removed.
 */
async function dedupeSweep(
  client: SupabaseClient,
  organizationId: string,
  sinceIso: string,
): Promise<number> {
  let rows: SweepRow[] = [];
  try {
    const { data, error } = await client
      .from("opportunities")
      .select("id, name, url, funders(name)")
      .eq("organization_id", organizationId)
      .gte("created_at", sinceIso)
      // Only fold agent-discovered rows; a manual entry made during the sweep
      // window must never be auto-removed (source is the profile name, never
      // "manual"). This mirrors the discovery feed's own filter.
      .not("source", "is", null)
      .neq("source", "manual")
      .order("created_at", { ascending: true });
    if (error) {
      console.error("[orchestrator] dedup sweep query failed:", error);
      return 0;
    }
    rows = (data ?? []) as unknown as SweepRow[];
  } catch (err) {
    console.error("[orchestrator] dedup sweep query threw:", err);
    return 0;
  }

  if (rows.length < 2) return 0;

  const candidates: ResultCandidate[] = rows.map((r) => ({
    id: r.id,
    url: r.url,
    name: r.name,
    funderName: funderNameOf(r.funders),
  }));

  const { duplicates } = deduplicateResults(candidates);
  if (duplicates.length === 0) return 0;

  let removed = 0;
  for (const dup of duplicates) {
    const id = dup.candidate.id;
    try {
      // Remove child keywords first (no ON DELETE cascade is assumed), then the
      // opportunity row. Both org-scoped as a second safety barrier.
      await client
        .from("opportunity_keywords")
        .delete()
        .eq("organization_id", organizationId)
        .eq("opportunity_id", id);
      const { error } = await client
        .from("opportunities")
        .delete()
        .eq("organization_id", organizationId)
        .eq("id", id);
      if (error) {
        console.error(`[orchestrator] could not remove duplicate ${id}:`, error);
        continue;
      }
      removed += 1;
    } catch (err) {
      console.error(`[orchestrator] dedup removal threw for ${id}:`, err);
    }
  }
  return removed;
}

/** Flatten the funder relation (object or single-element array) to its name. */
function funderNameOf(
  funders: SweepRow["funders"],
): string | null {
  if (!funders) return null;
  const funder = Array.isArray(funders) ? funders[0] : funders;
  return funder?.name ?? null;
}

/** A new opportunity row plus the fields the validators need to judge it. */
interface ValidatableRow {
  id: string;
  name: string;
  category: string;
  description: string | null;
  url: string | null;
  eligibility_requirements: string | null;
  deadline: string | null;
  amount_min: number | null;
  amount_max: number | null;
  amount_available: number | null;
  geographic_restrictions: string | null;
  funders: { name: string } | { name: string }[] | null;
}

/**
 * Cross-provider validation pass over this sweep's new opportunities (migration
 * 014). Validates up to `limit` of them concurrently; each finding goes to both
 * AI providers and the verdicts are upserted to `validations`. Never throws - a
 * validation failure leaves the opportunity unvalidated rather than breaking the
 * sweep. Returns how many were validated and how many reached "Verified".
 */
async function validateSweepFindings(
  client: SupabaseClient,
  organizationId: string,
  triggeredBy: string | null,
  sinceIso: string,
  model: string,
  limit: number,
): Promise<{ validated: number; verified: number }> {
  let rows: ValidatableRow[] = [];
  try {
    const { data, error } = await client
      .from("opportunities")
      .select(
        "id, name, category, description, url, eligibility_requirements, deadline, amount_min, amount_max, amount_available, geographic_restrictions, funders(name)",
      )
      .eq("organization_id", organizationId)
      .gte("created_at", sinceIso)
      .not("source", "is", null)
      .neq("source", "manual")
      .order("created_at", { ascending: true })
      .limit(limit);
    if (error) {
      console.error("[orchestrator] validation query failed:", error);
      return { validated: 0, verified: 0 };
    }
    rows = (data ?? []) as unknown as ValidatableRow[];
  } catch (err) {
    console.error("[orchestrator] validation query threw:", err);
    return { validated: 0, verified: 0 };
  }

  if (rows.length === 0) return { validated: 0, verified: 0 };

  const settled = await Promise.allSettled(
    rows.map((row) => {
      const opportunity: ValidationOpportunity = {
        name: row.name,
        category: row.category,
        description: row.description,
        funderName: funderNameOf(row.funders),
        url: row.url,
        eligibilityRequirements: row.eligibility_requirements,
        deadline: row.deadline,
        amountMin: row.amount_min,
        amountMax: row.amount_max,
        amountAvailable: row.amount_available,
        geographicRestrictions: row.geographic_restrictions,
      };
      return validateOpportunity({
        client,
        organizationId,
        opportunityId: row.id,
        opportunity,
        createdBy: triggeredBy,
        claudeModel: model,
        maxTokens: 1024,
      });
    }),
  );

  let validated = 0;
  let verified = 0;
  for (const res of settled) {
    if (res.status !== "fulfilled") continue;
    validated += 1;
    if (res.value.consensus.isVerified) verified += 1;
  }
  return { validated, verified };
}
