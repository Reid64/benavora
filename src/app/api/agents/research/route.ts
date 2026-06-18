import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireRole } from "@/lib/auth/role-gate";
import { createClient } from "@/lib/supabase/server";
import { enforceLimit } from "@/lib/billing/tier-enforcer";
import { checkTierGate } from "@/lib/services/tier-gate";
import { DEFAULT_MAX_TOKENS, DEFAULT_MODEL } from "@/lib/ai/claude";
import {
  AgentError,
  type AgentRunOutcome,
  type BaseAgentOptions,
} from "@/lib/agents/base-agent";
import { CorporateGivingResearchAgent } from "@/lib/agents/research/corporate-giving";
import { FoundationGrantsResearchAgent } from "@/lib/agents/research/foundation-grants";
import { GovernmentGrantsResearchAgent } from "@/lib/agents/research/government-grants";
import { LocalSponsorshipResearchAgent } from "@/lib/agents/research/local-sponsorship";
import { runResearchAgentsInParallel } from "@/lib/agents/research/orchestrator";
import { CorporateScraperAgent } from "@/lib/agents/corporate-scraper";
import { GrantsGovResearchAgent } from "@/lib/agents/grants-gov";
import { HudMonitorAgent } from "@/lib/agents/hud-monitor";
import { SamGovResearchAgent } from "@/lib/agents/sam-gov";
import { SimplerGrantsResearchAgent } from "@/lib/agents/simpler-grants";
import { TdhcaScraperAgent } from "@/lib/agents/tdhca-scraper";
import { GrantSummaryAgent } from "@/lib/agents/grant-summary";
import { EligibilityScorer } from "@/lib/agents/eligibility-scorer";
import type { AgentType } from "@/types/agents";

// Research trigger endpoint (BLUEPRINT §3.1, AGENTS.md Agents 12-15).
//
// POST { profileId?, agentType } — existing single-family / parallel-all flow.
// POST { sources: string[] }    — new multi-source flow (see below).
//
// Multi-source flow (sources = "grants_gov" | "sam_gov" | "simpler_grants" |
// "hud" | "tdhca" | "corporate" | "all"):
//   For each requested source the corresponding purpose-built scraper / API agent
//   runs. After each agent completes, any opportunities it inserted are found by
//   timestamp diff and auto-chained: GrantSummaryAgent then EligibilityScorer run
//   on each new opportunity_id so every discovery is immediately enriched and
//   scored. Results are returned as {results: [{source, inserted, errors}]}.
//
// agentType "all" is a special trigger: instead of one family, it runs EVERY
// research lane simultaneously (Promise.allSettled) via the orchestrator, then
// de-duplicates the union of their discoveries, and responds with per-lane
// status so the dashboard can show parallel execution.

export const runtime = "nodejs";
export const maxDuration = 300;

/** Options every research agent constructor accepts. */
interface ResearchAgentOptions extends BaseAgentOptions {
  model: string;
  maxTokens: number;
}

/** The common run input + outcome shape across the research agents. */
interface ResearchAgent {
  run(input: { profileIds?: string[] | null }): Promise<AgentRunOutcome<unknown>>;
}

/** Only the research agent types may be triggered here. */
const RESEARCH_AGENT_TYPES: AgentType[] = [
  "corporate_research",
  "foundation_research",
  "government_research",
  "local_sponsorship",
];

/** Construct the dedicated agent for a research type. */
function createResearchAgent(
  agentType: AgentType,
  options: ResearchAgentOptions,
): ResearchAgent {
  switch (agentType) {
    case "foundation_research":
      return new FoundationGrantsResearchAgent(options);
    case "government_research":
      return new GovernmentGrantsResearchAgent(options);
    case "local_sponsorship":
      return new LocalSponsorshipResearchAgent(options);
    case "corporate_research":
    default:
      return new CorporateGivingResearchAgent(options);
  }
}

// Per-org rate limit, mirroring the other agent routes (Contracts §16).
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;
const hits = new Map<string, number[]>();

function isRateLimited(orgId: string): boolean {
  const now = Date.now();
  const recent = (hits.get(orgId) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) {
    hits.set(orgId, recent);
    return true;
  }
  recent.push(now);
  hits.set(orgId, recent);
  return false;
}

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

// --- multi-source flow -------------------------------------------------------

const VALID_SOURCES = [
  "grants_gov",
  "sam_gov",
  "simpler_grants",
  "hud",
  "tdhca",
  "corporate",
] as const;

type SourceKey = (typeof VALID_SOURCES)[number];

/** Per-source result returned in the multi-source response. */
interface SourceResult {
  source: string;
  inserted: number;
  errors: string[];
}

interface SourceRunOptions {
  client: SupabaseClient;
  organizationId: string;
  triggeredBy: string;
  model: string;
  maxTokens: number;
  keywords: string[];
}

/**
 * Run one source agent, then auto-chain summarize + eligibility on every
 * opportunity inserted during this run. Best-effort: chain errors are collected
 * but never fail the source result.
 */
async function runSourceAndChain(
  source: SourceKey,
  opts: SourceRunOptions,
): Promise<SourceResult> {
  const errors: string[] = [];
  const sweepStart = new Date().toISOString();

  try {
    switch (source) {
      case "grants_gov": {
        const agent = new GrantsGovResearchAgent({
          client: opts.client,
          organizationId: opts.organizationId,
          triggeredBy: opts.triggeredBy,
        });
        await agent.run({ keywords: opts.keywords });
        break;
      }
      case "sam_gov": {
        const apiKey = process.env.SAM_GOV_API_KEY;
        if (!apiKey) {
          errors.push("SAM_GOV_API_KEY is not configured.");
          break;
        }
        const agent = new SamGovResearchAgent({
          client: opts.client,
          organizationId: opts.organizationId,
          triggeredBy: opts.triggeredBy,
        });
        await agent.run({ apiKey, keywords: opts.keywords });
        break;
      }
      case "simpler_grants": {
        const agent = new SimplerGrantsResearchAgent({
          client: opts.client,
          organizationId: opts.organizationId,
          triggeredBy: opts.triggeredBy,
        });
        await agent.run({ keywords: opts.keywords });
        break;
      }
      case "hud": {
        const agent = new HudMonitorAgent({
          client: opts.client,
          organizationId: opts.organizationId,
          triggeredBy: opts.triggeredBy,
        });
        await agent.run({ keywords: opts.keywords });
        break;
      }
      case "tdhca": {
        const agent = new TdhcaScraperAgent({
          client: opts.client,
          organizationId: opts.organizationId,
          triggeredBy: opts.triggeredBy,
        });
        await agent.run({});
        break;
      }
      case "corporate": {
        const agent = new CorporateScraperAgent({
          client: opts.client,
          organizationId: opts.organizationId,
          triggeredBy: opts.triggeredBy,
        });
        await agent.run({});
        break;
      }
    }
  } catch (err) {
    errors.push(err instanceof Error ? err.message : "Agent failed.");
  }

  // Find all opportunity IDs inserted during this run.
  const { data: newRows } = await opts.client
    .from("opportunities")
    .select("id")
    .eq("organization_id", opts.organizationId)
    .gte("created_at", sweepStart);

  const newIds = (newRows ?? []).map((r) => r.id as string);

  // Auto-chain: summarize then score each new opportunity.
  for (const opportunityId of newIds) {
    try {
      const summarizer = new GrantSummaryAgent({
        client: opts.client,
        organizationId: opts.organizationId,
        triggeredBy: opts.triggeredBy,
        model: opts.model,
        maxTokens: opts.maxTokens,
      });
      await summarizer.run({ opportunityId });
    } catch (err) {
      errors.push(
        `summarize ${opportunityId}: ${err instanceof Error ? err.message : "failed"}`,
      );
    }

    try {
      const scorer = new EligibilityScorer({
        client: opts.client,
        organizationId: opts.organizationId,
        triggeredBy: opts.triggeredBy,
        model: opts.model,
        maxTokens: opts.maxTokens,
      });
      await scorer.run({ opportunityId });
    } catch (err) {
      errors.push(
        `eligibility ${opportunityId}: ${err instanceof Error ? err.message : "failed"}`,
      );
    }
  }

  return { source, inserted: newIds.length, errors };
}

// --- route handler -----------------------------------------------------------

export async function POST(request: Request) {
  // Running an agent is a write action - viewers are read-only (Contracts §16).
  const roleCheck = await requireRole("writer");
  if ("error" in roleCheck) return roleCheck.error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", "invalid_body", 400);
  }

  const parsed = (body ?? {}) as {
    sources?: unknown;
    profileId?: unknown;
    agentType?: unknown;
  };

  // ── New multi-source flow ──────────────────────────────────────────────────
  if (Array.isArray(parsed.sources)) {
    const requested = (parsed.sources as unknown[]).map(String);
    const isAll = requested.includes("all");
    const effectiveSources: SourceKey[] = isAll
      ? [...VALID_SOURCES]
      : requested.filter((s): s is SourceKey =>
          VALID_SOURCES.includes(s as SourceKey),
        );

    if (effectiveSources.length === 0) {
      return jsonError(
        `sources must include "all" or at least one of: ${VALID_SOURCES.join(", ")}.`,
        "invalid_input",
        400,
      );
    }

    const supabase = createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return jsonError("Authentication required.", "unauthenticated", 401);
    }

    const { data: profileRow, error: profileError } = await supabase
      .from("profiles")
      .select("id, organization_id")
      .eq("id", user.id)
      .single();
    if (profileError || !profileRow) {
      return jsonError("Could not resolve your profile.", "no_profile", 403);
    }
    const organizationId = profileRow.organization_id as string;
    const triggeredBy = profileRow.id as string;

    if (isRateLimited(organizationId)) {
      return jsonError(
        "Too many research runs. Please wait a moment and try again.",
        "rate_limited",
        429,
      );
    }

    // Pull keywords from the org's active search profiles for API-based agents.
    const { data: profileRows } = await supabase
      .from("search_profiles")
      .select("keywords")
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .limit(5);

    const keywords: string[] = (profileRows ?? [])
      .flatMap((row) =>
        Array.isArray(row.keywords) ? (row.keywords as string[]) : [],
      )
      .filter(Boolean)
      .slice(0, 10);

    const effectiveKeywords =
      keywords.length > 0 ? keywords : ["grant", "nonprofit", "community"];

    // Resolve AI config for the auto-chain summarize + eligibility calls.
    const { data: configRows } = await supabase
      .from("platform_config")
      .select("key, value")
      .in("key", ["ai.model", "ai.max_tokens"]);
    const config = new Map<string, string>(
      (configRows ?? []).map((r) => [r.key as string, r.value as string]),
    );
    const model = config.get("ai.model") ?? DEFAULT_MODEL;
    const maxTokens = Number(config.get("ai.max_tokens")) || DEFAULT_MAX_TOKENS;

    const sourceOpts: SourceRunOptions = {
      client: supabase,
      organizationId,
      triggeredBy,
      model,
      maxTokens,
      keywords: effectiveKeywords,
    };

    const results: SourceResult[] = [];
    for (const source of effectiveSources) {
      const result = await runSourceAndChain(source, sourceOpts);
      results.push(result);
    }

    return NextResponse.json({ results });
  }

  // ── Existing agentType flow ────────────────────────────────────────────────
  const { profileId, agentType } = parsed as {
    profileId?: unknown;
    agentType?: unknown;
  };

  // "all" runs every lane in parallel; otherwise a single research family.
  const isParallel = agentType === "all";
  if (
    typeof agentType !== "string" ||
    (!isParallel && !RESEARCH_AGENT_TYPES.includes(agentType as AgentType))
  ) {
    return jsonError(
      `agentType must be "all" or one of: ${RESEARCH_AGENT_TYPES.join(", ")}.`,
      "invalid_input",
      400,
    );
  }

  // profileId is optional for every type - an omitted id means "run all active
  // profiles carrying this agent's categories" (each agent self-selects).
  const hasProfileId = typeof profileId === "string" && profileId.trim() !== "";
  const resolvedProfileId = hasProfileId ? (profileId as string).trim() : null;

  const supabase = createClient();

  // Authenticate via the session (Contracts §16).
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return jsonError("Authentication required.", "unauthenticated", 401);
  }

  // Derive organization_id server-side from the profile - never from the body.
  const { data: profileRow, error: profileError } = await supabase
    .from("profiles")
    .select("id, organization_id")
    .eq("id", user.id)
    .single();
  if (profileError || !profileRow) {
    return jsonError("Could not resolve your profile.", "no_profile", 403);
  }
  const organizationId = profileRow.organization_id as string;
  const triggeredBy = profileRow.id as string;

  if (isRateLimited(organizationId)) {
    return jsonError(
      "Too many research runs. Please wait a moment and try again.",
      "rate_limited",
      429,
    );
  }

  // Feature-level tier gate: agent_run cap per tier (Contracts §25).
  const agentGate = await checkTierGate(organizationId, "agent_run");
  if (!agentGate.allowed) {
    return jsonError(
      `Your plan allows ${agentGate.limit} agent runs per day. Upgrade to continue.`,
      "tier_limit_exceeded",
      429,
    );
  }

  // Daily agent-run quota for the org's tier (Behavioral Contracts §25).
  const overLimit = await enforceLimit(supabase, organizationId, "agent_runs");
  if (overLimit) return overLimit;

  // Research agents are a Phase 2 feature, gated per organization (SCHEMA
  // platform_config feature.research_agents, Contracts §17).
  const { data: flagRow } = await supabase
    .from("platform_config")
    .select("value")
    .eq("organization_id", organizationId)
    .eq("key", "feature.research_agents")
    .maybeSingle();
  if ((flagRow?.value as string | undefined) !== "true") {
    return jsonError(
      "Research agents are not enabled for your organization.",
      "feature_disabled",
      403,
    );
  }

  // Resolve AI config (platform_config overrides, then defaults).
  const { data: configRows } = await supabase
    .from("platform_config")
    .select("key, value")
    .in("key", ["ai.model", "ai.max_tokens"]);
  const config = new Map<string, string>(
    (configRows ?? []).map((r) => [r.key as string, r.value as string]),
  );
  const model = config.get("ai.model") ?? DEFAULT_MODEL;
  const maxTokens = Number(config.get("ai.max_tokens")) || DEFAULT_MAX_TOKENS;

  const profileIds = resolvedProfileId ? [resolvedProfileId] : null;

  try {
    // Parallel mode: run every research lane at once and dedupe the union.
    if (isParallel) {
      const orchestration = await runResearchAgentsInParallel({
        client: supabase,
        organizationId,
        triggeredBy,
        model,
        maxTokens,
        profileIds,
      });
      return NextResponse.json({
        status: "completed",
        mode: "parallel",
        lanes: orchestration.lanes,
        totalFound: orchestration.totalFound,
        totalCreated: orchestration.totalCreated,
        duplicatesRemoved: orchestration.duplicatesRemoved,
        opportunitiesValidated: orchestration.opportunitiesValidated,
        opportunitiesVerified: orchestration.opportunitiesVerified,
        durationMs: orchestration.durationMs,
      });
    }

    const agent = createResearchAgent(agentType as AgentType, {
      client: supabase,
      organizationId,
      triggeredBy,
      model,
      maxTokens,
    });
    const outcome = await agent.run({ profileIds });
    return NextResponse.json({
      runId: outcome.runId,
      status: "started",
      result: outcome.data,
    });
  } catch (err) {
    const status = err instanceof AgentError ? err.status : 500;
    return jsonError(
      "Research run failed. Please try again.",
      err instanceof AgentError ? err.code : "research_failed",
      status,
    );
  }
}
