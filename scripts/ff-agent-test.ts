// ============================================================================
// BENAVORA — Faith Foundation autonomous pipeline manual trigger
//
// Runs the full autonomous agent chain for org
// b1ab7402-dfc2-4712-869f-70ea3566cc1d in sequence, logging real output from
// each step (agent run id, item counts, timing, and the specific derived
// facts the task asked for — avg score, "any >= 70", "any critical", "any
// immediate"). Every step is independently try/caught: a failure in one step
// (most likely an `agent_type` enum gap — see notes below) is logged and the
// script continues to the next step rather than aborting, so this always
// reports the true end-to-end state of the pipeline instead of stopping at
// the first broken link.
//
// Known risk, checked against real migration state before writing this
// (not assumed from the task's literal step list):
//   - `agent_runs.agent_type` is a strict Postgres enum (migration 001,
//     extended piecemeal since). Of the six agent ids this script invokes,
//     three (`ag-29-fundability`, `ag-35-community-need`,
//     `ag-40-strategic-advisor`) already have a committed, presumably-applied
//     `ALTER TYPE ... ADD VALUE` migration (091, 090, 086). The other three
//     do not:
//       - `ag-17-discovery` (OpportunityDiscoveryAgent) — its enum value only
//         exists in src/supabase/migrations/101_orchestrator_enterprise_hardening.sql,
//         which is untracked in git as of this writing and has not been
//         confirmed applied to the live database.
//       - `ag-02` (EligibilityScoringAgent) and `ag-15-probability`
//         (ProbabilityScoringAgent) have no `ALTER TYPE` migration anywhere
//         in the repo at all — probability-scoring-agent.ts's own header
//         comment flags this exact gap as unresolved.
//     `AutonomousAgent.startRun()` is called before any try/catch inside
//     each agent's own `run()`, so a rejected enum value throws straight out
//     of `.run()` with no `agent_runs` row ever written. This script does
//     not work around that — it reports whatever actually happens, per
//     CLAUDE.md Iron Law #3 (never fabricate a test result).
//
// Step 4 (FundabilityScorerAgent) is scoped to "opportunities with
// eligibility_score >= 65" as the task specifies. FundabilityScorerAgent has
// no such filter built into its default scope (it scores every open,
// not-yet-scored opportunity org-wide) — its real "narrow scope" entry point
// is the `chain` trigger, which reads `opportunityIds` off an `agent_queue`
// row this agent's own upstream caller (ProbabilityScoringAgent, at
// overall_score 65-79) would normally have inserted. This script reproduces
// that exact real mechanism manually: it queries the qualifying opportunity
// ids itself, inserts one `agent_queue` row with status `processing` (mirrors
// what `claimNextQueueItem()` in worker/autonomous-orchestrator.ts does right
// before routing), calls the agent with `triggerSource: "chain"`, and then
// closes out that queue row's status — rather than silently reusing the
// agent's org-wide default scope, which would score opportunities outside
// the requested condition.
//
//   npx tsx scripts/ff-agent-test.ts
// ============================================================================

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";

import { OpportunityDiscoveryAgent } from "../src/lib/agents/opportunity-discovery-agent";
import { EligibilityScoringAgent } from "../src/lib/agents/eligibility-scoring-agent";
import { ProbabilityScoringAgent } from "../src/lib/agents/probability-scoring-agent";
import { FundabilityScorerAgent } from "../src/lib/agents/fundability-scorer-agent";
import { CommunityNeedPredictorAgent } from "../src/lib/agents/community-need-predictor-agent";
import { StrategicAdvisorAgent } from "../src/lib/agents/strategic-advisor-agent";

const FAITH_FOUNDATION_ORG_ID = "b1ab7402-dfc2-4712-869f-70ea3566cc1d";
const ELIGIBILITY_CHAIN_THRESHOLD = 65;

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function section(n: string, title: string): void {
  console.log("\n" + "-".repeat(78));
  console.log(`[${n}] ${title}`);
  console.log("-".repeat(78));
}

function log(line: string): void {
  console.log(`  ${line}`);
}

async function latestRun(
  admin: SupabaseClient,
  agentType: string,
): Promise<{
  id: string;
  status: string;
  error_message: string | null;
  output_payload: Record<string, unknown> | null;
} | null> {
  const { data } = await admin
    .from("agent_runs")
    .select("id, status, error_message, output_payload")
    .eq("organization_id", FAITH_FOUNDATION_ORG_ID)
    .eq("agent_type", agentType)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as never) ?? null;
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    console.error(
      "\nFATAL: Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local",
    );
    process.exit(1);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    realtime: { transport: ws as any },
  });

  console.log("=".repeat(78));
  console.log("Faith Foundation autonomous pipeline test — org", FAITH_FOUNDATION_ORG_ID);
  console.log("=".repeat(78));

  // --------------------------------------------------------------------
  // SECTION 0 — Preflight: confirm scripts/ff-setup.ts ran successfully
  // --------------------------------------------------------------------
  section("0/6", "Preflight — confirm scripts/ff-setup.ts ran successfully");
  try {
    const { data: orgRow, error: orgErr } = await admin
      .from("organizations")
      .select("id, name, onboarding_completed")
      .eq("id", FAITH_FOUNDATION_ORG_ID)
      .maybeSingle();
    if (orgErr || !orgRow) {
      log(`WARNING: could not load organization row: ${orgErr?.message ?? "not found"}`);
    } else {
      log(`organizations.onboarding_completed = ${orgRow.onboarding_completed} (expected true)`);
    }

    const { data: cfgRow } = await admin
      .from("org_autonomous_config")
      .select("auto_research_enabled, auto_score_enabled, auto_draft_enabled")
      .eq("org_id", FAITH_FOUNDATION_ORG_ID)
      .maybeSingle();
    log(
      `org_autonomous_config row present: ${!!cfgRow}` +
        (cfgRow
          ? ` (auto_research_enabled=${cfgRow.auto_research_enabled}, auto_score_enabled=${cfgRow.auto_score_enabled}, auto_draft_enabled=${cfgRow.auto_draft_enabled})`
          : " — ff-setup.ts has not run, or the upsert failed"),
    );

    const { data: kbRows } = await admin
      .from("knowledge_base")
      .select("id")
      .eq("organization_id", FAITH_FOUNDATION_ORG_ID)
      .eq("category", "program_description");
    log(`knowledge_base program_description entries: ${kbRows?.length ?? 0} (expected 9)`);

    const setupRanSuccessfully =
      !!orgRow?.onboarding_completed && !!cfgRow && (kbRows?.length ?? 0) === 9;
    log(
      setupRanSuccessfully
        ? "CONFIRMED: scripts/ff-setup.ts ran successfully — all three effects are present."
        : "WARNING: scripts/ff-setup.ts effects are incomplete or missing — see fields above.",
    );
  } catch (err) {
    log(`FAILED preflight check: ${errMsg(err)}`);
  }

  // --------------------------------------------------------------------
  // 1. OPPORTUNITY DISCOVERY
  // --------------------------------------------------------------------
  section("1/6", "OpportunityDiscoveryAgent (ag-17-discovery)");
  {
    const t0 = Date.now();
    try {
      const agent = new OpportunityDiscoveryAgent(FAITH_FOUNDATION_ORG_ID, admin);
      const result = await agent.run("manual");
      const durationMs = Date.now() - t0;
      const run = await latestRun(admin, "ag-17-discovery");
      log(`Agent run ID: ${run?.id ?? "(no agent_runs row written)"}`);
      log(`Items found: ${result.itemsFound}`);
      log(`Time taken: ${durationMs}ms`);
      if (result.errors.length > 0) log(`Errors: ${result.errors.join(" | ")}`);
    } catch (err) {
      const durationMs = Date.now() - t0;
      log(`FAILED after ${durationMs}ms: ${errMsg(err)}`);
    }
  }

  // --------------------------------------------------------------------
  // 2. ELIGIBILITY SCORING
  // --------------------------------------------------------------------
  section("2/6", "EligibilityScoringAgent (ag-02)");
  {
    try {
      const agent = new EligibilityScoringAgent(FAITH_FOUNDATION_ORG_ID, admin);
      const result = await agent.run("manual");

      const { data: scoreRows } = await admin
        .from("opportunities")
        .select("eligibility_score")
        .eq("organization_id", FAITH_FOUNDATION_ORG_ID)
        .not("eligibility_score", "is", null);
      const scores = (scoreRows ?? [])
        .map((r) => r.eligibility_score as number | null)
        .filter((n): n is number => typeof n === "number");
      const avg = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null;

      log(`Opportunities scored this run: ${result.itemsProcessed} (of ${result.itemsFound} candidates)`);
      log(
        `Avg eligibility score, org-wide across all scored opportunities: ${
          avg !== null ? avg.toFixed(1) : "n/a (none scored yet)"
        } (n=${scores.length})`,
      );
      if (result.errors.length > 0) log(`Errors: ${result.errors.join(" | ")}`);
    } catch (err) {
      log(`FAILED: ${errMsg(err)}`);
    }
  }

  // --------------------------------------------------------------------
  // 3. PROBABILITY SCORING
  // --------------------------------------------------------------------
  section("3/6", "ProbabilityScoringAgent (ag-15-probability)");
  {
    try {
      const agent = new ProbabilityScoringAgent(FAITH_FOUNDATION_ORG_ID, admin);
      const result = await agent.run("manual");

      const { data: probRows } = await admin
        .from("opportunity_probability_scores")
        .select("overall_score")
        .eq("organization_id", FAITH_FOUNDATION_ORG_ID);
      const scores = (probRows ?? [])
        .map((r) => r.overall_score as number | null)
        .filter((n): n is number => typeof n === "number");
      const above70 = scores.filter((s) => s >= 70);

      log(`Scores generated this run: ${result.itemsProcessed} (of ${result.itemsFound} candidates)`);
      log(
        `Any opportunity_probability_scores.overall_score >= 70 org-wide: ${above70.length > 0} ` +
          `(${above70.length} of ${scores.length} total)`,
      );
      if (result.errors.length > 0) log(`Errors: ${result.errors.join(" | ")}`);
    } catch (err) {
      log(`FAILED: ${errMsg(err)}`);
    }
  }

  // --------------------------------------------------------------------
  // 4. FUNDABILITY SCORING — opportunities with eligibility_score >= 65
  // --------------------------------------------------------------------
  section("4/6", "FundabilityScorerAgent (ag-29-fundability) — eligibility_score >= 65");
  {
    try {
      const { data: eligibleOpps, error: eligErr } = await admin
        .from("opportunities")
        .select("id, name")
        .eq("organization_id", FAITH_FOUNDATION_ORG_ID)
        .gte("eligibility_score", ELIGIBILITY_CHAIN_THRESHOLD);
      if (eligErr) throw new Error(`Failed to query qualifying opportunities: ${eligErr.message}`);

      const oppIds = (eligibleOpps ?? []).map((o) => o.id as string);
      log(`Opportunities with eligibility_score >= ${ELIGIBILITY_CHAIN_THRESHOLD}: ${oppIds.length}`);

      if (oppIds.length === 0) {
        log("Skipping FundabilityScorer run — no qualifying opportunities.");
      } else {
        let queueId: string | null = null;
        try {
          const { data: queueRow, error: queueErr } = await admin
            .from("agent_queue")
            .insert({
              org_id: FAITH_FOUNDATION_ORG_ID,
              agent_id: "ag-29-fundability",
              priority: 9,
              status: "processing",
              trigger_source: "chain",
              input_payload: { opportunityIds: oppIds },
              started_at: new Date().toISOString(),
            })
            .select("id")
            .single();
          if (queueErr || !queueRow) {
            throw new Error(`agent_queue insert failed: ${queueErr?.message ?? "no row returned"}`);
          }
          queueId = queueRow.id as string;

          const agent = new FundabilityScorerAgent(FAITH_FOUNDATION_ORG_ID, admin);
          const result = await agent.run("chain");

          const run = await latestRun(admin, "ag-29-fundability");
          const payload = (run?.output_payload ?? {}) as {
            totalDeficiencies?: number;
            autoFixed?: number;
            manualRequired?: number;
          };

          log(`Opportunities analyzed: ${result.itemsProcessed} (of ${result.itemsFound} in scope)`);
          log(
            `Deficiencies found: ${payload.totalDeficiencies ?? "n/a"}; ` +
              `auto-fixed: ${payload.autoFixed ?? "n/a"}; manual required: ${payload.manualRequired ?? "n/a"}`,
          );
          if (result.errors.length > 0) log(`Errors: ${result.errors.join(" | ")}`);

          await admin
            .from("agent_queue")
            .update({
              status: result.success ? "completed" : "failed",
              completed_at: new Date().toISOString(),
              output_payload: { summary: "ff-agent-test.ts manual chain trigger" },
            })
            .eq("id", queueId);
        } catch (innerErr) {
          log(`FAILED: ${errMsg(innerErr)}`);
          if (queueId) {
            await admin
              .from("agent_queue")
              .update({
                status: "failed",
                completed_at: new Date().toISOString(),
                error_message: errMsg(innerErr),
              })
              .eq("id", queueId);
          }
        }
      }
    } catch (err) {
      log(`FAILED: ${errMsg(err)}`);
    }
  }

  // --------------------------------------------------------------------
  // 5. COMMUNITY NEED PREDICTION
  // --------------------------------------------------------------------
  section("5/6", "CommunityNeedPredictorAgent (ag-35-community-need)");
  {
    try {
      const agent = new CommunityNeedPredictorAgent(FAITH_FOUNDATION_ORG_ID, admin);
      const result = await agent.run("manual");

      const { data: sigRows } = await admin
        .from("community_need_signals")
        .select("severity")
        .eq("org_id", FAITH_FOUNDATION_ORG_ID);
      const critical = (sigRows ?? []).filter((r) => r.severity === "critical");

      log(
        `Signals found this run: ${result.itemsProcessed} validated candidate(s) from ${result.itemsFound} raw search hit(s), ` +
          `${result.itemsQueued} persisted to community_need_signals`,
      );
      log(
        `Any critical-severity signal on file org-wide: ${critical.length > 0} ` +
          `(${critical.length} of ${(sigRows ?? []).length} total)`,
      );
      if (result.errors.length > 0) log(`Errors: ${result.errors.join(" | ")}`);
    } catch (err) {
      log(`FAILED: ${errMsg(err)}`);
    }
  }

  // --------------------------------------------------------------------
  // 6. STRATEGIC ADVISOR
  // --------------------------------------------------------------------
  section("6/6", "StrategicAdvisorAgent (ag-40-strategic-advisor)");
  {
    try {
      const agent = new StrategicAdvisorAgent(FAITH_FOUNDATION_ORG_ID, admin);
      const result = await agent.run("manual");

      const { data: recRows } = await admin
        .from("strategic_recommendations")
        .select("urgency")
        .eq("org_id", FAITH_FOUNDATION_ORG_ID);
      const immediate = (recRows ?? []).filter((r) => r.urgency === "immediate");

      log(`Recommendations generated this run: ${result.itemsProcessed} (of ${result.itemsFound} validated)`);
      log(
        `Any immediate-urgency recommendation on file org-wide: ${immediate.length > 0} ` +
          `(${immediate.length} of ${(recRows ?? []).length} total)`,
      );
      if (result.errors.length > 0) log(`Errors: ${result.errors.join(" | ")}`);
    } catch (err) {
      log(`FAILED: ${errMsg(err)}`);
    }
  }

  console.log("\n" + "=".repeat(78));
  console.log("Pipeline test complete.");
  console.log("=".repeat(78));
}

main().catch((error) => {
  console.error(`\nFATAL: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
