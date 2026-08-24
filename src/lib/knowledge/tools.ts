// Tool registry for the in-app Benavora Assist surface (knw-004).
//
// Every tool reads ONLY the caller's own organization's data. `orgId` always
// comes from the server-derived session (requireRole() in the /api/assist
// route) and is threaded straight into each tool's run() - it is NEVER read
// from the model-supplied `input`, and `runTool` strips any org_id/
// organization_id the model tries to slip into `input` before a tool ever
// sees it (Behavioral Contracts SS2).
//
// Each tool reuses the same org-scoped query surface its sibling API route
// already uses rather than re-deriving new SQL:
//   - list_opportunities  -> opportunities table (see /api/grants route.ts)
//   - upcoming_deadlines  -> deadlines table (see /api/deadlines/check route.ts)
//   - pipeline_summary    -> donor_discovery_prospects (see
//                            /api/donor-discovery/pipeline route.ts)
//   - draft_status        -> DraftQueueEngine.getQueueForOrg (see
//                            /api/drafts/queue/stats route.ts)

import { createClient } from "@/lib/supabase/server";
import { isOpportunityStatus } from "@/lib/grants/grants-service";
import { DraftQueueEngine } from "@/lib/drafts/draft-queue-engine";

export interface ToolResultOpportunity {
  id: string;
  title: string;
  funder: string | null;
  deadline: string | null;
  amount: number | null;
  stage: string | null;
}

export interface ToolResultDeadline {
  title: string;
  date: string;
}

export interface ToolResultPipelineStage {
  stage: string;
  count: number;
}

export interface ToolResultDraft {
  title: string;
  status: string | null;
  updated_at: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  run: (orgId: string, input: Record<string, unknown>) => Promise<unknown>;
}

function assertOrgId(orgId: string): void {
  if (!orgId || typeof orgId !== "string") {
    throw new Error("Tool call missing a valid orgId.");
  }
}

/** Clamp a caller-supplied numeric input to [1, max], falling back to `fallback`. */
function clampInt(value: unknown, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

// Mirrors the stage set in /api/donor-discovery/pipeline/route.ts's
// PIPELINE_STAGES - that route does not export it, so it is duplicated here
// rather than importing a route module.
const DONOR_DISCOVERY_STAGES = [
  "new",
  "reviewing",
  "contacted",
  "applied",
  "received",
  "rejected",
  "archived",
] as const;

interface ListOpportunitiesRow {
  id: string;
  name: string;
  deadline: string | null;
  amount_min: number | null;
  status: string | null;
  funder: { name: string } | { name: string }[] | null;
}

const listOpportunities: ToolDefinition = {
  name: "list_opportunities",
  description:
    "List this organization's opportunities (grants), most urgent deadline first. Optionally filter by status.",
  input_schema: {
    type: "object",
    properties: {
      status: {
        type: "string",
        description: "Filter by opportunity status, e.g. open, applied, closed, expired.",
      },
      limit: {
        type: "number",
        description: "Max rows to return (default 10, max 20).",
      },
    },
  },
  run: async (orgId, input) => {
    assertOrgId(orgId);
    const supabase = createClient();
    const limit = clampInt(input.limit, 20, 10);

    let query = supabase
      .from("opportunities")
      .select("id, name, deadline, amount_min, status, funder:funders(name)")
      .eq("organization_id", orgId);

    const status = typeof input.status === "string" ? input.status : null;
    if (status && isOpportunityStatus(status)) {
      query = query.eq("status", status);
    }

    const { data } = await query
      .order("deadline", { ascending: true, nullsFirst: false })
      .limit(limit);

    const rows = (data ?? []) as unknown as ListOpportunitiesRow[];
    const results: ToolResultOpportunity[] = rows.map((row) => {
      const funderRel = Array.isArray(row.funder) ? row.funder[0] ?? null : row.funder;
      return {
        id: row.id,
        title: row.name,
        funder: funderRel?.name ?? null,
        deadline: row.deadline,
        amount: row.amount_min,
        stage: row.status,
      };
    });
    return { opportunities: results };
  },
};

interface DeadlineRow {
  title: string;
  due_date: string;
}

const upcomingDeadlines: ToolDefinition = {
  name: "upcoming_deadlines",
  description: "List this organization's incomplete deadlines due within the next N days (default 30, max 90).",
  input_schema: {
    type: "object",
    properties: {
      days: {
        type: "number",
        description: "Look-ahead window in days (default 30, max 90).",
      },
    },
  },
  run: async (orgId, input) => {
    assertOrgId(orgId);
    const supabase = createClient();
    const days = clampInt(input.days, 90, 30);

    const now = new Date();
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() + days);

    const { data } = await supabase
      .from("deadlines")
      .select("title, due_date")
      .eq("organization_id", orgId)
      .or("is_completed.is.null,is_completed.eq.false")
      .gte("due_date", now.toISOString())
      .lte("due_date", cutoff.toISOString())
      .order("due_date", { ascending: true });

    const rows = (data ?? []) as DeadlineRow[];
    const results: ToolResultDeadline[] = rows.map((row) => ({
      title: row.title,
      date: row.due_date,
    }));
    return { deadlines: results };
  },
};

const pipelineSummary: ToolDefinition = {
  name: "pipeline_summary",
  description: "Per-stage counts for this organization's Donor Discovery prospect pipeline.",
  input_schema: { type: "object", properties: {} },
  run: async (orgId) => {
    assertOrgId(orgId);
    const supabase = createClient();

    const stageCounts = await Promise.all(
      DONOR_DISCOVERY_STAGES.map(async (stage) => {
        const { count } = await supabase
          .from("donor_discovery_prospects")
          .select("*", { count: "exact", head: true })
          .eq("organization_id", orgId)
          .eq("pipeline_stage", stage);
        return { stage, count: count ?? 0 } as ToolResultPipelineStage;
      }),
    );

    return { stages: stageCounts };
  },
};

const draftStatus: ToolDefinition = {
  name: "draft_status",
  description: "This organization's most recently updated application drafts, with title and status.",
  input_schema: {
    type: "object",
    properties: {
      limit: {
        type: "number",
        description: "Max rows to return (default 5, max 10).",
      },
    },
  },
  run: async (orgId, input) => {
    assertOrgId(orgId);
    const supabase = createClient();
    const limit = clampInt(input.limit, 10, 5);

    const engine = new DraftQueueEngine(supabase);
    const items = await engine.getQueueForOrg(orgId);

    const sorted = [...items].sort(
      (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
    );
    const results: ToolResultDraft[] = sorted.slice(0, limit).map((item) => ({
      title: item.opportunity?.name ?? item.template_type,
      status: item.status,
      updated_at: item.updated_at,
    }));
    return { drafts: results };
  },
};

const TOOLS: ToolDefinition[] = [listOpportunities, upcomingDeadlines, pipelineSummary, draftStatus];

/** Anthropic `tools` array for the Messages API. */
export function toolDefinitions(): { name: string; description: string; input_schema: Record<string, unknown> }[] {
  return TOOLS.map(({ name, description, input_schema }) => ({ name, description, input_schema }));
}

/**
 * Execute a registered tool by name for `orgId`. Strips any org_id/
 * organization_id key the model may have included in `input` - the caller's
 * own session-derived orgId is the only source of tenant scoping, never the
 * model's output.
 */
export async function runTool(
  name: string,
  orgId: string,
  input: Record<string, unknown> | undefined,
): Promise<unknown> {
  assertOrgId(orgId);
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) {
    throw new Error(`Unknown tool: ${name}`);
  }
  const sanitized: Record<string, unknown> = { ...(input ?? {}) };
  delete sanitized.org_id;
  delete sanitized.organization_id;
  return tool.run(orgId, sanitized);
}
