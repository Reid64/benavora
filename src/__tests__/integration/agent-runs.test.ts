import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

// Node 20 has no native WebSocket; mirrors the workaround in
// src/lib/supabase/admin.ts and the other suites in this directory — without
// it, supabase-js's realtime client (constructed eagerly by createClient
// regardless of whether it's used) throws immediately.
function createClient(url: string, key: string, opts: Record<string, unknown> = {}): SupabaseClient {
  return createSupabaseClient(url, key, {
    ...opts,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    realtime: { transport: ws as any },
  }) as unknown as SupabaseClient;
}

/**
 * agent_runs lifecycle + org scoping (TESTING_v2.md §2.1 original intent).
 *
 * Columns and the `agent_type`/`agent_run_status` enums below were verified
 * against a live PostgREST OpenAPI introspection of `agent_runs` on
 * 2026-07-30, not assumed from SCHEMA_REGISTRY_v2.md — that document's own
 * header admits its table list is stale. One live divergence worth calling
 * out: `agent_type` is a strict Postgres enum with ~30 fixed values
 * (corporate_research, foundation_research, ... consensus_validation).
 * Per project memory `benavora-agent-type-enum-gap`, several worker-inserted
 * ids (`ag-25-deadline-prediction`, `ag-28-followup`, `autonomous_orchestrator`)
 * were never added to this enum — confirmed live below with
 * `autonomous_orchestrator`, which still fails with Postgres error 22P02.
 *
 * Runs against the real project configured in `.env.local` (there is no
 * separate test Supabase project — `.env.test` points at a stack that isn't
 * running, matching the other suites in this directory). Every row created
 * here is deleted in `afterAll`.
 */

function loadLocalEnv(): Record<string, string> {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return {};
  return dotenv.parse(fs.readFileSync(envPath));
}

const localEnv = loadLocalEnv();
const SUPABASE_URL = localEnv.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = localEnv.SUPABASE_SERVICE_ROLE_KEY;
const CREDS_AVAILABLE = Boolean(SUPABASE_URL && SERVICE_ROLE_KEY);

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}

(CREDS_AVAILABLE ? describe : describe.skip)("agent_runs lifecycle and org scoping", () => {
  let service: SupabaseClient;
  let orgAId: string;
  let orgBId: string;
  const createdRunIds: string[] = [];

  beforeAll(async () => {
    service = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const tag = randomSuffix();
    const { data: orgA, error: orgAErr } = await service
      .from("organizations")
      .insert({ name: `AGENT_RUNS_TEST_ORG_A_${tag}`, onboarding_progress: {} })
      .select()
      .single();
    if (orgAErr || !orgA) throw new Error(`Failed to create test org A: ${orgAErr?.message}`);
    orgAId = orgA.id as string;

    const { data: orgB, error: orgBErr } = await service
      .from("organizations")
      .insert({ name: `AGENT_RUNS_TEST_ORG_B_${tag}`, onboarding_progress: {} })
      .select()
      .single();
    if (orgBErr || !orgB) throw new Error(`Failed to create test org B: ${orgBErr?.message}`);
    orgBId = orgB.id as string;
  }, 30000);

  afterAll(async () => {
    if (!service) return;
    if (createdRunIds.length > 0) {
      // supabase-js's PostgrestFilterBuilder in the pinned version here is
      // thenable but does not implement .catch()/.finally() — chaining
      // .catch() throws synchronously ("...is not a function") rather than
      // suppressing a rejection, so cleanup best-effort calls use try/catch.
      try {
        await service.from("agent_runs").delete().in("id", createdRunIds);
      } catch {
        // best-effort cleanup
      }
    }
    for (const orgId of [orgAId, orgBId]) {
      if (!orgId) continue;
      try {
        await service.from("platform_config").delete().match({ organization_id: orgId });
      } catch {
        // best-effort cleanup
      }
      const { error } = await service.from("organizations").delete().match({ id: orgId });
      if (error) {
        // eslint-disable-next-line no-console
        console.warn(`[agent-runs.test] cleanup failed for org ${orgId}: ${error.message}`);
      }
    }
  }, 30000);

  it("defaults status to 'pending' and numeric counters to 0 on insert", async () => {
    const { data, error } = await service
      .from("agent_runs")
      .insert({ organization_id: orgAId, agent_type: "corporate_research" })
      .select()
      .single();
    expect(error, error?.message).toBeNull();
    expect(data).not.toBeNull();
    createdRunIds.push(data!.id as string);

    expect(data!.status).toBe("pending");
    expect(data!.items_found).toBe(0);
    expect(data!.items_processed).toBe(0);
    expect(data!.items_queued).toBe(0);
    expect(data!.trigger_source).toBe("manual");
    expect(data!.created_at).toBeTruthy();
    expect(data!.started_at).toBeNull();
    expect(data!.completed_at).toBeNull();
  });

  it("transitions pending -> running -> completed, persisting fields written at each stage", async () => {
    const { data: created, error: createErr } = await service
      .from("agent_runs")
      .insert({ organization_id: orgAId, agent_type: "eligibility_scoring" })
      .select()
      .single();
    expect(createErr, createErr?.message).toBeNull();
    const runId = created!.id as string;
    createdRunIds.push(runId);
    expect(created!.status).toBe("pending");

    const startedAt = new Date().toISOString();
    const { data: running, error: runningErr } = await service
      .from("agent_runs")
      .update({ status: "running", started_at: startedAt })
      .eq("id", runId)
      .select()
      .single();
    expect(runningErr, runningErr?.message).toBeNull();
    expect(running!.status).toBe("running");
    expect(running!.started_at).toBeTruthy();

    const completedAt = new Date().toISOString();
    const { data: completed, error: completedErr } = await service
      .from("agent_runs")
      .update({
        status: "completed",
        completed_at: completedAt,
        output_summary: "Found 12 matching corporate prospects.",
        items_found: 12,
        items_processed: 12,
        tokens_used: 4200,
        duration_ms: 8300,
        confidence_score: 82,
      })
      .eq("id", runId)
      .select()
      .single();
    expect(completedErr, completedErr?.message).toBeNull();
    expect(completed!.status).toBe("completed");
    expect(completed!.completed_at).toBeTruthy();
    expect(completed!.output_summary).toBe("Found 12 matching corporate prospects.");
    expect(completed!.items_found).toBe(12);
    expect(completed!.items_processed).toBe(12);
    expect(completed!.tokens_used).toBe(4200);
    expect(completed!.duration_ms).toBe(8300);
    expect(completed!.confidence_score).toBe(82);

    // Round-trip: reselect by id and confirm the persisted row matches.
    const { data: reselected, error: reselectErr } = await service
      .from("agent_runs")
      .select("*")
      .eq("id", runId)
      .single();
    expect(reselectErr, reselectErr?.message).toBeNull();
    expect(reselected!.status).toBe("completed");
  });

  it("transitions pending -> failed, persisting error_message", async () => {
    const { data: created, error: createErr } = await service
      .from("agent_runs")
      .insert({ organization_id: orgAId, agent_type: "government_research" })
      .select()
      .single();
    expect(createErr, createErr?.message).toBeNull();
    createdRunIds.push(created!.id as string);

    const { data: failed, error: failedErr } = await service
      .from("agent_runs")
      .update({ status: "failed", error_message: "SAM.gov API returned 503 after 3 retries." })
      .eq("id", created!.id)
      .select()
      .single();
    expect(failedErr, failedErr?.message).toBeNull();
    expect(failed!.status).toBe("failed");
    expect(failed!.error_message).toBe("SAM.gov API returned 503 after 3 retries.");
  });

  it("rejects an agent_type not present in the live enum — reproduces the documented enum gap", async () => {
    // 'autonomous_orchestrator' was the original probe value here (a
    // worker-inserted id never added to the agent_type enum). Commit
    // c7779b9 (2026-07-31, "docs: agent_type enum gap analysis and fix,
    // governance update", fix-agent-type-enum-gap.sql) added it to the live
    // enum via `ALTER TYPE agent_type ADD VALUE IF NOT EXISTS
    // 'autonomous_orchestrator'` — inserting it now succeeds, which is the
    // intended fixed behavior, not a regression. Switched to a value
    // guaranteed to stay outside the enum so this test keeps documenting
    // the real invariant (an unrecognized agent_type is rejected) instead
    // of a specific value's now-stale history.
    const { data, error } = await service
      .from("agent_runs")
      .insert({ organization_id: orgAId, agent_type: "nonexistent_agent_type_probe" })
      .select()
      .single();
    expect(data).toBeNull();
    expect(error).not.toBeNull();
    expect(error!.code).toBe("22P02");
    expect(error!.message).toContain("nonexistent_agent_type_probe");
  });

  it("query by agent_type returns only matching rows", async () => {
    const tag = randomSuffix();
    const { data: narrative, error: narrativeErr } = await service
      .from("agent_runs")
      .insert({ organization_id: orgAId, agent_type: "narrative_drafting", output_summary: `filter-probe-${tag}` })
      .select()
      .single();
    expect(narrativeErr, narrativeErr?.message).toBeNull();
    createdRunIds.push(narrative!.id as string);

    const { data: budget, error: budgetErr } = await service
      .from("agent_runs")
      .insert({ organization_id: orgAId, agent_type: "budget_builder", output_summary: `filter-probe-${tag}` })
      .select()
      .single();
    expect(budgetErr, budgetErr?.message).toBeNull();
    createdRunIds.push(budget!.id as string);

    const { data: matches, error: queryErr } = await service
      .from("agent_runs")
      .select("id, agent_type")
      .eq("organization_id", orgAId)
      .eq("agent_type", "narrative_drafting")
      .eq("output_summary", `filter-probe-${tag}`);
    expect(queryErr, queryErr?.message).toBeNull();
    expect(matches).toHaveLength(1);
    expect(matches![0]!.id).toBe(narrative!.id);
    expect(matches!.every((row) => row.agent_type === "narrative_drafting")).toBe(true);
  });

  it("org scoping: a query filtered to org A's id never returns org B's runs", async () => {
    const tag = randomSuffix();
    const { data: runA, error: runAErr } = await service
      .from("agent_runs")
      .insert({ organization_id: orgAId, agent_type: "funder_intel", output_summary: `scope-probe-${tag}` })
      .select()
      .single();
    expect(runAErr, runAErr?.message).toBeNull();
    createdRunIds.push(runA!.id as string);

    const { data: runB, error: runBErr } = await service
      .from("agent_runs")
      .insert({ organization_id: orgBId, agent_type: "funder_intel", output_summary: `scope-probe-${tag}` })
      .select()
      .single();
    expect(runBErr, runBErr?.message).toBeNull();
    createdRunIds.push(runB!.id as string);

    const { data: scopedToA, error: scopedErr } = await service
      .from("agent_runs")
      .select("id, organization_id")
      .eq("organization_id", orgAId)
      .eq("output_summary", `scope-probe-${tag}`);
    expect(scopedErr, scopedErr?.message).toBeNull();
    expect(scopedToA).toHaveLength(1);
    expect(scopedToA![0]!.id).toBe(runA!.id);
    expect(scopedToA!.some((row) => row.id === runB!.id)).toBe(false);
  });
});

if (!CREDS_AVAILABLE) {
  // eslint-disable-next-line no-console
  console.warn(
    "[agent-runs.test] skipped entirely — .env.local is missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY",
  );
}
