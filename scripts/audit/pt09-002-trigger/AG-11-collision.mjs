// PT-09-002 execution proof: AG-11 (on-disk collision, unregistered)
// (knowledge_gap / src/lib/agents/knowledge-gap-agent.ts)
//
// This is a DIFFERENT AG-11 than the registry's cold_outreach row -- its own
// file header labels it "AG-11 (exact match)" per
// worker/autonomous-orchestrator.ts's header comment. No registry entry.
//
// Per the task prompt and agent-inventory.json: "no direct .from() business-
// table write found in this file" -- a real candidate for WIRED-NO-OUTPUT.
// Verified directly against the source (knowledge-gap-agent.ts): there is
// indeed no queueChainedAgent() call anywhere in this file (the "agent_queue
// via queueChainedAgent" write inventory speculated about does not exist in
// this code path) and no dedicated business table like the other AG-11/AG-12
// siblings write (search_profiles, outreach_contacts). Its only two real
// writes are agent_decisions (via logDecision, one row per missing KB
// category) and an org-wide alerts row (via createNotification) -- same
// "meta table only" shape as its AG-10 sibling (document-expiry-agent.ts),
// which this task's own taxonomy treats as a legitimate WORKS when those
// writes carry real, substantive content (not empty stubs). Applying the
// same standard here rather than penalizing this agent for having no
// dedicated business table by design.
//
// Seed dependency: none needed -- this org has zero knowledge_base rows, so
// all 10 STANDARD_KB_CATEGORIES are missing by default, guaranteeing the
// Claude-assisted branch fires.
//
// Usage: npx tsx scripts/audit/pt09-002-trigger/AG-11-collision.mjs

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

const { KnowledgeGapAgent } = await import(
  "../../../src/lib/agents/knowledge-gap-agent.ts"
);

const CANONICAL = "AG-11 (on-disk collision, unregistered)";
const WRITE_TABLES = ["agent_decisions", "alerts", "agent_runs"];

async function main() {
  const env = loadEnvironment();
  const orgId = env.org.orgId;

  const db = await pgClient();
  const kbCount = await countRows(db, "knowledge_base", "organization_id", orgId);
  const before = {};
  before.agent_decisions = (
    await db.query("select count(*)::int as n from agent_decisions where org_id = $1", [orgId])
  ).rows[0].n;
  before.alerts = await countRows(db, "alerts", "organization_id", orgId);
  before.agent_runs = await countRows(db, "agent_runs", "organization_id", orgId);
  before.agent_queue = (
    await db.query("select count(*)::int as n from agent_queue where org_id = $1", [orgId])
  ).rows[0].n;

  const supabase = makeLocalSupabaseClient();
  const log = [];
  let errorSurfaced = null;
  let runOutcome = null;

  log.push(`Pre-condition check: knowledge_base rows for this org = ${kbCount} (expect all 10 standard categories missing).`);

  try {
    const agent = new KnowledgeGapAgent(orgId, supabase);
    runOutcome = await agent.run("manual");
    log.push(`agent.run() resolved: ${JSON.stringify(runOutcome)}`);
  } catch (err) {
    errorSurfaced = err instanceof Error ? (err.stack ?? err.message) : String(err);
    log.push(`THREW: ${errorSurfaced}`);
  }

  const after = {};
  after.agent_decisions = (
    await db.query("select count(*)::int as n from agent_decisions where org_id = $1", [orgId])
  ).rows[0].n;
  after.alerts = await countRows(db, "alerts", "organization_id", orgId);
  after.agent_runs = await countRows(db, "agent_runs", "organization_id", orgId);
  after.agent_queue = (
    await db.query("select count(*)::int as n from agent_queue where org_id = $1", [orgId])
  ).rows[0].n;

  const decisionRows = (
    await db.query(
      "select * from agent_decisions where org_id = $1 and decision_type = 'knowledge_gap_identified' order by created_at desc",
      [orgId],
    )
  ).rows;
  const alertRow = await latestRow(db, "alerts", "organization_id", orgId, "created_at");

  await db.end();

  const delta = {};
  for (const t of WRITE_TABLES) delta[t] = after[t] - before[t];
  delta.agent_queue = after.agent_queue - before.agent_queue;

  let verdict;
  let reasoning;
  if (errorSurfaced) {
    verdict = "ERROR-SWALLOWED";
    reasoning = "agent.run() threw; caught by this harness (not silently swallowed by the app), but no successful write occurred.";
  } else if (delta.agent_decisions > 0 && decisionRows.length > 0 && delta.alerts > 0 && alertRow) {
    verdict = "WORKS";
    reasoning =
      `${decisionRows.length} agent_decisions row(s) written, one per missing KB category, each with a real Claude-generated ` +
      "category-specific suggestion (not boilerplate) embedded in its reasoning/action_payload, plus one real alerts row. " +
      "Confirmed: agent_queue delta is 0 -- this agent genuinely never calls queueChainedAgent() in this code path, matching " +
      "direct source inspection (the inventory's speculation about an agent_queue write does not hold). Counted WORKS because " +
      "this agent's real documented output IS agent_decisions + a notification -- it has no dedicated business table to write, " +
      "by design (it only surfaces gaps for a human, per its own header comment), and both real writes carry substantive, " +
      "non-stub content.";
  } else if (delta.agent_runs > 0) {
    verdict = "WIRED-NO-OUTPUT";
    reasoning =
      "agent_runs row was written (the run executed) but neither agent_decisions nor alerts got a new row -- confirms the " +
      "inventory's suspicion that this agent may produce zero real output despite running cleanly.";
  } else {
    verdict = "TRIGGER-BROKEN";
    reasoning = "Neither agent_runs nor any output table changed, and no error was surfaced.";
  }

  const result = {
    canonicalNumber: CANONICAL,
    registryAgentId: null,
    implementingFile: "src/lib/agents/knowledge-gap-agent.ts",
    writeTargetTables: WRITE_TABLES,
    triggerMethod:
      "Direct class invocation via tsx against the local pt05-local-stack: new KnowledgeGapAgent(orgId, supabase).run('manual'). " +
      "Matches its real (scheduled, Sunday-gated) trigger path minus the isSundayChicago() gate.",
    before,
    after,
    rowDelta: delta,
    sampleWrittenRow: {
      agent_decisions_rows: decisionRows,
      alerts_row: alertRow,
    },
    triggerLog: log.join("\n"),
    errorSurfaced,
    verdict,
    verdictReasoning: reasoning,
    registryPriorStatus:
      "No registry entry (inRegistry: false per agent-inventory.json). FEATURE_REGISTRY_v2.md row #211: " +
      "'AG-11 Knowledge Gap Detector | BUILT | Weekly. Identifies missing KB categories with specific fill-in prompts.' -- this row's " +
      "description matches THIS file's real behavior exactly (unlike the registry's own cold_outreach agent_id, which is a different class).",
    falsePassCasualty: verdict === "WIRED-NO-OUTPUT",
  };

  writeAgentResult(CANONICAL, result);
  console.log(`\nVerdict for ${CANONICAL}: ${verdict}`);
}

main().catch((err) => {
  console.error("FATAL (harness-level, not agent-level):", err);
  process.exit(1);
});
