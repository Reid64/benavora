// PT-09-003 execution proof: AG-28 (Follow-Up Generator Agent)
// registryAgentId ag-28-followup / src/lib/agents/followup-generator-agent.ts
//
// Trigger method: direct class invocation, AutonomousAgent family --
// new FollowupGeneratorAgent(orgId, supabase).run('manual'). Real code:
// loadTriggerPayload() has no queue-item id passed into run() at all -- it
// recovers the event payload by reading the currently-'processing'
// agent_queue row for (org_id, agent_id) directly (mirrors
// ProbabilityScoringAgent.loadChainScope per the file's own comment). This
// script seeds a real agent_queue row with status='processing' and a valid
// input_payload (applicationId/previousStage/newStage) against one of
// environment.json's seeded applications, exercising the exact same
// recovery path the real event-driven stage-transition trigger and the
// nightly sweep both use.
//
// LOCAL SCAFFOLDING NOTE: application_followups did not exist locally --
// applied via _fix-missing-tables-2.mjs this session (migration 081).
//
// Usage: node --import tsx scripts/audit/pt09-003-trigger/AG-28.mjs

import {
  setupLocalEnv,
  loadEnvironment,
  pgClient,
  countRows,
  writeAgentResult,
  makeLocalSupabaseClient,
} from "../pt09-003-lib.mjs";

setupLocalEnv();

const { FollowupGeneratorAgent } = await import(
  "../../../src/lib/agents/followup-generator-agent.ts"
);

const CANONICAL = "AG-28";
const WRITE_TABLES = ["agent_runs", "agent_decisions", "agent_queue", "application_followups"];

async function main() {
  const env = loadEnvironment();
  const orgId = env.org.orgId;
  const applicationId = env.applications[0].id;

  const db = await pgClient();

  // Move the target application to 'submitted' so the seeded queue payload's
  // newStage is consistent with real application state, then seed a real
  // processing agent_queue row loadTriggerPayload() will read back.
  await db.query(`update applications set stage='submitted' where id=$1`, [applicationId]);
  const queueSeed = await db.query(
    `insert into agent_queue (org_id, agent_id, status, trigger_source, input_payload, started_at)
     values ($1, 'ag-28-followup', 'processing', 'event',
             jsonb_build_object('applicationId', $2::text, 'previousStage', 'under_review', 'newStage', 'submitted'),
             now())
     returning id`,
    [orgId, applicationId],
  );
  const queueId = queueSeed.rows[0].id;

  const before = {
    agent_runs: await countRows(db, "agent_runs", "agent_type", "ag-28-followup"),
    application_followups: await countRows(db, "application_followups", "organization_id", orgId),
  };

  const supabase = makeLocalSupabaseClient();

  const log = [`Seeded agent_queue row ${queueId} (status=processing, applicationId=${applicationId}, previousStage=under_review, newStage=submitted) for loadTriggerPayload() to recover.`];
  let errorSurfaced = null;
  let result_ = null;

  try {
    const agent = new FollowupGeneratorAgent(orgId, supabase);
    result_ = await agent.run("manual");
    log.push(`agent.run("manual") resolved: ${JSON.stringify(result_)}`);
  } catch (err) {
    errorSurfaced = err instanceof Error ? (err.stack ?? err.message) : String(err);
    log.push(`THREW: ${errorSurfaced}`);
  }

  const after = {
    agent_runs: await countRows(db, "agent_runs", "agent_type", "ag-28-followup"),
    application_followups: await countRows(db, "application_followups", "organization_id", orgId),
  };

  const runRow = (
    await db.query(
      "select * from agent_runs where agent_type='ag-28-followup' and organization_id=$1 order by created_at desc limit 1",
      [orgId],
    )
  ).rows[0] ?? null;
  const followupRows = (
    await db.query("select * from application_followups where organization_id=$1 order by created_at desc limit 5", [orgId])
  ).rows;

  await db.end();

  const delta = {};
  for (const k of Object.keys(before)) delta[k] = after[k] - before[k];

  let verdict;
  let reasoning;
  if (errorSurfaced) {
    verdict = "ERROR-SWALLOWED";
    reasoning = `agent.run() threw past this harness: ${errorSurfaced}.`;
  } else if (delta.application_followups > 0 && followupRows[0]) {
    verdict = "WORKS";
    const f = followupRows[0];
    reasoning = `application_followups row written with real content for the real seeded stage-transition (applicationId=${applicationId}, newStage=submitted): follow_up_type=${f.follow_up_type}, scheduled_date=${f.scheduled_date}, channel=${f.channel}, content="${f.content}". itemsQueued=${result_.itemsQueued}. This confirms loadTriggerPayload()'s recovery-via-processing-queue-row mechanism genuinely works and the agent produces real, org-scoped follow-up content.`;
  } else if (delta.agent_runs > 0) {
    verdict = "WIRED-NO-OUTPUT";
    reasoning = `agent_runs completed cleanly (errors=${JSON.stringify(result_?.errors)}) but zero application_followups rows landed for the real seeded stage-transition. See sampleWrittenRow.agent_runs_row.output_summary for the agent's own stated reason.`;
  } else {
    verdict = "TRIGGER-BROKEN";
    reasoning = `No agent_runs, agent_decisions, or application_followups activity for the seeded queue row ${queueId}, and no error was surfaced -- loadTriggerPayload() may not have recovered the seeded payload at all.`;
  }

  const resultObj = {
    canonicalNumber: CANONICAL,
    registryAgentId: "ag-28-followup",
    implementingFile: "src/lib/agents/followup-generator-agent.ts",
    writeTargetTables: WRITE_TABLES,
    triggerMethod:
      "Direct class invocation via tsx against the local pt05-local-stack: new FollowupGeneratorAgent(orgId, supabase).run('manual'), against a real, freshly-seeded agent_queue row (status='processing', input_payload={applicationId,previousStage:'under_review',newStage:'submitted'}) for one of environment.json's seeded applications, moved to stage='submitted' first for consistency -- loadTriggerPayload() has no queue-item id passed into run() at all, it reads the currently-processing row for (org_id,agent_id) directly. Real trigger path: WIRED-EVENT+SCHEDULED+QUEUE (application stage-transition event, nightly sweep, routeQueueItem() case 'ag-28-followup').",
    before,
    after,
    rowDelta: delta,
    sampleWrittenRow: {
      application_followups_rows: followupRows,
      agent_runs_row: runRow,
      seeded_agent_queue_id: queueId,
      seeded_application_id: applicationId,
    },
    triggerLog: log.join("\n"),
    errorSurfaced,
    verdict,
    verdictReasoning: reasoning,
    registryPriorStatus:
      "See test-evidence/pt-09/agent-inventory.json triggerWiredVerdict: WIRED-EVENT+SCHEDULED+QUEUE.",
    falsePassCasualty: verdict === "WIRED-NO-OUTPUT" || verdict === "TRIGGER-BROKEN" || verdict === "ERROR-SWALLOWED",
  };

  writeAgentResult(CANONICAL, resultObj);
  console.log(`\nVerdict for ${CANONICAL}: ${verdict}`);
}

main().catch((err) => {
  console.error("FATAL (harness-level, not agent-level):", err);
  process.exit(1);
});
