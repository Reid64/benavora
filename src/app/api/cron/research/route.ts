import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { DEFAULT_MAX_TOKENS, DEFAULT_MODEL } from "@/lib/ai/claude";
import type {
  AgentRunOutcome,
  BaseAgentOptions,
} from "@/lib/agents/base-agent";
import {
  CorporateGivingResearchAgent,
  CORPORATE_CATEGORIES,
} from "@/lib/agents/research/corporate-giving";
import {
  FoundationGrantsResearchAgent,
  FOUNDATION_CATEGORIES,
} from "@/lib/agents/research/foundation-grants";
import {
  GovernmentGrantsResearchAgent,
  GOVERNMENT_CATEGORIES,
} from "@/lib/agents/research/government-grants";
import {
  LocalSponsorshipResearchAgent,
  LOCAL_CATEGORIES,
} from "@/lib/agents/research/local-sponsorship";
import { parseAgentSettings } from "@/lib/research/profile-config";
import type { AgentType } from "@/types/agents";
import type { Enums, Json } from "@/types/database";

// Scheduled research sweep (BLUEPRINT §3.1 cron, AGENTS.md Agents 12-15,
// BEHAVIORAL_CONTRACTS §17). Vercel Cron hits this with GET daily at 06:00 UTC
// (see vercel.json); the endpoint itself decides which agents are actually due
// based on each source family's own cadence, so one daily trigger drives both
// the daily (government) and weekly (corporate/foundation/local) schedules.
//
// This is a SYSTEM job: it sweeps EVERY organization via the service-role admin
// client and is gated solely by the server-only CRON_SECRET. It is never
// user-reachable (Contracts §2: service role is for system jobs, never
// user-facing routes — the interactive trigger is POST /api/agents/research).
//
// Per organization (Contracts §17):
//   a. Enforce the daily agent-run quota (research.daily_quota, default 100).
//   b. Select active search profiles whose last_run_at is past the threshold for
//      a given agent family (government: daily; others: weekly), or never run.
//   c. Build the run queue, then execute the agents SEQUENTIALLY (not parallel)
//      so a single org never floods its sources or blows the quota mid-sweep.
//   d. Each agent self-logs to agent_runs and stamps search_profile.last_run_at
//      + results_count via the shared scheduler (markProfileRun) — this route
//      does not double-write those.
//
// Every query is organization_id-scoped manually: under the service-role client
// RLS does NOT protect us (Contracts §2, §15).

export const runtime = "nodejs";
// A sweep runs several agents sequentially, each capped at 60s (AGENTS.md §15).
// Vercel clamps this to the deployment's plan limit; if the function times out
// mid-sweep, unfinished orgs are simply picked up on the next daily run.
export const maxDuration = 300;

type FunderCategory = Enums<"funder_category">;

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

/** Default daily cap on agent runs per org (Contracts §17), overridable. */
const DEFAULT_DAILY_QUOTA = 100;

/** Options every research agent constructor accepts (mirrors the POST route). */
interface ResearchAgentOptions extends BaseAgentOptions {
  model: string;
  maxTokens: number;
}

/** The uniform run input + outcome shape across the four research agents. */
interface ResearchAgent {
  run(input: {
    profileIds?: string[] | null;
  }): Promise<AgentRunOutcome<unknown>>;
}

/** One schedulable research family: its categories, cadence, and constructor. */
interface AgentDef {
  agentType: AgentType;
  categories: readonly FunderCategory[];
  /** Minimum gap between automated runs for profiles in this family. */
  intervalMs: number;
  create(options: ResearchAgentOptions): ResearchAgent;
}

// Cadence per AGENTS.md (federal/government daily; corporate, foundation, and
// local sponsorship weekly). Each family self-selects profiles carrying one of
// its categories.
const AGENT_DEFS: AgentDef[] = [
  {
    agentType: "government_research",
    categories: GOVERNMENT_CATEGORIES,
    intervalMs: DAY_MS,
    create: (o) => new GovernmentGrantsResearchAgent(o),
  },
  {
    agentType: "corporate_research",
    categories: CORPORATE_CATEGORIES,
    intervalMs: WEEK_MS,
    create: (o) => new CorporateGivingResearchAgent(o),
  },
  {
    agentType: "foundation_research",
    categories: FOUNDATION_CATEGORIES,
    intervalMs: WEEK_MS,
    create: (o) => new FoundationGrantsResearchAgent(o),
  },
  {
    agentType: "local_sponsorship",
    categories: LOCAL_CATEGORIES,
    intervalMs: WEEK_MS,
    create: (o) => new LocalSponsorshipResearchAgent(o),
  },
];

/** Minimal active-profile shape the scheduler decisions need. */
interface ProfileRow {
  id: string;
  name: string;
  categories: FunderCategory[] | null;
  is_active: boolean | null;
  last_run_at: string | null;
  // Advanced configuration (migration 011): per-agent enable + schedule, and the
  // negative-filter excluded categories. Drive due-ness per profile per family.
  excluded_categories: FunderCategory[] | null;
  agent_settings: Json | null;
}

/** A planned agent run for one org, before sequential execution. */
interface QueuedJob {
  def: AgentDef;
  profileIds: string[];
  profileNames: string[];
}

/** Per-org result, surfaced in the response for observability. */
interface OrgReport {
  organizationId: string;
  quota: number;
  runsAtStart: number;
  agentsQueued: number;
  agentsRun: number;
  skipped?: string;
  jobs: {
    agentType: AgentType;
    status: "completed" | "failed" | "skipped_quota";
    profiles: string[];
    error?: string;
  }[];
}

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

/** True if a profile is past its family's threshold (or has never run). */
function isDue(lastRunAt: string | null, intervalMs: number): boolean {
  if (!lastRunAt) return true;
  const t = Date.parse(lastRunAt);
  if (!Number.isFinite(t)) return true;
  return Date.now() - t >= intervalMs;
}

/** The profile's categories minus its negative-filter exclusions. */
function effectiveCategoriesOf(profile: ProfileRow): FunderCategory[] {
  const excluded = new Set(profile.excluded_categories ?? []);
  return (profile.categories ?? []).filter((c) => !excluded.has(c));
}

/** True if the profile carries at least one of the family's (non-excluded) categories. */
function matchesFamily(
  profile: ProfileRow,
  categories: readonly FunderCategory[],
): boolean {
  return effectiveCategoriesOf(profile).some((c) => categories.includes(c));
}

/**
 * Whether a profile is due for a family this sweep, honoring its per-agent config
 * (Configuration page): the family must be enabled for the profile, and its
 * last_run_at must be past the profile's own schedule interval (falling back to
 * the family's default cadence).
 */
function profileDueForFamily(profile: ProfileRow, def: AgentDef): boolean {
  if (!matchesFamily(profile, def.categories)) return false;
  const setting = parseAgentSettings(profile.agent_settings)[def.agentType];
  if (setting && setting.enabled === false) return false;
  const intervalHours = setting?.intervalHours ?? null;
  const intervalMs =
    intervalHours && intervalHours > 0
      ? intervalHours * 60 * 60 * 1000
      : def.intervalMs;
  return isDue(profile.last_run_at, intervalMs);
}

/** Count agent_runs created for an org since the start of the current UTC day. */
async function countRunsToday(
  admin: ReturnType<typeof createAdminClient>,
  organizationId: string,
): Promise<number> {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const { count } = await admin
    .from("agent_runs")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .gte("created_at", start.toISOString());
  return count ?? 0;
}

async function runSweep(request: Request) {
  // System-only: gate entirely on the server-only CRON_SECRET. When the secret
  // is unset, the route refuses every call rather than running unauthenticated.
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return jsonError("Unauthorized.", "unauthorized", 401);
  }

  const admin = createAdminClient();

  // Organizations with research agents enabled (Contracts §17 — gated per org).
  const { data: flagRows, error: flagError } = await admin
    .from("platform_config")
    .select("organization_id")
    .eq("key", "feature.research_agents")
    .eq("value", "true");
  if (flagError) {
    return jsonError("Could not load organizations.", "load_failed", 500);
  }

  const orgIds = Array.from(
    new Set(
      (flagRows ?? []).map((r) => r.organization_id as string).filter(Boolean),
    ),
  );

  const reports: OrgReport[] = [];

  for (const organizationId of orgIds) {
    const report = await processOrganization(admin, organizationId);
    reports.push(report);
  }

  const agentsRun = reports.reduce((sum, r) => sum + r.agentsRun, 0);
  return NextResponse.json({
    mode: "cron",
    scope: "all_organizations",
    organizationsScanned: orgIds.length,
    agentsRun,
    organizations: reports,
  });
}

/** Plan and execute the due research agents for a single organization. */
async function processOrganization(
  admin: ReturnType<typeof createAdminClient>,
  organizationId: string,
): Promise<OrgReport> {
  // Org config: daily quota + AI model/tokens (all org-scoped).
  const { data: configRows } = await admin
    .from("platform_config")
    .select("key, value")
    .eq("organization_id", organizationId)
    .in("key", ["research.daily_quota", "ai.model", "ai.max_tokens"]);
  const config = new Map<string, string>(
    (configRows ?? []).map((r) => [r.key as string, r.value as string]),
  );
  const quota = Number(config.get("research.daily_quota")) || DEFAULT_DAILY_QUOTA;
  const model = config.get("ai.model") ?? DEFAULT_MODEL;
  const maxTokens = Number(config.get("ai.max_tokens")) || DEFAULT_MAX_TOKENS;

  const runsAtStart = await countRunsToday(admin, organizationId);

  const base: OrgReport = {
    organizationId,
    quota,
    runsAtStart,
    agentsQueued: 0,
    agentsRun: 0,
    jobs: [],
  };

  // Already at the daily cap — nothing to do (Contracts §17).
  if (runsAtStart >= quota) {
    return { ...base, skipped: "daily_quota_reached" };
  }

  // Active profiles for the org (org-scoped — RLS is off under service role).
  const { data: profileData } = await admin
    .from("search_profiles")
    .select(
      "id, name, categories, is_active, last_run_at, excluded_categories, agent_settings",
    )
    .eq("organization_id", organizationId)
    .eq("is_active", true);
  const profiles = (profileData ?? []) as ProfileRow[];

  if (profiles.length === 0) {
    return { ...base, skipped: "no_active_profiles" };
  }

  // Build the run queue: one job per family that has at least one due profile.
  const queue: QueuedJob[] = [];
  for (const def of AGENT_DEFS) {
    const due = profiles.filter((p) => profileDueForFamily(p, def));
    if (due.length === 0) continue;
    queue.push({
      def,
      profileIds: due.map((p) => p.id),
      profileNames: due.map((p) => p.name),
    });
  }

  base.agentsQueued = queue.length;
  if (queue.length === 0) {
    return { ...base, skipped: "nothing_due" };
  }

  // Execute SEQUENTIALLY (Contracts §17). Re-check the quota before each agent,
  // since each run (plus its eligibility scoring) adds agent_runs rows.
  let agentsRun = 0;
  for (const job of queue) {
    const usedNow = await countRunsToday(admin, organizationId);
    if (usedNow >= quota) {
      base.jobs.push({
        agentType: job.def.agentType,
        status: "skipped_quota",
        profiles: job.profileNames,
      });
      continue;
    }

    const agent = job.def.create({
      client: admin,
      organizationId,
      triggeredBy: null, // automated run
      model,
      maxTokens,
    });

    try {
      // The agent self-logs to agent_runs and stamps the profiles' last_run_at
      // / results_count (scheduler.markProfileRun); we only pass which profiles
      // are due. A failure on one family must not abort the rest of the sweep.
      await agent.run({ profileIds: job.profileIds });
      agentsRun += 1;
      base.jobs.push({
        agentType: job.def.agentType,
        status: "completed",
        profiles: job.profileNames,
      });
    } catch (err) {
      base.jobs.push({
        agentType: job.def.agentType,
        status: "failed",
        profiles: job.profileNames,
        error: err instanceof Error ? err.message : "Agent run failed.",
      });
    }
  }

  base.agentsRun = agentsRun;
  return base;
}

// Vercel Cron issues GET. POST is accepted too for manual/ops invocation behind
// the same secret.
export async function GET(request: Request) {
  return runSweep(request);
}

export async function POST(request: Request) {
  return runSweep(request);
}
