import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

import { AgentRunner, type Agent, type AgentContext } from "@/lib/pil/agent-runner";

/**
 * AR-10.3: two gaps self-reported by the agents that built the surrounding
 * work (AR-5.2, AR-6.2), not discovered later.
 *
 * GAP 1 - AgentRunner.run() called checkBudget() exactly once, before an
 * agent started, with no mid-run polling anywhere -- a single long agent run
 * could overrun a hard_stop budget without limit. Fixed by checkBudgetMidRun()
 * (src/lib/pil/cost.ts), called from AgentRunner.useTool() right after each
 * tool/LLM call's own cost lands, so a run that crosses the limit is stopped
 * before its NEXT call.
 *
 * GAP 2 - Rule 2's cost_overage dedup key was (scope_type, scope_id) with no
 * budget-period component. Once cost_budgets gained a real period/reset
 * (migration 198), a genuine new period's overage would carry the identical
 * dedup_key as the prior period's already-resolved alert and be silently
 * dropped by uq_alerts_org_dedup. Fixed by folding period_start into the key.
 *
 * ASSERTION 1 exercises the full real AgentRunner.run() path end to end
 * (real pil_agent_registry row BEN-DIS-01, real policy/authorization checks,
 * real pil_agent_runs row) against the live database, not a mock -- the
 * mid-run gate only means something if it is proven inside the actual
 * closed-loop harness, not just as a unit around checkBudgetMidRun().
 * ASSERTIONS 2/3 exercise the DB triggers directly (accrue_cost_budget_spend,
 * alert_rule_cost_overage), the same way orchestration-alert-rules.test.ts
 * asserts Rule 2's original behavior.
 *
 * Runs against the real project configured in `.env.local`, matching every
 * other suite in this directory. Every row created here is deleted in
 * `afterAll` via try/catch (not `.catch()`), per project memory
 * (benavora-integration-test-catch-bug-leaks-prod-rows).
 */

function createClient(url: string, key: string, opts: Record<string, unknown> = {}): SupabaseClient {
  return createSupabaseClient(url, key, {
    ...opts,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    realtime: { transport: ws as any },
  }) as unknown as SupabaseClient;
}

function loadLocalEnv(): Record<string, string> {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return {};
  return dotenv.parse(fs.readFileSync(envPath));
}

const localEnv = loadLocalEnv();
const SUPABASE_URL = localEnv.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = localEnv.SUPABASE_SERVICE_ROLE_KEY;
const CREDS_AVAILABLE = Boolean(SUPABASE_URL && SERVICE_ROLE_KEY);

// AgentRunner -> checkBudgetMidRun()/checkBudget() -> getPilClient() ->
// createAdminClient() reads process.env directly, which tests/setup.ts has
// already pointed at .env.test's local-Supabase placeholder by the time this
// file runs.
if (SUPABASE_URL) process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
if (SERVICE_ROLE_KEY) process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_ROLE_KEY;

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}

// A real, seeded, active agent_id (migration 155) at A2 -- clears
// checkAgentAuthorization's "write_evidence" (A1) floor with no
// execute_policy_bounded human-review boundary in the way. Explicitly
// registering a stub implementation for it (per AgentRunner's own doc
// comment: "used by tests to stub an agent") makes AgentRunner.run() run
// this test's probe loop instead of BEN-DIS-01's real discovery logic, while
// every other part of the closed-loop harness -- authorization, the
// pil_agent_runs row lifecycle, useTool()'s cost recording -- runs for real.
const STUB_AGENT_CODE = "BEN-DIS-01";
const PROBE_TOOL = "budget-teeth-probe";

(CREDS_AVAILABLE ? describe : describe.skip)("Budget teeth (AR-10.3) — mid-run enforcement and period-scoped dedup", () => {
  let service: SupabaseClient;
  const tag = randomSuffix();
  const orgIds: string[] = [];

  beforeAll(() => {
    service = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const probeAgent: Agent = {
      async execute(context, runner) {
        const calls = (context.plan.calls as number) ?? 1;
        const costPerCall = (context.plan.costPerCall as number) ?? 1;
        for (let i = 0; i < calls; i++) {
          await runner.useTool(context, PROBE_TOOL, {
            unitCost: costPerCall,
            units: 1,
            costType: "api_call",
            model: "claude-test",
          });
        }
        return {
          status: "completed",
          evidence: [],
          conclusions: { callsCompleted: calls },
          delegations: [],
          tokensUsed: 0,
          costUsd: calls * costPerCall,
          error: null,
        };
      },
    };
    AgentRunner.registerImplementation(STUB_AGENT_CODE, probeAgent);
  });

  afterAll(async () => {
    if (!service || orgIds.length === 0) return;
    // alerts.organization_id has no ON DELETE CASCADE (migration 013);
    // ai_usage_log likewise (migration 056) -- both must be cleared before
    // organizations. cost_budgets does cascade (migration 158) but is
    // deleted explicitly anyway, matching budget-accrual.test.ts. Everything
    // AgentRunner.run() itself writes (pil_agent_runs, pil_policy_decisions,
    // pil_audit_log) does cascade from organizations, per migrations
    // 155/159.
    try {
      await service.from("alerts").delete().in("organization_id", orgIds);
    } catch {
      // best-effort cleanup
    }
    try {
      await service.from("ai_usage_log").delete().in("organization_id", orgIds);
    } catch {
      // best-effort cleanup
    }
    try {
      await service.from("platform_config").delete().in("organization_id", orgIds);
    } catch {
      // best-effort cleanup
    }
    try {
      await service.from("cost_budgets").delete().in("organization_id", orgIds);
    } catch {
      // best-effort cleanup
    }
    try {
      await service.from("organizations").delete().in("id", orgIds);
    } catch {
      // best-effort cleanup
    }
  });

  async function createOrg(name: string): Promise<string> {
    const { data, error } = await service
      .from("organizations")
      .insert({ name, mission_statement: "Budget teeth test fixture.", onboarding_progress: {} })
      .select()
      .single();
    expect(error, error?.message).toBeNull();
    const id = data!.id as string;
    orgIds.push(id);
    return id;
  }

  it(
    "ASSERTION 1: a run exceeding a hard_stop budget mid-flight is stopped before its next call, and records why",
    async () => {
      const orgId = await createOrg(`BUDGET_TEETH_1_${tag}`);

      const { error: budgetErr } = await service.from("cost_budgets").insert({
        organization_id: orgId,
        scope_type: "org",
        scope_id: orgId,
        budget_period: "daily",
        budget_limit_usd: 10,
        spent_usd: 0,
        hard_stop: true,
      });
      expect(budgetErr, budgetErr?.message).toBeNull();

      const context: AgentContext = {
        agentCode: STUB_AGENT_CODE,
        orgId,
        prospectId: null,
        // pil_agent_runs.research_run_id is a nullable FK to pil_research_runs
        // (migration 155) -- null avoids needing a real research-run fixture.
        runId: null as unknown as string,
        goal: "AR-10.3 budget teeth probe",
        plan: { calls: 5, costPerCall: 6 },
        tools: [PROBE_TOOL],
        budget: 1000,
        depth: 0,
      };

      const result = await new AgentRunner().run(context);

      // The 3rd call (spend would reach $18) is never attempted -- the run
      // is stopped after the 2nd call pushes spend from $6 to $12, past the
      // $10 hard_stop limit.
      expect(result.status).toBe("failed");
      expect(result.error).toContain("Mid-run budget check failed");
      expect(result.error).toContain("hard_stop enabled");

      const { data: usageRows, error: usageErr } = await service
        .from("ai_usage_log")
        .select("cost_usd")
        .eq("organization_id", orgId)
        .eq("agent_type", PROBE_TOOL);
      expect(usageErr, usageErr?.message).toBeNull();
      expect(usageRows).toHaveLength(2);

      const { data: runRows, error: runErr } = await service
        .from("pil_agent_runs")
        .select("status, error")
        .eq("organization_id", orgId)
        .eq("agent_id", STUB_AGENT_CODE);
      expect(runErr, runErr?.message).toBeNull();
      expect(runRows).toHaveLength(1);
      expect(runRows![0]!.status).toBe("failed");
      expect(runRows![0]!.error as string).toContain("hard_stop enabled");

      const { data: budget, error: budgetReadErr } = await service
        .from("cost_budgets")
        .select("spent_usd")
        .eq("organization_id", orgId)
        .eq("scope_type", "org")
        .eq("scope_id", orgId)
        .single();
      expect(budgetReadErr, budgetReadErr?.message).toBeNull();
      expect(Number(budget!.spent_usd)).toBeCloseTo(12, 6);
    },
    30000,
  );

  it(
    "ASSERTION 2: a new period's overage raises a NEW alert rather than colliding with the prior period's",
    async () => {
      const orgId = await createOrg(`BUDGET_TEETH_2_${tag}`);
      const longElapsedPeriodStart = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

      // Simulate a budget whose daily period elapsed 1+ day ago, already
      // over its limit -- inserting this raises the FIRST cost_overage alert,
      // keyed on the (now stale) period_start.
      const { error: budgetErr } = await service.from("cost_budgets").insert({
        organization_id: orgId,
        scope_type: "org",
        scope_id: orgId,
        budget_period: "daily",
        budget_limit_usd: 10,
        spent_usd: 10,
        hard_stop: true,
        period_start: longElapsedPeriodStart,
      });
      expect(budgetErr, budgetErr?.message).toBeNull();

      const { data: firstAlerts, error: firstAlertsErr } = await service
        .from("alerts")
        .select("dedup_key")
        .eq("organization_id", orgId)
        .eq("type", "cost_overage");
      expect(firstAlertsErr, firstAlertsErr?.message).toBeNull();
      expect(firstAlerts).toHaveLength(1);
      const firstDedupKey = firstAlerts![0]!.dedup_key as string;
      expect(firstDedupKey).toContain(`cost_overage:org:${orgId}`);

      // New spend lands after the period has elapsed -- accrue_cost_budget_spend()
      // (migration 198) rolls period_start forward and starts the new
      // period's spend at exactly this amount rather than piling onto the
      // stale total.
      const { error: costErr } = await service.from("ai_usage_log").insert({
        organization_id: orgId,
        model: "claude-test",
        endpoint: "model_tokens",
        cost_usd: 15,
      });
      expect(costErr, costErr?.message).toBeNull();

      const { data: budgetAfter, error: budgetAfterErr } = await service
        .from("cost_budgets")
        .select("spent_usd, period_start")
        .eq("organization_id", orgId)
        .eq("scope_type", "org")
        .eq("scope_id", orgId)
        .single();
      expect(budgetAfterErr, budgetAfterErr?.message).toBeNull();
      // Rolled, not accumulated: 15, not 10 + 15 = 25.
      expect(Number(budgetAfter!.spent_usd)).toBeCloseTo(15, 6);
      expect(budgetAfter!.period_start).not.toBe(longElapsedPeriodStart);

      const { data: allAlerts, error: allAlertsErr } = await service
        .from("alerts")
        .select("dedup_key")
        .eq("organization_id", orgId)
        .eq("type", "cost_overage");
      expect(allAlertsErr, allAlertsErr?.message).toBeNull();
      expect(allAlerts).toHaveLength(2);
      const dedupKeys = allAlerts!.map((row) => row.dedup_key as string);
      expect(new Set(dedupKeys).size).toBe(2);
    },
    30000,
  );

  it(
    "ASSERTION 3: a second overage within the SAME period still dedups to one alert",
    async () => {
      const orgId = await createOrg(`BUDGET_TEETH_3_${tag}`);

      const { error: budgetErr } = await service.from("cost_budgets").insert({
        organization_id: orgId,
        scope_type: "org",
        scope_id: orgId,
        budget_period: "daily",
        budget_limit_usd: 10,
        spent_usd: 10,
        hard_stop: true,
        // period_start left at its DEFAULT now() -- current, unexpired period.
      });
      expect(budgetErr, budgetErr?.message).toBeNull();

      const { data: firstAlerts, error: firstAlertsErr } = await service
        .from("alerts")
        .select("dedup_key")
        .eq("organization_id", orgId)
        .eq("type", "cost_overage");
      expect(firstAlertsErr, firstAlertsErr?.message).toBeNull();
      expect(firstAlerts).toHaveLength(1);

      // More spend in the SAME (unexpired) period pushes it further over --
      // still the same dedup_key, so ON CONFLICT (organization_id, dedup_key)
      // DO NOTHING must keep this at one row, not two.
      const { error: costErr } = await service.from("ai_usage_log").insert({
        organization_id: orgId,
        model: "claude-test",
        endpoint: "model_tokens",
        cost_usd: 5,
      });
      expect(costErr, costErr?.message).toBeNull();

      const { data: alertsAfter, error: alertsAfterErr } = await service
        .from("alerts")
        .select("dedup_key")
        .eq("organization_id", orgId)
        .eq("type", "cost_overage");
      expect(alertsAfterErr, alertsAfterErr?.message).toBeNull();
      expect(alertsAfter).toHaveLength(1);
      expect(alertsAfter![0]!.dedup_key).toBe(firstAlerts![0]!.dedup_key);
    },
    30000,
  );
});

if (!CREDS_AVAILABLE) {
  // eslint-disable-next-line no-console
  console.warn(
    "[budget-teeth.test] skipped entirely — .env.local is missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY",
  );
}
