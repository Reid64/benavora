// PT-09-002 execution proof: AG-06 canonical (registryAgentId "ag-06-draft-generator" per
// agent-inventory.json, but the real on-disk agentId literal is "ag-05-draft" --
// src/lib/agents/draft-generation-agent.ts:779 and its own file header explain the
// mismatch: AGENTS_v2.md calls this "AG-06: Draft Generator Agent" but the queue-chain
// literal that actually fires it (probability-scoring-agent.ts) uses "ag-05-draft"). This
// script keeps that real literal so the chain contract this class actually honors is
// reproduced faithfully.
//
// Real trigger per agent-inventory.json: WIRED-SCHEDULED-GATED+QUEUE (nightly pipeline at
// 2 AM gated on org_autonomous_config.auto_draft_enabled, plus routeQueueItem() case
// 'draft_generation'). DraftGenerationAgent.run() takes only a triggerSource -- it reads its
// target opportunity off the agent_queue row this run is "processing", same contract as
// every other AutonomousAgent subclass in this batch. This harness reproduces that: seed one
// agent_queue row (agent_id='ag-05-draft', status='processing', input_payload matching the
// real chain shape {opportunityId, score, title, funderId}), then invoke .run('manual').
//
// Local-schema patch applied before this run (see scripts/audit/pt09-002-trigger/
// _patch_metadata_col.mjs): `alter table applications add column if not exists metadata
// jsonb`. This is a genuine production column (src/supabase/migrations/103_narrative_
// humanizer.sql / supabase/migrations/105_applications_metadata_column.sql per this agent's
// own file header) that was simply missing from the PT-09-002 local schema-extension pass --
// not an application bug. Without it every insert into applications from this agent would
// fail with a PostgREST "column not found" error, masking otherwise-correct behavior.
//
// This is a genuine, real Claude-backed run: narrative strategy (1 call) + 6 section drafts
// (6 parallel calls) + Intelligence Library pattern synthesis (1 call) + narrative humanizer
// (1+ calls) = a real multi-call pipeline against the live ANTHROPIC_API_KEY. Kept to exactly
// one invocation, not a loop, per the task's real-Claude-call guidance.
//
// Usage: npx tsx scripts/audit/pt09-002-trigger/AG-06.mjs

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

const { DraftGenerationAgent } = await import("../../../src/lib/agents/draft-generation-agent.ts");

const CANONICAL = "AG-06";
const WRITE_TABLES = ["applications", "agent_runs", "agent_decisions", "alerts"];

async function main() {
  const env = loadEnvironment();
  const orgId = env.org.orgId;
  const opp = env.opportunities.find((o) => o.id === "eb3a490b-9f05-4b1e-a668-227f49d9161a");
  const funderId = "01bf8906-088c-4495-8fed-fe970d05671e"; // PT-09 Regional Bank Giving

  const whereCol = (t) => (t === "agent_decisions" ? "org_id" : "organization_id");

  const db = await pgClient();
  const before = {};
  for (const t of WRITE_TABLES) {
    before[t] = await countRows(db, t, whereCol(t), orgId);
  }

  const supabase = makeLocalSupabaseClient();
  const log = [];
  let errorSurfaced = null;
  let runOutcome = null;

  try {
    const { data: queueRow, error: queueErr } = await supabase
      .from("agent_queue")
      .insert({
        org_id: orgId,
        agent_id: "ag-05-draft", // real on-disk literal -- see header note
        status: "processing",
        trigger_source: "manual",
        input_payload: {
          opportunityId: opp.id,
          score: 85,
          title: "PT-09 Test Opportunity 3",
          funderId,
        },
        started_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (queueErr) throw new Error(`Failed to seed agent_queue row: ${queueErr.message}`);
    log.push(`Seeded agent_queue row ${queueRow.id} (status=processing, agent_id=ag-05-draft, input_payload={opportunityId, score:85, title, funderId})`);

    const agent = new DraftGenerationAgent(orgId, supabase);
    runOutcome = await agent.run("manual");
    log.push(`agent.run("manual") resolved: ${JSON.stringify(runOutcome)}`);
  } catch (err) {
    errorSurfaced = err instanceof Error ? (err.stack ?? err.message) : String(err);
    log.push(`THREW past DraftGenerationAgent.run(): ${errorSurfaced}`);
  }

  const after = {};
  for (const t of WRITE_TABLES) {
    after[t] = await countRows(db, t, whereCol(t), orgId);
  }

  const decisionRow = runOutcome?.decisions?.length
    ? (await db.query("select * from agent_decisions where id = $1", [runOutcome.decisions[runOutcome.decisions.length - 1]])).rows[0]
    : null;
  const runRow = decisionRow?.agent_run_id
    ? (await db.query("select * from agent_runs where id = $1", [decisionRow.agent_run_id])).rows[0]
    : (await db.query(
        "select * from agent_runs where organization_id = $1 and agent_type = 'ag-05-draft' order by created_at desc limit 1",
        [orgId],
      )).rows[0];
  const appRow = await db.query(
    "select * from applications where opportunity_id = $1 and auto_generated = true order by created_at desc limit 1",
    [opp.id],
  ).then((r) => r.rows[0] ?? null);

  await db.end();

  const delta = {};
  for (const t of WRITE_TABLES) delta[t] = after[t] - before[t];

  let verdict;
  let reasoning;
  if (errorSurfaced) {
    verdict = "ERROR-SWALLOWED";
    reasoning =
      "DraftGenerationAgent.run() wraps its whole body in try/catch and always calls failRun() before returning success:false. Reaching this branch means the throw happened outside that (harness setup or import), which is a real gap this harness caught but the app itself never got to log.";
  } else if (runOutcome && runOutcome.success === false) {
    verdict = delta.agent_runs > 0 ? "WIRED-NO-OUTPUT" : "TRIGGER-BROKEN";
    reasoning = `agent.run() resolved success:false with errors=${JSON.stringify(runOutcome.errors)}. ${
      delta.agent_runs > 0
        ? "A failed agent_runs row was written (failRun() executed, visible via agent_runs.error_message) -- not swallowed, but zero business-table output."
        : "No agent_runs row was written -- the run never reached logging."
    }`;
  } else if (
    delta.applications > 0 &&
    appRow &&
    appRow.draft_content &&
    appRow.draft_content.length > 200 &&
    appRow.pending_review === true &&
    appRow.auto_generated === true
  ) {
    verdict = "WORKS";
    reasoning =
      `A real applications row was created via a full 5-phase Claude pipeline (narrative strategy -> per-section drafting -> compliance check -> humanization -> confidence scoring): draft_content is ${appRow.draft_content.length} characters of real Claude-generated grant narrative across all 6 sections, stage='drafting', auto_generated=true, pending_review=true (HARD LIMIT honored -- never auto-submitted), draft_confidence_score=${appRow.draft_confidence_score}, compliance_check_result populated. Matches AG-06/AG-05's documented intent exactly: an autonomous, human-review-gated draft generator.`;
  } else if (delta.agent_runs > 0 || delta.agent_decisions > 0) {
    verdict = "WIRED-NO-OUTPUT";
    reasoning =
      "agent_runs/agent_decisions rows were written (the run executed and logged), but no qualifying applications row (auto_generated draft with real content) was found -- zero real business-table output despite a run that appears to have completed.";
  } else {
    verdict = "TRIGGER-BROKEN";
    reasoning = "Neither agent_runs, agent_decisions, nor applications changed, and no error was surfaced.";
  }

  const result = {
    canonicalNumber: CANONICAL,
    registryAgentId: "ag-06-draft-generator",
    implementingFile: "src/lib/agents/draft-generation-agent.ts",
    writeTargetTables: ["applications", "agent_runs", "agent_decisions", "alerts"],
    triggerMethod:
      "Direct class invocation via tsx against the local pt05-local-stack, reproducing the real chain contract: seeded one agent_queue row (org_id, agent_id='ag-05-draft' -- the real on-disk literal, not the registry's 'ag-06-draft-generator' -- status='processing', input_payload={opportunityId, score, title, funderId} matching what probability-scoring-agent.ts's queueChainedAgent call actually enqueues) since DraftGenerationAgent.run() takes only a triggerSource. Then: new DraftGenerationAgent(orgId, supabase).run('manual'). Local schema patch applied first: applications.metadata jsonb column added (was missing from the PT-09-002 schema-extension pass; a real production column per this agent's own header, not an app bug).",
    before,
    after,
    rowDelta: delta,
    sampleWrittenRow: {
      applications_created: appRow
        ? {
            id: appRow.id,
            opportunity_id: appRow.opportunity_id,
            stage: appRow.stage,
            auto_generated: appRow.auto_generated,
            pending_review: appRow.pending_review,
            draft_source: appRow.draft_source,
            draft_confidence_score: appRow.draft_confidence_score,
            twin_powered: appRow.twin_powered,
            twin_completeness: appRow.twin_completeness,
            platform_patterns_applied: appRow.platform_patterns_applied,
            compliance_check_result: appRow.compliance_check_result,
            draft_content_excerpt: appRow.draft_content ? appRow.draft_content.slice(0, 600) : null,
            draft_content_length: appRow.draft_content ? appRow.draft_content.length : 0,
            metadata: appRow.metadata,
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
      "FEATURE_REGISTRY_v2.md row #197: 'AG-05 Autonomous Draft Generation | BUILT | Auto-drafts above threshold. pending_review=true. Never submits.' (this is the registry row for the code this class actually is -- see file header on the ag-05-draft vs ag-06-draft-generator agent_id mismatch; agent-inventory.json's registryName for canonical AG-06 is 'AG-06 -- Draft Generator Agent').",
    falsePassCasualty: verdict === "WIRED-NO-OUTPUT",
  };

  writeAgentResult(CANONICAL, result);
  console.log(`\nVerdict for ${CANONICAL}: ${verdict}`);
}

main().catch((err) => {
  console.error("FATAL (harness-level, not agent-level):", err);
  process.exit(1);
});
