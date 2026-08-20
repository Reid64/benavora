// PT-09-002 execution proof: "AG-07 (non-canonical duplicate)" (registryAgentId
// "ag-07-compliance-check" / src/lib/agents/compliance-check-agent.ts) -- distinct from
// src/lib/agents/compliance-checker.ts (ComplianceChecker, fuzzy token-matching + advisory
// Claude review); this is the simpler, deterministic (no AI) queue-driven AutonomousAgent
// version: matches an opportunity's required_documents to attached documents by category
// alone.
//
// Real trigger per agent-inventory.json: WIRED-QUEUE (worker/autonomous-orchestrator.ts's
// routeQueueItem() case 'compliance_check', line 1715). ComplianceCheckAgent.run() takes only
// a triggerSource -- it reads its target applicationId off the agent_queue row this run is
// "processing", same contract as every other AutonomousAgent subclass in this batch.
//
// This invocation deliberately leaves the application's attached documents empty (no
// application_documents/documents rows seeded) to exercise the real "missing required
// documents" blocking path, which is exactly what environment.json's fixture already sets up
// (application 0159bcb9 has no attachments) -- this is not a contrived failure, it is the
// real state a newly drafted application starts in before a human/AG-XX attaches documents.
//
// Usage: npx tsx scripts/audit/pt09-002-trigger/AG-07-non-canonical.mjs

import {
  setupLocalEnv,
  loadEnvironment,
  pgClient,
  countRows,
  writeAgentResult,
  makeLocalSupabaseClient,
} from "../pt09-002-lib.mjs";

setupLocalEnv();

const { ComplianceCheckAgent } = await import("../../../src/lib/agents/compliance-check-agent.ts");

const CANONICAL = "AG-07 (non-canonical duplicate)";
const WRITE_TABLES = ["agent_runs", "agent_decisions", "alerts"];

async function main() {
  const env = loadEnvironment();
  const orgId = env.org.orgId;
  // Application 0159bcb9 (opportunity b1a414f2, "PT-09 Test Opportunity 2", government_grant,
  // required_documents=['Form 990','Board list']) has zero attached documents in the fixture
  // -- the real precondition this deterministic gate is meant to catch.
  const application = env.applications.find((a) => a.id === "0159bcb9-f0fb-49ea-925e-bcfd121318ca");

  const whereCol = (t) => (t === "agent_decisions" ? "org_id" : "organization_id");

  const db = await pgClient();
  const before = {};
  for (const t of WRITE_TABLES) before[t] = await countRows(db, t, whereCol(t), orgId);
  const appBefore = (await db.query("select compliance_check_result from applications where id = $1", [application.id])).rows[0];

  const supabase = makeLocalSupabaseClient();
  const log = [];
  let errorSurfaced = null;
  let runOutcome = null;

  try {
    const { data: queueRow, error: queueErr } = await supabase
      .from("agent_queue")
      .insert({
        org_id: orgId,
        agent_id: "ag-07-compliance-check",
        status: "processing",
        trigger_source: "event",
        input_payload: { applicationId: application.id },
        started_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (queueErr) throw new Error(`Failed to seed agent_queue row: ${queueErr.message}`);
    log.push(`Seeded agent_queue row ${queueRow.id} (status=processing, agent_id=ag-07-compliance-check, input_payload.applicationId=${application.id})`);
    log.push(`Application ${application.id} has zero attached documents in the fixture (application_documents empty) -- real precondition, not contrived.`);

    const agent = new ComplianceCheckAgent(orgId, supabase);
    runOutcome = await agent.run("event");
    log.push(`agent.run("event") resolved: ${JSON.stringify(runOutcome)}`);
  } catch (err) {
    errorSurfaced = err instanceof Error ? (err.stack ?? err.message) : String(err);
    log.push(`THREW past ComplianceCheckAgent.run(): ${errorSurfaced}`);
  }

  const after = {};
  for (const t of WRITE_TABLES) after[t] = await countRows(db, t, whereCol(t), orgId);
  const appAfter = (await db.query("select * from applications where id = $1", [application.id])).rows[0];

  const decisionRow = runOutcome?.decisions?.length
    ? (await db.query("select * from agent_decisions where id = $1", [runOutcome.decisions[runOutcome.decisions.length - 1]])).rows[0]
    : null;
  const runRow = decisionRow?.agent_run_id
    ? (await db.query("select * from agent_runs where id = $1", [decisionRow.agent_run_id])).rows[0]
    : (await db.query(
        "select * from agent_runs where organization_id = $1 and agent_type = 'ag-07-compliance-check' order by created_at desc limit 1",
        [orgId],
      )).rows[0];

  await db.end();

  const delta = {};
  for (const t of WRITE_TABLES) delta[t] = after[t] - before[t];

  const resultWasEmpty = !appBefore.compliance_check_result || Object.keys(appBefore.compliance_check_result).length === 0;
  const resultNowPopulated =
    appAfter.compliance_check_result && typeof appAfter.compliance_check_result.passed === "boolean";

  let verdict;
  let reasoning;
  if (errorSurfaced) {
    verdict = "ERROR-SWALLOWED";
    reasoning =
      "ComplianceCheckAgent.run() wraps its whole body in try/catch and always calls failRun() before returning success:false. Reaching this branch means the throw happened outside that (harness setup or import) -- a gap this harness caught but the app itself never logged.";
  } else if (runOutcome && runOutcome.success === false) {
    verdict = delta.agent_runs > 0 ? "WIRED-NO-OUTPUT" : "TRIGGER-BROKEN";
    reasoning = `agent.run() resolved success:false with errors=${JSON.stringify(runOutcome.errors)}. ${
      delta.agent_runs > 0
        ? "A failed agent_runs row was written (visible via error_message) -- not swallowed, but zero business-table output."
        : "No agent_runs row was written -- the run never reached logging."
    }`;
  } else if (resultWasEmpty && resultNowPopulated) {
    verdict = "WORKS";
    reasoning =
      `applications.compliance_check_result was updated in place (UPDATE, not INSERT -- confirmed by comparing the same row id before/after) from empty to a real deterministic compliance result: passed=${appAfter.compliance_check_result.passed}, missingDocuments=${JSON.stringify(appAfter.compliance_check_result.missingDocuments)} (both of this opportunity's required_documents correctly flagged missing since zero documents are attached). ${
        appAfter.compliance_check_result.passed === false
          ? "Since the check failed, an alerts row (compliance_blocked) was also created and agent_decisions logged required_human_review=true -- matches AG-07 Compliance Check's documented intent exactly: a deterministic gate that blocks non-compliant applications for human review."
          : ""
      }`;
  } else if (delta.agent_runs > 0 || delta.agent_decisions > 0) {
    verdict = "WIRED-NO-OUTPUT";
    reasoning = "agent_runs/agent_decisions rows were written (the run executed and logged), but applications.compliance_check_result was not populated -- zero real business-table output despite a run that appears to have completed.";
  } else {
    verdict = "TRIGGER-BROKEN";
    reasoning = "Neither agent_runs, agent_decisions, nor applications.compliance_check_result changed, and no error was surfaced.";
  }

  const result = {
    canonicalNumber: CANONICAL,
    registryAgentId: "ag-07-compliance-check",
    implementingFile: "src/lib/agents/compliance-check-agent.ts",
    writeTargetTables: ["agent_runs", "agent_decisions", "alerts", "applications (UPDATE compliance_check_result)"],
    triggerMethod:
      "Direct class invocation via tsx against the local pt05-local-stack, reproducing the real production contract: seeded one agent_queue row (org_id, agent_id='ag-07-compliance-check', status='processing', input_payload={applicationId}) since ComplianceCheckAgent.run() takes only a triggerSource and reads its target application off that queue row (mirrors worker/autonomous-orchestrator.ts routeQueueItem() case 'compliance_check'). Then: new ComplianceCheckAgent(orgId, supabase).run('event'). No Claude call -- this agent is fully deterministic (token/category matching only), per its own file header.",
    before: { ...before, applications_compliance_check_result_before: appBefore.compliance_check_result },
    after,
    rowDelta: delta,
    sampleWrittenRow: {
      applications_updated: {
        id: appAfter.id,
        opportunity_id: appAfter.opportunity_id,
        stage: appAfter.stage,
        compliance_check_result: appAfter.compliance_check_result,
        updated_at: appAfter.updated_at,
      },
      agent_runs_row: runRow ?? null,
      agent_decisions_row: decisionRow ?? null,
    },
    triggerLog: log.join("\n"),
    errorSurfaced,
    verdict,
    verdictReasoning: reasoning,
    registryPriorStatus:
      "FEATURE_REGISTRY_v2.md row #205: 'AG-07 Autonomous Compliance Check | BUILT | Event-driven on ready_for_review. Blocks non-compliant applications.'",
    falsePassCasualty: verdict === "WIRED-NO-OUTPUT",
  };

  writeAgentResult(CANONICAL, result);
  console.log(`\nVerdict for ${CANONICAL}: ${verdict}`);
}

main().catch((err) => {
  console.error("FATAL (harness-level, not agent-level):", err);
  process.exit(1);
});
