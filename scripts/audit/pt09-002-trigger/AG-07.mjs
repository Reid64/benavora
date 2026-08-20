// PT-09-002 execution proof: AG-07 canonical (registryAgentId "recursive_learning" /
// src/lib/agents/recursive-learning.ts). Real trigger per agent-inventory.json:
// WIRED-EVENT-CLIENT-TRIGGERED -- a best-effort fetch fired directly from
// src/components/outcomes/OutcomeForm.tsx on every real outcomes insert, not a queue/cron
// path. This agent extends BaseAgent (the grant-summary.ts / AG-01 pattern), not
// AutonomousAgent -- constructor takes { client, organizationId }, run() takes a real input
// object { outcomeId } directly (no agent_queue indirection).
//
// Since the real trigger fires off a genuine outcomes row being recorded, this harness first
// seeds one real outcomes row (organization_id, application_id, result='awarded',
// funder_category matching the linked opportunity's category, a real narrative_snapshot with
// substantive grant-narrative prose) via pgClient() -- documented here per the task's rule 6
// (seeding baseline data the environment fixture doesn't already provide). Then invokes
// new RecursiveLearningAgent({ client, organizationId }).run({ outcomeId }), the same call
// shape OutcomeForm.tsx's real fetch triggers server-side.
//
// Usage: npx tsx scripts/audit/pt09-002-trigger/AG-07.mjs

import {
  setupLocalEnv,
  loadEnvironment,
  pgClient,
  countRows,
  writeAgentResult,
  makeLocalSupabaseClient,
} from "../pt09-002-lib.mjs";

setupLocalEnv();

const { RecursiveLearningAgent } = await import("../../../src/lib/agents/recursive-learning.ts");

const CANONICAL = "AG-07";
const WRITE_TABLES = ["knowledge_base", "proven_narratives"];

const NARRATIVE_SNAPSHOT = `## Executive Summary

PT-09 Batch1 Test Org respectfully requests $45,000 from the PT-09 Community Foundation to
expand transitional housing services for displaced workers and low-income families across
Central Texas. Our mission -- stabilizing housing for vulnerable working families -- is a
direct match for this funder's Housing Stability Grant priorities.

## Program Description

Our transitional housing program has served this community for over a decade, combining
short-term rental assistance with intensive workforce case management. Each family receives
a dedicated case manager, access to job-readiness training, and up to six months of rental
subsidy while they stabilize employment.

## Organizational Capacity

Our board of directors brings deep expertise in nonprofit finance, housing policy, and
workforce development, giving this organization the governance capacity to manage a grant
of this size responsibly.

## Budget Narrative

The requested $45,000 will fund one full-time case manager position and direct rental
assistance for approximately 12 families over the grant period, calculated against our
verified average rental subsidy cost of $2,800 per family.`;

async function main() {
  const env = loadEnvironment();
  const orgId = env.org.orgId;
  const application = env.applications.find((a) => a.id === "94f79d2e-d8ec-4802-9395-ee251f298c0e");
  const opportunity = env.opportunities.find((o) => o.id === application.opportunityId);
  // opportunity 88365eb3 ("PT-09 Test Opportunity 1") is private_foundation -- matches the
  // funder_category the outcome and this org's seeded knowledge_base rows (category='mission',
  // 'program_description') can plausibly be attributed against.
  const funderCategory = "private_foundation";

  const db = await pgClient();
  const before = {};
  for (const t of WRITE_TABLES) before[t] = await countRows(db, t, "organization_id", orgId);

  const seeded = await db.query(
    `insert into outcomes (organization_id, application_id, result, awarded_amount, requested_amount, funder_category, narrative_snapshot, recorded_at)
     values ($1, $2, 'awarded', 45000, 45000, $3, $4, now())
     returning id`,
    [orgId, application.id, funderCategory, NARRATIVE_SNAPSHOT],
  );
  const outcomeId = seeded.rows[0].id;

  const supabase = makeLocalSupabaseClient();
  const log = [`Seeded outcomes row ${outcomeId} (result=awarded, funder_category=${funderCategory}, application_id=${application.id}, real narrative_snapshot with 4 sections) -- this is the real event OutcomeForm.tsx's client-side call fires on.`];
  let errorSurfaced = null;
  let runOutcome = null;

  try {
    const agent = new RecursiveLearningAgent({ client: supabase, organizationId: orgId });
    runOutcome = await agent.run({ outcomeId });
    log.push(`agent.run({ outcomeId }) resolved: runId=${runOutcome.runId} tokensUsed=${runOutcome.tokensUsed} durationMs=${runOutcome.durationMs}`);
    log.push(`data: ${JSON.stringify(runOutcome.data)}`);
  } catch (err) {
    errorSurfaced = err instanceof Error ? (err.stack ?? err.message) : String(err);
    log.push(`THREW: ${errorSurfaced}`);
  }

  const after = {};
  for (const t of WRITE_TABLES) after[t] = await countRows(db, t, "organization_id", orgId);

  const provenRows = (await db.query(
    "select * from proven_narratives where organization_id = $1 and outcome_id = $2 order by created_at desc",
    [orgId, outcomeId],
  )).rows;
  const kbFlagged = runOutcome?.data?.knowledgeBaseFlagged?.length
    ? (await db.query("select id, category, is_proven, proven_count from knowledge_base where id = any($1::uuid[])", [runOutcome.data.knowledgeBaseFlagged])).rows
    : [];
  const runRow = runOutcome?.runId
    ? (await db.query("select * from agent_runs where id = $1", [runOutcome.runId])).rows[0]
    : null;

  await db.end();

  const delta = {};
  for (const t of WRITE_TABLES) delta[t] = after[t] - before[t];

  let verdict;
  let reasoning;
  if (errorSurfaced) {
    verdict = "ERROR-SWALLOWED";
    reasoning =
      "agent.run() threw; the error was captured by this harness (not silently swallowed by the app -- BaseAgent.run() itself writes agent_runs.status=failed/error_message before rethrowing, per base-agent.ts), but no successful proven_narratives/knowledge_base write occurred for this outcome.";
  } else if (delta.proven_narratives > 0 && provenRows.length > 0 && provenRows[0].narrative_text && provenRows[0].narrative_text.length > 20) {
    verdict = "WORKS";
    reasoning =
      `A real awarded outcome was recorded and the agent extracted ${runOutcome.data.sectionsExtracted} narrative section(s) from the narrative_snapshot, writing ${runOutcome.data.provenCreated} new proven_narratives row(s) (section_type='${provenRows[0].section_type}', funder_category='${provenRows[0].funder_category}', real Claude-extracted narrative_text) and rescoring ${runOutcome.data.narrativesRescored} narrative(s)' effectiveness. ${kbFlagged.length > 0 ? `${kbFlagged.length} knowledge_base entr(y/ies) flagged is_proven.` : "No KB entries crossed the is_proven threshold yet (proven_count still below PROVEN_NARRATIVE_THRESHOLD after this single awarded use)."} Matches AG-07's documented intent: closing the learning loop from a real awarded outcome into reusable proven narratives.`;
  } else if (delta.knowledge_base > 0 || runOutcome?.data?.narrativesRescored > 0 || runRow) {
    verdict = "WIRED-NO-OUTPUT";
    reasoning = `An agent_runs row was written and the run resolved (data=${JSON.stringify(runOutcome?.data)}), but no proven_narratives row was actually created for this outcome's narrative_snapshot -- zero real business-table output from the extraction pipeline despite a clean run.`;
  } else {
    verdict = "TRIGGER-BROKEN";
    reasoning = "No proven_narratives, knowledge_base, or agent_runs changes were observed and no error was surfaced -- the invocation never reached BaseAgent.run()'s logging/execution path.";
  }

  const result = {
    canonicalNumber: CANONICAL,
    registryAgentId: "recursive_learning",
    implementingFile: "src/lib/agents/recursive-learning.ts",
    writeTargetTables: ["knowledge_base", "proven_narratives", "agent_runs"],
    triggerMethod:
      "Seeded one real outcomes row (organization_id, application_id, result='awarded', funder_category, narrative_snapshot with real 4-section grant-narrative prose) via direct pg insert -- reproducing the real event this agent fires on (OutcomeForm.tsx's client-side fetch on every real outcomes insert, per agent-inventory.json's WIRED-EVENT-CLIENT-TRIGGERED verdict). Then: new RecursiveLearningAgent({ client, organizationId }).run({ outcomeId }) -- BaseAgent pattern, same shape as AG-01/grant-summary.ts, not the AutonomousAgent agent_queue-polling shape the other 4 agents in this batch use.",
    before,
    after,
    rowDelta: delta,
    sampleWrittenRow: {
      proven_narratives_created: provenRows.length > 0 ? provenRows[0] : null,
      knowledge_base_flagged: kbFlagged,
      agent_runs_row: runRow ?? null,
    },
    triggerLog: log.join("\n"),
    errorSurfaced,
    verdict,
    verdictReasoning: reasoning,
    registryPriorStatus:
      "FEATURE_REGISTRY_v2.md row #14: 'Recursive Learning | BUILT | Analyzes awarded applications. Extracts proven narratives. Updates effectiveness scores. Flags winning patterns for reuse.'",
    falsePassCasualty: verdict === "WIRED-NO-OUTPUT",
  };

  writeAgentResult(CANONICAL, result);
  console.log(`\nVerdict for ${CANONICAL}: ${verdict}`);
}

main().catch((err) => {
  console.error("FATAL (harness-level, not agent-level):", err);
  process.exit(1);
});
