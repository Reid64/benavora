// PT-09-002 execution proof: AG-04 (ag-04-fit-analysis / src/lib/agents/fit-analysis-agent.ts)
// Trigger method: real production trigger is "manual API only" per agent-inventory.json
// (WIRED-MANUAL-API-ONLY -- worker/autonomous-orchestrator.ts explicitly does NOT wire this
// agent; the only real caller is src/app/api/ai/fit-analysis/route.ts). FitAnalysisAgent
// extends AutonomousAgent, whose run() has no free-form input params -- it reads its target
// opportunityId off the currently "processing" agent_queue row for
// (org_id, agent_id="ag-04-fit-analysis"). This harness reproduces exactly that contract: it
// inserts one agent_queue row with status="processing" and the real input_payload shape,
// then calls new FitAnalysisAgent(orgId, supabase).run("manual") -- the same path a real
// caller (worker or route) would use once one exists.
//
// Usage: npx tsx scripts/audit/pt09-002-trigger/AG-04.mjs

import {
  setupLocalEnv,
  loadEnvironment,
  pgClient,
  countRows,
  latestRow,
  writeAgentResult,
  makeLocalSupabaseClient,
} from "../pt09-002-lib.mjs";

setupLocalEnv();

const { FitAnalysisAgent } = await import("../../../src/lib/agents/fit-analysis-agent.ts");

const CANONICAL = "AG-04";
const WRITE_TABLES = ["applications", "agent_runs", "agent_decisions"];

async function main() {
  const env = loadEnvironment();
  const orgId = env.org.orgId;
  // Test Opportunity 3 (corporate_donation, funder "PT-09 Regional Bank Giving") was seeded
  // with eligibility_score=85 -- above the real >=70 firing threshold this agent's caller is
  // supposed to gate on (this class itself does not re-check the threshold; that is the
  // caller's job per its header, so a manual-triggered call skips that gate deliberately,
  // same as the real manual API route does).
  const opp = env.opportunities.find((o) => o.id === "eb3a490b-9f05-4b1e-a668-227f49d9161a");

  const db = await pgClient();
  const before = {};
  for (const t of WRITE_TABLES) {
    before[t] = await countRows(db, t, t === "agent_decisions" ? "org_id" : "organization_id", orgId);
  }

  const supabase = makeLocalSupabaseClient();
  const log = [];
  let errorSurfaced = null;
  let runOutcome = null;

  try {
    // Reproduce the real trigger contract: the agent has no input params on run() -- it reads
    // opportunityId off the agent_queue row this run is "processing".
    const { data: queueRow, error: queueErr } = await supabase
      .from("agent_queue")
      .insert({
        org_id: orgId,
        agent_id: "ag-04-fit-analysis",
        status: "processing",
        trigger_source: "manual",
        input_payload: { opportunityId: opp.id },
        started_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (queueErr) throw new Error(`Failed to seed agent_queue row: ${queueErr.message}`);
    log.push(`Seeded agent_queue row ${queueRow.id} (status=processing, agent_id=ag-04-fit-analysis, input_payload.opportunityId=${opp.id})`);

    const agent = new FitAnalysisAgent(orgId, supabase);
    runOutcome = await agent.run("manual");
    log.push(`agent.run("manual") resolved: ${JSON.stringify(runOutcome)}`);
  } catch (err) {
    errorSurfaced = err instanceof Error ? (err.stack ?? err.message) : String(err);
    log.push(`THREW past FitAnalysisAgent.run() (its own try/catch should prevent this): ${errorSurfaced}`);
  }

  const after = {};
  for (const t of WRITE_TABLES) {
    after[t] = await countRows(db, t, t === "agent_decisions" ? "org_id" : "organization_id", orgId);
  }

  // NOTE: a parallel audit group (Group A) is running concurrently against this same local
  // stack/org, so a naive "latest row for this org" query can race and grab another agent's
  // row. Anchor every lookup on the actual ids agent.run() itself returned (runOutcome.decisions)
  // rather than recency, and scope agent_runs/applications lookups by agent_id/opportunity_id.
  const decisionRow = runOutcome?.decisions?.[0]
    ? (await db.query("select * from agent_decisions where id = $1", [runOutcome.decisions[0]])).rows[0]
    : null;
  const runRow = decisionRow?.agent_run_id
    ? (await db.query("select * from agent_runs where id = $1", [decisionRow.agent_run_id])).rows[0]
    : (await db.query(
        "select * from agent_runs where organization_id = $1 and agent_type = 'ag-04-fit-analysis' order by created_at desc limit 1",
        [orgId],
      )).rows[0];
  const appRow = await latestRow(db, "applications", "opportunity_id", opp.id, "created_at");

  await db.end();

  const delta = {};
  for (const t of WRITE_TABLES) delta[t] = after[t] - before[t];

  let verdict;
  let reasoning;
  if (errorSurfaced) {
    verdict = "ERROR-SWALLOWED";
    reasoning =
      "FitAnalysisAgent.run() itself wraps its whole body in try/catch and always calls failRun() (writes agent_runs.status=failed + error_message) before returning success:false -- so a normal agent-level failure would NOT reach this branch. Reaching this branch means the throw happened outside that try/catch (harness-level setup, e.g. the agent_queue seed insert, or a constructor/import failure), which is the harness catching something the app itself never got a chance to log. Treated as ERROR-SWALLOWED per the task's guidance since no agent_runs/agent_decisions row exists recording this specific failure.";
  } else if (runOutcome && runOutcome.success === false) {
    verdict = delta.agent_runs > 0 ? "WIRED-NO-OUTPUT" : "TRIGGER-BROKEN";
    reasoning = `agent.run() resolved success:false with errors=${JSON.stringify(runOutcome.errors)}. ${
      delta.agent_runs > 0
        ? "A failed agent_runs row was written (failRun() executed, error is visible to a human via agent_runs.error_message) -- not swallowed, but zero business-table output."
        : "No agent_runs row was even written -- the run never reached BaseAgent-style logging."
    }`;
  } else if (delta.applications > 0 && appRow && appRow.fit_analysis && appRow.stage === "discovered") {
    verdict = "WORKS";
    reasoning =
      `agent_runs + agent_decisions rows written, and a real applications row was created in the 'discovered' stage with fit_analysis populated (recommendation="${appRow.fit_analysis.recommendation}", confidence=${appRow.fit_analysis.confidence}) -- matches AG-04's documented intent: a deep second-pass fit/ROI analysis that creates a discovered-stage application for human review on any non-"pass" verdict.`;
  } else if (delta.agent_decisions > 0 || delta.agent_runs > 0) {
    // Legitimate "pass" outcome: Claude recommended passing on the opportunity, so per the
    // agent's own logic no application is created. This is a real, correct code path, not a
    // failure -- but it means zero business-table (applications) output for this specific run.
    verdict = "WIRED-NO-OUTPUT";
    reasoning =
      "agent_runs/agent_decisions rows were written (the run executed end-to-end and logged a real Claude-driven recommendation), but the model recommended \"pass\" on this opportunity, so per the agent's own logic no applications row was created. The run is real and logged, but this specific invocation produced zero business-table output -- flagged per the task's WIRED-NO-OUTPUT class even though the *reason* is a legitimate model judgment call rather than a bug.";
  } else {
    verdict = "TRIGGER-BROKEN";
    reasoning = "Neither agent_runs, agent_decisions, nor applications changed, and no error was surfaced -- the invocation never reached BaseAgent-style logging.";
  }

  const result = {
    canonicalNumber: CANONICAL,
    registryAgentId: "ag-04-fit-analysis",
    implementingFile: "src/lib/agents/fit-analysis-agent.ts",
    writeTargetTables: ["applications", "agent_runs", "agent_decisions"],
    triggerMethod:
      "Direct class invocation via tsx against the local pt05-local-stack, reproducing the real production contract exactly: seeded one agent_queue row (org_id, agent_id='ag-04-fit-analysis', status='processing', input_payload={opportunityId}) since FitAnalysisAgent.run() takes only a triggerSource and reads its target opportunity off that queue row (mirrors the manual API route at src/app/api/ai/fit-analysis/ per agent-inventory.json's WIRED-MANUAL-API-ONLY verdict -- this class itself has no scheduled/queue caller). Then: new FitAnalysisAgent(orgId, supabase).run('manual').",
    before,
    after,
    rowDelta: delta,
    sampleWrittenRow: {
      applications_created: appRow
        ? {
            id: appRow.id,
            opportunity_id: appRow.opportunity_id,
            stage: appRow.stage,
            fit_analysis: appRow.fit_analysis,
            created_at: appRow.created_at,
          }
        : null,
      agent_runs_row: runRow ?? null,
      agent_decisions_row: decisionRow ?? null,
    },
    triggerLog: log.join("\n"),
    errorSurfaced,
    verdict,
    verdictReasoning: reasoning,
    registryPriorStatus:
      "FEATURE_REGISTRY_v2.md row #206: 'AG-04 Autonomous Fit Analysis | BUILT | Fires at eligibility >= 70. Creates discovered-stage application.'",
    falsePassCasualty: verdict === "WIRED-NO-OUTPUT",
  };

  writeAgentResult(CANONICAL, result);
  console.log(`\nVerdict for ${CANONICAL}: ${verdict}`);
}

main().catch((err) => {
  console.error("FATAL (harness-level, not agent-level):", err);
  process.exit(1);
});
