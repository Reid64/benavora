import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { createClient } from "@/lib/supabase/server";
import { enforceLimit } from "@/lib/billing/tier-enforcer";
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
import type { AgentType } from "@/types/agents";

// Research trigger endpoint (BLUEPRINT §3.1, AGENTS.md Agents 12-15).
//
// POST { profileId?, agentType } authenticates the user, derives organization_id
// from their profile (never the body), then runs the dedicated research agent
// for the selected source family. Each agent runs the shared pipeline: build
// queries from the search profile(s) → search its sources → fetch + parse
// candidate pages → de-duplicate → create funders + opportunities (status open,
// source = profile name) → score eligibility on each new opportunity
// (Contracts §17). Every agent self-logs to agent_runs via BaseAgent.
//
// profileId is optional: when given, only that profile runs; when omitted, the
// agent self-selects every active profile carrying one of its categories. The
// pipeline runs synchronously and is logged as completed/failed before the
// response returns; `status: "started"` is the response contract from the spec.

export const runtime = "nodejs";
export const maxDuration = 60;

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

export async function POST(request: Request) {
  // Running an agent is a write action — viewers are read-only (Contracts §16).
  const roleCheck = await requireRole("writer");
  if ("error" in roleCheck) return roleCheck.error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", "invalid_body", 400);
  }

  const { profileId, agentType } = (body ?? {}) as {
    profileId?: unknown;
    agentType?: unknown;
  };

  if (
    typeof agentType !== "string" ||
    !RESEARCH_AGENT_TYPES.includes(agentType as AgentType)
  ) {
    return jsonError(
      `agentType must be one of: ${RESEARCH_AGENT_TYPES.join(", ")}.`,
      "invalid_input",
      400,
    );
  }
  const resolvedAgentType = agentType as AgentType;

  // profileId is optional for every type — an omitted id means "run all active
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

  // Derive organization_id server-side from the profile — never from the body.
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

  try {
    const agent = createResearchAgent(resolvedAgentType, {
      client: supabase,
      organizationId,
      triggeredBy,
      model,
      maxTokens,
    });
    const outcome = await agent.run({
      profileIds: resolvedProfileId ? [resolvedProfileId] : null,
    });
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
